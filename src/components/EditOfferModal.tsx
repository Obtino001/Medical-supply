import { useEffect, useMemo, useState } from 'react'
import { buildManualOfferPatch, createManualPriceRecord, updatePriceRecordOffer } from '../lib/actions'
import { useData } from '../lib/data'
import { parseNumber } from '../lib/scheme'
import type { PriceRecord, Product } from '../lib/types'
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, cx, rs, useToast } from './ui'

type OfferMode = 'smart' | 'net' | 'discount' | 'tp'

export interface EditOfferModalProps {
  open: boolean
  onClose: () => void
  /** Specific price record to edit (if opened from an offer row) */
  record?: PriceRecord | null
  /** Canonical product (if opened from a product row) */
  product?: Product | null
  /** All current price records for this product so the user can switch shops or add a shop offer */
  records?: PriceRecord[]
  onSaved?: () => void | Promise<void>
}

function initialExprFromRecord(rec: PriceRecord | null | undefined): string {
  if (!rec) return ''
  if (rec.source_attrs?.is_net_price && rec.base_price != null) return `N ${rec.base_price}`
  if (rec.price_is_net && rec.base_price != null && !rec.discount_pct) return `N ${rec.base_price}`
  if (rec.source_attrs?.offer_raw) return rec.source_attrs.offer_raw
  if (rec.source_attrs?.is_trade_price || /^tp\b/i.test(rec.scheme_text ?? '')) return 'TP'
  if (rec.base_price != null && !rec.scheme_text) return String(rec.base_price)
  if (rec.scheme_text) return rec.scheme_text
  if (rec.discount_pct != null) return `${rec.discount_pct}%`
  return ''
}

function detectInitialMode(rec: PriceRecord | null | undefined): OfferMode {
  if (!rec) return 'smart'
  if (rec.source_attrs?.is_net_price || (rec.price_is_net && rec.base_price != null)) return 'net'
  if (rec.source_attrs?.is_trade_price || /^tp\b/i.test(rec.scheme_text ?? '')) return 'tp'
  if (rec.discount_pct != null && rec.discount_pct > 0 && rec.base_price == null) return 'discount'
  return 'smart'
}

export function EditOfferModal({
  open,
  onClose,
  record,
  product,
  records = [],
  onSaved,
}: EditOfferModalProps) {
  const { shops, shopMap, productMap, reload } = useData()
  const toast = useToast()
  const activeShops = useMemo(() => shops.filter((s) => s.status === 'active'), [shops])

  const resolvedProduct = product ?? (record?.product_id ? productMap.get(record.product_id) ?? null : null)
  const productRecords = useMemo(
    () => (records.length > 0 ? records : record ? [record] : []),
    [records, record],
  )

  const [selectedRecId, setSelectedRecId] = useState<string>(record?.id ?? productRecords[0]?.id ?? '__new__')
  const activeRec = useMemo(
    () => (selectedRecId === '__new__' ? null : productRecords.find((r) => r.id === selectedRecId) ?? record ?? null),
    [selectedRecId, productRecords, record],
  )

  const [newShopId, setNewShopId] = useState<string>(activeShops[0]?.id ?? '')
  const [mode, setMode] = useState<OfferMode>(() => detectInitialMode(activeRec))
  const [smartExpr, setSmartExpr] = useState<string>(() => initialExprFromRecord(activeRec))
  const [netRate, setNetRate] = useState<string>(() => (activeRec?.base_price != null ? String(activeRec.base_price) : ''))
  const [discPct, setDiscPct] = useState<string>(() =>
    activeRec?.discount_pct != null && activeRec.discount_pct > 0 ? String(activeRec.discount_pct) : '',
  )
  const [cartonPct, setCartonPct] = useState<string>(() =>
    activeRec?.source_attrs?.carton_discount_pct != null ? String(activeRec.source_attrs.carton_discount_pct) : '',
  )
  const [baseTradePrice, setBaseTradePrice] = useState<string>(() =>
    activeRec?.base_price != null && !activeRec?.price_is_net ? String(activeRec.base_price) : '',
  )
  const [productName, setProductName] = useState<string>(resolvedProduct?.name ?? activeRec?.original_title ?? '')
  const [notes, setNotes] = useState<string>(activeRec?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const targetRec = record ?? productRecords[0] ?? null
    setSelectedRecId(targetRec?.id ?? '__new__')
  }, [record, productRecords, open])

  useEffect(() => {
    setMode(detectInitialMode(activeRec))
    setSmartExpr(initialExprFromRecord(activeRec))
    setNetRate(activeRec?.base_price != null ? String(activeRec.base_price) : '')
    setDiscPct(activeRec?.discount_pct != null && activeRec.discount_pct > 0 ? String(activeRec.discount_pct) : '')
    setCartonPct(activeRec?.source_attrs?.carton_discount_pct != null ? String(activeRec.source_attrs.carton_discount_pct) : '')
    setBaseTradePrice(activeRec?.base_price != null && !activeRec?.price_is_net ? String(activeRec.base_price) : '')
    setProductName(resolvedProduct?.name ?? activeRec?.original_title ?? '')
    setNotes(activeRec?.notes ?? '')
    setErr(null)
  }, [activeRec, resolvedProduct])

  // Compute the offer expression from the active mode
  const computedInput = useMemo(() => {
    const tpVal = parseNumber(baseTradePrice)
    if (mode === 'net') {
      const nVal = parseNumber(netRate)
      return {
        offerExpr: nVal != null && nVal > 0 ? `N ${nVal}` : netRate.trim(),
        basePriceOverride: nVal != null && nVal > 0 ? nVal : null,
        priceIsNet: true,
      }
    }
    if (mode === 'tp') {
      return {
        offerExpr: 'TP',
        basePriceOverride: tpVal != null && tpVal > 0 ? tpVal : null,
        priceIsNet: false,
      }
    }
    if (mode === 'discount') {
      const dVal = parseNumber(discPct)
      const cVal = parseNumber(cartonPct)
      const parts: string[] = []
      if (dVal != null && dVal >= 0) parts.push(`${dVal}%`)
      if (cVal != null && cVal > 0) parts.push(`COTON ${cVal}%`)
      return {
        offerExpr: parts.join(' ') || discPct.trim(),
        basePriceOverride: tpVal != null && tpVal > 0 ? tpVal : null,
        priceIsNet: false,
      }
    }
    // Smart mode
    return {
      offerExpr: smartExpr.trim(),
      basePriceOverride: tpVal != null && tpVal > 0 ? tpVal : null,
      priceIsNet: false,
    }
  }, [mode, smartExpr, netRate, discPct, cartonPct, baseTradePrice])

  const preview = useMemo(
    () => buildManualOfferPatch(computedInput, activeRec?.source_attrs),
    [computedInput, activeRec],
  )

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!computedInput.offerExpr && computedInput.basePriceOverride == null) {
      setErr('Please enter a rate, N (Net price), discount %, or select TP.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const payload = {
        ...computedInput,
        originalTitle: productName.trim() || undefined,
        productName: productName.trim() || undefined,
        notes,
      }
      if (activeRec) {
        await updatePriceRecordOffer(activeRec, payload)
      } else if (resolvedProduct) {
        if (!newShopId) throw new Error('Please select a supplier / shop.')
        await createManualPriceRecord(resolvedProduct, newShopId, payload)
      } else {
        throw new Error('No product or price record selected.')
      }
      await reload()
      await onSaved?.()
      toast('ok', 'Offer updated')
      onClose()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit item price & offer">
      <form onSubmit={(e) => void handleSave(e)} className="space-y-3.5">
        {/* Supplier selector when editing from a product row */}
        {productRecords.length > 0 ? (
          <Field label="Supplier offer to edit">
            <Select value={selectedRecId} onChange={(e) => setSelectedRecId(e.target.value)}>
              {productRecords.map((r) => {
                const sName = shopMap.get(r.shop_id)?.name ?? 'Supplier'
                const curLabel =
                  r.effective_cost != null
                    ? rs(r.effective_cost)
                    : r.scheme_text || (r.base_price != null ? rs(r.base_price) : 'No rate')
                return (
                  <option key={r.id} value={r.id}>
                    {sName} — {curLabel}
                  </option>
                )
              })}
              {resolvedProduct && activeShops.length > 0 && (
                <option value="__new__">+ Add offer for another shop…</option>
              )}
            </Select>
          </Field>
        ) : null}

        {selectedRecId === '__new__' && resolvedProduct && (
          <Field label="Select supplier / shop" required>
            <Select value={newShopId} onChange={(e) => setNewShopId(e.target.value)}>
              <option value="">Select shop…</option>
              {activeShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* Product Name */}
        <Field label="Product / medicine name">
          <Input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. DOLOR SYP"
          />
        </Field>

        {/* 4-Mode Selector Tabs */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--text-primary)]">
            How is this item priced?
          </span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(
              [
                ['smart', 'Smart Input', 'N 75, TP, 15%…'],
                ['net', 'Net Fixed (N)', 'Fixed Rs rate'],
                ['discount', 'Discount %', 'DES% / Carton %'],
                ['tp', 'Trade Price', 'TP (0% disc.)'],
              ] as const
            ).map(([k, title, sub]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={cx(
                  'flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors',
                  mode === k
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <span className="text-xs font-semibold">{title}</span>
                <span className="text-[10.5px] text-[var(--text-secondary)]">{sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mode-specific inputs */}
        {mode === 'smart' && (
          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
            <Field
              label="Offer Rate / Net Price / Discount"
              hint='Write "N 75" for Net Rs 75 fixed, "TP" for Trade Price (0% disc.), "15%" for discount, or "15% COTON 8%".'
            >
              <Input
                value={smartExpr}
                onChange={(e) => setSmartExpr(e.target.value)}
                placeholder="e.g. N 75, TP, 15%, 15% COTON 8%, or 145"
                autoFocus
              />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-[var(--text-secondary)]">Quick set:</span>
              {['TP', 'N 75', 'N 100', '5%', '10%', '12%', '15%', '20%', '15% COTON 8%'].map((presetVal) => (
                <button
                  key={presetVal}
                  type="button"
                  onClick={() => setSmartExpr(presetVal)}
                  className={cx(
                    'rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
                    smartExpr.toUpperCase() === presetVal
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-text)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {presetVal}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'net' && (
          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
            <Field
              label="Fixed Net Price in Rs (N)"
              hint="Fixed net rate in the market (no discount % applies)."
            >
              <Input
                type="number"
                step="any"
                min="0"
                value={netRate}
                onChange={(e) => setNetRate(e.target.value)}
                placeholder="e.g. 75"
                autoFocus
              />
            </Field>
          </div>
        )}

        {mode === 'discount' && (
          <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3 sm:grid-cols-2">
            <Field label="Discount % (DES%)" hint="Loose / standard discount %">
              <Input
                type="number"
                step="any"
                min="0"
                max="99.9"
                value={discPct}
                onChange={(e) => setDiscPct(e.target.value)}
                placeholder="e.g. 15"
                autoFocus
              />
            </Field>
            <Field label="Full Box / Carton % (optional)" hint="If full carton has a different %">
              <Input
                type="number"
                step="any"
                min="0"
                max="99.9"
                value={cartonPct}
                onChange={(e) => setCartonPct(e.target.value)}
                placeholder="e.g. 8"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label="Market Trade Price (TP) in Rs (optional)"
                hint="Leave blank if the sheet only gives discount %, or enter TP in Rs to calculate effective Rs price."
              >
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={baseTradePrice}
                  onChange={(e) => setBaseTradePrice(e.target.value)}
                  placeholder="Optional — e.g. 250"
                />
              </Field>
            </div>
          </div>
        )}

        {mode === 'tp' && (
          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
            <div className="text-xs text-[var(--text-primary)]">
              <b>Trade Price (TP)</b> — Item is sold at market Trade Price with <b>0% discount</b>.
            </div>
            <Field
              label="Market Trade Price (TP) in Rs (optional)"
              hint="If you know the market TP in Rs, enter it here; otherwise leave blank to record as TP."
            >
              <Input
                type="number"
                step="any"
                min="0"
                value={baseTradePrice}
                onChange={(e) => setBaseTradePrice(e.target.value)}
                placeholder="Optional — e.g. 180"
              />
            </Field>
          </div>
        )}

        {/* Live Result Preview */}
        <div className="rounded-xl border border-[var(--color-best-border)] bg-[var(--color-best-bg)] px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-[var(--text-secondary)]">Parsed result preview:</span>
            <Badge tone={preview.scheme_status === 'ok' ? 'green' : 'amber'}>
              {preview.price_is_net
                ? 'Fixed Net Rate'
                : preview.source_attrs.is_trade_price
                  ? 'Trade Price (TP)'
                  : preview.discount_pct != null
                    ? `${preview.discount_pct}% Discount`
                    : preview.scheme_status === 'ok'
                      ? 'Valid Rate'
                      : 'Custom Note'}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {preview.scheme_text || (preview.base_price != null ? `Rate ${rs(preview.base_price)}` : '—')}
            </span>
            {preview.effective_cost != null && (
              <span className="text-sm font-bold text-[var(--color-best)] tabular-nums">
                Effective: {rs(preview.effective_cost)}
              </span>
            )}
          </div>
        </div>

        <Field label="Notes (optional)">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any note about this supplier offer…"
          />
        </Field>

        {err && <ErrorBox>{err}</ErrorBox>}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save offer'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

