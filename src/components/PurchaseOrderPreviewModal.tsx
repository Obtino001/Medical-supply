import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { companySlug } from '../lib/companies'
import { download } from '../lib/exporter'
import { calculateLineTotal, calculateOrderTotals } from '../lib/orders'
import { naturalCompare } from '../lib/productParse'
import {
  formatShortDateAscii,
  formatSupplierOfferLines,
  generatePurchaseOrderPdf,
  type PurchaseOrderPdfInput,
} from '../lib/purchaseOrderPdf'
import { IconDownload, IconPrinter } from './icons'
import { Button, Modal, cx, rs, useToast } from './ui'

function PurchaseOrderSheet({ input }: { input: PurchaseOrderPdfInput }) {
  const sortedLines = useMemo(
    () => [...input.lines].sort((a, b) => naturalCompare(a.productName, b.productName)),
    [input.lines],
  )
  const totals = useMemo(
    () =>
      calculateOrderTotals(
        sortedLines.map((l) => ({
          quantity: l.quantity,
          lowest_price: l.lowestPrice,
          target_price: l.targetPrice,
        })),
      ),
    [sortedLines],
  )
  const extraPct = input.extraDiscountPct ?? 5

  return (
    <div className="bg-white p-4 text-[#111827] sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#1f2937] pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#111827]">HAFSA MEDICALS</h1>
          <div className="text-sm font-semibold tracking-wider text-[#374151] uppercase">PURCHASE ORDER</div>
        </div>
        <div className="text-right text-xs text-[#374151] tabular-nums">
          <div className="text-sm font-semibold text-[#111827]">Order No: {input.orderNumber}</div>
          <div>Date: {input.dateLabel}</div>
          <div>
            Status: <span className="font-semibold uppercase">{input.status || 'draft'}</span> · Target -{extraPct}%
          </div>
        </div>
      </div>

      {/* Company Meta */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <div>
          <span className="text-[#4b5563]">Manufacturer / Company: </span>
          <strong className="text-sm font-bold text-[#111827]">{input.manufacturer}</strong>
        </div>
        {input.title && input.title.trim().toLowerCase() !== `${input.manufacturer.trim().toLowerCase()} order` && (
          <div className="text-[#4b5563]">Ref: {input.title}</div>
        )}
      </div>

      {input.notes?.trim() && (
        <div className="mt-2 rounded border border-[#d1d5db] bg-[#f9fafb] px-3 py-1.5 text-xs text-[#374151]">
          <strong>Note:</strong> {input.notes.trim()}
        </div>
      )}

      {/* Items Table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="bg-[#f3f4f6] text-left text-[10px] font-bold uppercase tracking-wide text-[#374151]">
              <th className="w-8 border border-[#d1d5db] px-2 py-1.5">#</th>
              <th className="border border-[#d1d5db] px-2 py-1.5">Product Name &amp; Variant</th>
              <th className="border border-[#d1d5db] px-2 py-1.5">Available Supplier Prices</th>
              <th className="w-14 border border-[#d1d5db] px-2 py-1.5 text-right">Qty</th>
              <th className="w-24 border border-[#d1d5db] px-2 py-1.5 text-right">Lowest Mkt</th>
              <th className="w-24 border border-[#d1d5db] px-2 py-1.5 text-right">Target Rate*</th>
              <th className="w-24 border border-[#d1d5db] px-2 py-1.5 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-[#d1d5db] px-3 py-4 text-center text-[#6b7280]">
                  No items in this purchase order yet.
                </td>
              </tr>
            ) : (
              sortedLines.map((line, i) => {
                const quoteLines = formatSupplierOfferLines(line.offers)
                const lineTotal = calculateLineTotal(line.quantity, line.targetPrice)
                return (
                  <tr key={`${line.productName}-${i}`} className="print-avoid-break align-top odd:bg-white even:bg-[#fafafa]">
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-[#4b5563] tabular-nums">{i + 1}</td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5">
                      <div className="font-semibold text-[#111827]">{line.productName}</div>
                      {line.variantLabel && <div className="text-[10.5px] text-[#4b5563]">{line.variantLabel}</div>}
                    </td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-[10.5px] leading-snug text-[#374151] tabular-nums">
                      {quoteLines.map((ql, qi) => (
                        <div key={qi}>{ql}</div>
                      ))}
                    </td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-right font-medium text-[#111827] tabular-nums">
                      {line.quantity}
                    </td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-right text-[#374151] tabular-nums">
                      <div className="font-medium text-[#111827]">
                        {line.lowestPrice != null ? rs(line.lowestPrice) : '—'}
                      </div>
                      {line.lowestPriceDate && (
                        <div className="text-[10px] text-[#6b7280]">{formatShortDateAscii(line.lowestPriceDate)}</div>
                      )}
                    </td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-right font-semibold text-[#111827] tabular-nums">
                      {line.targetPrice != null ? rs(line.targetPrice) : '—'}
                      {line.isTargetManual && <span className="block text-[9.5px] font-normal text-[#4b5563]">manual</span>}
                    </td>
                    <td className="border border-[#e5e7eb] px-2 py-1.5 text-right font-bold text-[#111827] tabular-nums">
                      {lineTotal != null ? rs(lineTotal) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totals & Required Disclaimer */}
      <div className="print-avoid-break mt-4 rounded border border-[#9ca3af] bg-[#f9fafb] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#374151] tabular-nums">
            <div>
              <strong>Items:</strong> {totals.totalItems} ({totals.totalUnits} total units)
            </div>
            <div>
              <strong>Lowest Market Benchmark:</strong> {totals.marketTotal > 0 ? rs(totals.marketTotal) : '—'}
            </div>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-xs uppercase tracking-wide text-[#4b5563]">Requested PO Grand Total</div>
            <div className="text-lg font-bold text-[#111827]">
              {totals.targetTotal > 0 ? rs(totals.targetTotal) : '—'}
            </div>
            {totals.estimatedExtraSavings > 0 && (
              <div className="text-[11px] font-medium text-[#374151]">
                Target Additional Savings (-{extraPct}%): {rs(totals.estimatedExtraSavings)}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 text-[10.5px] leading-snug text-[#4b5563]">
        * <strong>Requested / Negotiation Target Price</strong> (default -{extraPct}% from the lowest comparable market
        quote) — <strong>NOT</strong> a confirmed supplier price. Final invoice rates are subject to wholesaler
        confirmation. Quotes marked [Old] exceed standard freshness days.
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-dashed border-[#cbd5e1] pt-2 text-[10px] text-[#6b7280]">
        <span>HAFSA MEDICALS · Purchase Order {input.orderNumber}</span>
        <span>Authorized Signatory: _______________________</span>
      </div>
    </div>
  )
}

export function PurchaseOrderPreviewModal({
  open,
  onClose,
  input,
  initialMode = 'sheet',
}: {
  open: boolean
  onClose: () => void
  input: PurchaseOrderPdfInput
  initialMode?: 'sheet' | 'pdf'
}) {
  const toast = useToast()
  const [viewMode, setViewMode] = useState<'sheet' | 'pdf'>(initialMode)

  const pdfBytes = useMemo(() => (open ? generatePurchaseOrderPdf(input) : null), [open, input])
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    setViewMode(initialMode)
  }, [initialMode, open])

  useEffect(() => {
    if (!pdfBytes) {
      setPdfUrl(null)
      return
    }
    const copy = new Uint8Array(pdfBytes.byteLength)
    copy.set(pdfBytes)
    const blob = new Blob([copy], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfBytes])

  const handleDownload = () => {
    if (input.lines.length === 0) return toast('err', 'Add at least one item before downloading PDF.')
    const bytes = pdfBytes ?? generatePurchaseOrderPdf(input)
    const slug = companySlug(input.manufacturer)
    download(`HAFSA-MEDICALS-${input.orderNumber}-${slug}.pdf`, bytes.buffer as ArrayBuffer, 'application/pdf')
    toast('ok', `Downloaded Purchase Order ${input.orderNumber}.pdf`)
  }

  const handlePrint = () => {
    if (input.lines.length === 0) return toast('err', 'Add at least one item before printing.')
    window.print()
  }

  if (!open) return null

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Purchase Order Preview — ${input.orderNumber}`}
        wide
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewMode('sheet')}
                className={cx(
                  'rounded-md px-3 py-1 transition-colors',
                  viewMode === 'sheet'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                Print Layout Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={cx(
                  'rounded-md px-3 py-1 transition-colors',
                  viewMode === 'pdf'
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                PDF File Preview
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" small onClick={handlePrint}>
                <IconPrinter size={14} />
                <span>Print PDF</span>
              </Button>
              <Button small onClick={handleDownload}>
                <IconDownload size={14} />
                <span>Download PDF</span>
              </Button>
            </div>
          </div>

          {viewMode === 'sheet' ? (
            <div className="max-h-[65vh] overflow-y-auto rounded-xl border border-[var(--border-default)] shadow-sm">
              <PurchaseOrderSheet input={input} />
            </div>
          ) : (
            <div className="h-[65vh] overflow-hidden rounded-xl border border-[var(--border-default)] bg-white">
              {pdfUrl ? (
                <iframe src={pdfUrl} title={`PDF Preview ${input.orderNumber}`} className="h-full w-full border-0" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[#4b5563]">
                  Generating PDF preview…
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end border-t border-[var(--border-default)] pt-2">
            <Button variant="secondary" small onClick={onClose}>
              Close preview
            </Button>
          </div>
        </div>
      </Modal>

      {typeof document !== 'undefined' &&
        createPortal(
          <div className="print-portal" aria-hidden="true">
            <PurchaseOrderSheet input={input} />
          </div>,
          document.body,
        )}
    </>
  )
}
