import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, suggestMapping } from './columns'
import { compareOffers } from './compare'
import { buildRows, type BuiltRow } from './importBuild'
import { rankOffers, termsOf } from './offerRank'
import { parseCsvText } from './parseFile'
import type { PriceRecord } from './types'

const TODAY = new Date('2026-10-28T00:00:00')
const OPT = { freshnessDays: 15, excludeStale: false, today: TODAY }

/** Build a stored record the way the import commit does, from a supplier's offer-rate cell. */
function fromImport(shop: string, offerCell: string, over: Partial<PriceRecord> = {}): PriceRecord {
  const g = parseCsvText(`ITEM NAME,OFFER RATE\nMEDICINE A,"${offerCell}"`)
  const row: BuiltRow = buildRows(g, suggestMapping(g[0]), DEFAULT_OPTIONS).rows[0]
  return {
    id: shop, product_id: 'P', shop_id: shop, survey_id: 's', import_job_id: null, observed_on: '2026-10-20',
    original_title: row.title, original_code: null, base_price: row.price, mrp: null, discount_pct: row.discountPct,
    flat_discount: row.flatDiscount, scheme_text: row.schemeText, bonus_buy: row.bonusBuy, bonus_free: row.bonusFree,
    min_order_qty: null, pack_size: null, availability: null, expiry: null, valid_until: null, tax_included: null,
    price_is_net: false, combine_discounts: false, effective_cost: row.cost.effective, scheme_status: row.cost.status,
    calc_notes: null, match_status: 'exact', match_candidates: null, updated_at: '', notes: null, archived: false,
    created_at: '2026-10-20T00:00:00Z',
    source_attrs: {
      brand: null, manufacturer: null, barcode: null, mfr_code: null, strength_value: null, strength_unit: null,
      weight_value: null, weight_unit: null, pack_size: null, dosage_form: null,
      offer_raw: row.offerRaw, base_discount_pct: row.baseDiscountPct, carton_discount_pct: row.cartonDiscountPct,
      carton_rate: row.cartonRate, is_trade_price: row.isTradePrice,
    },
    ...over,
  }
}

const rank = (recs: PriceRecord[]) => rankOffers(compareOffers(recs, undefined, OPT))
const shops = (r: ReturnType<typeof rank>) => r.ordered.filter((o) => o.rank != null).map((o) => o.view.rec.shop_id)

describe('offer-rate ranking (no purchase prices)', () => {
  it('ranks a discount-only list without inventing any Rs value', () => {
    const r = rank([fromImport('A', '15%'), fromImport('B', '12%'), fromImport('C', '10%')])
    expect(r.method).toBe('offer')
    expect(r.badge).toBe('BEST OFFER')
    expect(r.winners.map((w) => w.view.rec.shop_id)).toEqual(['A'])
    expect(shops(r)).toEqual(['A', 'B', 'C'])
    expect(r.ordered.map((o) => o.rank)).toEqual([1, 2, 3])
    for (const o of r.ordered) {
      expect(o.view.cents).toBeNull()
      expect(o.view.rec.effective_cost).toBeNull()
    }
  })

  it('order does not depend on input order', () => {
    const recs = [fromImport('C', '10%'), fromImport('A', '15%'), fromImport('B', '12%')]
    expect(shops(rank(recs))).toEqual(shops(rank([...recs].reverse())))
    expect(shops(rank(recs))).toEqual(['A', 'B', 'C'])
  })

  it('equal discounts are a TIED OFFER', () => {
    const r = rank([fromImport('A', '15%'), fromImport('B', '15%'), fromImport('C', '10%')])
    expect(r.badge).toBe('TIED OFFER')
    expect(r.winners.map((w) => w.view.rec.shop_id).sort()).toEqual(['A', 'B'])
  })

  it('TP and missing discounts are never numeric and never counted as 0%', () => {
    const r = rank([fromImport('A', 'TP'), fromImport('B', '10%'), fromImport('C', '1TP')])
    expect(termsOf(r.ordered.find((o) => o.view.rec.shop_id === 'A')!.view.rec).kind).toBe('tp')
    expect(termsOf(r.ordered.find((o) => o.view.rec.shop_id === 'A')!.view.rec).pct).toBeNull()
    expect(r.badge).toBe('SINGLE OFFER') // only one numeric offer: no winner is claimed
    expect(r.winners).toHaveLength(0)
    expect(r.ordered[0].view.rec.shop_id).toBe('B')

    const onlyTp = rank([fromImport('A', 'TP'), fromImport('B', 'TP')])
    expect(onlyTp.badge).toBe('INCOMPLETE')
    expect(onlyTp.leadPct).toBeNull()

    const missing = rank([fromImport('A', '12%', { discount_pct: null, scheme_text: null, source_attrs: null })])
    expect(termsOf(missing.ordered[0].view.rec).kind).toBe('missing')
    expect(missing.badge).toBe('INCOMPLETE')
  })

  it('a carton scheme on the better offer does not block the ranking', () => {
    const r = rank([fromImport('A', '15% COTON 8%'), fromImport('B', '12%')])
    expect(termsOf(r.ordered[0].view.rec)).toMatchObject({ kind: 'percent', pct: 15, cartonPct: 8 })
    expect(r.badge).toBe('BEST OFFER')
    expect(r.winners[0].view.rec.shop_id).toBe('A')
  })

  it('conflicting scheme conditions give NEEDS REVIEW instead of a winner', () => {
    // A has the higher plain discount but no carton scheme, B has a carton scheme: unclear which is better.
    const r = rank([fromImport('A', '15%'), fromImport('B', '12% COTON 10%')])
    expect(r.badge).toBe('NEEDS REVIEW')
    expect(r.winners).toHaveLength(0)
    expect(r.warning).toMatch(/check manually/)
    expect(r.ordered.every((o) => !o.winner)).toBe(true)
  })

  it('bonus, flat and carton-only offers cannot be compared with percentages', () => {
    const bonus = rank([fromImport('A', '10%'), fromImport('B', '12%'), fromImport('C', '10+1')])
    expect(bonus.badge).toBe('NEEDS REVIEW')
    expect(bonus.winners).toHaveLength(0)
    const cartonOnly = rank([fromImport('A', '10%'), fromImport('B', '12%'), fromImport('C', 'COTON 20%')])
    expect(cartonOnly.badge).toBe('NEEDS REVIEW')
  })

  it('does not double count: a plain discount is not duplicated by a carton percentage', () => {
    const t = termsOf(fromImport('A', 'COTON 8%'))
    expect(t.kind).toBe('conditional')
    expect(t.pct).toBeNull()
    expect(termsOf(fromImport('B', '15% COTON 8%')).pct).toBe(15)
  })

  it('keeps the offer exactly as imported next to the normalized terms', () => {
    const rec = fromImport('A', '15% COTON 8%')
    expect(rec.source_attrs!.offer_raw).toBe('15% COTON 8%')
    expect(rec.scheme_text).toBe('15% discount · Full box (carton) 8%')
    const t = termsOf(rec)
    expect(t.original).toBe('15% COTON 8%')
    expect(t.label).toBe('15% · carton 8%')
  })

  it('older records without structured terms are still interpreted safely', () => {
    const legacy = (text: string, pct: number | null) =>
      termsOf({ ...fromImport('A', '5%'), source_attrs: null, scheme_text: text, discount_pct: pct })
    expect(legacy('15% discount · Full box (carton) 8%', 15)).toMatchObject({ kind: 'percent', pct: 15, cartonPct: 8 })
    expect(legacy('Full box (carton) 8% discount', 8).kind).toBe('conditional')
    expect(legacy('TP (0% discount)', 0).kind).toBe('tp')
  })

  it('offers that are expired, unavailable or unverified are not ranked', () => {
    const r = rank([
      fromImport('A', '20%', { availability: 'Out of stock' }),
      fromImport('B', '18%', { match_status: 'needs_review' }),
      fromImport('C', '12%'),
      fromImport('D', '10%'),
    ])
    expect(shops(r)).toEqual(['C', 'D'])
    expect(r.winners[0].view.rec.shop_id).toBe('C')
  })
})

describe('actual purchase prices take priority', () => {
  const priced = (shop: string, cost: number, over: Partial<PriceRecord> = {}) =>
    fromImport(shop, String(cost), { effective_cost: cost, base_price: cost, ...over })

  it('lowest effective cost wins over the highest discount, and the badge says BEST PRICE', () => {
    const r = rank([
      priced('Cheap', 90, { discount_pct: 5, scheme_text: '5% discount' }),
      priced('Pricey', 100, { discount_pct: 30, scheme_text: '30% discount' }),
      fromImport('DiscOnly', '40%'),
    ])
    expect(r.method).toBe('price')
    expect(r.badge).toBe('BEST PRICE')
    expect(r.winners[0].view.rec.shop_id).toBe('Cheap')
    expect(r.ordered[2].view.rec.shop_id).toBe('DiscOnly')
    expect(r.ordered[2].rank).toBeNull()
    expect(r.warning).toMatch(/no purchase price/)
  })

  it('never labels an offer-rate winner as BEST PRICE', () => {
    const r = rank([fromImport('A', '15%'), fromImport('B', '12%')])
    expect(r.badge).not.toBe('BEST PRICE')
    expect(r.method).toBe('offer')
  })
})
