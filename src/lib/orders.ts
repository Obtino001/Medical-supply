// Pure Purchase Order pricing, supplier comparison, 5% negotiation target calculation, and company-wise grouping.
import {
  companyCompareKey,
  companyProductDedupeKey,
  primaryProductScore,
  resolveCanonicalCompany,
  resolveProductDisplayCompany,
} from './companies'
import { compareOffers, hasAttributeConflict, type CompareOptions } from './compare'
import { naturalCompare } from './productParse'
import type { PriceRecord, Product, PurchaseOrder, Shop, SupplierOfferSnapshot } from './types'

export const DEFAULT_EXTRA_DISCOUNT_PCT = 5

export function roundMoney2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Default additional negotiation target calculation:
 * target_price = lowest_supplier_price * (1 - extraDiscountPct / 100)
 * Example: lowest 950 with 5% -> 902.50. Always treated as a negotiation target, not a confirmed rate.
 */
export function calculateTargetPrice(
  lowestSupplierPrice: number | null | undefined,
  extraDiscountPct = DEFAULT_EXTRA_DISCOUNT_PCT,
): number | null {
  if (lowestSupplierPrice == null || !Number.isFinite(lowestSupplierPrice) || lowestSupplierPrice <= 0) return null
  const pct = Math.max(0, Math.min(99.99, Number.isFinite(extraDiscountPct) ? extraDiscountPct : DEFAULT_EXTRA_DISCOUNT_PCT))
  return roundMoney2(lowestSupplierPrice * (1 - pct / 100))
}

export function detectRecordCurrency(rec: PriceRecord): string {
  const attrCurr = rec.source_attrs?.currency?.trim().toUpperCase()
  if (attrCurr) return attrCurr
  const text = `${rec.scheme_text ?? ''} ${rec.notes ?? ''}`
  if (/\b(USD|US\$)\b|\$/i.test(text)) return 'USD'
  if (/\b(EUR|EURO)\b|€/i.test(text)) return 'EUR'
  if (/\b(GBP)\b|£/i.test(text)) return 'GBP'
  if (/\b(AED|SAR)\b/i.test(text)) return /\bSAR\b/i.test(text) ? 'SAR' : 'AED'
  return 'PKR'
}

export interface ComparedSupplierOffer {
  rec: PriceRecord
  shop: Shop | null
  shopName: string
  recordedPrice: number | null
  effectiveCost: number | null
  discountPct: number | null
  schemeText: string | null
  observedOn: string
  ageDays: number
  fresh: boolean
  currency: string
  /** True only if variant, pack size, currency, stock, expiry, and scheme status permit numeric price comparison */
  comparable: boolean
  excludeReason: string | null
  isLowest: boolean
}

export interface ProductOrderPricing {
  offers: ComparedSupplierOffer[]
  lowestPrice: number | null
  lowestShopId: string | null
  lowestShopName: string | null
  lowestDate: string | null
  lowestIsStale: boolean
  targetPrice5Pct: number | null
  hasIncompatibleVariants: boolean
  hasIncompatibleCurrencies: boolean
  hasStaleOffers: boolean
  hasOnlyDiscountOffers: boolean
}

/**
 * Evaluate every supplier's current offer for one canonical product.
 * Excludes incompatible variants, pack sizes, currencies, unavailable/expired/review offers from numeric comparison,
 * and clearly surfaces freshness dates on stale offers.
 */
export function evaluateProductSupplierOffers(
  product: Product,
  records: PriceRecord[],
  shops: Map<string, Shop>,
  opt: CompareOptions & { baseCurrency?: string; includeStaleInLowest?: boolean },
): ProductOrderPricing {
  const baseCurrency = (opt.baseCurrency ?? 'PKR').toUpperCase()
  const includeStaleInLowest = opt.includeStaleInLowest !== false
  const cmp = compareOffers(records, product, {
    freshnessDays: opt.freshnessDays,
    excludeStale: false,
    today: opt.today,
  })

  let hasIncompatibleVariants = false
  let hasIncompatibleCurrencies = false
  let hasStaleOffers = false
  let hasOnlyDiscountOffers = false

  const evaluated: ComparedSupplierOffer[] = cmp.offers.map((ov) => {
    const rec = ov.rec
    const shop = shops.get(rec.shop_id) ?? null
    const shopName = shop?.name ?? 'Unknown supplier'
    const currency = detectRecordCurrency(rec)
    const variantConflict = hasAttributeConflict(rec, product)

    let comparable = ov.eligible && ov.cents != null
    let excludeReason: string | null = null

    if (variantConflict) {
      comparable = false
      hasIncompatibleVariants = true
      excludeReason = 'Variant / pack size mismatch — not compared'
    } else if (currency !== baseCurrency) {
      comparable = false
      hasIncompatibleCurrencies = true
      excludeReason = `Currency mismatch (${currency} vs ${baseCurrency}) — not compared`
    } else if (!ov.eligible) {
      if (ov.reason === 'expired') excludeReason = 'Expired quote'
      else if (ov.reason === 'unavailable') excludeReason = 'Out of stock'
      else if (ov.reason === 'review') excludeReason = 'Needs match/scheme verification'
      else if (ov.isDiscountOnly) {
        hasOnlyDiscountOffers = true
        excludeReason = 'Discount % only (no Rs rate)'
      } else excludeReason = 'Missing or invalid rate'
    } else if (!ov.fresh) {
      hasStaleOffers = true
      if (!includeStaleInLowest) {
        comparable = false
        excludeReason = `Outdated (${ov.ageDays}d old)`
      }
    }

    return {
      rec,
      shop,
      shopName,
      recordedPrice: rec.base_price,
      effectiveCost: ov.cents != null ? roundMoney2(ov.cents / 100) : rec.effective_cost,
      discountPct: rec.discount_pct,
      schemeText: rec.scheme_text,
      observedOn: rec.observed_on,
      ageDays: ov.ageDays,
      fresh: ov.fresh,
      currency,
      comparable,
      excludeReason,
      isLowest: false,
    }
  })

  const comparableOffers = evaluated
    .filter((o) => o.comparable && o.effectiveCost != null && o.effectiveCost > 0)
    .sort((a, b) => a.effectiveCost! - b.effectiveCost! || b.observedOn.localeCompare(a.observedOn))

  const winner = comparableOffers[0] ?? null
  let lowestPrice: number | null = null
  let lowestShopId: string | null = null
  let lowestShopName: string | null = null
  let lowestDate: string | null = null
  let lowestIsStale = false

  if (winner && winner.effectiveCost != null) {
    lowestPrice = winner.effectiveCost
    lowestShopId = winner.rec.shop_id
    lowestShopName = winner.shopName
    lowestDate = winner.observedOn
    lowestIsStale = !winner.fresh
    for (const o of evaluated) {
      if (o.comparable && o.effectiveCost === lowestPrice) o.isLowest = true
    }
  }

  evaluated.sort((a, b) => {
    if (a.comparable !== b.comparable) return a.comparable ? -1 : 1
    if (a.comparable && b.comparable && a.effectiveCost !== b.effectiveCost) return a.effectiveCost! - b.effectiveCost!
    return b.observedOn.localeCompare(a.observedOn) || naturalCompare(a.shopName, b.shopName)
  })

  return {
    offers: evaluated,
    lowestPrice,
    lowestShopId,
    lowestShopName,
    lowestDate,
    lowestIsStale,
    targetPrice5Pct: calculateTargetPrice(lowestPrice, DEFAULT_EXTRA_DISCOUNT_PCT),
    hasIncompatibleVariants,
    hasIncompatibleCurrencies,
    hasStaleOffers,
    hasOnlyDiscountOffers,
  }
}

export function toSupplierSnapshots(offers: ComparedSupplierOffer[]): SupplierOfferSnapshot[] {
  return offers.map((o) => ({
    shop_id: o.rec.shop_id,
    shop_name: o.shopName,
    recorded_price: o.recordedPrice,
    effective_cost: o.effectiveCost,
    discount_pct: o.discountPct,
    scheme_text: o.schemeText,
    observed_on: o.observedOn,
    age_days: o.ageDays,
    fresh: o.fresh,
    comparable: o.comparable,
    currency: o.currency,
    status_note: o.excludeReason,
  }))
}

export function calculateLineTotal(
  quantity: number | null | undefined,
  unitPrice: number | null | undefined,
): number | null {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return null
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice < 0) return null
  return roundMoney2(quantity * unitPrice)
}

export interface OrderTotalsSummary {
  totalItems: number
  totalUnits: number
  pricedItems: number
  marketTotal: number
  targetTotal: number
  estimatedExtraSavings: number
}

export function calculateOrderTotals(
  items: { quantity: number; lowest_price: number | null; target_price: number | null }[],
): OrderTotalsSummary {
  let totalUnits = 0
  let pricedItems = 0
  let marketTotal = 0
  let targetTotal = 0

  for (const it of items) {
    const qty = Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 0
    totalUnits += qty
    const lineTarget = calculateLineTotal(qty, it.target_price)
    const lineMarket = calculateLineTotal(qty, it.lowest_price)
    if (lineTarget != null) {
      pricedItems++
      targetTotal += lineTarget
    }
    if (lineMarket != null) {
      marketTotal += lineMarket
    } else if (lineTarget != null) {
      marketTotal += lineTarget
    }
  }

  marketTotal = roundMoney2(marketTotal)
  targetTotal = roundMoney2(targetTotal)
  const estimatedExtraSavings = marketTotal > targetTotal ? roundMoney2(marketTotal - targetTotal) : 0

  return {
    totalItems: items.length,
    totalUnits: Math.round(totalUnits * 100) / 100,
    pricedItems,
    marketTotal,
    targetTotal,
    estimatedExtraSavings,
  }
}

/**
 * Enforce strict company-wise order separation:
 * returns resolved product company if valid, or throws if it belongs to a different manufacturer.
 */
export function assertProductMatchesOrderCompany(
  orderManufacturer: string,
  product: Product,
  records: PriceRecord[],
): string {
  const orderMfr = resolveCanonicalCompany(orderManufacturer) ?? orderManufacturer.trim()
  const prodMfr = resolveProductDisplayCompany(product, records)
  if (!prodMfr) {
    throw new Error(`"${product.name}" has no manufacturer assigned yet. Assign ${orderMfr} to this product before adding it.`)
  }
  if (companyCompareKey(prodMfr) !== companyCompareKey(orderMfr)) {
    throw new Error(`Cannot add "${product.name}" (${prodMfr}) to "${orderMfr}" order. Orders are separated by company.`)
  }
  return orderMfr
}

/** Deduplicated A-Z product catalog for one manufacturer/company, with combined records per product. */
export function buildCompanyProductCatalog(
  manufacturer: string,
  products: Product[],
  currentRecords: PriceRecord[],
): { product: Product; records: PriceRecord[] }[] {
  const recsByProd = new Map<string, PriceRecord[]>()
  for (const r of currentRecords) {
    if (!r.product_id || r.archived) continue
    const arr = recsByProd.get(r.product_id)
    if (arr) arr.push(r)
    else recsByProd.set(r.product_id, [r])
  }

  const targetKey = companyCompareKey(manufacturer)
  if (!targetKey) return []

  const buckets = new Map<string, { primary: Product; records: PriceRecord[] }>()
  for (const p of products) {
    if (p.archived) continue
    const recs = recsByProd.get(p.id) ?? []
    const mfr = resolveProductDisplayCompany(p, recs)
    if (!mfr || companyCompareKey(mfr) !== targetKey) continue

    const dk = companyProductDedupeKey(p)
    const cur = buckets.get(dk)
    if (!cur) {
      buckets.set(dk, { primary: p, records: [...recs] })
    } else {
      const sCur = primaryProductScore(
        cur.primary,
        (recsByProd.get(cur.primary.id) ?? []).length,
        resolveCanonicalCompany(cur.primary.manufacturer) === cur.primary.manufacturer,
      )
      const sNew = primaryProductScore(
        p,
        recs.length,
        resolveCanonicalCompany(p.manufacturer) === p.manufacturer,
      )
      if (sNew > sCur || (sNew === sCur && p.product_no < cur.primary.product_no)) {
        cur.primary = p
      }
      cur.records.push(...recs)
    }
  }

  // Keep latest offer per shop on consolidated product
  return [...buckets.values()]
    .map((entry) => {
      const byShop = new Map<string, PriceRecord>()
      for (const rec of entry.records) {
        const prev = byShop.get(rec.shop_id)
        if (!prev || rec.observed_on > prev.observed_on || (rec.observed_on === prev.observed_on && rec.created_at > prev.created_at)) {
          byShop.set(rec.shop_id, rec)
        }
      }
      return { product: entry.primary, records: [...byShop.values()] }
    })
    .sort((a, b) => naturalCompare(a.product.name, b.product.name))
}

export function generateNextOrderNumber(existing: PurchaseOrder[], dateIso = new Date().toISOString().slice(0, 10)): string {
  const ymd = dateIso.replace(/-/g, '')
  const prefix = `PO-${ymd}-`
  let maxSeq = 0
  for (const o of existing) {
    if (o.order_number.startsWith(prefix)) {
      const n = Number(o.order_number.slice(prefix.length))
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}
