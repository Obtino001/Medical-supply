// Best-price comparison, freshness, savings and opportunity detection. Pure functions.
import { isUnavailable } from './importBuild'
import { money } from './scheme'
import type { PriceRecord, Product, RecordLite } from './types'

export type Reason = 'review' | 'invalid' | 'unavailable' | 'stale' | 'expired' | 'archived'

export interface OfferView {
  rec: PriceRecord
  ageDays: number
  fresh: boolean
  eligible: boolean
  reason: Reason | null
  /** True when the supplier provided a valid discount/scheme text, but no base rate in Rs to calculate effective cost */
  isDiscountOnly: boolean
  /** Usable for offer-rate ranking: passes every check except having a purchase price (match, scheme, stock, expiry, freshness) */
  offerEligible: boolean
  cents: number | null // effective cost in paisa, rounded to 2 decimals
  isBest: boolean
  isTied: boolean
  /** Rs above the best eligible offer (0 for the best) */
  aboveBest: number | null
  perUnit: { label: string; value: number } | null
}

export interface CompareOptions {
  freshnessDays: number
  excludeStale: boolean
  today?: Date
}

export interface CompareResult {
  offers: OfferView[]
  eligibleCount: number
  bestCents: number | null
  tied: boolean
  /** saving of best vs the next different offer */
  nextBest: { cents: number; saving: number; savingPct: number; shopId: string } | null
  hasIncompleteOffers: boolean
  hasExpiredOffers: boolean
  hasStaleOffers: boolean
}

export function ageInDays(observedOn: string, today = new Date()): number {
  const d = new Date(observedOn + 'T00:00:00')
  return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000))
}

export function toCents(x: number | null | undefined): number | null {
  if (x == null || !Number.isFinite(x) || x <= 0) return null
  return Math.round(money(x) * 100)
}

export function perUnitMetric(rec: PriceRecord, product: Product | undefined): { label: string; value: number } | null {
  if (rec.effective_cost == null || rec.effective_cost <= 0 || !product) return null
  if (product.weight_value && product.weight_unit) {
    return { label: `per ${product.weight_unit}`, value: rec.effective_cost / product.weight_value }
  }
  return null
}

/** Check whether an offer's known validity or expiry date has passed. */
export function isOfferExpired(rec: PriceRecord, today: Date): boolean {
  if (rec.valid_until) {
    const vu = new Date(rec.valid_until.length === 10 ? rec.valid_until + 'T23:59:59' : rec.valid_until)
    if (!Number.isNaN(vu.getTime()) && vu < today) return true
  }
  if (rec.expiry) {
    const exp = rec.expiry.trim()
    if (/^expired$/i.test(exp)) return true
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
      const ed = new Date(exp + 'T23:59:59')
      if (!Number.isNaN(ed.getTime()) && ed < today) return true
    } else if (/^\d{4}-\d{2}$/.test(exp)) {
      const [y, m] = exp.split('-').map(Number)
      const lastDay = new Date(y, m, 0, 23, 59, 59)
      if (!Number.isNaN(lastDay.getTime()) && lastDay < today) return true
    }
  }
  return false
}

/** Prevent comparing offers whose explicit strength, weight, or pack size conflicts with the canonical product. */
export function hasAttributeConflict(rec: PriceRecord, product: Product | undefined): boolean {
  if (!product) return false
  if (rec.pack_size != null && product.pack_size != null && rec.pack_size !== product.pack_size) return true
  const sa = rec.source_attrs
  if (sa) {
    if (sa.pack_size != null && product.pack_size != null && sa.pack_size !== product.pack_size) return true
    if (
      sa.strength_value != null &&
      product.strength_value != null &&
      (sa.strength_value !== product.strength_value ||
        (sa.strength_unit && product.strength_unit && sa.strength_unit.toLowerCase() !== product.strength_unit.toLowerCase()))
    ) {
      return true
    }
    if (
      sa.weight_value != null &&
      product.weight_value != null &&
      (sa.weight_value !== product.weight_value ||
        (sa.weight_unit && product.weight_unit && sa.weight_unit.toLowerCase() !== product.weight_unit.toLowerCase()))
    ) {
      return true
    }
  }
  return false
}

const UNVERIFIED_MATCH = new Set(['needs_review', 'unmatched', 'conflicting'])

export function compareOffers(records: PriceRecord[], product: Product | undefined, opt: CompareOptions): CompareResult {
  const today = opt.today ?? new Date()
  let hasIncompleteOffers = false
  let hasExpiredOffers = false
  let hasStaleOffers = false

  const offers: OfferView[] = records.map((rec) => {
    const ageDays = ageInDays(rec.observed_on, today)
    const fresh = ageDays <= opt.freshnessDays
    if (!fresh && !rec.archived) hasStaleOffers = true

    const isDiscountOnly =
      !rec.archived &&
      rec.scheme_status === 'ok' &&
      (rec.effective_cost == null || rec.effective_cost <= 0) &&
      Boolean(rec.scheme_text || rec.discount_pct != null)

    const validCents = toCents(rec.effective_cost)
    const expired = isOfferExpired(rec, today)
    if (expired && !rec.archived) hasExpiredOffers = true

    let reason: Reason | null = null
    if (rec.archived) reason = 'archived'
    else if (UNVERIFIED_MATCH.has(rec.match_status) || hasAttributeConflict(rec, product)) reason = 'review'
    else if (rec.scheme_status === 'review') reason = 'review'
    else if (rec.scheme_status !== 'ok' || validCents == null || (rec.base_price != null && rec.base_price <= 0)) reason = 'invalid'
    else if (isUnavailable(rec.availability)) reason = 'unavailable'
    else if (expired) reason = 'expired'
    else if (opt.excludeStale && !fresh) reason = 'stale'

    if (isDiscountOnly || reason === 'review') hasIncompleteOffers = true

    let offerEligible = false
    if (!rec.archived && rec.scheme_status === 'ok' && !UNVERIFIED_MATCH.has(rec.match_status) && !hasAttributeConflict(rec, product)) {
      offerEligible = !(isUnavailable(rec.availability) || expired || (opt.excludeStale && !fresh))
    }

    return {
      rec,
      ageDays,
      fresh,
      eligible: reason === null,
      reason,
      isDiscountOnly,
      offerEligible,
      cents: reason === 'review' || reason === 'invalid' ? null : validCents,
      isBest: false,
      isTied: false,
      aboveBest: null,
      perUnit: perUnitMetric(rec, product),
    }
  })

  const eligible = offers.filter((o) => o.eligible && o.cents != null)
  let bestCents: number | null = null
  let tied = false
  let nextBest: CompareResult['nextBest'] = null
  if (eligible.length > 0) {
    bestCents = Math.min(...eligible.map((o) => o.cents!))
    const winners = eligible.filter((o) => o.cents === bestCents)
    tied = winners.length > 1
    // "best" badge in multi-offer comparison is set when at least two comparable offers exist
    if (eligible.length >= 2) winners.forEach((o) => { o.isBest = true; o.isTied = tied })
    for (const o of eligible) o.aboveBest = (o.cents! - bestCents) / 100
    const higher = eligible.filter((o) => o.cents! > bestCents!).sort((a, b) => a.cents! - b.cents!)
    if (higher[0]) {
      const saving = (higher[0].cents! - bestCents) / 100
      nextBest = { cents: higher[0].cents!, saving, savingPct: (saving / (higher[0].cents! / 100)) * 100, shopId: higher[0].rec.shop_id }
    }
  }
  offers.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    if (a.cents != null && b.cents != null && a.cents !== b.cents) return a.cents - b.cents
    if (a.cents != null && b.cents == null) return -1
    if (a.cents == null && b.cents != null) return 1
    if (a.isDiscountOnly !== b.isDiscountOnly) return a.isDiscountOnly ? -1 : 1
    return b.rec.observed_on.localeCompare(a.rec.observed_on) || a.rec.shop_id.localeCompare(b.rec.shop_id)
  })
  return { offers, eligibleCount: eligible.length, bestCents, tied, nextBest, hasIncompleteOffers, hasExpiredOffers, hasStaleOffers }
}

/** Latest record per (product, shop). Archived and unmatched records are excluded. */
export function latestPerProductShop(records: PriceRecord[]): PriceRecord[] {
  const map = new Map<string, PriceRecord>()
  for (const r of records) {
    if (r.archived || !r.product_id) continue
    const k = r.product_id + '|' + r.shop_id
    const cur = map.get(k)
    if (!cur || r.observed_on > cur.observed_on || (r.observed_on === cur.observed_on && r.created_at > cur.created_at)) map.set(k, r)
  }
  return [...map.values()]
}

export type OpportunityReason = 'multiple' | 'new_low' | 'price_drop' | 'scheme'

export interface Opportunity {
  product: Product
  best: OfferView
  next: OfferView | null
  saving: number
  savingPct: number
  tied: boolean
  reasons: OpportunityReason[]
  priorLow: number | null
  dropPct: number | null
  verified: boolean
  confidence: string
}

export function findOpportunities(
  products: Product[],
  current: PriceRecord[],
  history: RecordLite[],
  opt: CompareOptions,
): Opportunity[] {
  const byProduct = new Map<string, PriceRecord[]>()
  for (const r of current) {
    const a = byProduct.get(r.product_id!)
    if (a) a.push(r)
    else byProduct.set(r.product_id!, [r])
  }
  const histBy = new Map<string, RecordLite[]>()
  for (const h of history) {
    if (!h.product_id || h.scheme_status !== 'ok' || h.effective_cost == null) continue
    const a = histBy.get(h.product_id)
    if (a) a.push(h)
    else histBy.set(h.product_id, [h])
  }
  const out: Opportunity[] = []
  for (const p of products) {
    if (p.archived) continue
    const recs = byProduct.get(p.id)
    if (!recs || recs.length < 2) continue
    const cmp = compareOffers(recs, p, opt)
    if (cmp.eligibleCount < 2) continue
    const elig = cmp.offers.filter((o) => o.eligible)
    const best = elig[0]
    const next = elig.find((o) => o.cents! > best.cents!) ?? elig[1] ?? null
    const saving = next ? (next.cents! - best.cents!) / 100 : 0
    const savingPct = next && next.cents! > 0 ? (saving / (next.cents! / 100)) * 100 : 0
    const reasons: OpportunityReason[] = ['multiple']
    let priorLow: number | null = null
    let dropPct: number | null = null
    const hs = histBy.get(p.id) ?? []
    const older = hs.filter((h) => h.observed_on < best.rec.observed_on)
    if (older.length) {
      priorLow = Math.min(...older.map((h) => h.effective_cost!))
      if (toCents(best.rec.effective_cost)! < toCents(priorLow)!) reasons.push('new_low')
    }
    const prevSameShop = hs
      .filter((h) => h.shop_id === best.rec.shop_id && h.observed_on < best.rec.observed_on)
      .sort((a, b) => b.observed_on.localeCompare(a.observed_on))[0]
    if (prevSameShop?.effective_cost) {
      const change = ((prevSameShop.effective_cost - best.rec.effective_cost!) / prevSameShop.effective_cost) * 100
      if (change >= 5) { dropPct = change; reasons.push('price_drop') }
    }
    if (best.rec.bonus_buy && best.rec.bonus_free) reasons.push('scheme')
    const okMatch = (s: string) => s === 'exact' || s === 'high' || s === 'manual'
    const verified = okMatch(best.rec.match_status) && (!next || okMatch(next.rec.match_status))
    out.push({
      product: p, best, next, saving, savingPct, tied: cmp.tied, reasons, priorLow, dropPct, verified,
      confidence: verified ? (best.rec.match_status === 'high' ? 'High (auto-matched)' : 'Verified') : 'Needs review',
    })
  }
  return out
}
