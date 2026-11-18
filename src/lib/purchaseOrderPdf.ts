// Pure TypeScript multi-page A4 PDF-1.4 generator for HAFSA MEDICALS Purchase Orders.
// Clean, minimal, wholesaler-readable print layout without unnecessary graphics or clutter.
import { calculateLineTotal, calculateOrderTotals } from './orders'
import { fmtRsAscii } from './orderPrint'
import { naturalCompare, normalizeHomoglyphs } from './productParse'
import type { SupplierOfferSnapshot } from './types'

export interface PurchaseOrderPdfLine {
  productName: string
  variantLabel: string | null
  manufacturer: string
  quantity: number
  lowestPrice: number | null
  lowestShopName: string | null
  lowestPriceDate: string | null
  targetPrice: number | null
  isTargetManual: boolean
  offers: SupplierOfferSnapshot[]
  notes?: string | null
}

export interface PurchaseOrderPdfInput {
  orderNumber: string
  dateLabel: string
  manufacturer: string
  title?: string | null
  status?: string
  extraDiscountPct?: number
  notes?: string | null
  lines: PurchaseOrderPdfLine[]
}

const enc = new TextEncoder()

function toPdfAscii(s: string | null | undefined): string {
  if (!s) return ''
  return normalizeHomoglyphs(s)
    .replace(/[·•]/g, ' - ')
    .replace(/[→➔]/g, '->')
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₨/g, 'Rs ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pdfEsc(s: string): string {
  return toPdfAscii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapSingle(text: string, maxChars: number): string[] {
  const clean = toPdfAscii(text)
  if (!clean) return ['']
  const words = clean.split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) { out.push(cur); cur = '' }
      for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars))
      continue
    }
    const cand = cur ? `${cur} ${w}` : w
    if (cand.length <= maxChars) cur = cand
    else {
      out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

function wrapParagraphs(lines: string[], maxChars: number): string[] {
  const out: string[] = []
  for (const l of lines) out.push(...wrapSingle(l, maxChars))
  return out.length ? out : ['-']
}

export function formatShortDateAscii(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mon = months[Number(m[2]) - 1] ?? m[2]
  return `${m[3]} ${mon} ${m[1].slice(2)}`
}

export function formatSupplierOfferLines(offers: SupplierOfferSnapshot[]): string[] {
  if (!offers || offers.length === 0) return ['No recorded supplier quote']
  return offers.slice(0, 6).map((o) => {
    const dt = o.observed_on ? formatShortDateAscii(o.observed_on) : ''
    const staleTag = o.observed_on && !o.fresh ? ' [Old]' : ''
    let rate = '-'
    if (o.effective_cost != null && o.effective_cost > 0) {
      rate = `${fmtRsAscii(o.effective_cost)}`
      if (o.currency && o.currency !== 'PKR') rate = `${o.currency} ${o.effective_cost}`
    } else if (o.scheme_text) {
      rate = o.scheme_text
    } else if (o.discount_pct != null) {
      rate = `${o.discount_pct}% disc`
    } else if (o.status_note) {
      rate = o.status_note
    }
    const excl = !o.comparable && o.status_note && !o.status_note.includes('Old') ? ` (${o.status_note})` : ''
    return `${o.shop_name}: ${rate}${dt ? ` (${dt})` : ''}${staleTag}${excl}`
  })
}

/** Generate a minimal, print-ready A4 PDF-1.4 Purchase Order document for HAFSA MEDICALS. */
export function generatePurchaseOrderPdf(input: PurchaseOrderPdfInput): Uint8Array {
  const PW = 595.28
  const PH = 841.89
  const ML = 34
  const MR = 34
  const CW = PW - ML - MR // 527.28 pt
  const TOP = PH - 36
  const BOT = 48

  const sortedLines = [...input.lines].sort((a, b) => naturalCompare(a.productName, b.productName))
  const totals = calculateOrderTotals(
    sortedLines.map((l) => ({
      quantity: l.quantity,
      lowest_price: l.lowestPrice,
      target_price: l.targetPrice,
    })),
  )
  const extraPct = input.extraDiscountPct ?? 5

  const pages: string[][] = []
  let cmds: string[] = []
  let y = TOP

  const startPage = () => {
    cmds = []
    pages.push(cmds)
    y = TOP
  }

  const drawText = (x: number, yy: number, text: string, size = 9, bold = false, rgb: [number, number, number] = [0.12, 0.13, 0.15]) => {
    const safe = pdfEsc(text)
    if (!safe) return
    cmds.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb[0]} ${rgb[1]} ${rgb[2]} rg 1 0 0 1 ${x.toFixed(2)} ${yy.toFixed(2)} Tm (${safe}) Tj ET`)
  }

  const drawRight = (rx: number, yy: number, text: string, size = 9, bold = false, rgb: [number, number, number] = [0.12, 0.13, 0.15]) => {
    const approxW = toPdfAscii(text).length * size * (bold ? 0.54 : 0.5)
    drawText(Math.max(ML, rx - approxW), yy, text, size, bold, rgb)
  }

  const drawRect = (x: number, yy: number, w: number, h: number, fillRgb?: [number, number, number], strokeRgb?: [number, number, number]) => {
    cmds.push('q')
    if (fillRgb) cmds.push(`${fillRgb[0]} ${fillRgb[1]} ${fillRgb[2]} rg`)
    if (strokeRgb) cmds.push(`${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG 0.6 w`)
    cmds.push(`${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fillRgb && strokeRgb ? 'B' : fillRgb ? 'f' : 'S'}`)
    cmds.push('Q')
  }

  const drawLine = (x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.78, 0.8, 0.84], width = 0.6) => {
    cmds.push(`q ${rgb[0]} ${rgb[1]} ${rgb[2]} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`)
  }

  const drawHeader = (continued = false) => {
    // Minimal clean header — white background, dark charcoal rules, zero visual clutter
    drawText(ML, y - 12, 'HAFSA MEDICALS', 14.5, true, [0.09, 0.11, 0.15])
    drawText(ML, y - 26, continued ? 'PURCHASE ORDER (Continued)' : 'PURCHASE ORDER', 10.5, true, [0.22, 0.25, 0.3])
    drawRight(ML + CW, y - 12, `Order No: ${input.orderNumber}`, 9.5, true, [0.09, 0.11, 0.15])
    drawRight(ML + CW, y - 25, `Date: ${input.dateLabel}`, 8.8, false, [0.28, 0.31, 0.36])

    y -= 34
    drawLine(ML, y, ML + CW, y, [0.2, 0.22, 0.26], 1.0)
    y -= 14

    drawText(ML, y, `Manufacturer / Company: ${input.manufacturer}`, 9.5, true, [0.1, 0.12, 0.15])
    const statusText = input.status ? input.status.toUpperCase() : 'DRAFT'
    drawRight(ML + CW, y, `Status: ${statusText} | Requested Discount: -${extraPct}%`, 8.2, false, [0.32, 0.35, 0.4])
    y -= 12

    if (!continued && input.title && input.title.trim().toLowerCase() !== `${input.manufacturer.trim().toLowerCase()} order`) {
      drawText(ML, y, `Reference: ${input.title.trim()}`, 8.3, false, [0.3, 0.33, 0.38])
      y -= 11
    }
    if (!continued && input.notes?.trim()) {
      for (const nl of wrapSingle(`Note: ${input.notes.trim()}`, 98)) {
        drawText(ML, y, nl, 8.3, false, [0.3, 0.33, 0.38])
        y -= 11
      }
    }
    y -= 4
  }

  // Exact column widths sum to CW (~527.28 pt)
  const cols: { label: string; width: number; maxChars: number; align?: 'right' }[] = [
    { label: '#', width: 20, maxChars: 3 },
    { label: 'Product / Strength / Pack', width: 138, maxChars: 27 },
    { label: 'Available Supplier Prices', width: 162, maxChars: 34 },
    { label: 'Qty', width: 34, maxChars: 6, align: 'right' },
    { label: 'Lowest Mkt', width: 56, maxChars: 11, align: 'right' },
    { label: 'Target*', width: 57, maxChars: 11, align: 'right' },
    { label: 'Line Total', width: CW - 467, maxChars: 12, align: 'right' },
  ]

  const drawTableHeader = () => {
    drawRect(ML, y - 19, CW, 19, [0.95, 0.96, 0.97], [0.75, 0.78, 0.82])
    let cx = ML
    for (const col of cols) {
      if (col.align === 'right') drawRight(cx + col.width - 4, y - 12.5, col.label, 7.8, true, [0.18, 0.2, 0.24])
      else drawText(cx + 4, y - 12.5, col.label, 7.8, true, [0.18, 0.2, 0.24])
      cx += col.width
    }
    y -= 19
  }

  startPage()
  drawHeader(false)
  drawTableHeader()

  if (sortedLines.length === 0) {
    drawRect(ML, y - 24, CW, 24, undefined, [0.85, 0.87, 0.9])
    drawText(ML + 8, y - 15, 'No items added to this purchase order.', 8.5, false, [0.35, 0.38, 0.42])
    y -= 28
  } else {
    sortedLines.forEach((line, idx) => {
      const prodLines = wrapParagraphs(
        [line.productName, line.variantLabel ? line.variantLabel : ''].filter(Boolean),
        cols[1].maxChars,
      )
      const offerLines = wrapParagraphs(formatSupplierOfferLines(line.offers), cols[2].maxChars)
      const qtyStr = String(line.quantity)
      const lowStr = line.lowestPrice != null ? fmtRsAscii(line.lowestPrice) : '-'
      const targetStr = line.targetPrice != null ? `${fmtRsAscii(line.targetPrice)}${line.isTargetManual ? ' (M)' : ''}` : '-'
      const lineTotal = calculateLineTotal(line.quantity, line.targetPrice)
      const totalStr = lineTotal != null ? fmtRsAscii(lineTotal) : '-'

      const cellWrapped: string[][] = [
        [String(idx + 1)],
        prodLines,
        offerLines,
        [qtyStr],
        line.lowestPriceDate ? [lowStr, formatShortDateAscii(line.lowestPriceDate)] : [lowStr],
        [targetStr],
        [totalStr],
      ]

      const maxLines = Math.max(1, ...cellWrapped.map((c) => c.length))
      const rowH = Math.max(19, maxLines * 9.5 + 8)

      if (y - rowH < BOT) {
        startPage()
        drawHeader(true)
        drawTableHeader()
      }

      if (idx % 2 === 1) drawRect(ML, y - rowH, CW, rowH, [0.985, 0.987, 0.99])
      drawLine(ML, y - rowH, ML + CW, y - rowH, [0.85, 0.87, 0.9], 0.5)

      let cx = ML
      cellWrapped.forEach((lines, cIdx) => {
        const col = cols[cIdx]
        lines.forEach((txt, lIdx) => {
          const ly = y - 11 - lIdx * 9.5
          const isBold = (cIdx === 1 && lIdx === 0) || cIdx === 5 || cIdx === 6
          const color: [number, number, number] =
            cIdx === 2 || (cIdx === 4 && lIdx > 0)
              ? [0.32, 0.35, 0.4]
              : [0.1, 0.12, 0.15]
          if (col.align === 'right') drawRight(cx + col.width - 4, ly, txt, cIdx === 2 ? 7.3 : 8.0, isBold, color)
          else drawText(cx + 4, ly, txt, cIdx === 2 ? 7.3 : 8.0, isBold, color)
        })
        cx += col.width
      })
      y -= rowH
    })
  }

  // Grand Totals & Mandatory Negotiation Target Notice
  const summaryH = 82
  if (y - summaryH < BOT) {
    startPage()
    drawHeader(true)
  }

  y -= 10
  drawRect(ML, y - 42, CW, 42, [0.96, 0.97, 0.98], [0.7, 0.74, 0.79])
  drawText(ML + 8, y - 14, `Items: ${totals.totalItems} (${totals.totalUnits} total units)`, 8.8, true, [0.15, 0.18, 0.22])
  drawText(ML + 8, y - 29, `Market Lowest Benchmark Total: ${totals.marketTotal > 0 ? fmtRsAscii(totals.marketTotal) : '-'}`, 8.3, false, [0.3, 0.33, 0.38])
  drawRight(
    ML + CW - 8,
    y - 15,
    `Requested PO Grand Total: ${totals.targetTotal > 0 ? fmtRsAscii(totals.targetTotal) : '-'}`,
    10.5,
    true,
    [0.08, 0.1, 0.14],
  )
  drawRight(
    ML + CW - 8,
    y - 30,
    totals.estimatedExtraSavings > 0
      ? `Target Additional Savings: ${fmtRsAscii(totals.estimatedExtraSavings)}`
      : `${totals.pricedItems}/${totals.totalItems} items priced`,
    8.2,
    false,
    [0.25, 0.28, 0.33],
  )

  y -= 50
  const noticeText =
    `* Target Rate is a REQUESTED NEGOTIATION PRICE (default -${extraPct}% below the lowest comparable market rate), NOT a confirmed supplier price. (M) indicates manually adjusted target price. Outdated dates marked [Old].`
  for (const nl of wrapSingle(noticeText, 102)) {
    drawText(ML, y - 8, nl, 7.6, false, [0.32, 0.35, 0.4])
    y -= 9.5
  }

  // Footer on every page
  const totalPages = pages.length
  pages.forEach((pageCmds, pIdx) => {
    const prev = cmds
    cmds = pageCmds
    drawLine(ML, 30, ML + CW, 30, [0.82, 0.84, 0.88], 0.5)
    drawText(ML, 18, `HAFSA MEDICALS - Purchase Order ${input.orderNumber} (${input.manufacturer})`, 7.5, false, [0.42, 0.45, 0.5])
    drawRight(ML + CW, 18, `Page ${pIdx + 1} of ${totalPages}`, 7.5, false, [0.42, 0.45, 0.5])
    cmds = prev
  })

  // Serialize clean PDF 1.4 binary with exact xref byte offsets
  const objects: string[] = []
  const addObj = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalogId = addObj('')
  const pagesId = addObj('')
  const font1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const font2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  const pageObjIds: number[] = []
  for (const pageCmds of pages) {
    const stream = pageCmds.join('\n')
    const streamBytes = enc.encode(stream).length
    const contentId = addObj(`<< /Length ${streamBytes} >>\nstream\n${stream}\nendstream`)
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
    pageObjIds.push(pageId)
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`

  const headerPrefix = enc.encode('%PDF-1.4\n%')
  const binComment = new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])
  const headerBlock = new Uint8Array(headerPrefix.length + binComment.length)
  headerBlock.set(headerPrefix, 0)
  headerBlock.set(binComment, headerPrefix.length)

  const parts: Uint8Array[] = [headerBlock]
  let offset = headerBlock.length
  const offsets: number[] = []

  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    const objBytes = enc.encode(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`)
    parts.push(objBytes)
    offset += objBytes.length
  }

  const xrefOffset = offset
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`]
  for (const o of offsets) {
    xrefLines.push(`${String(o).padStart(10, '0')} 00000 n \n`)
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  parts.push(enc.encode(xrefLines.join('') + trailer))

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}
