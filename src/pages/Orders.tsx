import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  IconBuilding,
  IconCheck,
  IconClipboardList,
  IconClose,
  IconDownload,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconStore,
  IconTrash,
} from '../components/icons'
import { PurchaseOrderPreviewModal } from '../components/PurchaseOrderPreviewModal'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Stat,
  cx,
  fmtDate,
  rs,
  useConfirm,
  useToast,
} from '../components/ui'
import { PHARMA_COMPANIES, companyCompareKey, companySlug, resolveCanonicalCompany, resolveProductDisplayCompany } from '../lib/companies'
import { useData } from '../lib/data'
import { download } from '../lib/exporter'
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  deletePurchaseOrderItem,
  updatePurchaseOrder,
  updatePurchaseOrderItem,
  upsertPurchaseOrderItems,
} from '../lib/orderActions'
import {
  buildCompanyProductCatalog,
  calculateLineTotal,
  calculateOrderTotals,
  calculateTargetPrice,
  DEFAULT_EXTRA_DISCOUNT_PCT,
  evaluateProductSupplierOffers,
  generateNextOrderNumber,
  roundMoney2,
  toSupplierSnapshots,
} from '../lib/orders'
import { naturalCompare, variantLabel } from '../lib/productParse'
import { generatePurchaseOrderPdf, type PurchaseOrderPdfInput } from '../lib/purchaseOrderPdf'
import type { PriceRecord, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from '../lib/types'

interface LocalLinePatch {
  quantity: string
  targetPrice: string
  isTargetManual: boolean
  notes: string
}

const STATUS_TONE: Record<PurchaseOrderStatus, 'amber' | 'blue' | 'green' | 'red'> = {
  draft: 'amber',
  finalized: 'blue',
  ordered: 'green',
  cancelled: 'red',
}

export default function Orders() {
  const {
    products,
    current,
    shopMap,
    settings,
    purchaseOrders,
    purchaseOrderItems,
    ordersSchemaReady,
    refreshOrders,
    memberName,
  } = useData()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const confirm = useConfirm()

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products])
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [activeOrderId, setActiveOrderId] = useState<string>('')
  const [includeStaleInLowest, setIncludeStaleInLowest] = useState(true)

  // Catalog picker state
  const [catalogSearch, setCatalogSearch] = useState('')
  const [pickedProductIds, setPickedProductIds] = useState<Set<string>>(() => new Set())
  const [defaultAddQty, setDefaultAddQty] = useState('1')

  // Order header editable state
  const [hdrTitle, setHdrTitle] = useState('')
  const [hdrDate, setHdrDate] = useState('')
  const [hdrStatus, setHdrStatus] = useState<PurchaseOrderStatus>('draft')
  const [hdrDiscountPct, setHdrDiscountPct] = useState(String(DEFAULT_EXTRA_DISCOUNT_PCT))
  const [hdrNotes, setHdrNotes] = useState('')
  const [hdrDirty, setHdrDirty] = useState(false)

  // Draft item edits keyed by PurchaseOrderItem.id
  const [lineEdits, setLineEdits] = useState<Record<string, LocalLinePatch>>({})
  const [dirtyLineIds, setDirtyLineIds] = useState<Set<string>>(() => new Set())

  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'sheet' | 'pdf'>('sheet')

  const baseCompareOpt = useMemo(
    () => ({
      freshnessDays: settings.freshness_days,
      excludeStale: false,
      includeStaleInLowest,
    }),
    [settings.freshness_days, includeStaleInLowest],
  )

  const recordsByProduct = useMemo(() => {
    const m = new Map<string, PriceRecord[]>()
    for (const r of current) {
      if (!r.product_id || r.archived) continue
      const arr = m.get(r.product_id)
      if (arr) arr.push(r)
      else m.set(r.product_id, [r])
    }
    return m
  }, [current])

  // Available companies sorted A-Z (listed products + companies with existing orders + Top 50)
  const companyOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; orderCount: number }>()
    for (const c of PHARMA_COMPANIES) {
      counts.set(c.name, { name: c.name, count: 0, orderCount: 0 })
    }
    for (const p of activeProducts) {
      const m = resolveProductDisplayCompany(p, recordsByProduct.get(p.id))
      if (!m) continue
      const cur = counts.get(m) ?? { name: m, count: 0, orderCount: 0 }
      cur.count++
      counts.set(m, cur)
    }
    for (const o of purchaseOrders) {
      const m = resolveCanonicalCompany(o.manufacturer) ?? o.manufacturer
      const cur = counts.get(m) ?? { name: m, count: 0, orderCount: 0 }
      cur.orderCount++
      counts.set(m, cur)
    }
    return [...counts.values()].sort((a, b) => {
      const aActive = a.count > 0 || a.orderCount > 0 ? 0 : 1
      const bActive = b.count > 0 || b.orderCount > 0 ? 0 : 1
      return aActive - bActive || naturalCompare(a.name, b.name)
    })
  }, [activeProducts, recordsByProduct, purchaseOrders])

  // Sync URL ?company= parameter cleanly
  useEffect(() => {
    const qComp = params.get('company')
    if (qComp) {
      const found =
        companyOptions.find(
          (c) => companySlug(c.name) === qComp || c.name.toLowerCase() === qComp.toLowerCase(),
        )?.name ?? resolveCanonicalCompany(qComp)
      if (found && found !== selectedCompany) {
        setSelectedCompany(found)
        return
      }
    }
    if (!selectedCompany && companyOptions.length > 0) {
      const firstActive = companyOptions.find((c) => c.orderCount > 0 || c.count > 0) ?? companyOptions[0]
      if (firstActive) setSelectedCompany(firstActive.name)
    }
  }, [params, companyOptions, selectedCompany])

  // Group existing purchase orders by manufacturer (strict company separation)
  const ordersByCompany = useMemo(() => {
    const m = new Map<string, { manufacturer: string; orders: PurchaseOrder[]; itemCounts: Map<string, number> }>()
    const countMap = new Map<string, number>()
    for (const it of purchaseOrderItems) {
      countMap.set(it.order_id, (countMap.get(it.order_id) ?? 0) + 1)
    }
    for (const o of purchaseOrders) {
      const mfr = resolveCanonicalCompany(o.manufacturer) ?? o.manufacturer
      let g = m.get(mfr)
      if (!g) {
        g = { manufacturer: mfr, orders: [], itemCounts: countMap }
        m.set(mfr, g)
      }
      g.orders.push(o)
    }
    return [...m.values()].sort((a, b) => naturalCompare(a.manufacturer, b.manufacturer))
  }, [purchaseOrders, purchaseOrderItems])

  // Orders for the currently selected company
  const companyOrders = useMemo(() => {
    const targetKey = companyCompareKey(selectedCompany)
    if (!targetKey) return []
    return purchaseOrders.filter((o) => companyCompareKey(o.manufacturer) === targetKey)
  }, [purchaseOrders, selectedCompany])

  const activeOrder = useMemo(
    () => companyOrders.find((o) => o.id === activeOrderId) ?? companyOrders[0] ?? null,
    [companyOrders, activeOrderId],
  )

  // Keep activeOrderId synced with companyOrders
  useEffect(() => {
    if (activeOrder && activeOrder.id !== activeOrderId) {
      setActiveOrderId(activeOrder.id)
    } else if (!activeOrder && activeOrderId) {
      setActiveOrderId('')
    }
  }, [activeOrder, activeOrderId])

  // Populate header form when active order changes
  useEffect(() => {
    if (!activeOrder) {
      setHdrTitle('')
      setHdrDate(new Date().toISOString().slice(0, 10))
      setHdrStatus('draft')
      setHdrDiscountPct(String(DEFAULT_EXTRA_DISCOUNT_PCT))
      setHdrNotes('')
      setHdrDirty(false)
      return
    }
    setHdrTitle(activeOrder.title ?? `${activeOrder.manufacturer} Order`)
    setHdrDate(activeOrder.order_date)
    setHdrStatus(activeOrder.status)
    setHdrDiscountPct(String(activeOrder.extra_discount_pct ?? DEFAULT_EXTRA_DISCOUNT_PCT))
    setHdrNotes(activeOrder.notes ?? '')
    setHdrDirty(false)
  }, [activeOrder])

  const activeItems = useMemo(() => {
    if (!activeOrder) return []
    return purchaseOrderItems
      .filter((it) => it.order_id === activeOrder.id)
      .sort((a, b) => naturalCompare(a.product_name, b.product_name))
  }, [purchaseOrderItems, activeOrder])

  // Populate local line state when activeOrder or items load
  useEffect(() => {
    const next: Record<string, LocalLinePatch> = {}
    for (const it of activeItems) {
      next[it.id] = {
        quantity: String(it.quantity),
        targetPrice: it.target_price != null ? String(it.target_price) : '',
        isTargetManual: it.is_target_manual,
        notes: it.notes ?? '',
      }
    }
    setLineEdits(next)
    setDirtyLineIds(new Set())
  }, [activeOrder?.id, activeItems])

  // Company product catalog (A-Z deduplicated)
  const companyCatalog = useMemo(() => {
    if (!selectedCompany) return []
    return buildCompanyProductCatalog(selectedCompany, activeProducts, current)
  }, [selectedCompany, activeProducts, current])

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    if (!q) return companyCatalog
    return companyCatalog.filter(({ product, records }) => {
      const shopsStr = records.map((r) => shopMap.get(r.shop_id)?.name ?? '').join(' ')
      const hay = `${product.name} ${product.brand ?? ''} ${product.dosage_form ?? ''} ${product.country_of_origin ?? ''} #${product.product_no} ${product.barcode ?? ''} ${product.mfr_code ?? ''} ${shopsStr}`.toLowerCase()
      return hay.includes(q)
    })
  }, [companyCatalog, catalogSearch, shopMap])

  const orderItemByProductId = useMemo(
    () => new Map(activeItems.map((it) => [it.product_id, it])),
    [activeItems],
  )

  const handleSelectCompany = (mfr: string) => {
    setSelectedCompany(mfr)
    setPickedProductIds(new Set())
    setCatalogSearch('')
    const nextParams = new URLSearchParams(params)
    nextParams.set('company', companySlug(mfr))
    setParams(nextParams, { replace: true })
  }

  const handleCreateCompanyOrder = async (companyOverride?: string) => {
    const mfr = companyOverride || selectedCompany
    if (!mfr) return toast('err', 'Select a manufacturer / company first.')
    setBusy(true)
    try {
      const orderNumber = generateNextOrderNumber(purchaseOrders)
      const created = await createPurchaseOrder({
        manufacturer: mfr,
        orderNumber,
        title: `${mfr} Order`,
        extraDiscountPct: DEFAULT_EXTRA_DISCOUNT_PCT,
      })
      await refreshOrders()
      setActiveOrderId(created.id)
      toast('ok', `Created draft order ${created.order_number} for ${mfr}`)
      return created
    } catch (e) {
      toast('err', (e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const addProductsToCompanyOrder = async (productIds: string[]) => {
    if (!selectedCompany || productIds.length === 0) return
    setBusy(true)
    try {
      let targetOrder = activeOrder
      if (!targetOrder || companyCompareKey(targetOrder.manufacturer) !== companyCompareKey(selectedCompany)) {
        const orderNumber = generateNextOrderNumber(purchaseOrders)
        targetOrder = await createPurchaseOrder({
          manufacturer: selectedCompany,
          orderNumber,
          title: `${selectedCompany} Order`,
          extraDiscountPct: DEFAULT_EXTRA_DISCOUNT_PCT,
        })
        setActiveOrderId(targetOrder.id)
      }
      const catalogMap = new Map(companyCatalog.map((c) => [c.product.id, c]))
      const qtyNum = Number(defaultAddQty)
      const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1
      const toAdd = productIds
        .map((id) => catalogMap.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .map((entry) => ({
          product: entry.product,
          records: entry.records,
          shops: shopMap,
          quantity: qty,
          opt: baseCompareOpt,
        }))

      await upsertPurchaseOrderItems(targetOrder, toAdd, activeItems.length)
      await refreshOrders()
      setPickedProductIds((prev) => {
        const next = new Set(prev)
        for (const id of productIds) next.delete(id)
        return next
      })
      toast('ok', `Added ${toAdd.length} product${toAdd.length === 1 ? '' : 's'} to ${targetOrder.order_number}`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const flushDirtyEdits = async (): Promise<boolean> => {
    if (!activeOrder) return true
    try {
      if (hdrDirty) {
        const pctNum = Number(hdrDiscountPct)
        await updatePurchaseOrder(activeOrder.id, {
          title: hdrTitle.trim() || `${activeOrder.manufacturer} Order`,
          order_date: hdrDate || activeOrder.order_date,
          status: hdrStatus,
          extra_discount_pct: Number.isFinite(pctNum) && pctNum >= 0 && pctNum < 100 ? pctNum : DEFAULT_EXTRA_DISCOUNT_PCT,
          notes: hdrNotes.trim() || null,
        })
        setHdrDirty(false)
      }
      const itemUpdates: Promise<unknown>[] = []
      for (const id of dirtyLineIds) {
        const patch = lineEdits[id]
        if (!patch) continue
        const q = Number(patch.quantity)
        const tp = patch.targetPrice.trim() === '' ? null : Number(patch.targetPrice)
        if (!Number.isFinite(q) || q <= 0) {
          toast('err', 'Quantities must be positive numbers.')
          return false
        }
        if (tp !== null && (!Number.isFinite(tp) || tp < 0)) {
          toast('err', 'Target price must be a non-negative number.')
          return false
        }
        itemUpdates.push(
          updatePurchaseOrderItem(id, {
            quantity: Math.round(q * 100) / 100,
            target_price: tp != null ? roundMoney2(tp) : null,
            is_target_manual: patch.isTargetManual,
            notes: patch.notes.trim() || null,
          }),
        )
      }
      if (itemUpdates.length > 0) await Promise.all(itemUpdates)
      setDirtyLineIds(new Set())
      if (hdrDirty || itemUpdates.length > 0) await refreshOrders()
      return true
    } catch (e) {
      toast('err', (e as Error).message)
      return false
    }
  }

  const handleSaveDraft = async () => {
    setBusy(true)
    const ok = await flushDirtyEdits()
    setBusy(false)
    if (ok) toast('ok', `Saved ${activeOrder?.order_number ?? 'order'} to shared workspace`)
  }

  const handleRefreshSupplierQuotes = async () => {
    if (!activeOrder || activeItems.length === 0) return
    setBusy(true)
    try {
      const ok = await flushDirtyEdits()
      if (!ok) return
      const catById = new Map(companyCatalog.map((c) => [c.product.id, c]))
      const pct = Number(hdrDiscountPct)
      const extraPct = Number.isFinite(pct) && pct >= 0 && pct < 100 ? pct : activeOrder.extra_discount_pct
      await Promise.all(
        activeItems.map((it) => {
          const entry = catById.get(it.product_id)
          if (!entry) return Promise.resolve()
          const pricing = evaluateProductSupplierOffers(entry.product, entry.records, shopMap, baseCompareOpt)
          const nextAutoTarget = calculateTargetPrice(pricing.lowestPrice, extraPct)
          return updatePurchaseOrderItem(it.id, {
            selected_shop_id: pricing.lowestShopId,
            selected_shop_name: pricing.lowestShopName,
            lowest_price: pricing.lowestPrice,
            lowest_price_date: pricing.lowestDate,
            target_price: it.is_target_manual ? it.target_price : nextAutoTarget,
            supplier_offers_snapshot: toSupplierSnapshots(pricing.offers),
          })
        }),
      )
      await refreshOrders()
      toast('ok', 'Updated all supplier quotes & lowest comparable prices')
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteItem = async (it: PurchaseOrderItem) => {
    setBusy(true)
    try {
      await deletePurchaseOrderItem(it.id)
      await refreshOrders()
      toast('ok', `Removed ${it.product_name}`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteOrder = async (po: PurchaseOrder) => {
    const ok = await confirm({
      title: `Delete order ${po.order_number}?`,
      body: `This will remove "${po.title || po.manufacturer}" and all its line items. Product master records and supplier prices stay intact.`,
      confirmLabel: 'Delete order',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deletePurchaseOrder(po.id)
      await refreshOrders()
      toast('ok', `Deleted ${po.order_number}`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Build live evaluated lines merging persisted PO lines + live catalog quotes + local edits
  const displayLines = useMemo(() => {
    const catById = new Map(companyCatalog.map((c) => [c.product.id, c]))
    const pctNum = Number(hdrDiscountPct)
    const extraPct = Number.isFinite(pctNum) && pctNum >= 0 && pctNum < 100 ? pctNum : DEFAULT_EXTRA_DISCOUNT_PCT

    return activeItems.map((it) => {
      const catEntry = catById.get(it.product_id)
      const livePricing = catEntry
        ? evaluateProductSupplierOffers(catEntry.product, catEntry.records, shopMap, baseCompareOpt)
        : null
      const lowestPrice = livePricing ? livePricing.lowestPrice : it.lowest_price
      const lowestShopName = livePricing ? livePricing.lowestShopName : it.selected_shop_name
      const lowestDate = livePricing ? livePricing.lowestDate : it.lowest_price_date
      const offers = livePricing ? toSupplierSnapshots(livePricing.offers) : it.supplier_offers_snapshot
      const patch = lineEdits[it.id]
      const qty = patch ? Math.max(0, Number(patch.quantity) || 0) : it.quantity
      const autoTarget = calculateTargetPrice(lowestPrice, extraPct)
      const targetPrice = patch
        ? patch.isTargetManual
          ? patch.targetPrice.trim() === ''
            ? null
            : roundMoney2(Number(patch.targetPrice))
          : autoTarget
        : it.is_target_manual
          ? it.target_price
          : autoTarget

      const productVariant = catEntry
        ? [variantLabel(catEntry.product), catEntry.product.country_of_origin].filter(Boolean).join(' · ') || null
        : it.variant_label

      return {
        item: it,
        product: catEntry?.product ?? null,
        variant: productVariant,
        livePricing,
        offers,
        lowestPrice,
        lowestShopName,
        lowestDate,
        autoTarget,
        targetPrice,
        isTargetManual: patch ? patch.isTargetManual : it.is_target_manual,
        qty,
        lineTotal: calculateLineTotal(qty, targetPrice),
        marketLineTotal: calculateLineTotal(qty, lowestPrice),
      }
    })
  }, [activeItems, companyCatalog, shopMap, baseCompareOpt, lineEdits, hdrDiscountPct])

  const totals = useMemo(
    () =>
      calculateOrderTotals(
        displayLines.map((l) => ({
          quantity: l.qty,
          lowest_price: l.lowestPrice,
          target_price: l.targetPrice,
        })),
      ),
    [displayLines],
  )

  const poPdfInput: PurchaseOrderPdfInput | null = useMemo(() => {
    if (!activeOrder) return null
    const pctNum = Number(hdrDiscountPct)
    return {
      orderNumber: activeOrder.order_number,
      dateLabel: fmtDate(hdrDate || activeOrder.order_date),
      manufacturer: activeOrder.manufacturer,
      title: hdrTitle || activeOrder.title,
      status: hdrStatus,
      extraDiscountPct: Number.isFinite(pctNum) ? pctNum : DEFAULT_EXTRA_DISCOUNT_PCT,
      notes: hdrNotes,
      lines: displayLines.map((l) => ({
        productName: l.item.product_name,
        variantLabel: l.variant,
        manufacturer: l.item.manufacturer,
        quantity: l.qty > 0 ? l.qty : 1,
        lowestPrice: l.lowestPrice,
        lowestShopName: l.lowestShopName,
        lowestPriceDate: l.lowestDate,
        targetPrice: l.targetPrice,
        isTargetManual: l.isTargetManual,
        offers: l.offers,
        notes: lineEdits[l.item.id]?.notes ?? l.item.notes,
      })),
    }
  }, [activeOrder, hdrDate, hdrTitle, hdrStatus, hdrDiscountPct, hdrNotes, displayLines, lineEdits])

  const openPreview = async (mode: 'sheet' | 'pdf') => {
    if (dirtyLineIds.size > 0 || hdrDirty) {
      await flushDirtyEdits()
    }
    setPreviewMode(mode)
    setPreviewOpen(true)
  }

  const handleQuickDownloadPdf = async () => {
    if (!poPdfInput || poPdfInput.lines.length === 0) return toast('err', 'Add items to your order first.')
    if (dirtyLineIds.size > 0 || hdrDirty) await flushDirtyEdits()
    const bytes = generatePurchaseOrderPdf(poPdfInput)
    download(
      `HAFSA-MEDICALS-${poPdfInput.orderNumber}-${companySlug(poPdfInput.manufacturer)}.pdf`,
      bytes.buffer as ArrayBuffer,
      'application/pdf',
    )
    toast('ok', `Downloaded ${poPdfInput.orderNumber}.pdf`)
  }

  const handleQuickPrint = async () => {
    if (!poPdfInput || poPdfInput.lines.length === 0) return toast('err', 'Add items to your order first.')
    if (dirtyLineIds.size > 0 || hdrDirty) await flushDirtyEdits()
    setPreviewMode('sheet')
    setPreviewOpen(true)
    setTimeout(() => window.print(), 120)
  }

  const hasUnsavedChanges = hdrDirty || dirtyLineIds.size > 0

  return (
    <div className="min-w-0 space-y-4 pb-10">
      <PageHeader
        title="Purchase Orders"
        subtitle="Create company-wise draft orders, compare all supplier quotes with -5% negotiation targets, and print clean Purchase Orders for Hafsa Medicals."
      >
        <Button small onClick={() => void handleCreateCompanyOrder()} disabled={!selectedCompany || !ordersSchemaReady || busy}>
          <IconPlus size={15} />
          <span>New {selectedCompany ? selectedCompany.split(' ')[0] : 'Company'} Order</span>
        </Button>
      </PageHeader>

      {!ordersSchemaReady && (
        <Card className="!p-3.5 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]">
          <div className="text-sm font-medium text-[var(--color-warning-text)]">
            Orders database migration pending (`0004_matching_country_and_orders.sql`)
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Run <code>supabase/migrations/0004_matching_country_and_orders.sql</code> in Supabase SQL Editor so draft purchase orders sync across workspace members.
          </p>
        </Card>
      )}

      {/* Company-wise Saved Draft Orders Summary Strip */}
      {ordersByCompany.length > 0 && (
        <Card className="!p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              <IconClipboardList size={14} className="text-[var(--color-primary)]" />
              <span>Workspace Orders by Company ({purchaseOrders.length})</span>
            </div>
            <span className="text-[11px] text-[var(--text-secondary)]">Click any company order to edit</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {ordersByCompany.map((grp) =>
              grp.orders.map((po) => {
                const isActive = activeOrder?.id === po.id
                const cnt = grp.itemCounts.get(po.id) ?? 0
                return (
                  <button
                    key={po.id}
                    type="button"
                    onClick={() => {
                      handleSelectCompany(grp.manufacturer)
                      setActiveOrderId(po.id)
                    }}
                    className={cx(
                      'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                      isActive
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--text-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <span className="font-semibold">{grp.manufacturer}</span>
                    <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                      {po.order_number} · {cnt} item{cnt === 1 ? '' : 's'}
                    </span>
                    <Badge tone={po.status === 'draft' ? 'amber' : STATUS_TONE[po.status]}>{po.status}</Badge>
                  </button>
                )
              }),
            )}
          </div>
        </Card>
      )}

      {/* Step 1: Company Selector + Company Product Picker */}
      <Card className="!p-3.5 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Field label="Select Manufacturer / Company (company-wise order)" className="min-w-0 flex-1">
            <Select
              value={selectedCompany}
              onChange={(e) => handleSelectCompany(e.target.value)}
              aria-label="Select manufacturer for order"
            >
              {companyOptions.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                  {c.count > 0 ? ` (${c.count} products)` : ' (0 products listed)'}
                  {c.orderCount > 0 ? ` · ${c.orderCount} order${c.orderCount === 1 ? '' : 's'}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          {companyOrders.length > 0 && (
            <Field label={`Active ${selectedCompany.split(' ')[0]} Order`} className="md:w-72">
              <Select
                value={activeOrder?.id ?? ''}
                onChange={(e) => setActiveOrderId(e.target.value)}
                aria-label="Select company draft order"
              >
                {companyOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.order_number} — {fmtDate(po.order_date)} ({po.status})
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {/* Company Products Picker */}
        <div className="space-y-2.5 border-t border-[var(--border-default)] pt-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                type="search"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder={`Search ${selectedCompany || 'company'} medicines by name, strength, code, or shop…`}
                className="min-h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--color-primary)] focus:outline-none"
              />
              {catalogSearch && (
                <button
                  type="button"
                  onClick={() => setCatalogSearch('')}
                  aria-label="Clear product search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)]"
                >
                  <IconClose size={14} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span>Default qty:</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={defaultAddQty}
                  onChange={(e) => setDefaultAddQty(e.target.value)}
                  className="h-8 w-16 rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)] tabular-nums"
                />
              </label>
              {pickedProductIds.size > 0 && (
                <Button
                  small
                  disabled={!ordersSchemaReady || busy}
                  onClick={() => void addProductsToCompanyOrder([...pickedProductIds])}
                >
                  <IconPlus size={14} />
                  <span>Add {pickedProductIds.size} selected to Order</span>
                </Button>
              )}
            </div>
          </div>

          {companyCatalog.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)] p-4 text-center text-xs text-[var(--text-secondary)]">
              No products assigned to <b>{selectedCompany}</b> yet. Categorize products in the Companies page or select another company above.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] divide-y divide-[var(--border-default)]">
              {filteredCatalog.length === 0 ? (
                <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
                  No products match “{catalogSearch}”.
                </div>
              ) : (
                filteredCatalog.slice(0, 120).map(({ product, records }) => {
                  const pricing = evaluateProductSupplierOffers(product, records, shopMap, baseCompareOpt)
                  const inOrder = orderItemByProductId.has(product.id)
                  const checked = pickedProductIds.has(product.id)
                  const vl = [variantLabel(product), product.country_of_origin].filter(Boolean).join(' · ')
                  return (
                    <div
                      key={product.id}
                      className={cx(
                        'flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--bg-hover)]',
                        inOrder && 'bg-[var(--color-best-bg)]/35',
                      )}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setPickedProductIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(product.id)) next.delete(product.id)
                              else next.add(product.id)
                              return next
                            })
                          }
                          className="h-4 w-4 shrink-0 rounded"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-semibold text-[var(--text-primary)]">{product.name}</span>
                            {vl && <Badge tone="blue">{vl}</Badge>}
                            {inOrder && <Badge tone="green">In order</Badge>}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)] tabular-nums">
                            {records.length === 0
                              ? 'No supplier quote yet'
                              : pricing.lowestPrice != null
                                ? `Lowest: ${rs(pricing.lowestPrice)} (${pricing.lowestShopName} · ${fmtDate(pricing.lowestDate ?? '')})${pricing.lowestIsStale ? ' · Old' : ''} → -5% Target ${rs(pricing.targetPrice5Pct)}`
                                : `${records.length} supplier offer${records.length === 1 ? '' : 's'} (discount % / no Rs base rate)`}
                          </div>
                        </div>
                      </label>

                      <Button
                        small
                        variant={inOrder ? 'secondary' : 'ghost'}
                        disabled={!ordersSchemaReady || busy}
                        onClick={() => void addProductsToCompanyOrder([product.id])}
                      >
                        <IconPlus size={13} />
                        <span>{inOrder ? 'Update' : 'Add'}</span>
                      </Button>
                    </div>
                  )
                })
              )}
              {filteredCatalog.length > 120 && (
                <div className="px-3 py-2 text-center text-[11px] text-[var(--text-secondary)]">
                  Showing first 120 matching products — refine your search above.
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Step 2 & 3: Active Draft Order + Supplier Comparison + 5% Target Pricing */}
      {!activeOrder ? (
        <Empty title={`No active order for ${selectedCompany || 'selected company'}`}>
          <p className="mb-3">
            Select products above and click Add to automatically start a draft order for <b>{selectedCompany}</b>, or start an empty draft now.
          </p>
          <Button small onClick={() => void handleCreateCompanyOrder()} disabled={!selectedCompany || !ordersSchemaReady || busy}>
            <IconPlus size={14} />
            <span>Start {selectedCompany} Draft Order</span>
          </Button>
        </Empty>
      ) : (
        <div className="space-y-4">
          {/* Active Order Header & Totals KPIs */}
          <Card className="space-y-3 border-[var(--color-primary-border)]">
            <div className="flex flex-wrap items-start justify-between gap-2.5 border-b border-[var(--border-default)] pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <IconBuilding size={16} className="text-[var(--color-primary)]" />
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">{activeOrder.manufacturer}</h2>
                  <Badge tone="blue">{activeOrder.order_number}</Badge>
                  <Badge tone={activeOrder.status === 'draft' ? 'amber' : STATUS_TONE[activeOrder.status]}>
                    {activeOrder.status}
                  </Badge>
                  {hasUnsavedChanges && <Badge tone="amber">Unsaved edits</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  Company-locked order · Last updated by {memberName(activeOrder.updated_by ?? activeOrder.created_by)} on{' '}
                  {fmtDate(activeOrder.updated_at)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  small
                  variant="secondary"
                  disabled={busy || activeItems.length === 0}
                  onClick={() => void handleRefreshSupplierQuotes()}
                  title="Pull latest supplier prices from catalog without overwriting manual target prices"
                >
                  <IconRefresh size={14} />
                  <span>Sync latest prices</span>
                </Button>
                <Button small variant="danger" disabled={busy} onClick={() => void handleDeleteOrder(activeOrder)}>
                  <IconTrash size={14} />
                  <span>Delete order</span>
                </Button>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Order Title">
                <Input
                  value={hdrTitle}
                  onChange={(e) => {
                    setHdrTitle(e.target.value)
                    setHdrDirty(true)
                  }}
                />
              </Field>
              <Field label="Order Date">
                <Input
                  type="date"
                  value={hdrDate}
                  onChange={(e) => {
                    setHdrDate(e.target.value)
                    setHdrDirty(true)
                  }}
                />
              </Field>
              <Field label="Additional Target Discount (%)">
                <Input
                  type="number"
                  min={0}
                  max={99}
                  step={0.5}
                  value={hdrDiscountPct}
                  onChange={(e) => {
                    setHdrDiscountPct(e.target.value)
                    setHdrDirty(true)
                  }}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={hdrStatus}
                  onChange={(e) => {
                    setHdrStatus(e.target.value as PurchaseOrderStatus)
                    setHdrDirty(true)
                  }}
                >
                  <option value="draft">Draft</option>
                  <option value="finalized">Finalized</option>
                  <option value="ordered">Sent / Ordered</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-2.5 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Order Notes / Instructions (printed on PO)">
                <Input
                  placeholder="e.g. Urgent stock · Include batch expiry > 12 months"
                  value={hdrNotes}
                  onChange={(e) => {
                    setHdrNotes(e.target.value)
                    setHdrDirty(true)
                  }}
                />
              </Field>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={includeStaleInLowest}
                  onChange={(e) => setIncludeStaleInLowest(e.target.checked)}
                />
                <span>Include older quotes (&gt;{settings.freshness_days}d) in lowest calculation</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Products in order" value={`${totals.totalItems} (${totals.totalUnits} qty)`} />
              <Stat
                label="Lowest Market Benchmark"
                value={totals.marketTotal > 0 ? rs(totals.marketTotal) : '—'}
              />
              <Stat
                label={`Requested PO Total (-${hdrDiscountPct || 5}%)`}
                value={totals.targetTotal > 0 ? rs(totals.targetTotal) : '—'}
                tone="green"
              />
              <Stat
                label="Negotiation Target Savings"
                value={totals.estimatedExtraSavings > 0 ? rs(totals.estimatedExtraSavings) : '—'}
                tone={totals.estimatedExtraSavings > 0 ? 'blue' : undefined}
              />
            </div>
          </Card>

          {/* Draft Order Line Items + Full Supplier Comparison */}
          {displayLines.length === 0 ? (
            <Empty title="This draft order has no products yet">
              <p>Use the {activeOrder.manufacturer} catalog picker above to add medicines.</p>
            </Empty>
          ) : (
            <div className="space-y-3">
              {displayLines.map((line, idx) => {
                const it = line.item
                const patch = lineEdits[it.id] ?? {
                  quantity: String(it.quantity),
                  targetPrice: it.target_price != null ? String(it.target_price) : '',
                  isTargetManual: it.is_target_manual,
                  notes: it.notes ?? '',
                }
                const setPatch = (up: Partial<LocalLinePatch>) => {
                  setLineEdits((prev) => ({ ...prev, [it.id]: { ...patch, ...up } }))
                  setDirtyLineIds((prev) => new Set(prev).add(it.id))
                }

                return (
                  <Card key={it.id} className="space-y-3 !p-3.5">
                    {/* Line Header */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">#{idx + 1}</span>
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{it.product_name}</span>
                          <Badge tone="slate">{it.manufacturer}</Badge>
                          {line.variant && <Badge tone="blue">{line.variant}</Badge>}
                          {line.livePricing?.lowestIsStale && line.lowestDate && (
                            <Badge tone="amber">Lowest quote old · {fmtDate(line.lowestDate)}</Badge>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteItem(it)}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-xs font-medium text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)]"
                      >
                        <IconTrash size={13} />
                        <span>Remove</span>
                      </button>
                    </div>

                    {/* All Supplier Quotes for this Product */}
                    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-2.5">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                        <IconStore size={13} className="text-[var(--color-primary)]" />
                        <span>Available Supplier Quotes ({line.offers.length})</span>
                      </div>

                      {line.offers.length === 0 ? (
                        <div className="text-xs text-[var(--text-secondary)]">
                          No recorded supplier prices yet. Enter your target negotiation price below manually.
                        </div>
                      ) : (
                        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {line.offers.map((o, oi) => {
                            const isWin = o.comparable && line.lowestPrice != null && o.effective_cost === line.lowestPrice
                            return (
                              <div
                                key={`${o.shop_id}-${oi}`}
                                className={cx(
                                  'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
                                  isWin
                                    ? 'border-[var(--color-best-border)] bg-[var(--color-best-bg)]'
                                    : o.comparable
                                      ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
                                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] opacity-75',
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="truncate font-semibold text-[var(--text-primary)]">{o.shop_name}</span>
                                    {isWin && <Badge tone="solid">LOWEST</Badge>}
                                    {!o.fresh && <Badge tone="amber">Stale · {o.age_days}d</Badge>}
                                  </div>
                                  <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)] tabular-nums">
                                    {fmtDate(o.observed_on)}
                                    {o.scheme_text ? ` · ${o.scheme_text}` : ''}
                                    {o.status_note ? ` · ${o.status_note}` : ''}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right tabular-nums">
                                  <div className={cx('font-bold', isWin ? 'text-[var(--color-best)]' : 'text-[var(--text-primary)]')}>
                                    {o.effective_cost != null && o.effective_cost > 0
                                      ? o.currency && o.currency !== 'PKR'
                                        ? `${o.currency} ${o.effective_cost}`
                                        : rs(o.effective_cost)
                                      : o.discount_pct != null
                                        ? `${o.discount_pct}% disc`
                                        : '—'}
                                  </div>
                                  {o.recorded_price != null && o.effective_cost != null && o.recorded_price !== o.effective_cost && (
                                    <div className="text-[10.5px] text-[var(--text-secondary)]">Base {rs(o.recorded_price)}</div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Lowest Market, -5% Negotiation Target, Qty, Line Total */}
                    <div className="grid gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
                      <div>
                        <div className="text-[11px] font-medium text-[var(--text-secondary)]">Lowest Comparable Price</div>
                        <div className="mt-0.5 text-sm font-bold text-[var(--text-primary)] tabular-nums">
                          {line.lowestPrice != null ? rs(line.lowestPrice) : 'Unavailable (no Rs quote)'}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          {line.lowestShopName ? `${line.lowestShopName}${line.lowestDate ? ` · ${fmtDate(line.lowestDate)}` : ''}` : 'No comparable Rs quote'}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
                          <span>Target Price (-{hdrDiscountPct || 5}% negotiation)*</span>
                          {patch.isTargetManual && line.autoTarget != null && (
                            <button
                              type="button"
                              onClick={() =>
                                setPatch({
                                  targetPrice: String(line.autoTarget),
                                  isTargetManual: false,
                                })
                              }
                              className="font-semibold text-[var(--color-primary)] hover:underline"
                            >
                              Reset to -{hdrDiscountPct || 5}%
                            </button>
                          )}
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={patch.isTargetManual ? patch.targetPrice : line.autoTarget != null ? String(line.autoTarget) : patch.targetPrice}
                          placeholder={line.autoTarget != null ? String(line.autoTarget) : 'Enter target Rs'}
                          onChange={(e) =>
                            setPatch({
                              targetPrice: e.target.value,
                              isTargetManual: true,
                            })
                          }
                          aria-label={`Target price for ${it.product_name}`}
                          className="mt-1 !min-h-8.5 text-sm font-semibold tabular-nums"
                        />
                        <div className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">
                          {patch.isTargetManual ? 'Manual negotiation target' : 'Auto target · Not a confirmed supplier price'}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium text-[var(--text-secondary)]">Order Quantity</div>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={patch.quantity}
                          onChange={(e) => setPatch({ quantity: e.target.value })}
                          aria-label={`Quantity for ${it.product_name}`}
                          className="mt-1 !min-h-8.5 text-sm font-semibold tabular-nums"
                        />
                        <div className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">Units / packs</div>
                      </div>

                      <div className="text-left lg:text-right">
                        <div className="text-[11px] font-medium text-[var(--text-secondary)]">Line Total (at Target)</div>
                        <div className="mt-0.5 text-base font-bold text-[var(--color-best)] tabular-nums">
                          {line.lineTotal != null ? rs(line.lineTotal) : '—'}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                          {line.marketLineTotal != null ? `Market est: ${rs(line.marketLineTotal)}` : 'Enter qty & target rate'}
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Action Footer */}
          <Card className="border-[var(--color-primary-border)] bg-[var(--bg-surface)] p-3.5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 tabular-nums">
                <div className="text-xs text-[var(--text-secondary)]">
                  {activeOrder.manufacturer} · {activeOrder.order_number} · {totals.totalItems} items ({totals.totalUnits} qty)
                </div>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-base font-bold text-[var(--text-primary)]">
                    PO Target Grand Total: {totals.targetTotal > 0 ? rs(totals.targetTotal) : '—'}
                  </span>
                  {totals.estimatedExtraSavings > 0 && (
                    <span className="text-xs font-medium text-[var(--color-best)]">
                      Saves {rs(totals.estimatedExtraSavings)} vs market lowest
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  small
                  variant={hasUnsavedChanges ? 'primary' : 'secondary'}
                  disabled={busy}
                  onClick={() => void handleSaveDraft()}
                >
                  <IconCheck size={14} />
                  <span>{busy ? 'Saving…' : hasUnsavedChanges ? 'Save Draft Changes' : 'Saved Draft'}</span>
                </Button>
                <Button
                  small
                  variant="secondary"
                  disabled={displayLines.length === 0 || busy}
                  onClick={() => void openPreview('pdf')}
                >
                  <IconClipboardList size={14} />
                  <span>Preview PDF</span>
                </Button>
                <Button
                  small
                  variant="secondary"
                  disabled={displayLines.length === 0 || busy}
                  onClick={() => void handleQuickPrint()}
                >
                  <IconPrinter size={14} />
                  <span>Print PDF</span>
                </Button>
                <Button
                  small
                  disabled={displayLines.length === 0 || busy}
                  onClick={() => void handleQuickDownloadPdf()}
                >
                  <IconDownload size={14} />
                  <span>Download PDF</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {poPdfInput && (
        <PurchaseOrderPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          input={poPdfInput}
          initialMode={previewMode}
        />
      )}
    </div>
  )
}
