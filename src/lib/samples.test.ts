import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, suggestMapping } from './columns'
import { compareOffers } from './compare'
import { buildRows } from './importBuild'
import { buildCommitPayload, runMatching } from './importPlan'
import { buildIndex, type CatalogProduct } from './matching'
import { parseCsvText } from './parseFile'
import type { PriceRecord } from './types'

const load = (f: string) => parseCsvText(readFileSync(`docs/samples/${f}`, 'utf8'))

describe('two-shop sample flow (docs/samples)', () => {
  it('imports shop A, then shop B links equal variants and keeps 50g/200g separate', () => {
    const gridA = load('test-shop-a.csv')
    const a = buildRows(gridA, suggestMapping(gridA[0]), DEFAULT_OPTIONS)
    expect(a.stats.invalid).toBe(1)
    expect(a.stats.duplicate).toBe(1)
    const mA = runMatching(a.rows, buildIndex([], [], []), 'A')
    const pa = buildCommitPayload(a.rows, mA, [])
    // Panadol has no size and nothing to compare yet -> still a new product, 6 distinct products
    expect(pa.newProducts).toHaveLength(5)

    const catalog: CatalogProduct[] = pa.newProducts.map((n, i) => ({
      id: 'p' + i, name: n.name as string, normalized_name: n.normalized_name as string, brand: null,
      manufacturer: n.manufacturer as string | null, strength_value: n.strength_value as number | null, strength_unit: n.strength_unit as string | null,
      weight_value: n.weight_value as number | null, weight_unit: n.weight_unit as string | null, pack_size: n.pack_size as number | null,
      dosage_form: n.dosage_form as string | null, barcode: null, mfr_code: null,
    }))
    const gridB = load('test-shop-b.csv')
    const b = buildRows(gridB, suggestMapping(gridB[0]), DEFAULT_OPTIONS)
    expect(b.stats.invalid).toBe(0)
    const mB = runMatching(b.rows, buildIndex(catalog, [], []), 'B')
    const get = (code: string) => mB.get(b.rows.find((r) => r.code === code)!.rowNumber)!
    // "ZINCOL CREAM 100 GM" -> shop A's "Zincol Cream 100g" (manufacturer unknown on B's side: not a conflict)
    expect(get('B1').match.confidence).toBe('high')
    expect(catalog.find((c) => c.id === get('B1').match.productId)!.name).toBe('Zincol Cream 100g')
    // 200g has no equivalent -> new product, never merged into 100g/50g
    expect(get('B2').match.confidence).toBe('unmatched')
    // 120 ml cough syrup matches
    expect(get('B3').match.confidence).toBe('high')
    // 500mg aspirin vs A's 100mg -> different strength, separate product
    expect(get('B4').match.confidence).toBe('unmatched')
  })

  it('effective costs: Rs.5 flat discount vs 2% percent', () => {
    const gridA = load('test-shop-a.csv'); const gridB = load('test-shop-b.csv')
    const a = buildRows(gridA, suggestMapping(gridA[0]), DEFAULT_OPTIONS).rows.find((r) => r.code === 'A100')!
    const b = buildRows(gridB, suggestMapping(gridB[0]), DEFAULT_OPTIONS).rows.find((r) => r.code === 'B1')!
    expect(a.cost.effective).toBeCloseTo(411.6, 6)
    expect(b.cost.effective).toBeCloseTo(410, 6)
    const mk = (shop: string, e: number): PriceRecord => ({ id: shop, product_id: 'P', shop_id: shop, survey_id: 's', import_job_id: null, observed_on: new Date().toISOString().slice(0, 10), original_title: 'x', original_code: null, base_price: e, mrp: null, discount_pct: null, flat_discount: null, scheme_text: null, bonus_buy: null, bonus_free: null, min_order_qty: null, pack_size: null, availability: null, expiry: null, valid_until: null, tax_included: null, price_is_net: false, combine_discounts: false, effective_cost: e, scheme_status: 'ok', calc_notes: null, match_status: 'exact', match_candidates: null, source_attrs: null, updated_at: '', notes: null, archived: false, created_at: '' })
    const r = compareOffers([mk('A', a.cost.effective!), mk('B', b.cost.effective!)], undefined, { freshnessDays: 15, excludeStale: false })
    expect(r.offers[0].rec.shop_id).toBe('B'); expect(r.offers[0].isBest).toBe(true)
  })

  it('10+1 scheme is computed as paid/received', () => {
    const g = load('test-shop-a.csv')
    const row = buildRows(g, suggestMapping(g[0]), DEFAULT_OPTIONS).rows.find((r) => r.code === 'A103')!
    expect(row.cost.effective).toBeCloseTo((180 * 10) / 11, 6)
  })
})
