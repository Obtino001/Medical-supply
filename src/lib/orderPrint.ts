// Order slip builder, WhatsApp formatter, and pure A4 PDF-1.4 generator for Hafsa Medicose.
// Pure functions (except trigger browser download/print helpers).
import { resolveProductDisplayCompany } from './companies'
import { compareOffers, type CompareOptions } from './compare'
import { rankOffers } from './offerRank'
import { normalizeHomoglyphs, variantLabel } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

export interface OrderLineDraft {
  product: Product
  company: string | null
  records: PriceRecord[]
  chosenShopId: string | null
  qty: string
}

export interface ResolvedOrderLine {
  product: Product
  company: string | null
  shop: Shop | null
  record: PriceRecord | null
  offerLabel: string
  effectiveUnitCost: number | null
  qty: string
  qtyNum: number | null
  lineTotal: number | null
}

export interface ShopOrderGroup {
  shopId: string | null
  shop: Shop | null
  shopName: string
  lines: ResolvedOrderLine[]
  estimatedTotal: number
  pricedLines: number
}

export interface OrderPdfOptions {
  title: string
  subtitle?: string
  dateLabel: string
  note?: string
  groups: ShopOrderGroup[]
  groupByShop: boolean
  showPricing: boolean
  pageBreakPerShop: boolean
}

export function parseOrderQtyNumber(raw: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(raw ?? '')
  if (!m) return null
  const val = parseFloat(m[1].replace(',', '.'))
  return Number.isFinite(val) && val > 0 ? val : null
}

/** Pick the default winning supplier record for a product (lowest effective cost, else best discount %, else latest record). */
export function pickDefaultShopForProduct(
  product: Product,
  records: PriceRecord[],
  opt: CompareOptions,
  lockedShopId?: string,
): string | null {
  if (lockedShopId && records.some((r) => r.shop_id === lockedShopId)) return lockedShopId
  if (records.length === 0) return null
  const cmp = compareOffers(records, product, opt)
  const rank = rankOffers(cmp)
  if (rank.lead) return rank.lead.view.rec.shop_id
  return records[0].shop_id
}

export function formatRecordOfferSummary(rec: PriceRecord | null): string {
  if (!rec) return 'No offer'
  const parts: string[] = []
  if (rec.base_price != null && rec.base_price > 0) {
    parts.push(`Rate ${fmtRsAscii(rec.base_price)}`)
  }
  if (rec.scheme_text) {
    parts.push(rec.scheme_text)
  } else if (rec.discount_pct != null && rec.discount_pct > 0) {
    parts.push(`${rec.discount_pct}% disc`)
  }
  if (rec.effective_cost != null && rec.scheme_status === 'ok' && rec.base_price !== rec.effective_cost) {
    parts.push(`Net ${fmtRsAscii(rec.effective_cost)}`)
  }
  return parts.join(' · ') || '—'
}

export function buildResolvedLines(
  drafts: OrderLineDraft[],
  shops: Map<string, Shop>,
): ResolvedOrderLine[] {
  return drafts.map((d) => {
    const rec = d.chosenShopId ? d.records.find((r) => r.shop_id === d.chosenShopId) ?? null : null
    const shop = d.chosenShopId ? shops.get(d.chosenShopId) ?? null : null
    const eff = rec && rec.scheme_status === 'ok' && rec.effective_cost != null && rec.effective_cost > 0 ? rec.effective_cost : null
    const qtyNum = parseOrderQtyNumber(d.qty)
    const lineTotal = eff != null && qtyNum != null ? Math.round(eff * qtyNum * 100) / 100 : null
    return {
      product: d.product,
      company: d.company ?? resolveProductDisplayCompany(d.product, d.records),
      shop,
      record: rec,
      offerLabel: formatRecordOfferSummary(rec),
      effectiveUnitCost: eff,
      qty: d.qty.trim(),
      qtyNum,
      lineTotal,
    }
  })
}

export function buildOrderGroups(lines: ResolvedOrderLine[], groupByShop: boolean): ShopOrderGroup[] {
  if (!groupByShop) {
    const estimatedTotal = lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)
    const pricedLines = lines.filter((l) => l.lineTotal != null).length
    return [{ shopId: null, shop: null, shopName: 'Selected Products', lines, estimatedTotal, pricedLines }]
  }

  const map = new Map<string, ShopOrderGroup>()
  for (const l of lines) {
    const key = l.shop?.id ?? '__no_shop__'
    let g = map.get(key)
    if (!g) {
      g = {
        shopId: l.shop?.id ?? null,
        shop: l.shop,
        shopName: l.shop?.name ?? 'No Supplier Selected',
        lines: [],
        estimatedTotal: 0,
        pricedLines: 0,
      }
      map.set(key, g)
    }
    g.lines.push(l)
    if (l.lineTotal != null) {
      g.estimatedTotal = Math.round((g.estimatedTotal + l.lineTotal) * 100) / 100
      g.pricedLines++
    }
  }
  return [...map.values()].sort((a, b) => {
    if (!a.shop && b.shop) return 1
    if (a.shop && !b.shop) return -1
    return a.shopName.localeCompare(b.shopName)
  })
}

export function buildWhatsAppOrderText(opts: OrderPdfOptions): string {
  const out: string[] = [`*HAFSA MEDICOSE — ${opts.title}*`, `Date: ${opts.dateLabel}`]
  if (opts.note?.trim()) out.push(`Note: ${opts.note.trim()}`)
  out.push('')

  for (const g of opts.groups) {
    if (opts.groupByShop) {
      out.push(`*Supplier: ${g.shopName}*${g.shop?.phone ? ` (${g.shop.phone})` : ''}`)
    }
    g.lines.forEach((l, i) => {
      const qtyPart = l.qty ? ` | Qty: *${l.qty}*` : ''
      const ratePart = opts.showPricing && l.offerLabel !== '—' && l.offerLabel !== 'No offer' ? ` (${l.offerLabel})` : ''
      const shopPart = !opts.groupByShop && l.shop ? ` [${l.shop.name}]` : ''
      out.push(`${i + 1}. ${l.product.name}${qtyPart}${ratePart}${shopPart}`)
    })
    if (opts.showPricing && g.estimatedTotal > 0) {
      out.push(`Est. Total: ${fmtRsAscii(g.estimatedTotal)}`)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

export function fmtRsAscii(n: number): string {
  return 'Rs ' + n.toLocaleString('en-PK', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}

// ---- Pure TypeScript Multi-Page A4 PDF-1.4 Vector Document Builder

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

function wrapText(text: string, maxChars: number): string[] {
  const clean = toPdfAscii(text)
  if (!clean) return ['']
  const words = clean.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = '' }
      for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars))
      continue
    }
    const cand = cur ? `${cur} ${w}` : w
    if (cand.length <= maxChars) cur = cand
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

const enc = new TextEncoder()

/** Generate a multi-page A4 PDF-1.4 document with clean tables and valid xref offsets. */
export function generateOrderPdf(opts: OrderPdfOptions): Uint8Array {
  const PW = 595.28
  const PH = 841.89
  const ML = 34
  const MR = 34
  const CW = PW - ML - MR // ~527 pt
  const TOP = PH - 38
  const BOT = 44

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
    // Approximate width for Helvetica (~0.52 * fontSize per char) cleanly aligns numbers
    const approxW = toPdfAscii(text).length * size * (bold ? 0.54 : 0.5)
    drawText(Math.max(ML, rx - approxW), yy, text, size, bold, rgb)
  }

  const drawRect = (x: number, yy: number, w: number, h: number, fillRgb?: [number, number, number], strokeRgb?: [number, number, number]) => {
    cmds.push('q')
    if (fillRgb) cmds.push(`${fillRgb[0]} ${fillRgb[1]} ${fillRgb[2]} rg`)
    if (strokeRgb) cmds.push(`${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG 0.5 w`)
    cmds.push(`${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fillRgb && strokeRgb ? 'B' : fillRgb ? 'f' : 'S'}`)
    cmds.push('Q')
  }

  const drawLine = (x1: number, y1: number, x2: number, y2: number, rgb: [number, number, number] = [0.85, 0.87, 0.9]) => {
    cmds.push(`q ${rgb[0]} ${rgb[1]} ${rgb[2]} RG 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`)
  }

  const drawDocHeader = (continued = false) => {
    drawRect(ML, y - 34, CW, 34, [0.91, 0.94, 0.99], [0.8, 0.87, 0.97])
    drawText(ML + 10, y - 14, continued ? 'HAFSA MEDICOSE (Continued)' : 'HAFSA MEDICOSE', 12, true, [0.1, 0.45, 0.91])
    drawText(ML + 10, y - 27, opts.subtitle || opts.title, 8.5, false, [0.28, 0.31, 0.36])
    drawRight(ML + CW - 10, y - 14, opts.title, 9.5, true, [0.12, 0.13, 0.15])
    drawRight(ML + CW - 10, y - 27, `Date: ${opts.dateLabel}`, 8.5, false, [0.35, 0.38, 0.42])
    y -= 42
    if (!continued && opts.note?.trim()) {
      const noteLines = wrapText(`Note: ${opts.note.trim()}`, 95)
      for (const nl of noteLines) {
        drawText(ML, y - 9, nl, 8.5, false, [0.28, 0.31, 0.36])
        y -= 12
      }
      y -= 4
    }
  }

  // Column definitions
  type ColDef = { label: string; width: number; maxChars: number; align?: 'right' }
  const cols: ColDef[] = opts.showPricing
    ? opts.groupByShop
      ? [
          { label: '#', width: 24, maxChars: 4 },
          { label: 'Product Name / Pack', width: 215, maxChars: 42 },
          { label: 'Company', width: 88, maxChars: 17 },
          { label: 'Rate / Discount / Scheme', width: 120, maxChars: 24 },
          { label: 'Qty', width: 38, maxChars: 7, align: 'right' },
          { label: 'Total', width: CW - 485, maxChars: 9, align: 'right' },
        ]
      : [
          { label: '#', width: 22, maxChars: 4 },
          { label: 'Product Name / Pack', width: 172, maxChars: 33 },
          { label: 'Company', width: 78, maxChars: 15 },
          { label: 'Supplier / Shop', width: 92, maxChars: 18 },
          { label: 'Rate / Discount', width: 118, maxChars: 23 },
          { label: 'Qty', width: CW - 482, maxChars: 8, align: 'right' },
        ]
    : opts.groupByShop
      ? [
          { label: '#', width: 28, maxChars: 4 },
          { label: 'Product Name / Strength / Pack', width: 285, maxChars: 56 },
          { label: 'Company', width: 130, maxChars: 25 },
          { label: 'Order Qty', width: CW - 443, maxChars: 14, align: 'right' },
        ]
      : [
          { label: '#', width: 26, maxChars: 4 },
          { label: 'Product Name / Pack', width: 215, maxChars: 42 },
          { label: 'Company', width: 110, maxChars: 21 },
          { label: 'Supplier', width: 110, maxChars: 21 },
          { label: 'Qty', width: CW - 461, maxChars: 12, align: 'right' },
        ]

  const drawTableHeader = () => {
    drawRect(ML, y - 18, CW, 18, [0.95, 0.96, 0.98], [0.82, 0.85, 0.89])
    let cx = ML
    for (const col of cols) {
      if (col.align === 'right') drawRight(cx + col.width - 4, y - 12, col.label, 8, true, [0.3, 0.33, 0.38])
      else drawText(cx + 4, y - 12, col.label, 8, true, [0.3, 0.33, 0.38])
      cx += col.width
    }
    y -= 18
  }

  const drawShopBanner = (g: ShopOrderGroup) => {
    const contact = [g.shop?.owner_name, g.shop?.phone, g.shop?.city].filter(Boolean).join(' - ')
    const bh = contact ? 30 : 22
    if (y - bh - 24 < BOT) {
      startPage()
      drawDocHeader(true)
    }
    drawRect(ML, y - bh, CW, bh, [0.97, 0.98, 1.0], [0.75, 0.82, 0.92])
    drawText(ML + 8, y - 13, `Supplier: ${g.shopName}`, 10, true, [0.1, 0.35, 0.72])
    const metaRight = `${g.lines.length} item${g.lines.length === 1 ? '' : 's'}${opts.showPricing && g.estimatedTotal > 0 ? ` - Est ${fmtRsAscii(g.estimatedTotal)}` : ''}`
    drawRight(ML + CW - 8, y - 13, metaRight, 8.5, true, [0.15, 0.17, 0.2])
    if (contact) drawText(ML + 8, y - 24, contact, 8, false, [0.35, 0.38, 0.42])
    y -= bh + 4
  }

  startPage()
  drawDocHeader(false)

  opts.groups.forEach((g, gIdx) => {
    if (gIdx > 0 && opts.groupByShop && opts.pageBreakPerShop) {
      startPage()
      drawDocHeader(false)
    } else if (gIdx > 0) {
      y -= 8
    }

    if (opts.groupByShop) drawShopBanner(g)
    if (y - 36 < BOT) {
      startPage()
      drawDocHeader(true)
      if (opts.groupByShop) drawShopBanner(g)
    }
    drawTableHeader()

    g.lines.forEach((l, idx) => {
      const vl = variantLabel(l.product)
      const titleFull = vl && !l.product.name.toLowerCase().includes(vl.toLowerCase()) ? `${l.product.name} (${vl})` : l.product.name
      const cells: string[] = opts.showPricing
        ? opts.groupByShop
          ? [
              String(idx + 1),
              titleFull,
              l.company ?? '-',
              l.offerLabel,
              l.qty || '[    ]',
              l.lineTotal != null ? fmtRsAscii(l.lineTotal) : '-',
            ]
          : [
              String(idx + 1),
              titleFull,
              l.company ?? '-',
              l.shop?.name ?? '-',
              l.offerLabel,
              l.qty || '[    ]',
            ]
        : opts.groupByShop
          ? [String(idx + 1), titleFull, l.company ?? '-', l.qty || '[       ]']
          : [String(idx + 1), titleFull, l.company ?? '-', l.shop?.name ?? '-', l.qty || '[     ]']

      const wrapped = cells.map((val, cIdx) => wrapText(val, cols[cIdx].maxChars))
      const maxLines = Math.max(1, ...wrapped.map((w) => w.length))
      const rowH = Math.max(17, maxLines * 10 + 7)

      if (y - rowH < BOT) {
        startPage()
        drawDocHeader(true)
        if (opts.groupByShop) drawShopBanner(g)
        drawTableHeader()
      }

      if (idx % 2 === 1) drawRect(ML, y - rowH, CW, rowH, [0.985, 0.988, 0.992])
      drawLine(ML, y - rowH, ML + CW, y - rowH, [0.9, 0.91, 0.93])

      let cx = ML
      wrapped.forEach((lines, cIdx) => {
        const col = cols[cIdx]
        lines.forEach((line, lIdx) => {
          const ly = y - 11 - lIdx * 10
          if (col.align === 'right') drawRight(cx + col.width - 4, ly, line, 8.2, cIdx === 1)
          else drawText(cx + 4, ly, line, 8.2, cIdx === 1)
        })
        cx += col.width
      })
      y -= rowH
    })

    if (opts.showPricing && g.estimatedTotal > 0) {
      if (y - 22 < BOT) {
        startPage()
        drawDocHeader(true)
      }
      drawRect(ML, y - 20, CW, 20, [0.93, 0.97, 0.94], [0.75, 0.87, 0.79])
      drawRight(ML + CW - 8, y - 13, `${g.shopName} Estimated Total (${g.pricedLines}/${g.lines.length} priced): ${fmtRsAscii(g.estimatedTotal)}`, 8.5, true, [0.09, 0.5, 0.22])
      y -= 24
    }
  })

  // Footer on every page
  const totalPages = pages.length
  pages.forEach((pageCmds, pIdx) => {
    const prev = cmds
    cmds = pageCmds
    drawLine(ML, 30, ML + CW, 30, [0.85, 0.87, 0.9])
    drawText(ML, 19, 'Hafsa Medicose - Wholesale Price Intelligence', 7.5, false, [0.45, 0.48, 0.52])
    drawRight(ML + CW, 19, `Page ${pIdx + 1} of ${totalPages}`, 7.5, false, [0.45, 0.48, 0.52])
    cmds = prev
  })

  // Assemble valid PDF 1.4 objects
  const objects: string[] = []
  const addObj = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalogId = addObj('') // 1 placeholder
  const pagesId = addObj('') // 2 placeholder
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

  const chunks: Uint8Array[] = [headerBlock]
  let offset = headerBlock.length
  const offsets: number[] = [0]

  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    const objBytes = enc.encode(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`)
    chunks.push(objBytes)
    offset += objBytes.length
  }

  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(enc.encode(xref))

  const totalLen = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const c of chunks) {
    result.set(c, pos)
    pos += c.length
  }
  return result
}
