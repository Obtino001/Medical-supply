// Export datasets, configurable column profiles, CSV / XLSX writers with formula-injection protection.
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { compareOffers, type CompareOptions } from './compare'
import { variantLabel } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

export type ExportValue = string | number | boolean | null

export interface ExportColumn {
  key: string
  label: string
  /** default header text in the generic export */
  header: string
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'product_id', label: 'Product ID (internal #)', header: 'product_id' },
  { key: 'product_name', label: 'Product name', header: 'product_name' },
  { key: 'title_group', label: 'Title group', header: 'title_group' },
  { key: 'brand', label: 'Brand', header: 'brand' },
  { key: 'manufacturer', label: 'Manufacturer', header: 'manufacturer' },
  { key: 'strength', label: 'Strength', header: 'strength' },
  { key: 'weight', label: 'Grams / weight / volume', header: 'weight' },
  { key: 'pack_size', label: 'Pack size', header: 'pack_size' },
  { key: 'dosage_form', label: 'Dosage form', header: 'dosage_form' },
  { key: 'barcode', label: 'Barcode', header: 'barcode' },
  { key: 'mfr_code', label: 'Manufacturer code', header: 'mfr_code' },
  { key: 'shop', label: 'Shop', header: 'shop' },
  { key: 'shop_phone', label: 'Shop phone', header: 'shop_phone' },
  { key: 'supplier_title', label: 'Title in shop list', header: 'supplier_title' },
  { key: 'supplier_code', label: 'Shop product code', header: 'supplier_code' },
  { key: 'base_price', label: 'Base price', header: 'base_price' },
  { key: 'mrp', label: 'MRP', header: 'mrp' },
  { key: 'discount_pct', label: 'Discount %', header: 'discount_pct' },
  { key: 'flat_discount', label: 'Flat discount (Rs)', header: 'flat_discount' },
  { key: 'scheme', label: 'Scheme text', header: 'scheme' },
  { key: 'effective_cost', label: 'Effective cost', header: 'effective_cost' },
  { key: 'per_unit', label: 'Price per g / ml', header: 'price_per_unit' },
  { key: 'is_best', label: 'Best price?', header: 'is_best' },
  { key: 'offers_count', label: 'Number of offers', header: 'offers_count' },
  { key: 'availability', label: 'Availability', header: 'availability' },
  { key: 'expiry', label: 'Expiry', header: 'expiry' },
  { key: 'survey_date', label: 'Survey date', header: 'survey_date' },
  { key: 'scheme_status', label: 'Price check status', header: 'price_status' },
  { key: 'match_status', label: 'Match status', header: 'match_status' },
  { key: 'notes', label: 'Notes', header: 'notes' },
]

export const DEFAULT_COLUMN_KEYS = [
  'product_id', 'product_name', 'brand', 'manufacturer', 'strength', 'weight', 'pack_size', 'shop',
  'base_price', 'discount_pct', 'scheme', 'effective_cost', 'is_best', 'survey_date',
]

export type Dataset = 'products' | 'selected' | 'best' | 'offers' | 'shop' | 'latest' | 'new' | 'grouped' | 'review'

export interface ExportContext {
  products: Product[]
  shops: Map<string, Shop>
  current: PriceRecord[] // latest per product+shop
  review: PriceRecord[] // records needing match review
  opt: CompareOptions
  selectedIds: Set<string>
  shopId?: string
  sinceDays?: number
}

export type ExportRow = Record<string, ExportValue>

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase())
const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)

function recordFields(rec: PriceRecord, shop: Shop | undefined, p: Product | undefined): ExportRow {
  const perUnit = p?.weight_value && rec.effective_cost != null ? Math.round((rec.effective_cost / p.weight_value) * 10000) / 10000 : null
  return {
    shop: shop?.name ?? '', shop_phone: shop?.phone ?? '',
    supplier_title: rec.original_title, supplier_code: rec.original_code ?? '',
    base_price: rec.base_price, mrp: rec.mrp, discount_pct: rec.discount_pct, flat_discount: rec.flat_discount,
    scheme: rec.scheme_text ?? '', effective_cost: rec.scheme_status === 'ok' ? round2(rec.effective_cost) : null,
    per_unit: perUnit, availability: rec.availability ?? '', expiry: rec.expiry ?? '', survey_date: rec.observed_on,
    scheme_status: rec.scheme_status, match_status: rec.match_status, notes: rec.notes ?? '',
  }
}

function productFields(p: Product | undefined): ExportRow {
  if (!p) return { product_id: '', product_name: '', title_group: '', brand: '', manufacturer: '', strength: '', weight: '', pack_size: null, dosage_form: '', barcode: '', mfr_code: '' }
  return {
    product_id: p.product_no, product_name: p.name, title_group: titleCase(p.normalized_name),
    brand: p.brand ?? '', manufacturer: p.manufacturer ?? '',
    strength: p.strength_value != null ? `${p.strength_value}${p.strength_unit ?? ''}` : '',
    weight: p.weight_value != null ? `${p.weight_value}${p.weight_unit ?? ''}` : '',
    pack_size: p.pack_size, dosage_form: p.dosage_form ?? '', barcode: p.barcode ?? '', mfr_code: p.mfr_code ?? '',
  }
}

export function buildExportRows(ds: Dataset, ctx: ExportContext): ExportRow[] {
  const pById = new Map(ctx.products.map((p) => [p.id, p]))
  const byProduct = new Map<string, PriceRecord[]>()
  for (const r of ctx.current) {
    if (!r.product_id) continue
    const a = byProduct.get(r.product_id)
    if (a) a.push(r)
    else byProduct.set(r.product_id, [r])
  }
  const offerRow = (rec: PriceRecord, isBest: boolean | null, count: number | null): ExportRow => {
    const p = rec.product_id ? pById.get(rec.product_id) : undefined
    return { ...productFields(p), ...recordFields(rec, ctx.shops.get(rec.shop_id), p), is_best: isBest === null ? '' : isBest ? 'YES' : 'no', offers_count: count }
  }
  // one row per product, showing its best eligible offer (or blank offer columns)
  const productRow = (p: Product): ExportRow => {
    const recs = byProduct.get(p.id) ?? []
    const cmp = compareOffers(recs, p, ctx.opt)
    const best = cmp.offers.find((o) => o.eligible)
    if (best) return offerRow(best.rec, best.isBest, recs.length)
    return { ...productFields(p), offers_count: recs.length, is_best: '' }
  }

  switch (ds) {
    case 'products': return ctx.products.filter((p) => !p.archived).map(productRow)
    case 'selected': return ctx.products.filter((p) => ctx.selectedIds.has(p.id)).map(productRow)
    case 'grouped':
      return ctx.products
        .filter((p) => !p.archived)
        .sort((a, b) => a.normalized_name.localeCompare(b.normalized_name, 'en', { numeric: true }) || (a.weight_value ?? 0) - (b.weight_value ?? 0) || (a.strength_value ?? 0) - (b.strength_value ?? 0))
        .map(productRow)
    case 'best': {
      const rows: ExportRow[] = []
      for (const p of ctx.products) {
        if (p.archived) continue
        const recs = byProduct.get(p.id) ?? []
        const cmp = compareOffers(recs, p, ctx.opt)
        for (const o of cmp.offers) if (o.eligible && (o.isBest || (cmp.eligibleCount === 1 && o.cents === cmp.bestCents))) rows.push(offerRow(o.rec, o.isBest, recs.length))
      }
      return rows
    }
    case 'offers': {
      const ids = ctx.selectedIds.size ? ctx.selectedIds : null
      const rows: ExportRow[] = []
      for (const p of ctx.products) {
        if (p.archived || (ids && !ids.has(p.id))) continue
        const recs = byProduct.get(p.id) ?? []
        const cmp = compareOffers(recs, p, ctx.opt)
        for (const o of cmp.offers) rows.push(offerRow(o.rec, o.isBest, recs.length))
      }
      return rows
    }
    case 'shop':
      return ctx.current.filter((r) => r.shop_id === ctx.shopId).map((r) => offerRow(r, null, null))
    case 'latest':
      return ctx.current.map((r) => offerRow(r, null, byProduct.get(r.product_id!)?.length ?? null))
    case 'new': {
      const since = new Date(Date.now() - (ctx.sinceDays ?? 7) * 86400000).toISOString()
      return ctx.current.filter((r) => r.created_at >= since).map((r) => offerRow(r, null, null))
    }
    case 'review': {
      const rows = ctx.review.map((r) => offerRow(r, null, null))
      const schemeReview = ctx.current.filter((r) => r.scheme_status !== 'ok').map((r) => offerRow(r, null, null))
      return [...rows, ...schemeReview]
    }
  }
}

export interface ExportProfile {
  name: string
  isErp: boolean
  columns: { key: string; header: string }[]
}

export const GENERIC_PROFILE: ExportProfile = {
  name: 'Generic export',
  isErp: false,
  columns: DEFAULT_COLUMN_KEYS.map((k) => ({ key: k, header: EXPORT_COLUMNS.find((c) => c.key === k)!.header })),
}

export function toMatrix(rows: ExportRow[], columns: { key: string; header: string }[]): ExportValue[][] {
  return [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => r[c.key] ?? ''))]
}

/** Neutralise spreadsheet formulas in untrusted text: =, +, -, @, tab, CR at the start. Numbers are untouched. */
export function sanitizeCell(v: ExportValue): ExportValue {
  if (typeof v !== 'string') return v
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v
}

export function toCsv(matrix: ExportValue[][]): string {
  const safe = matrix.map((row) => row.map(sanitizeCell))
  // BOM so Excel opens UTF-8 correctly; CRLF for Windows spreadsheet tools
  return '﻿' + Papa.unparse(safe as unknown[][], { newline: '\r\n', quotes: false, escapeFormulae: false })
}

export function toXlsxBuffer(matrix: ExportValue[][], meta: { sheet: string; info: (string | number)[][] }): ArrayBuffer {
  const safe = matrix.map((row) => row.map(sanitizeCell))
  const ws = XLSX.utils.aoa_to_sheet(safe as unknown[][])
  ws['!cols'] = (safe[0] ?? []).map((h, i) => ({ wch: Math.min(40, Math.max(String(h).length + 2, ...safe.slice(1, 50).map((r) => String(r[i] ?? '').length + 1))) }))
  const info = XLSX.utils.aoa_to_sheet(meta.info)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, meta.sheet.slice(0, 31))
  XLSX.utils.book_append_sheet(wb, info, 'Export info')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

export function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export { variantLabel }
