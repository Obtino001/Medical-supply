// Offer-rate ranking for supplier lists that carry discounts/schemes instead of purchase prices. Pure functions.
//
// Two ranking methods are kept strictly apart:
//  - 'price': >= 2 offers have a validated effective purchase cost -> lowest cost wins (BEST PRICE).
//  - 'offer': otherwise offers are ranked by their comparable discount terms (BEST OFFER). No Rs value is ever derived.
import type { CompareResult, OfferView } from './compare'
import type { PriceRecord } from './types'

export type TermsKind =
  | 'percent' // plain % discount, optionally with a carton % and a minimum order qty: numerically comparable
  | 'tp' // trade price, i.e. no discount offered: not a numeric discount
  | 'conditional' // bonus / flat Rs / carton-only / carton rate / TP + scheme: real offer we cannot quantify reliably
  | 'unrecognized' // scheme could not be interpreted or failed validation
  | 'missing' // nothing usable was supplied

export interface OfferTerms {
  kind: TermsKind
  /** Plain percentage discount; set only when kind === 'percent' */
  pct: number | null
  /** Full-carton percentage scheme; set only when kind === 'percent' */
  cartonPct: number | null
  minQty: number | null
  /** Offer exactly as imported (falls back to the stored scheme text for older imports) */
  original: string | null
  /** Short normalized label for display, e.g. "15% · carton 8%" */
  label: string
  /** Why the offer cannot be compared numerically */
  note: string | null
}

export type RankBadge = 'BEST PRICE' | 'BEST PRICE (TIED)' | 'BEST OFFER' | 'TIED OFFER' | 'NEEDS REVIEW' | 'INCOMPLETE' | 'SINGLE OFFER'

export interface RankedOffer {
  view: OfferView
  terms: OfferTerms
  /** 1-based position within the ranked group; null for offers that are not ranked */
  rank: number | null
  winner: boolean
}

export interface OfferRanking {
  method: 'price' | 'offer' | 'none'
  badge: RankBadge
  /** Winning offers (more than one when tied); empty when no verified winner exists */
  winners: RankedOffer[]
  /** The offer to show on the compact row: the winner, or the leading candidate when there is no verified winner */
  lead: RankedOffer | null
  ordered: RankedOffer[]
  /** Explains NEEDS REVIEW / INCOMPLETE, or notes offers left out of the ranking */
  warning: string | null
  /** Best comparable discount among offers (null when none is numeric) */
  leadPct: number | null
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const fmtPct = (x: number) => `${Math.round(x * 100) / 100}%`

/** Interpret a stored price record. Prefers the structured terms captured at import, with a fallback for older imports. */
export function termsOf(rec: PriceRecord): OfferTerms {
  const sa = rec.source_attrs
  const text = rec.scheme_text ?? null
  const original = sa?.offer_raw ?? text
  const base = { pct: null, cartonPct: null, minQty: rec.min_order_qty ?? null, original }
  const no = (kind: TermsKind, label: string, note: string | null): OfferTerms => ({ ...base, kind, label, note })

  if (rec.scheme_status !== 'ok') return no('unrecognized', original ?? 'Unrecognized', 'Offer text could not be interpreted reliably')

  const isTp = sa?.is_trade_price ?? (text != null && /(^|[^a-z])(?:[1il!|]?t\.?p\.?|trade\s*price)(?![a-z])/i.test(text))
  let carton = sa?.carton_discount_pct
  if (carton === undefined) {
    const m = text ? new RegExp(String.raw`(?:carton|coton|box)[^0-9|]*${NUM}\s*%`, 'i').exec(text) : null
    carton = m ? parseFloat(m[1].replace(',', '.')) : null
  }
  const hasCartonWords = text != null && /carton|coton|box/i.test(text)
  // Newer imports record the plain (non-carton) discount explicitly. Older ones only have discount_pct, which for a
  // carton-only offer ("COTON 8%") simply echoes the carton percentage and must not count as a plain discount.
  let pct: number | null
  if (sa && 'base_discount_pct' in sa) pct = sa.base_discount_pct ?? null
  else pct = rec.discount_pct != null && !(hasCartonWords && carton != null && rec.discount_pct === carton) ? rec.discount_pct : null

  const hasBonus = rec.bonus_buy != null || rec.bonus_free != null
  const hasFlat = rec.flat_discount != null && rec.flat_discount > 0
  const cartonRate = sa?.carton_rate != null || (carton == null && hasCartonWords && pct == null && !isTp)

  if (hasBonus || hasFlat || cartonRate) {
    const what = hasBonus ? `bonus ${rec.bonus_buy}+${rec.bonus_free}` : hasFlat ? `Rs ${rec.flat_discount} off` : 'carton rate'
    return no('conditional', original ?? what, `Includes ${what}: cannot be compared with percentage discounts`)
  }
  if (isTp && (pct == null || pct === 0)) {
    if (carton != null) return no('conditional', original ?? `TP · carton ${fmtPct(carton)}`, 'TP with a carton-only scheme: cannot be compared with percentage discounts')
    return no('tp', 'TP', 'TP (trade price): no discount offered')
  }
  if (pct == null) {
    if (carton != null) return no('conditional', original ?? `Carton ${fmtPct(carton)}`, 'Discount applies to full cartons only')
    return no(rec.discount_pct == null && !text ? 'missing' : 'unrecognized', original ?? 'No offer', rec.discount_pct == null && !text ? 'No discount supplied' : 'Offer format not recognized')
  }
  if (pct < 0 || pct >= 100) return no('unrecognized', original ?? fmtPct(pct), `Invalid discount ${pct}%`)

  const parts = [fmtPct(pct)]
  if (carton != null) parts.push(`carton ${fmtPct(carton)}`)
  if (base.minQty != null) parts.push(`min qty ${base.minQty}`)
  return { ...base, kind: 'percent', pct, cartonPct: carton ?? null, label: parts.join(' · '), note: null }
}

/** Whether a is at least as good as b on every term (null carton = not offered; lower min qty is better). */
function atLeastAsGood(a: OfferTerms, b: OfferTerms): boolean {
  return (
    a.pct! >= b.pct! &&
    (a.cartonPct ?? -1) >= (b.cartonPct ?? -1) &&
    (a.minQty ?? 0) <= (b.minQty ?? 0)
  )
}
const sameTerms = (a: OfferTerms, b: OfferTerms) => atLeastAsGood(a, b) && atLeastAsGood(b, a)

const KIND_ORDER: Record<TermsKind, number> = { percent: 0, conditional: 1, tp: 2, unrecognized: 3, missing: 4 }

export function rankOffers(cmp: CompareResult): OfferRanking {
  const all: RankedOffer[] = cmp.offers.map((view) => ({ view, terms: termsOf(view.rec), rank: null, winner: false }))
  const live = all.filter((o) => !o.view.rec.archived)

  // ---- Method 1: actual purchase prices (>= 2 validated effective costs)
  if (cmp.eligibleCount >= 2) {
    const elig = all.filter((o) => o.view.eligible)
    const winners = elig.filter((o) => o.view.isBest)
    elig.forEach((o, i) => { o.rank = i + 1; o.winner = o.view.isBest })
    const rest = all.filter((o) => !o.view.eligible)
    return {
      method: 'price',
      badge: cmp.tied ? 'BEST PRICE (TIED)' : 'BEST PRICE',
      winners,
      lead: winners[0] ?? elig[0] ?? null,
      ordered: [...elig, ...rest],
      warning: rest.some((o) => o.view.offerEligible && !o.view.eligible)
        ? 'Some offers have no purchase price and are not part of the price ranking.'
        : null,
      leadPct: maxPct(live),
    }
  }

  // ---- Method 2: offer-rate ranking
  const pool = live.filter((o) => o.view.offerEligible)
  const percent = pool.filter((o) => o.terms.kind === 'percent')
  const conditional = pool.filter((o) => o.terms.kind === 'conditional')
  const others = all.filter((o) => !percent.includes(o) && !conditional.includes(o))
  const sortPercent = (a: RankedOffer, b: RankedOffer) =>
    b.terms.pct! - a.terms.pct! ||
    (b.terms.cartonPct ?? -1) - (a.terms.cartonPct ?? -1) ||
    (a.terms.minQty ?? 0) - (b.terms.minQty ?? 0) ||
    b.view.rec.observed_on.localeCompare(a.view.rec.observed_on) ||
    a.view.rec.shop_id.localeCompare(b.view.rec.shop_id)
  percent.sort(sortPercent)
  conditional.sort((a, b) => b.view.rec.observed_on.localeCompare(a.view.rec.observed_on) || a.view.rec.shop_id.localeCompare(b.view.rec.shop_id))
  others.sort(
    (a, b) =>
      Number(b.view.offerEligible) - Number(a.view.offerEligible) ||
      KIND_ORDER[a.terms.kind] - KIND_ORDER[b.terms.kind] ||
      b.view.rec.observed_on.localeCompare(a.view.rec.observed_on) ||
      a.view.rec.shop_id.localeCompare(b.view.rec.shop_id),
  )
  const ordered = [...percent, ...conditional, ...others]
  const leadPct = percent[0]?.terms.pct ?? null
  const skipped = others.filter((o) => o.view.offerEligible).length
  const skippedNote = skipped ? `${skipped} offer${skipped === 1 ? '' : 's'} (TP, missing or unrecognized) not ranked.` : null

  const result = (badge: RankBadge, winners: RankedOffer[], lead: RankedOffer | null, warning: string | null): OfferRanking => {
    winners.forEach((w) => { w.winner = true })
    return { method: percent.length || conditional.length ? 'offer' : 'none', badge, winners, lead, ordered, warning, leadPct }
  }

  if (percent.length === 0) {
    const lead = conditional[0] ?? others.find((o) => o.view.offerEligible) ?? null
    return result('INCOMPLETE', [], lead, conditional.length
      ? 'Only scheme offers that cannot be compared numerically were found.'
      : 'No comparable discount: offers are TP, missing or unrecognized.')
  }

  // Maximal percent offers: not strictly beaten by any other percent offer.
  const maximal = percent.filter((a) => !percent.some((b) => b !== a && atLeastAsGood(b.terms, a.terms) && !sameTerms(b.terms, a.terms)))
  const allSame = maximal.every((m) => sameTerms(m.terms, maximal[0].terms))

  if (conditional.length > 0) {
    return result('NEEDS REVIEW', [], percent[0], `${conditional.length} offer${conditional.length === 1 ? ' has' : 's have'} a bonus, flat or carton-only scheme that cannot be compared with the percentage offers: check manually.`)
  }
  if (maximal.length > 1 && !allSame) {
    return result('NEEDS REVIEW', [], percent[0], 'Offers differ in carton or order-quantity conditions, so a higher discount is not necessarily better: check manually.')
  }
  if (percent.length === 1) {
    percent[0].rank = 1
    return result('SINGLE OFFER', [], percent[0], skippedNote)
  }

  // Dense ranking over distinct terms so tied offers share a rank.
  let rank = 0
  percent.forEach((o, i) => {
    if (i === 0 || !sameTerms(o.terms, percent[i - 1].terms)) rank = i + 1
    o.rank = rank
  })
  const winners = percent.filter((o) => o.rank === 1)
  return result(winners.length > 1 ? 'TIED OFFER' : 'BEST OFFER', winners, winners[0], skippedNote)
}

function maxPct(list: RankedOffer[]): number | null {
  let m: number | null = null
  for (const o of list) if (o.terms.kind === 'percent' && o.view.offerEligible && (m == null || o.terms.pct! > m)) m = o.terms.pct
  return m
}
