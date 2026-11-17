import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveProductDisplayCompany } from '../lib/companies'
import { useData } from '../lib/data'
import { download } from '../lib/exporter'
import {
  buildOrderGroups,
  buildResolvedLines,
  buildWhatsAppOrderText,
  generateOrderPdf,
  pickDefaultShopForProduct,
  type OrderLineDraft,
  type OrderPdfOptions,
} from '../lib/orderPrint'
import { variantLabel } from '../lib/productParse'
import type { PriceRecord } from '../lib/types'
import { IconClose, IconCopy, IconDownload, IconPrinter } from './icons'
import { Badge, Button, Field, Input, Modal, Select, cx, fmtDate, rs, useToast } from './ui'

export function PrintOrderModal({
  open,
  onClose,
  productIds,
  lockedShopId,
  preferredShopId,
  title,
}: {
  open: boolean
  onClose: () => void
  productIds: string[]
  lockedShopId?: string
  preferredShopId?: string
  title?: string
}) {
  const { productMap, current, shopMap, settings } = useData()
  const toast = useToast()

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

  const opt = useMemo(
    () => ({ freshnessDays: settings.freshness_days, excludeStale: false }),
    [settings.freshness_days],
  )

  const initialDrafts = useMemo<OrderLineDraft[]>(() => {
    const uniqueIds = [...new Set(productIds)]
    const out: OrderLineDraft[] = []
    for (const id of uniqueIds) {
      const product = productMap.get(id)
      if (!product) continue
      const records = recordsByProduct.get(id) ?? []
      out.push({
        product,
        company: resolveProductDisplayCompany(product, records),
        records,
        chosenShopId: pickDefaultShopForProduct(product, records, opt, lockedShopId ?? preferredShopId),
        qty: '',
      })
    }
    return out
  }, [productIds, productMap, recordsByProduct, opt, lockedShopId, preferredShopId])

  const [drafts, setDrafts] = useState<OrderLineDraft[]>(initialDrafts)
  const lockedShop = lockedShopId ? shopMap.get(lockedShopId) : undefined

  const [orderTitle, setOrderTitle] = useState(
    title ?? (lockedShop ? `${lockedShop.name} - Order Slip` : 'Order & Price Selection Sheet'),
  )
  const [note, setNote] = useState('')
  const [groupByShop, setGroupByShop] = useState(true)
  const [showPricing, setShowPricing] = useState(true)
  const [pageBreakPerShop, setPageBreakPerShop] = useState(true)

  const resolvedLines = useMemo(() => buildResolvedLines(drafts, shopMap), [drafts, shopMap])
  const groups = useMemo(() => buildOrderGroups(resolvedLines, groupByShop), [resolvedLines, groupByShop])

  const availableShopsInSelection = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>()
    for (const d of drafts) {
      const seen = new Set<string>()
      for (const r of d.records) {
        if (seen.has(r.shop_id)) continue
        seen.add(r.shop_id)
        const s = shopMap.get(r.shop_id)
        if (!s) continue
        const cur = counts.get(s.id) ?? { id: s.id, name: s.name, count: 0 }
        cur.count++
        counts.set(s.id, cur)
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [drafts, shopMap])

  const totalEstimate = useMemo(
    () => groups.reduce((sum, g) => sum + g.estimatedTotal, 0),
    [groups],
  )

  const pdfOpts: OrderPdfOptions = useMemo(
    () => ({
      title: orderTitle.trim() || 'Purchase Order',
      subtitle: lockedShop ? `Supplier Order - ${lockedShop.name}` : 'Wholesale Market Selection & Order Slip',
      dateLabel: fmtDate(new Date().toISOString().slice(0, 10)),
      note,
      groups,
      groupByShop,
      showPricing,
      pageBreakPerShop: groupByShop && groups.length > 1 && pageBreakPerShop,
    }),
    [orderTitle, lockedShop, note, groups, groupByShop, showPricing, pageBreakPerShop],
  )

  const switchAllShop = (shopIdOrBest: string) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (shopIdOrBest === '__best__') {
          return { ...d, chosenShopId: pickDefaultShopForProduct(d.product, d.records, opt) }
        }
        if (d.records.some((r) => r.shop_id === shopIdOrBest)) {
          return { ...d, chosenShopId: shopIdOrBest }
        }
        return d
      }),
    )
  }

  const setAllQty = (val: string) => {
    setDrafts((prev) => prev.map((d) => ({ ...d, qty: val })))
  }

  const removeLine = (productId: string) => {
    setDrafts((prev) => prev.filter((d) => d.product.id !== productId))
  }

  const handleDownloadPdf = () => {
    if (drafts.length === 0) return toast('err', 'No items to export.')
    const bytes = generateOrderPdf(pdfOpts)
    const slug = (lockedShop?.name ?? orderTitle).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'order'
    const stamp = new Date().toISOString().slice(0, 10)
    download(`hafsa-medicose-${slug}-${stamp}.pdf`, bytes.buffer as ArrayBuffer, 'application/pdf')
    toast('ok', `Downloaded PDF (${drafts.length} item${drafts.length === 1 ? '' : 's'})`)
  }

  const handleNativePrint = () => {
    if (drafts.length === 0) return toast('err', 'No items to print.')
    window.print()
  }

  const handleCopyWhatsApp = async () => {
    if (drafts.length === 0) return toast('err', 'No items to copy.')
    try {
      const text = buildWhatsAppOrderText(pdfOpts)
      await navigator.clipboard.writeText(text)
      toast('ok', 'Copied formatted order text for WhatsApp')
    } catch {
      toast('err', 'Could not access clipboard. Use Download PDF or Print instead.')
    }
  }

  if (!open) return null

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={lockedShop ? `Print / PDF Order — ${lockedShop.name}` : `Print / PDF Order Slip (${drafts.length} items)`}
        wide
      >
        <div className="space-y-3.5">
          {/* Configuration Controls */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Slip / Order title">
              <Input value={orderTitle} onChange={(e) => setOrderTitle(e.target.value)} />
            </Field>
            <Field label="Order note / delivery instructions (optional)">
              <Input
                placeholder="e.g. Send urgently · Evening delivery"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>

          {/* Grouping, Bulk Shop Switch & Qty Helpers */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 text-xs sm:text-[13px] text-[var(--text-primary)]">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={groupByShop} onChange={(e) => setGroupByShop(e.target.checked)} />
                  <span>Group order slips by shop</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={showPricing} onChange={(e) => setShowPricing(e.target.checked)} />
                  <span>Show prices &amp; discounts</span>
                </label>
                {groupByShop && groups.length > 1 && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={pageBreakPerShop}
                      onChange={(e) => setPageBreakPerShop(e.target.checked)}
                    />
                    <span>New page per shop</span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[var(--text-secondary)]">Quick Qty:</span>
                {['1', '5', '10', ''].map((q) => (
                  <button
                    key={q || 'clear'}
                    type="button"
                    onClick={() => setAllQty(q)}
                    className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    {q ? `All ${q}` : 'Clear'}
                  </button>
                ))}
              </div>
            </div>

            {!lockedShopId && availableShopsInSelection.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-default)]/70 pt-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Assign supplier:</span>
                <Select
                  value=""
                  onChange={(e) => e.target.value && switchAllShop(e.target.value)}
                  className="!min-h-8 !w-auto !py-0.5 text-xs"
                  aria-label="Bulk switch supplier"
                >
                  <option value="">Switch available items to shop…</option>
                  <option value="__best__">Auto-pick best price / discount per item</option>
                  {availableShopsInSelection.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.count}/{drafts.length} items)
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* Supplier Group Summary Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {groups.map((g) => (
                <Badge key={g.shopId ?? 'all'} tone={g.shop ? 'blue' : 'slate'}>
                  {g.shopName}: {g.lines.length} item{g.lines.length === 1 ? '' : 's'}
                  {showPricing && g.estimatedTotal > 0 ? ` · ${rs(g.estimatedTotal, 0)}` : ''}
                </Badge>
              ))}
            </div>
            {showPricing && totalEstimate > 0 && (
              <span className="font-semibold text-[var(--color-best)] tabular-nums">
                Est. Grand Total: {rs(totalEstimate)}
              </span>
            )}
          </div>

          {/* Interactive Item Preview Table */}
          <div className="max-h-72 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
            {drafts.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--text-secondary)]">No items selected for printing.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--bg-subtle)] text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  <tr>
                    <th className="px-2.5 py-2">#</th>
                    <th className="px-2.5 py-2">Product</th>
                    <th className="px-2.5 py-2">Supplier (Shop)</th>
                    <th className="px-2.5 py-2">Rate / Offer</th>
                    <th className="w-24 px-2.5 py-2">Order Qty</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {drafts.map((d, idx) => {
                    const line = resolvedLines[idx]
                    const vl = variantLabel(d.product) || d.product.dosage_form
                    return (
                      <tr key={d.product.id} className="hover:bg-[var(--bg-hover)]/50">
                        <td className="px-2.5 py-2 text-[var(--text-secondary)] tabular-nums">{idx + 1}</td>
                        <td className="min-w-36 px-2.5 py-2">
                          <div className="font-medium text-[var(--text-primary)]">{d.product.name}</div>
                          <div className="text-[10.5px] text-[var(--text-secondary)]">
                            {[vl, d.company].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td className="min-w-36 px-2.5 py-2">
                          {d.records.length === 0 ? (
                            <span className="text-[var(--text-secondary)]">No shop offer</span>
                          ) : (
                            <select
                              value={d.chosenShopId ?? ''}
                              disabled={Boolean(lockedShopId)}
                              onChange={(e) => {
                                const val = e.target.value || null
                                setDrafts((prev) => prev.map((x) => (x.product.id === d.product.id ? { ...x, chosenShopId: val } : x)))
                              }}
                              aria-label={`Supplier for ${d.product.name}`}
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-1.5 py-1 text-xs text-[var(--text-primary)]"
                            >
                              {d.records.map((r) => {
                                const sn = shopMap.get(r.shop_id)?.name ?? 'Supplier'
                                const rateTag = r.effective_cost != null ? rs(r.effective_cost, 0) : r.scheme_text || 'Offer'
                                return (
                                  <option key={r.id} value={r.shop_id}>
                                    {sn} ({rateTag})
                                  </option>
                                )
                              })}
                            </select>
                          )}
                        </td>
                        <td className="px-2.5 py-2 text-[var(--text-secondary)] tabular-nums">
                          {line.offerLabel}
                          {line.lineTotal != null && (
                            <div className="font-semibold text-[var(--color-best)]">= {rs(line.lineTotal)}</div>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            placeholder="Qty"
                            value={d.qty}
                            onChange={(e) => {
                              const val = e.target.value
                              setDrafts((prev) => prev.map((x) => (x.product.id === d.product.id ? { ...x, qty: val } : x)))
                            }}
                            aria-label={`Order quantity for ${d.product.name}`}
                            className="w-20 rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)] tabular-nums focus:border-[var(--color-primary)] focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(d.product.id)}
                            title="Remove from print list"
                            aria-label={`Remove ${d.product.name}`}
                            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--color-error-bg)] hover:text-[var(--color-error-text)]"
                          >
                            <IconClose size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Primary Print / PDF / WhatsApp Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
            <Button variant="secondary" small disabled={drafts.length === 0} onClick={() => void handleCopyWhatsApp()}>
              <IconCopy size={14} className="text-[var(--color-primary)]" />
              <span>Copy WhatsApp order</span>
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button variant="secondary" disabled={drafts.length === 0} onClick={handleNativePrint}>
                <IconPrinter size={15} className="text-[var(--color-primary)]" />
                <span>Print / Browser PDF</span>
              </Button>
              <Button disabled={drafts.length === 0} onClick={handleDownloadPdf}>
                <IconDownload size={15} />
                <span>Download PDF</span>
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Dedicated Light-Mode Print Portal (only visible inside @media print) */}
      {typeof document !== 'undefined' &&
        createPortal(<PrintPortalSheet opts={pdfOpts} />, document.body)}
    </>
  )
}

function PrintPortalSheet({ opts }: { opts: OrderPdfOptions }) {
  return (
    <div className="print-portal" aria-hidden="true">
      {opts.groups.map((g, gIdx) => {
        const useBreak = gIdx > 0 && opts.pageBreakPerShop
        const showDocBanner = gIdx === 0 || useBreak
        return (
          <div key={(g.shopId ?? 'all') + gIdx} className={cx(useBreak && 'print-page-break', gIdx > 0 && !useBreak && 'mt-6')}>
            {showDocBanner && (
              <div className="mb-3 flex items-start justify-between border-b-2 border-[#1A73E8] pb-2">
                <div>
                  <div className="text-lg font-bold tracking-tight text-[#1A73E8]">HAFSA MEDICOSE</div>
                  <div className="text-xs text-[#4b5563]">{opts.subtitle || opts.title}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-[#111827]">{opts.title}</div>
                  <div className="text-xs text-[#4b5563]">Date: {opts.dateLabel}</div>
                </div>
              </div>
            )}

            {gIdx === 0 && opts.note?.trim() && (
              <div className="mb-3 rounded border border-[#d1d5db] bg-[#f9fafb] px-3 py-1.5 text-xs text-[#1f2937]">
                <b>Note:</b> {opts.note.trim()}
              </div>
            )}

            {opts.groupByShop && (
              <div className="print-avoid-break mb-2 flex items-center justify-between rounded border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2">
                <div>
                  <div className="text-sm font-bold text-[#111827]">Supplier: {g.shopName}</div>
                  {[g.shop?.owner_name, g.shop?.phone, g.shop?.address, g.shop?.city].some(Boolean) && (
                    <div className="text-[11px] text-[#4b5563]">
                      {[g.shop?.owner_name, g.shop?.phone, g.shop?.address, g.shop?.city].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="text-right text-xs font-semibold text-[#111827] tabular-nums">
                  <div>{g.lines.length} item{g.lines.length === 1 ? '' : 's'}</div>
                  {opts.showPricing && g.estimatedTotal > 0 && (
                    <div className="text-[#188038]">Est. {rs(g.estimatedTotal)}</div>
                  )}
                </div>
              </div>
            )}

            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#f1f5f9] text-left text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                  <th className="w-8 border border-[#cbd5e1] px-2 py-1.5">#</th>
                  <th className="border border-[#cbd5e1] px-2 py-1.5">Product / Strength / Form</th>
                  <th className="border border-[#cbd5e1] px-2 py-1.5">Company</th>
                  {!opts.groupByShop && <th className="border border-[#cbd5e1] px-2 py-1.5">Supplier</th>}
                  {opts.showPricing && <th className="border border-[#cbd5e1] px-2 py-1.5">Rate / Discount / Scheme</th>}
                  <th className="w-16 border border-[#cbd5e1] px-2 py-1.5 text-right">Qty</th>
                  {opts.showPricing && opts.groupByShop && <th className="w-20 border border-[#cbd5e1] px-2 py-1.5 text-right">Est. Total</th>}
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l, i) => {
                  const vl = variantLabel(l.product)
                  return (
                    <tr key={l.product.id} className="print-avoid-break">
                      <td className="border border-[#e2e8f0] px-2 py-1 text-[#4b5563] tabular-nums">{i + 1}</td>
                      <td className="border border-[#e2e8f0] px-2 py-1 font-medium text-[#111827]">
                        {l.product.name}
                        {vl && !l.product.name.toLowerCase().includes(vl.toLowerCase()) ? ` (${vl})` : ''}
                      </td>
                      <td className="border border-[#e2e8f0] px-2 py-1 text-[#374151]">{l.company ?? '—'}</td>
                      {!opts.groupByShop && <td className="border border-[#e2e8f0] px-2 py-1 text-[#374151]">{l.shop?.name ?? '—'}</td>}
                      {opts.showPricing && <td className="border border-[#e2e8f0] px-2 py-1 text-[#374151] tabular-nums">{l.offerLabel}</td>}
                      <td className="border border-[#e2e8f0] px-2 py-1 text-right font-medium text-[#111827] tabular-nums">{l.qty || ''}</td>
                      {opts.showPricing && opts.groupByShop && (
                        <td className="border border-[#e2e8f0] px-2 py-1 text-right font-medium text-[#111827] tabular-nums">
                          {l.lineTotal != null ? rs(l.lineTotal) : '—'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {opts.showPricing && g.estimatedTotal > 0 && (
              <div className="print-avoid-break mt-1.5 flex justify-end text-xs font-bold text-[#188038] tabular-nums">
                {g.shopName} Estimated Total ({g.pricedLines}/{g.lines.length} priced): {rs(g.estimatedTotal)}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-dashed border-[#cbd5e1] pt-2 text-[10px] text-[#6b7280]">
              <span>Hafsa Medicose · Wholesale Price Intelligence</span>
              <span>Prepared by: ____________________</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
