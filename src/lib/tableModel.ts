// Row model, sorting and grouping for the product / comparison tables. Pure functions.
import { compareOffers, type CompareOptions, type CompareResult } from './compare'
import { naturalCompare, numCompare, variantLabel } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

export interface ProductRow {
  product: Product
  cmp: CompareResult
  records: PriceRecord[]
  bestShop: Shop | null
  bestCents: number | null
  highestCents: number | null
  maxDiscount: number | null
  latestDate: string | null
  opportunityPct: number
  variant: string
}

export function buildProductRows(products: Product[], current: PriceRecord[], shops: Map<string, Shop>, opt: CompareOptions): ProductRow[] {
  const by = new Map<string, PriceRecord[]>()
  for (const r of current) {
    if (!r.product_id) continue
    const a = by.get(r.product_id)
    if (a) a.push(r)
    else by.set(r.product_id, [r])
  }
  return products.map((product) => {
    const records = by.get(product.id) ?? []
    const cmp = compareOffers(records, product, opt)
    const eligible = cmp.offers.filter((o) => o.eligible)
    const bestOffer = eligible[0] ?? null
    return {
      product, cmp, records,
      bestShop: bestOffer ? shops.get(bestOffer.rec.shop_id) ?? null : null,
      bestCents: cmp.bestCents,
      highestCents: eligible.length ? eligible[eligible.length - 1].cents : null,
      maxDiscount: records.reduce<number | null>((m, r) => (r.discount_pct != null && (m == null || r.discount_pct > m) ? r.discount_pct : m), null),
      latestDate: records.reduce<string | null>((m, r) => (m == null || r.observed_on > m ? r.observed_on : m), null),
      opportunityPct: cmp.nextBest ? cmp.nextBest.savingPct : 0,
      variant: variantLabel(product),
    }
  })
}

export type SortKey =
  | 'name_asc' | 'name_desc' | 'code' | 'brand' | 'manufacturer' | 'strength' | 'weight' | 'pack'
  | 'price_low' | 'price_high' | 'discount' | 'shop' | 'survey' | 'opportunity'

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name_asc', label: 'Name A → Z' },
  { key: 'name_desc', label: 'Name Z → A' },
  { key: 'code', label: 'Product ID' },
  { key: 'brand', label: 'Brand' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'strength', label: 'Strength' },
  { key: 'weight', label: 'Grams / weight' },
  { key: 'pack', label: 'Pack size' },
  { key: 'price_low', label: 'Lowest effective price' },
  { key: 'price_high', label: 'Highest effective price' },
  { key: 'discount', label: 'Highest discount' },
  { key: 'shop', label: 'Shop name (best offer)' },
  { key: 'survey', label: 'Latest survey date' },
  { key: 'opportunity', label: 'Best purchase opportunity' },
]

export type GroupKey = 'none' | 'title' | 'product' | 'brand' | 'manufacturer' | 'shop' | 'strength' | 'weight' | 'pack' | 'best'

export const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'none', label: 'No grouping' },
  { key: 'title', label: 'Product title (variants underneath)' },
  { key: 'product', label: 'Canonical product ID' },
  { key: 'brand', label: 'Brand' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'shop', label: 'Shop (best offer)' },
  { key: 'strength', label: 'Strength' },
  { key: 'weight', label: 'Grams / weight' },
  { key: 'pack', label: 'Pack size' },
  { key: 'best', label: 'Best-price status' },
]

const str = (s: string | null | undefined) => (s ?? '').toLowerCase()

/** Natural comparison of the variant parts so 25g < 50g < 100g < 200g. */
export function variantCompare(a: Product, b: Product): number {
  return (
    numCompare(a.weight_value, b.weight_value) ||
    numCompare(a.strength_value, b.strength_value) ||
    numCompare(a.pack_size, b.pack_size) ||
    naturalCompare(a.name, b.name)
  )
}

export function sortRows(rows: ProductRow[], key: SortKey): ProductRow[] {
  const nameCmp = (a: ProductRow, b: ProductRow) => naturalCompare(a.product.normalized_name, b.product.normalized_name) || variantCompare(a.product, b.product)
  const cmpNullLast = (x: number | null, y: number | null, dir: 1 | -1) => (x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir)
  const cmp: Record<SortKey, (a: ProductRow, b: ProductRow) => number> = {
    name_asc: nameCmp,
    name_desc: (a, b) => -naturalCompare(a.product.normalized_name, b.product.normalized_name) || variantCompare(a.product, b.product),
    code: (a, b) => a.product.product_no - b.product.product_no,
    brand: (a, b) => naturalCompare(str(a.product.brand), str(b.product.brand)) || nameCmp(a, b),
    manufacturer: (a, b) => naturalCompare(str(a.product.manufacturer), str(b.product.manufacturer)) || nameCmp(a, b),
    strength: (a, b) => numCompare(a.product.strength_value, b.product.strength_value) || nameCmp(a, b),
    weight: (a, b) => numCompare(a.product.weight_value, b.product.weight_value) || nameCmp(a, b),
    pack: (a, b) => numCompare(a.product.pack_size, b.product.pack_size) || nameCmp(a, b),
    price_low: (a, b) => cmpNullLast(a.bestCents, b.bestCents, 1) || nameCmp(a, b),
    price_high: (a, b) => cmpNullLast(a.highestCents, b.highestCents, -1) || nameCmp(a, b),
    discount: (a, b) => cmpNullLast(a.maxDiscount, b.maxDiscount, -1) || nameCmp(a, b),
    shop: (a, b) => naturalCompare(str(a.bestShop?.name), str(b.bestShop?.name)) || nameCmp(a, b),
    survey: (a, b) => (b.latestDate ?? '').localeCompare(a.latestDate ?? '') || nameCmp(a, b),
    opportunity: (a, b) => b.opportunityPct - a.opportunityPct || nameCmp(a, b),
  }
  return [...rows].sort(cmp[key])
}

export interface Group {
  key: string
  label: string
  rows: ProductRow[]
}

export function groupRows(rows: ProductRow[], key: GroupKey): Group[] {
  if (key === 'none') return [{ key: 'all', label: '', rows }]
  const label = (r: ProductRow): string => {
    const p = r.product
    switch (key) {
      case 'title': return titleCase(p.normalized_name || p.name)
      case 'product': return `#${p.product_no} ${p.name}`
      case 'brand': return p.brand || 'No brand'
      case 'manufacturer': return p.manufacturer || 'No manufacturer'
      case 'shop': return r.bestShop?.name ?? 'No valid offer'
      case 'strength': return p.strength_value != null ? `${p.strength_value}${p.strength_unit ?? ''}` : 'No strength'
      case 'weight': return p.weight_value != null ? `${p.weight_value}${p.weight_unit ?? ''}` : 'No weight'
      case 'pack': return p.pack_size != null ? `${p.pack_size} pcs` : 'No pack size'
      case 'best': return r.cmp.eligibleCount >= 2 ? (r.cmp.tied ? 'Tied best price' : 'Has a best price') : r.cmp.eligibleCount === 1 ? 'Only one offer' : 'No valid offers'
      default: return ''
    }
  }
  const map = new Map<string, Group>()
  for (const r of rows) {
    const l = label(r)
    const g = map.get(l) ?? { key: l, label: l, rows: [] }
    g.rows.push(r)
    map.set(l, g)
  }
  const groups = [...map.values()]
  if (key === 'strength' || key === 'weight' || key === 'pack') {
    groups.sort((a, b) => naturalCompare(a.label, b.label))
  } else if (key !== 'best') {
    groups.sort((a, b) => naturalCompare(a.label, b.label))
  }
  if (key === 'title') for (const g of groups) g.rows.sort((a, b) => variantCompare(a.product, b.product))
  return groups
}

export function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

export interface SearchableRow {
  product: Product
  records: PriceRecord[]
}

/** Case-insensitive token search across product fields, supplier codes, and shop names. */
export function matchesQuery(r: SearchableRow, q: string, shops: Map<string, Shop>): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const p = r.product
  const hay = [
    p.name, p.normalized_name, p.brand, p.manufacturer, p.barcode, p.mfr_code, `#${p.product_no}`, String(p.product_no),
    p.strength_value != null ? `${p.strength_value}${p.strength_unit}` : '', p.weight_value != null ? `${p.weight_value}${p.weight_unit}` : '',
    ...r.records.flatMap((x) => [x.original_title, x.original_code, shops.get(x.shop_id)?.name]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return tokens.every((t) => hay.includes(t))
}
