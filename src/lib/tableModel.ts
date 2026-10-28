// Row model, sorting and grouping for the product / comparison tables. Pure functions.
import { compareOffers, type CompareOptions, type CompareResult, type OfferView } from './compare'
import { naturalCompare, numCompare, variantLabel } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

export interface ProductRow {
  product: Product
  cmp: CompareResult
  records: PriceRecord[]
  bestOffer: OfferView | null
  bestShop: Shop | null
  nextBestShop: Shop | null
  schemeOnlyOffer: PriceRecord | null
  bestCents: number | null
  highestCents: number | null
  maxDiscount: number | null
  latestDate: string | null
  oldestDate: string | null
  savingRs: number | null
  opportunityPct: number
  variant: string
  hasFreshOffer: boolean
  hasStaleOffer: boolean
  hasValidOffer: boolean
  hasExpiredOffer: boolean
  hasIncompleteOffer: boolean
  searchText: string
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
    const schemeOnlyOffer =
      !bestOffer
        ? cmp.offers.find((o) => o.isDiscountOnly)?.rec ?? records.find((r) => r.scheme_status === 'ok' && Boolean(r.scheme_text)) ?? null
        : null
    const variant = variantLabel(product)
    let latestDate: string | null = null
    let oldestDate: string | null = null
    let maxDiscount: number | null = null
    for (const r of records) {
      if (latestDate == null || r.observed_on > latestDate) latestDate = r.observed_on
      if (oldestDate == null || r.observed_on < oldestDate) oldestDate = r.observed_on
      if (r.discount_pct != null && (maxDiscount == null || r.discount_pct > maxDiscount)) maxDiscount = r.discount_pct
    }
    const searchParts: (string | null | undefined)[] = [
      product.name,
      product.normalized_name,
      product.brand,
      product.manufacturer,
      product.active_ingredient,
      product.dosage_form,
      product.variant,
      variant,
      product.barcode,
      product.mfr_code,
      `#${product.product_no}`,
      String(product.product_no),
      product.strength_value != null ? `${product.strength_value}${product.strength_unit ?? ''}` : '',
      product.weight_value != null ? `${product.weight_value}${product.weight_unit ?? ''}` : '',
      product.pack_size != null ? `${product.pack_size}s` : '',
    ]
    for (const r of records) {
      searchParts.push(r.original_title, r.original_code, r.scheme_text, shops.get(r.shop_id)?.name)
    }
    const searchText = searchParts.filter(Boolean).join(' ').toLowerCase()

    return {
      product,
      cmp,
      records,
      bestOffer,
      bestShop: bestOffer ? shops.get(bestOffer.rec.shop_id) ?? null : null,
      nextBestShop: cmp.nextBest ? shops.get(cmp.nextBest.shopId) ?? null : null,
      schemeOnlyOffer,
      bestCents: cmp.bestCents,
      highestCents: eligible.length ? eligible[eligible.length - 1].cents : null,
      maxDiscount,
      latestDate,
      oldestDate,
      savingRs: cmp.nextBest ? cmp.nextBest.saving : null,
      opportunityPct: cmp.nextBest ? cmp.nextBest.savingPct : 0,
      variant,
      hasFreshOffer: cmp.offers.some((o) => o.fresh && !o.rec.archived),
      hasStaleOffer: cmp.hasStaleOffers,
      hasValidOffer: cmp.eligibleCount > 0,
      hasExpiredOffer: cmp.hasExpiredOffers,
      hasIncompleteOffer: cmp.hasIncompleteOffers,
      searchText,
    }
  })
}

export type SortKey =
  | 'price_low'
  | 'price_high'
  | 'name_asc'
  | 'name_desc'
  | 'survey'
  | 'survey_asc'
  | 'opportunity'
  | 'savings'
  | 'wishlist_first'
  | 'code'
  | 'brand'
  | 'manufacturer'
  | 'strength'
  | 'weight'
  | 'pack'
  | 'discount'
  | 'shop'

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'price_low', label: 'Best effective price — lowest first' },
  { key: 'price_high', label: 'Best effective price — highest first' },
  { key: 'name_asc', label: 'Product name A → Z' },
  { key: 'name_desc', label: 'Product name Z → A' },
  { key: 'survey', label: 'Most recently surveyed' },
  { key: 'survey_asc', label: 'Oldest survey first' },
  { key: 'opportunity', label: 'Largest verified savings' },
  { key: 'wishlist_first', label: 'Wishlist products first' },
  { key: 'shop', label: 'Best supplier name' },
  { key: 'code', label: 'Product ID' },
  { key: 'brand', label: 'Brand' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'strength', label: 'Strength' },
  { key: 'weight', label: 'Grams / weight' },
  { key: 'pack', label: 'Pack size' },
  { key: 'discount', label: 'Highest discount %' },
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

export function sortRows(
  rows: ProductRow[],
  key: SortKey,
  wishlist?: { has(id: string): boolean },
): ProductRow[] {
  const nameCmp = (a: ProductRow, b: ProductRow) =>
    naturalCompare(a.product.normalized_name, b.product.normalized_name) || variantCompare(a.product, b.product)
  const cmpNullLast = (x: number | null, y: number | null, dir: 1 | -1) =>
    x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir
  const strNullLast = (x: string | null, y: string | null, dir: 1 | -1) =>
    x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : x.localeCompare(y) * dir

  const priceLowCmp = (a: ProductRow, b: ProductRow) => {
    const c = cmpNullLast(a.bestCents, b.bestCents, 1)
    if (c !== 0) return c
    // Among products without an absolute rupee price, put those with recorded scheme/discount offers ahead of empty products
    if (a.bestCents == null && b.bestCents == null) {
      const aHas = a.records.length > 0 ? 0 : 1
      const bHas = b.records.length > 0 ? 0 : 1
      if (aHas !== bHas) return aHas - bHas
    }
    return (b.savingRs ?? 0) - (a.savingRs ?? 0) || nameCmp(a, b)
  }

  const savingsCmp = (a: ProductRow, b: ProductRow) => {
    const c = cmpNullLast(a.savingRs, b.savingRs, -1)
    if (c !== 0) return c
    return (b.opportunityPct - a.opportunityPct) || priceLowCmp(a, b)
  }

  const cmp: Record<SortKey, (a: ProductRow, b: ProductRow) => number> = {
    name_asc: nameCmp,
    name_desc: (a, b) => -naturalCompare(a.product.normalized_name, b.product.normalized_name) || variantCompare(a.product, b.product),
    code: (a, b) => a.product.product_no - b.product.product_no,
    brand: (a, b) => naturalCompare(str(a.product.brand), str(b.product.brand)) || nameCmp(a, b),
    manufacturer: (a, b) => naturalCompare(str(a.product.manufacturer), str(b.product.manufacturer)) || nameCmp(a, b),
    strength: (a, b) => numCompare(a.product.strength_value, b.product.strength_value) || nameCmp(a, b),
    weight: (a, b) => numCompare(a.product.weight_value, b.product.weight_value) || nameCmp(a, b),
    pack: (a, b) => numCompare(a.product.pack_size, b.product.pack_size) || nameCmp(a, b),
    price_low: priceLowCmp,
    price_high: (a, b) => cmpNullLast(a.bestCents ?? a.highestCents, b.bestCents ?? b.highestCents, -1) || nameCmp(a, b),
    discount: (a, b) => cmpNullLast(a.maxDiscount, b.maxDiscount, -1) || nameCmp(a, b),
    shop: (a, b) => {
      if (!a.bestShop && !b.bestShop) return nameCmp(a, b)
      if (!a.bestShop) return 1
      if (!b.bestShop) return -1
      return naturalCompare(str(a.bestShop.name), str(b.bestShop.name)) || priceLowCmp(a, b)
    },
    survey: (a, b) => strNullLast(a.latestDate, b.latestDate, -1) || nameCmp(a, b),
    survey_asc: (a, b) => strNullLast(a.oldestDate ?? a.latestDate, b.oldestDate ?? b.latestDate, 1) || nameCmp(a, b),
    opportunity: savingsCmp,
    savings: savingsCmp,
    wishlist_first: (a, b) => {
      const aw = wishlist?.has(a.product.id) ? 0 : 1
      const bw = wishlist?.has(b.product.id) ? 0 : 1
      return aw - bw || priceLowCmp(a, b)
    },
  }
  return [...rows].sort(cmp[key] ?? priceLowCmp)
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
  searchText?: string
}

/** Case-insensitive token search across product fields, dosage form, supplier codes, and shop names. */
export function matchesQuery(r: SearchableRow, q: string, shops: Map<string, Shop>): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  if (r.searchText) {
    return tokens.every((t) => r.searchText!.includes(t))
  }
  const p = r.product
  const hay = [
    p.name, p.normalized_name, p.brand, p.manufacturer, p.active_ingredient, p.dosage_form, p.variant,
    p.barcode, p.mfr_code, `#${p.product_no}`, String(p.product_no),
    p.strength_value != null ? `${p.strength_value}${p.strength_unit ?? ''}` : '',
    p.weight_value != null ? `${p.weight_value}${p.weight_unit ?? ''}` : '',
    p.pack_size != null ? `${p.pack_size}s` : '',
    ...r.records.flatMap((x) => [x.original_title, x.original_code, x.scheme_text, shops.get(x.shop_id)?.name]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return tokens.every((t) => hay.includes(t))
}
