import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { suggestMapping, DEFAULT_OPTIONS } from './columns'
import { compareOffers, findOpportunities, latestPerProductShop } from './compare'
import { buildExportRows, GENERIC_PROFILE, sanitizeCell, toCsv, toMatrix, toXlsxBuffer, type ExportContext } from './exporter'
import { buildRows, detectHeaderRow, detectSideBySide } from './importBuild'
import { buildCommitPayload, runMatching } from './importPlan'
import { buildIndex, matchProduct, type CatalogProduct, type IncomingProduct } from './matching'
import { parseCsvText, parseWorkbook, validateFile } from './parseFile'
import { identityKey, naturalCompare, parseTitle, sourceKey } from './productParse'
import { calculateEffectiveCost, parseNumber, parseSchemeText } from './scheme'
import { buildProductRows, groupRows, sortRows } from './tableModel'
import type { PriceRecord, Product, Shop } from './types'

// ---------- helpers
let seq = 0
function catalogProduct(title: string, extra: Partial<CatalogProduct> = {}): CatalogProduct {
  const p = parseTitle(title)
  return {
    id: 'p' + ++seq, name: title, normalized_name: p.name, brand: null, manufacturer: null,
    strength_value: p.strengthValue, strength_unit: p.strengthUnit, weight_value: p.weightValue, weight_unit: p.weightUnit,
    pack_size: p.packSize, dosage_form: p.dosageForm, barcode: null, mfr_code: null, ...extra,
  }
}
function incoming(title: string, extra: Partial<IncomingProduct> = {}): IncomingProduct {
  const p = parseTitle(title)
  return {
    title, normalizedName: p.name, supplierCode: null, barcode: null, mfrCode: null, brand: null, manufacturer: null,
    strengthValue: p.strengthValue, strengthUnit: p.strengthUnit, weightValue: p.weightValue, weightUnit: p.weightUnit,
    packSize: p.packSize, dosageForm: p.dosageForm, sourceKey: sourceKey(null, title), ...extra,
  }
}
const SHOP = 'shopA'

// ---------- parsing / normalization
describe('title parsing', () => {
  it('treats 100g, 100 GM and 100 Gram as the same weight', () => {
    const a = parseTitle('Product XYZ 100g'), b = parseTitle('Product XYZ 100 GM'), c = parseTitle('product  xyz 100 Gram')
    for (const x of [a, b, c]) expect([x.name, x.weightValue, x.weightUnit]).toEqual(['product xyz', 100, 'g'])
  })
  it('does not equate mg, g and ml', () => {
    expect(parseTitle('Foo 100mg').strengthUnit).toBe('mg')
    expect(parseTitle('Foo 100mg').weightValue).toBeNull()
    expect(parseTitle('Foo 100ml').weightUnit).toBe('ml')
    expect(parseTitle('Foo 100g').weightUnit).toBe('g')
  })
  it('converts kg to g and keeps 50g / 100g different', () => {
    expect(parseTitle('Foo 1kg').weightValue).toBe(1000)
    expect(parseTitle('Foo 50g').weightValue).not.toBe(parseTitle('Foo 100g').weightValue)
  })
  it('extracts pack sizes', () => {
    expect(parseTitle('Foo 100g Pack of 12').packSize).toBe(12)
    expect(parseTitle('Foo Tab 500mg 10x10').packSize).toBe(100)
    expect(parseTitle("Foo 20's").packSize).toBe(20)
    expect(parseTitle('Foo 500mg tablets').dosageForm).toBe('tablet')
  })
  it('sorts sizes numerically', () => {
    expect(['100g', '200g', '25g', '50g'].sort(naturalCompare)).toEqual(['25g', '50g', '100g', '200g'])
  })
})

// ---------- schemes
describe('scheme parsing and effective cost', () => {
  it('percentage discount', () => {
    const r = calculateEffectiveCost({ basePrice: 1000, discountPct: 2 })
    expect(r.effective).toBeCloseTo(980); expect(r.status).toBe('ok')
  })
  it('flat discount', () => expect(calculateEffectiveCost({ basePrice: 1000, flatDiscount: 20 }).effective).toBe(980))
  it('10+1 bonus uses paid / total received', () => {
    expect(calculateEffectiveCost({ basePrice: 100, bonusBuy: 10, bonusFree: 1 }).effective).toBeCloseTo(1000 / 11, 6)
  })
  it('does not double count when price is already net', () => {
    expect(calculateEffectiveCost({ basePrice: 1000, discountPct: 2, priceIsNet: true }).effective).toBe(1000)
  })
  it('percent + bonus needs review unless stacking is confirmed', () => {
    expect(calculateEffectiveCost({ basePrice: 100, discountPct: 2, bonusBuy: 10, bonusFree: 1 }).status).toBe('review')
    const ok = calculateEffectiveCost({ basePrice: 100, discountPct: 2, bonusBuy: 10, bonusFree: 1, combine: true })
    expect(ok.status).toBe('ok'); expect(ok.effective).toBeCloseTo((98 * 10) / 11, 6)
  })
  it('percent then flat when explicitly combined', () => {
    expect(calculateEffectiveCost({ basePrice: 1000, discountPct: 10, flatDiscount: 20, combine: true }).effective).toBe(880)
  })
  it('missing and invalid inputs', () => {
    expect(calculateEffectiveCost({ basePrice: null }).status).toBe('missing')
    expect(calculateEffectiveCost({ basePrice: 100, discountPct: 120 }).status).toBe('invalid')
    expect(calculateEffectiveCost({ basePrice: 100, bonusBuy: 10, bonusFree: 0 }).status).toBe('invalid')
    expect(calculateEffectiveCost({ basePrice: -5 }).status).toBe('invalid')
  })
  it('parses common scheme texts', () => {
    expect(parseSchemeText('5% discount').discountPct).toBe(5)
    expect(parseSchemeText('Rs. 20 discount').flatDiscount).toBe(20)
    const b = parseSchemeText('10 + 1'); expect([b.bonusBuy, b.bonusFree]).toEqual([10, 1])
    const g = parseSchemeText('Buy 20, get 2 free'); expect([g.bonusBuy, g.bonusFree]).toEqual([20, 2])
    expect(parseSchemeText('flat rate').ambiguous).toBe(false)
    expect(parseSchemeText('call for deal xyz').ambiguous).toBe(true)
    expect(parseSchemeText('2% + 1%').ambiguous).toBe(true)
  })
  it('parses numbers', () => {
    expect(parseNumber('Rs. 1,250.50')).toBe(1250.5); expect(parseNumber('abc')).toBeNull(); expect(parseNumber('')).toBeNull()
  })
})

// ---------- matching
describe('product matching', () => {
  it('exact supplier/barcode/manufacturer code wins', () => {
    const p = catalogProduct('Panadol 500mg', { barcode: '123456' })
    const idx = buildIndex([p], [], [])
    const r = matchProduct(idx, SHOP, incoming('PANADOL TAB 500 MG', { barcode: '123456' }))
    expect(r.confidence).toBe('exact'); expect(r.productId).toBe(p.id)
  })
  it('identifier that contradicts the description is flagged, not accepted', () => {
    const p = catalogProduct('Panadol 500mg', { barcode: '123456' })
    const r = matchProduct(buildIndex([p], [], []), SHOP, incoming('Panadol 1000mg', { barcode: '123456' }))
    expect(r.confidence).toBe('conflicting'); expect(r.productId).toBeNull()
  })
  it('title formatting, case and spaces do not matter', () => {
    const p = catalogProduct('Product XYZ 100g')
    const r = matchProduct(buildIndex([p], [], []), SHOP, incoming('  PRODUCT   xyz 100 GM '))
    expect(r.confidence).toBe('high'); expect(r.productId).toBe(p.id)
  })
  it('50g and 100g stay separate (never merged)', () => {
    const p = catalogProduct('Product XYZ 100g')
    const r = matchProduct(buildIndex([p], [], []), SHOP, incoming('Product XYZ 50g'))
    expect(r.confidence).toBe('unmatched'); expect(r.productId).toBeNull()
  })
  it('different strengths and pack sizes stay separate', () => {
    const p = catalogProduct('Foo Tab 500mg 10s'.replace('10s', "10's"))
    const idx = buildIndex([p], [], [])
    expect(matchProduct(idx, SHOP, incoming('Foo Tab 250mg 10\'s')).confidence).toBe('unmatched')
    expect(matchProduct(idx, SHOP, incoming('Foo Tab 500mg 20\'s')).confidence).toBe('unmatched')
  })
  it('100mg is not 100g', () => {
    const idx = buildIndex([catalogProduct('Foo 100mg')], [], [])
    expect(matchProduct(idx, SHOP, incoming('Foo 100g')).confidence).toBe('unmatched')
  })
  it('matches by normalized product name even when no explicit size unit is needed (e.g. ACENAC GEL, ACEFYL 125 SYP NEW)', () => {
    const p1 = catalogProduct('ACENAC GEL')
    const p2 = catalogProduct('ACEFYL 125 SYP NEW')
    const p3 = catalogProduct('ACABEL-4MG-TABS')
    const p4 = catalogProduct('2SUM 500MG INJ')
    const p5 = catalogProduct('ACTIM-5MG-TABS')
    const idx = buildIndex([p1, p2, p3, p4, p5], [], [])
    expect(matchProduct(idx, SHOP, incoming('  acenac - gel  ')).productId).toBe(p1.id)
    expect(matchProduct(idx, SHOP, incoming('Acefyl  125   Syp New')).productId).toBe(p2.id)
    expect(matchProduct(idx, SHOP, incoming('ACABEL 4MG TAB')).productId).toBe(p3.id)
    expect(matchProduct(idx, SHOP, incoming('2sum 500 mg inj')).productId).toBe(p4.id)
    expect(matchProduct(idx, SHOP, incoming('Actim 5mg Tabs')).productId).toBe(p5.id)
    // Different bare numbers (125 vs 250) or different strengths (250mg vs 500mg) stay separate
    expect(matchProduct(idx, SHOP, incoming('ACEFYL 250 SYP NEW')).confidence).toBe('unmatched')
    expect(matchProduct(idx, SHOP, incoming('2SUM 250MG INJ')).confidence).toBe('unmatched')
  })
  it('one side missing the size or formulation needs review', () => {
    const idx = buildIndex([catalogProduct('Panadol 500mg'), catalogProduct('Acenac Gel')], [], [])
    expect(matchProduct(idx, SHOP, incoming('Panadol')).confidence).toBe('needs_review')
    expect(matchProduct(idx, SHOP, incoming('Acenac')).confidence).toBe('needs_review')
  })
  it('same name and size but different manufacturer needs review', () => {
    const p = catalogProduct('Foo 100g', { manufacturer: 'Alpha Pharma' })
    const r = matchProduct(buildIndex([p], [], []), SHOP, incoming('Foo 100g', { manufacturer: 'Beta Labs' }))
    expect(r.confidence).toBe('needs_review'); expect(r.productId).toBeNull()
  })
  it('same name and size but different barcodes are flagged as conflicting', () => {
    const p = catalogProduct('Foo 100g', { barcode: '111' })
    const r = matchProduct(buildIndex([p], [], []), SHOP, incoming('Foo 100g', { barcode: '222' }))
    expect(r.confidence).toBe('conflicting')
  })
  it('ambiguous (two candidates) is never auto-merged', () => {
    const a = catalogProduct('Foo 100g', { manufacturer: 'A' }), b = catalogProduct('Foo 100g', { manufacturer: 'B' })
    const r = matchProduct(buildIndex([a, b], [], []), SHOP, incoming('Foo 100g'))
    expect(r.confidence).toBe('needs_review'); expect(r.candidates).toHaveLength(2)
  })
  it('a confirmed decision is reused on a later import', () => {
    const p = catalogProduct('Totally Different Name 100g')
    const inc = incoming('Weird Supplier Title 100g')
    const idx = buildIndex([p], [], [{ shop_id: SHOP, source_key: inc.sourceKey, product_id: p.id }])
    const r = matchProduct(idx, SHOP, inc)
    expect(r.confidence).toBe('exact'); expect(r.productId).toBe(p.id)
    // other shop is not affected
    expect(matchProduct(idx, 'shopB', inc).confidence).toBe('unmatched')
  })
  it('a rejected mapping is not reintroduced', () => {
    const p = catalogProduct('Foo Cream')
    const inc = incoming('Foo Cream 100g', { supplierCode: 'S1' })
    const idx = buildIndex(
      [p], [{ product_id: p.id, kind: 'supplier_code', value: 'S1', shop_id: SHOP }],
      [{ shop_id: SHOP, source_key: inc.sourceKey, product_id: p.id }],
      [{ shop_id: SHOP, source_key: inc.sourceKey, product_id: p.id }],
    )
    const r = matchProduct(idx, SHOP, inc)
    expect(r.productId).toBeNull(); expect(r.confidence).not.toBe('exact')
    expect(r.candidates.find((c) => c.productId === p.id)).toBeUndefined()
  })
  it('a similar name with the same size is only a suggestion', () => {
    const idx = buildIndex([catalogProduct('Zinc Plus Syrup 120ml')], [], [])
    const r = matchProduct(idx, SHOP, incoming('Zinc Plus Forte Syrup 120ml'))
    expect(r.confidence).toBe('needs_review'); expect(r.productId).toBeNull()
  })
  it('policy can require manufacturer agreement', () => {
    const p = catalogProduct('Foo 100g', { manufacturer: 'A' })
    const idx = buildIndex([p], [], [], [], { requireManufacturerAgreement: true, allowPackOnlyWhenManufacturerAgrees: true })
    expect(matchProduct(idx, SHOP, incoming('Foo 100g')).confidence).toBe('needs_review')
    expect(matchProduct(idx, SHOP, incoming('Foo 100g', { manufacturer: 'A' })).confidence).toBe('high')
  })
})

// ---------- import
const CSV_A = [
  'Item Code,Product Name,Rate,Disc %,Scheme',
  'A1,Product XYZ 100g,1000,2,',
  'A2,Product XYZ 50g,550,,10+1',
  'A3,,100,,',
  'A4,Bad Price Item 10mg,abc,,',
  'A5,No Price Item 10mg,,,',
  'A1,Product XYZ 100g,1000,2,',
  ',,,,',
  'A6,Bad Disc 5mg,100,150,',
].join('\n')

describe('import pipeline', () => {
  const grid = parseCsvText(CSV_A)
  const mapping = suggestMapping(grid[0])
  it('suggests mapping for common header names', () => {
    expect(mapping.title).toBe('Product Name'); expect(mapping.price).toBe('Rate'); expect(mapping.code).toBe('Item Code')
    expect(mapping.discount).toBe('Disc %'); expect(mapping.scheme).toBe('Scheme')
  })
  it('validates rows: missing title, bad/missing price, duplicate, invalid discount, empty rows', () => {
    const { rows, stats } = buildRows(grid, mapping, DEFAULT_OPTIONS)
    expect(stats.empty).toBe(1)
    expect(stats.missingTitle).toBe(1); expect(stats.missingPrice).toBe(1); expect(stats.badNumbers).toBe(1)
    expect(stats.duplicate).toBe(1); expect(stats.valid).toBe(2); expect(stats.invalid).toBe(4)
    const a1 = rows.find((r) => r.code === 'A1')!
    expect(a1.cost.effective).toBeCloseTo(980); expect(a1.raw['Product Name']).toBe('Product XYZ 100g')
    const a2 = rows.find((r) => r.code === 'A2')!
    expect(a2.cost.effective).toBeCloseTo((550 * 10) / 11, 6)
  })
  it('missing headers: unmapped required fields produce errors per row', () => {
    const { stats } = buildRows(grid, { code: 'Item Code' }, DEFAULT_OPTIONS)
    expect(stats.valid).toBe(0)
  })
  it('XLSX and CSV give the same rows', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const x = parseWorkbook(buf)
    const a = buildRows(x.grid, suggestMapping(x.grid[0]), DEFAULT_OPTIONS)
    const b = buildRows(grid, mapping, DEFAULT_OPTIONS)
    expect(a.stats).toEqual(b.stats)
  })
  it('rejects PDF / images with a clear message', () => {
    expect(() => validateFile('list.pdf', 10)).toThrow(/not supported/)
    expect(() => validateFile('list.csv', 0)).toThrow(/empty/)
    expect(() => validateFile('list.exe', 10)).toThrow(/Unsupported/)
    expect(() => validateFile('list.xlsx', 100)).not.toThrow()
  })
  it('commit payload: new products grouped by identity, 50g and 100g distinct, errors kept out', () => {
    const { rows } = buildRows(grid, mapping, DEFAULT_OPTIONS)
    const idx = buildIndex([], [], [])
    const matches = runMatching(rows, idx, SHOP)
    const payload = buildCommitPayload(rows, matches, [])
    expect(payload.summary.imported).toBe(2); expect(payload.summary.errors).toBe(4); expect(payload.summary.skipped).toBe(1)
    expect(payload.newProducts).toHaveLength(2)
    const keys = new Set(payload.newProducts.map((n) => n.identity_key)); expect(keys.size).toBe(2)
    const imported = payload.rows.filter((r) => r.status === 'import')
    expect(imported.every((r) => r.original_title && r.raw)).toBe(true)
  })
  it('repeat import of the same file reuses products (no new product created)', () => {
    const { rows } = buildRows(grid, mapping, DEFAULT_OPTIONS)
    const first = buildCommitPayload(rows, runMatching(rows, buildIndex([], [], []), SHOP), [])
    const catalog: CatalogProduct[] = first.newProducts.map((n, i) => ({
      id: 'x' + i, name: n.name as string, normalized_name: n.normalized_name as string, brand: null, manufacturer: null,
      strength_value: n.strength_value as number | null, strength_unit: n.strength_unit as string | null,
      weight_value: n.weight_value as number | null, weight_unit: n.weight_unit as string | null,
      pack_size: n.pack_size as number | null, dosage_form: n.dosage_form as string | null, barcode: null, mfr_code: null,
    }))
    const second = buildCommitPayload(rows, runMatching(rows, buildIndex(catalog, [], []), SHOP), catalog)
    expect(second.newProducts).toHaveLength(0)
    expect(second.rows.filter((r) => r.status === 'import').every((r) => r.product_id)).toBe(true)
  })
  it('identity key distinguishes variants', () => {
    const k = (t: string) => { const p = parseTitle(t); return identityKey({ normalizedName: p.name, strengthValue: p.strengthValue, strengthUnit: p.strengthUnit, weightValue: p.weightValue, weightUnit: p.weightUnit, packSize: p.packSize, dosageForm: p.dosageForm, manufacturer: null }) }
    expect(k('Foo 100g')).toBe(k('FOO 100 gm')); expect(k('Foo 100g')).not.toBe(k('Foo 50g')); expect(k('Foo 100g')).not.toBe(k('Foo 100g Pack of 12'))
  })
  it('imports a simple two-column market price list (ITEM NAME + OFFER RATE) without optional columns', () => {
    const csv = [
      'ITEM NAME,OFFER RATE',
      '2SUM 500MG INJ,145',
      'ACABEL-4MG-TABS,210.50',
      'ACEFYL 125 SYP NEW,95',
      'ACENAC GEL,85',
      'ACTIM-5MG-TABS,160',
    ].join('\n')
    const g = parseCsvText(csv)
    const map = suggestMapping(g[0])
    expect(map.title).toBe('ITEM NAME')
    expect(map.price).toBe('OFFER RATE')
    const { rows, stats } = buildRows(g, map, DEFAULT_OPTIONS)
    expect(stats.valid).toBe(5)
    expect(stats.invalid).toBe(0)
    expect(rows.map((r) => [r.title, r.cost.effective])).toEqual([
      ['2SUM 500MG INJ', 145],
      ['ACABEL-4MG-TABS', 210.5],
      ['ACEFYL 125 SYP NEW', 95],
      ['ACENAC GEL', 85],
      ['ACTIM-5MG-TABS', 160],
    ])
  })
  it('detects and normalizes side-by-side ITEM NAME / OFFER RATE columns into one product-price list', () => {
    const sideBySideCsv = [
      'AL-MADINA MEDICOSE,DATE: 28-10-2026,,',
      'ITEM NAME,OFFER RATE,ITEM NAME,OFFER RATE',
      '2SUM 500MG INJ,145,ACENAC GEL,85',
      'ACABEL-4MG-TABS,210,ACTIM-5MG-TABS,160',
      'ACEFYL 125 SYP NEW,95,,',
    ].join('\n')
    const g = parseCsvText(sideBySideCsv)
    const hr = detectHeaderRow(g)
    expect(hr).toBe(2)
    const sbs = detectSideBySide(g, hr)
    expect(sbs.status).toBe('detected')
    expect(sbs.groups).toHaveLength(2)

    const map = suggestMapping(g[hr - 1])
    const { rows, stats } = buildRows(g, map, { ...DEFAULT_OPTIONS, headerRow: hr })
    expect(stats.valid).toBe(5)
    expect(stats.invalid).toBe(0)
    expect(rows.map((r) => r.title)).toEqual([
      '2SUM 500MG INJ',
      'ACABEL-4MG-TABS',
      'ACEFYL 125 SYP NEW',
      'ACENAC GEL',
      'ACTIM-5MG-TABS',
    ])
    // Ensure unique row numbers for database constraint (import_job_id, row_number)
    expect(new Set(rows.map((r) => r.rowNumber)).size).toBe(5)
  })
  it('flags ambiguous multi-column sheets when product/rate columns cannot be paired cleanly', () => {
    const ambigCsv = [
      'ITEM NAME,OFFER RATE,ITEM NAME,UNKNOWN COL',
      '2SUM 500MG INJ,145,ACENAC GEL,85',
    ].join('\n')
    const g = parseCsvText(ambigCsv)
    const sbs = detectSideBySide(g, 1)
    expect(sbs.status).toBe('ambiguous')
  })
})

// ---------- comparison
function rec(over: Partial<PriceRecord>): PriceRecord {
  return {
    id: 'r' + ++seq, product_id: 'P', shop_id: 'S1', survey_id: 'sv', import_job_id: null, observed_on: '2026-10-20',
    original_title: 'x', original_code: null, base_price: 1000, mrp: null, discount_pct: null, flat_discount: null, scheme_text: null,
    bonus_buy: null, bonus_free: null, min_order_qty: null, pack_size: null, availability: null, expiry: null, valid_until: null,
    tax_included: null, price_is_net: false, combine_discounts: false, effective_cost: 1000, scheme_status: 'ok', calc_notes: null,
    match_status: 'exact', match_candidates: null, source_attrs: null, updated_at: '2026-10-20T00:00:00Z', notes: null, archived: false, created_at: '2026-10-20T00:00:00Z', ...over,
  }
}
const TODAY = new Date('2026-10-28T00:00:00')
const OPT = { freshnessDays: 15, excludeStale: false, today: TODAY }

describe('comparison engine', () => {
  it('picks the lowest effective cost, not the lowest base price', () => {
    const r = compareOffers([
      rec({ shop_id: 'A', base_price: 1000, effective_cost: 990 }),
      rec({ shop_id: 'B', base_price: 990, effective_cost: 970.2 }),
      rec({ shop_id: 'C', base_price: 1020, effective_cost: 989.4 }),
    ], undefined, OPT)
    expect(r.offers[0].rec.shop_id).toBe('B'); expect(r.offers[0].isBest).toBe(true)
    expect(r.nextBest!.saving).toBeCloseTo(19.2, 2)
  })
  it('ties mark both as best', () => {
    const r = compareOffers([rec({ shop_id: 'A', effective_cost: 500 }), rec({ shop_id: 'B', effective_cost: 500 }), rec({ shop_id: 'C', effective_cost: 600 })], undefined, OPT)
    expect(r.tied).toBe(true); expect(r.offers.filter((o) => o.isBest)).toHaveLength(2)
  })
  it('never ranks missing, invalid or review offers; a lone offer is not "best"', () => {
    const r = compareOffers([
      rec({ shop_id: 'A', effective_cost: 100 }),
      rec({ shop_id: 'B', effective_cost: 50, scheme_status: 'review' }),
      rec({ shop_id: 'C', effective_cost: null, scheme_status: 'missing' }),
      rec({ shop_id: 'D', effective_cost: 40, availability: 'Out of stock' }),
    ], undefined, OPT)
    expect(r.eligibleCount).toBe(1); expect(r.offers.some((o) => o.isBest)).toBe(false)
    expect(r.offers.find((o) => o.rec.shop_id === 'B')!.reason).toBe('review')
  })
  it('stale quotes can be excluded by the freshness threshold', () => {
    const old = rec({ shop_id: 'A', observed_on: '2026-08-01', effective_cost: 10 })
    const now = rec({ shop_id: 'B', effective_cost: 20 }), now2 = rec({ shop_id: 'C', effective_cost: 30 })
    const incl = compareOffers([old, now, now2], undefined, OPT)
    expect(incl.offers[0].rec.shop_id).toBe('A'); expect(incl.offers[0].fresh).toBe(false)
    const excl = compareOffers([old, now, now2], undefined, { ...OPT, excludeStale: true })
    expect(excl.offers.find((o) => o.rec.shop_id === 'A')!.reason).toBe('stale'); expect(excl.offers[0].rec.shop_id).toBe('B')
  })
  it('price per gram is shown for weighted products', () => {
    const prod = { weight_value: 50, weight_unit: 'g' } as Product
    expect(compareOffers([rec({ effective_cost: 100 })], prod, OPT).offers[0].perUnit!.value).toBe(2)
  })
  it('history is preserved: latest per shop wins in current offers, older prices stay as history', () => {
    const o = rec({ id: 'old', observed_on: '2026-09-01', effective_cost: 900 }), n = rec({ id: 'new', observed_on: '2026-10-20', effective_cost: 950 })
    const cur = latestPerProductShop([o, n]); expect(cur).toHaveLength(1); expect(cur[0].id).toBe('new')
  })
  it('opportunities: new low and saving vs next-best, only with 2+ comparable offers', () => {
    const prod = { id: 'P', archived: false } as Product
    const cur = [rec({ shop_id: 'A', effective_cost: 80, observed_on: '2026-10-25' }), rec({ shop_id: 'B', effective_cost: 100 })]
    const hist = [{ id: 'h', product_id: 'P', shop_id: 'A', observed_on: '2026-09-01', effective_cost: 95, scheme_status: 'ok' as const, created_at: '' }]
    const [o] = findOpportunities([prod], cur, hist, OPT)
    expect(o.saving).toBe(20); expect(o.savingPct).toBe(20); expect(o.reasons).toContain('new_low'); expect(o.reasons).toContain('price_drop')
    expect(findOpportunities([prod], [cur[0]], hist, OPT)).toHaveLength(0)
  })
  it('both users compute the same result from the same shared records (deterministic)', () => {
    const recs = [rec({ shop_id: 'A', effective_cost: 5 }), rec({ shop_id: 'B', effective_cost: 7 })]
    const a = compareOffers([...recs], undefined, OPT), b = compareOffers([...recs].reverse(), undefined, OPT)
    expect(a.offers.map((o) => o.rec.shop_id)).toEqual(b.offers.map((o) => o.rec.shop_id))
  })
})

// ---------- sorting / grouping
function prod(name: string, over: Partial<Product> = {}): Product {
  const p = parseTitle(name)
  return {
    id: 'q' + ++seq, product_no: seq, name, normalized_name: p.name, brand: null, manufacturer: null, active_ingredient: null,
    strength_value: p.strengthValue, strength_unit: p.strengthUnit, weight_value: p.weightValue, weight_unit: p.weightUnit,
    pack_size: p.packSize, dosage_form: p.dosageForm, variant: null, barcode: null, mfr_code: null, notes: null, archived: false,
    created_at: '', updated_at: '', ...over,
  }
}
describe('sorting and grouping', () => {
  const products = [prod('Product XYZ 100g'), prod('Product XYZ 25g'), prod('Alpha 10g'), prod('Product XYZ 200g'), prod('Product XYZ 50g')]
  const rows = buildProductRows(products, [], new Map<string, Shop>(), OPT)
  it('groups variants under one title in natural weight order without merging', () => {
    const g = groupRows(sortRows(rows, 'name_asc'), 'title')
    expect(g.map((x) => x.label)).toEqual(['Alpha', 'Product Xyz'])
    expect(g[1].rows.map((r) => r.product.weight_value)).toEqual([25, 50, 100, 200]); expect(g[1].rows).toHaveLength(4)
  })
  it('A-Z / Z-A', () => {
    expect(sortRows(rows, 'name_asc')[0].product.name).toBe('Alpha 10g')
    expect(sortRows(rows, 'name_desc')[0].product.normalized_name).toBe('product xyz')
  })
  it('sorts by weight numerically', () => {
    expect(sortRows(rows, 'weight').map((r) => r.product.weight_value)).toEqual([10, 25, 50, 100, 200])
  })
})

// ---------- export
describe('export', () => {
  const p = prod('Zürich Tabs 500mg', { name: 'Zürich "Tabs", 500mg\nline2' })
  const shops = new Map<string, Shop>([['S1', { id: 'S1', name: '=cmd|calc', phone: null } as Shop], ['S2', { id: 'S2', name: 'Shop Two', phone: null } as Shop]])
  const ctx: ExportContext = {
    products: [p, prod('Other 5mg')], shops,
    current: [rec({ product_id: p.id, shop_id: 'S1', effective_cost: 90 }), rec({ product_id: p.id, shop_id: 'S2', effective_cost: 95 })],
    review: [], opt: OPT, selectedIds: new Set([p.id]),
  }
  it('selected products and best-only', () => {
    expect(buildExportRows('selected', ctx)).toHaveLength(1)
    const best = buildExportRows('best', ctx); expect(best).toHaveLength(1); expect(best[0].shop).toBe('=cmd|calc'); expect(best[0].is_best).toBe('YES')
    expect(buildExportRows('offers', ctx)).toHaveLength(2)
  })
  it('CSV: column order, unicode, quotes/newlines, BOM, formula neutralised', () => {
    const rows = buildExportRows('best', ctx)
    const cols = [{ key: 'shop', header: 'Shop' }, { key: 'product_name', header: 'Name' }, { key: 'effective_cost', header: 'Cost' }]
    const csv = toCsv(toMatrix(rows, cols))
    expect(csv.startsWith('﻿Shop,Name,Cost')).toBe(true)
    expect(csv).toContain("'=cmd|calc"); expect(csv).toContain('Zürich'); expect(csv).toContain('"Zürich ""Tabs"", 500mg\nline2"')
    const back = parseCsvText(csv)
    expect(back[1][1]).toBe('Zürich "Tabs", 500mg\nline2'); expect(back[1][2]).toBe('90')
  })
  it('XLSX round trip', () => {
    const m = toMatrix(buildExportRows('offers', ctx), GENERIC_PROFILE.columns)
    const buf = toXlsxBuffer(m, { sheet: 'Offers', info: [['Exported', 'now']] })
    const { grid } = parseWorkbook(buf)
    expect(grid[0]).toEqual(GENERIC_PROFILE.columns.map((c) => c.header)); expect(grid).toHaveLength(3)
  })
  it('sanitizeCell leaves numbers alone', () => {
    expect(sanitizeCell(-5)).toBe(-5); expect(sanitizeCell('@x')).toBe("'@x"); expect(sanitizeCell('plain')).toBe('plain')
  })
})
