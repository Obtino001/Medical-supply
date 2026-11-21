import { describe, expect, it } from 'vitest'
import { buildSuggestionAssignments } from './actions'
import {
  PHARMA_COMPANIES,
  buildCompanySuggestions,
  buildCompanySummaries,
  companyProductDedupeKey,
  extractCompanyFromTitle,
  findDuplicateProductGroups,
  isPlaceholderCompany,
  resolveCanonicalCompany,
  resolveProductDisplayCompany,
} from './companies'
import { buildIndex, matchProduct, type CatalogProduct, type IncomingProduct } from './matching'
import { parseTitle, sourceKey } from './productParse'
import { buildProductRows, dedupeProductRowsForCompany, groupRows } from './tableModel'
import type { PriceRecord, Product, Shop } from './types'

let seq = 0
function mkProd(name: string, extra: Partial<Product> = {}): Product {
  const p = parseTitle(name)
  return {
    id: 'cp' + ++seq,
    product_no: seq,
    name,
    normalized_name: p.name,
    brand: null,
    manufacturer: null,
    active_ingredient: null,
    strength_value: p.strengthValue,
    strength_unit: p.strengthUnit,
    weight_value: p.weightValue,
    weight_unit: p.weightUnit,
    pack_size: p.packSize,
    dosage_form: p.dosageForm,
    variant: null,
    barcode: null,
    mfr_code: null,
    notes: null,
    archived: false,
    created_at: '',
    updated_at: '',
    ...extra,
  }
}

function mkRec(over: Partial<PriceRecord>): PriceRecord {
  return {
    id: 'cr' + ++seq,
    product_id: null,
    shop_id: 'S1',
    survey_id: 'sv1',
    import_job_id: null,
    observed_on: '2026-11-17',
    original_title: 'x',
    original_code: null,
    base_price: null,
    mrp: null,
    discount_pct: 10,
    flat_discount: null,
    scheme_text: '10% discount',
    bonus_buy: null,
    bonus_free: null,
    min_order_qty: null,
    pack_size: null,
    availability: null,
    expiry: null,
    valid_until: null,
    tax_included: null,
    price_is_net: false,
    combine_discounts: false,
    effective_cost: null,
    scheme_status: 'ok',
    calc_notes: null,
    match_status: 'exact',
    match_candidates: null,
    source_attrs: null,
    updated_at: '2026-11-17T00:00:00Z',
    notes: null,
    archived: false,
    created_at: '2026-11-17T00:00:00Z',
    ...over,
  }
}

describe('Pakistan Top 50 Pharmaceutical Companies & auto-categorization', () => {
  it('contains all unique companies from Pakistan Top 50 list (#1 Getz to #50 Wyeth)', () => {
    const top50 = PHARMA_COMPANIES.filter((c) => c.top50Rank != null)
    // User's pasted 50 rows contain two repeated names (#5/#21 The Searle Company, #18/#31 Barrett Hodgson)
    expect(top50).toHaveLength(48)
    expect(top50[0].name).toBe('Getz Pharma')
    expect(top50[0].top50Rank).toBe(1)
    expect(top50[top50.length - 1].name).toBe('Wyeth Pakistan')
    expect(top50[top50.length - 1].top50Rank).toBe(50)
  })

  it('canonicalizes messy wholesaler shorthand & rejects non-company placeholders', () => {
    expect(resolveCanonicalCompany('GETZ')).toBe('Getz Pharma')
    expect(resolveCanonicalCompany('A.G.P')).toBe('AGP Limited')
    expect(resolveCanonicalCompany('AGP PHARMA')).toBe('AGP Limited')
    expect(resolveCanonicalCompany('ABBOTT PHARMANET')).toBe('Abbott Laboratories Pakistan')
    expect(resolveCanonicalCompany('ABBOTT UDL')).toBe('Abbott Laboratories Pakistan')
    expect(resolveCanonicalCompany('GSK-')).toBe('GlaxoSmithKline Pakistan (GSK)')
    expect(resolveCanonicalCompany('BEECHAM')).toBe('GlaxoSmithKline Pakistan (GSK)')
    expect(resolveCanonicalCompany('FEROZ SONS.')).toBe('Ferozsons Laboratories')
    expect(resolveCanonicalCompany('HIGH-Q.')).toBe('High-Q International')
    expect(resolveCanonicalCompany('BARRETT HODSON')).toBe('Barrett Hodgson Pakistan')
    expect(resolveCanonicalCompany('N-Q')).toBe('Nabiqasim Industries')
    expect(resolveCanonicalCompany('NABI QASIM')).toBe('Nabiqasim Industries')
    expect(resolveCanonicalCompany('LEPETIT PACIFIC')).toBe('Pacific Pharmaceuticals')
    expect(resolveCanonicalCompany('LCI / PFIZER')).toBe('Pfizer Pakistan')
    expect(resolveCanonicalCompany('AVENTIS')).toBe('Sanofi Pakistan')
    expect(resolveCanonicalCompany('NOVO')).toBe('Novo Nordisk Pakistan')

    expect(isPlaceholderCompany('MISC.')).toBe(true)
    expect(isPlaceholderCompany('DROPS')).toBe(true)
    expect(isPlaceholderCompany('MIX ITEM')).toBe(true)
    expect(isPlaceholderCompany('CREAMS AND OINTMENT')).toBe(true)
    expect(resolveCanonicalCompany('MISC.')).toBeNull()
    expect(resolveCanonicalCompany('DROPS')).toBeNull()

    // Preserves unknown real custom pharma companies
    expect(resolveCanonicalCompany('Star Pharma Labs')).toBe('Star Pharma Labs')
  })

  it('extracts company tags embedded inside product names', () => {
    expect(extractCompanyFromTitle('PARAXYL-CR-25. (CCL)')?.name).toBe('CCL Pharmaceuticals')
    expect(extractCompanyFromTitle('CALFINA-PLUS. (AGP)')?.name).toBe('AGP Limited')
    expect(extractCompanyFromTitle('EZOMOL-20 MG TAB. (ABBOTT')?.name).toBe('Abbott Laboratories Pakistan')
    expect(extractCompanyFromTitle('SOMOGELL ABBOT')?.name).toBe('Abbott Laboratories Pakistan')
    // Ambiguous generic words inside ordinary titles must NOT trigger false matches
    expect(extractCompanyFromTitle('POPULAR HERBAL TEA')).toBeNull()
    expect(extractCompanyFromTitle('GLOBAL HEALTH VITAMIN')).toBeNull()
  })

  it('generates safe multi-source categorization suggestions & propagates unambiguous brand families', () => {
    const p1 = mkProd('PARAXYL-CR-25. (CCL)')
    const p2 = mkProd('RIGIX 10MG TAB', { manufacturer: 'A.G.P' })
    const p3 = mkProd('GETRYL 2MG TAB') // gets manufacturer from linked price record
    const p4 = mkProd('GETRYL 4MG TAB') // uncategorized variant shares brand family "getryl" -> Getz Pharma
    const p5 = mkProd('RANDOM DROPS', { manufacturer: 'DROPS' }) // bogus placeholder

    const recs = [
      mkRec({
        product_id: p3.id,
        shop_id: 'S1',
        source_attrs: {
          brand: null, manufacturer: 'GETZ', barcode: null, mfr_code: null,
          strength_value: 2, strength_unit: 'mg', weight_value: null, weight_unit: null, pack_size: null, dosage_form: 'tablet',
        },
      }),
    ]

    const sugs = buildCompanySuggestions([p1, p2, p3, p4, p5], recs)
    const byId = new Map(sugs.map((s) => [s.productId, s]))

    expect(byId.get(p1.id)?.suggestedManufacturer).toBe('CCL Pharmaceuticals')
    expect(byId.get(p1.id)?.reason).toBe('title_tag')

    expect(byId.get(p2.id)?.suggestedManufacturer).toBe('AGP Limited')
    expect(byId.get(p2.id)?.reason).toBe('canonical_existing')

    expect(byId.get(p3.id)?.suggestedManufacturer).toBe('Getz Pharma')
    expect(byId.get(p3.id)?.reason).toBe('supplier_record')

    expect(byId.get(p4.id)?.suggestedManufacturer).toBe('Getz Pharma')
    expect(byId.get(p4.id)?.reason).toBe('brand_family')

    expect(byId.get(p5.id)?.suggestedManufacturer).toBeNull()
    expect(byId.get(p5.id)?.reason).toBe('clear_placeholder')
  })

  it('summarizes product counts, multi-shop availability, discounts, and suppliers per company', () => {
    const p1 = mkProd('RISEk 40MG CAP', { manufacturer: 'GETZ', dosage_form: 'capsule' })
    const p2 = mkProd('PARAXYL-CR-25. (CCL)')
    const p3 = mkProd('MYSTERY ITEM')

    const shops = new Map<string, Shop>([
      ['S1', { id: 'S1', name: 'Noman impex' } as Shop],
      ['S2', { id: 'S2', name: 'Kirpal Medicos' } as Shop],
    ])
    const recs = [
      mkRec({ product_id: p1.id, shop_id: 'S1', discount_pct: 12 }),
      mkRec({ product_id: p1.id, shop_id: 'S2', discount_pct: 18 }),
      mkRec({ product_id: p2.id, shop_id: 'S1', discount_pct: 10, base_price: 500, effective_cost: 450 }),
    ]

    expect(resolveProductDisplayCompany(p1, [])).toBe('Getz Pharma')
    const summaries = buildCompanySummaries([p1, p2, p3], recs, shops)

    const getz = summaries.find((s) => s.id === 'getz-pharma')!
    expect(getz.top50Rank).toBe(1)
    expect(getz.productCount).toBe(1)
    expect(getz.offerCount).toBe(2)
    expect(getz.multiShopCount).toBe(1)
    expect(getz.bestDiscountPct).toBe(18)
    expect(getz.shops.map((s) => s.shopName)).toEqual(['Kirpal Medicos', 'Noman impex'])

    const ccl = summaries.find((s) => s.id === 'ccl-pharmaceuticals')!
    expect(ccl.productCount).toBe(1)
    expect(ccl.minPriceRs).toBe(450)

    const uncat = summaries.find((s) => s.isUncategorized)!
    expect(uncat.productCount).toBe(1)

    const wyeth = summaries.find((s) => s.id === 'wyeth-pakistan')!
    expect(wyeth.productCount).toBe(0)
  })

  it('treats company aliases as agreeing during product matching & table grouping', () => {
    const parsed = parseTitle('Risek 40mg Capsule')
    const catalogProd: CatalogProduct = {
      id: 'c1',
      name: 'Risek 40mg Capsule',
      normalized_name: parsed.name,
      brand: null,
      manufacturer: 'Getz Pharma',
      strength_value: parsed.strengthValue,
      strength_unit: parsed.strengthUnit,
      weight_value: null,
      weight_unit: null,
      pack_size: null,
      dosage_form: parsed.dosageForm,
      barcode: null,
      mfr_code: null,
    }
    const inc: IncomingProduct = {
      title: 'RISEK 40MG CAP',
      normalizedName: parsed.name,
      supplierCode: null,
      barcode: null,
      mfrCode: null,
      brand: null,
      manufacturer: 'GETZ',
      strengthValue: parsed.strengthValue,
      strengthUnit: parsed.strengthUnit,
      weightValue: null,
      weightUnit: null,
      packSize: null,
      dosageForm: parsed.dosageForm,
      sourceKey: sourceKey(null, 'RISEK 40MG CAP'),
    }
    const res = matchProduct(buildIndex([catalogProd], [], []), 'S1', inc)
    expect(res.confidence).toBe('high')
    expect(res.productId).toBe('c1')

    // Grouping rows by manufacturer groups "GETZ" and "Getz Pharma" together
    const dummyRow = {
      product: mkProd('A', { manufacturer: 'GETZ' }),
      company: 'Getz Pharma',
    } as never
    const groups = groupRows([dummyRow], 'manufacturer')
    expect(groups[0].label).toBe('Getz Pharma')
  })

  it('deduplicates same-company duplicate products while preserving combined supplier offers and distinct strengths', () => {
    const pDupTagged = mkProd('RISEK 40MG CAP. (GETZ)', { manufacturer: 'GETZ', dosage_form: 'capsule' })
    const pClean = mkProd('Risek 40mg Capsule', { manufacturer: 'Getz Pharma', dosage_form: 'capsule' })
    const pOtherStrength = mkProd('Risek 20mg Capsule', { manufacturer: 'Getz Pharma', dosage_form: 'capsule' })
    const pAlpha = mkProd('Amkay 500mg Inj', { manufacturer: 'Getz Pharma', dosage_form: 'injection' })

    // Duplicate title variations (title tag + punctuation) produce identical dedupe keys, while 20mg stays separate
    expect(companyProductDedupeKey(pDupTagged)).toBe(companyProductDedupeKey(pClean))
    expect(companyProductDedupeKey(pClean)).not.toBe(companyProductDedupeKey(pOtherStrength))

    const shops = new Map<string, Shop>([
      ['S1', { id: 'S1', name: 'Noman Impex' } as Shop],
      ['S2', { id: 'S2', name: 'Kirpal Medicos' } as Shop],
    ])
    const recs: PriceRecord[] = [
      mkRec({ product_id: pDupTagged.id, shop_id: 'S1', base_price: 500, effective_cost: 460, discount_pct: 8 }),
      mkRec({ product_id: pClean.id, shop_id: 'S2', base_price: 500, effective_cost: 430, discount_pct: 14 }),
      mkRec({ product_id: pOtherStrength.id, shop_id: 'S1', base_price: 320, effective_cost: 290, discount_pct: 9 }),
      mkRec({ product_id: pAlpha.id, shop_id: 'S1', base_price: 200, effective_cost: 180, discount_pct: 10 }),
    ]

    const dupGroups = findDuplicateProductGroups([pDupTagged, pClean, pOtherStrength, pAlpha], recs, 'Getz Pharma')
    expect(dupGroups).toHaveLength(1)
    expect(dupGroups[0].primary.id).toBe(pClean.id)
    expect(dupGroups[0].duplicates.map((d) => d.id)).toEqual([pDupTagged.id])

    const summaries = buildCompanySummaries([pDupTagged, pClean, pOtherStrength, pAlpha], recs, shops)
    const getz = summaries.find((s) => s.name === 'Getz Pharma')!
    expect(getz.rawProductCount).toBe(4)
    expect(getz.productCount).toBe(3)
    expect(getz.duplicateCount).toBe(1)
    expect(getz.multiShopCount).toBe(1)
    expect(getz.sampleProducts.map((p) => p.name)).toEqual([
      'Amkay 500mg Inj',
      'Risek 20mg Capsule',
      'Risek 40mg Capsule',
    ])

    const opt = { freshnessDays: 30, excludeStale: false }
    const rawRows = buildProductRows([pDupTagged, pClean, pOtherStrength, pAlpha], recs, shops, opt)
    const dedupedRows = dedupeProductRowsForCompany(rawRows, shops, opt)
    expect(dedupedRows).toHaveLength(3)
    const risek40Row = dedupedRows.find((r) => r.product.id === pClean.id)!
    // Combined offers from BOTH suppliers S1 and S2 are visible on the single surviving Risek 40mg row
    expect(risek40Row.records.map((r) => r.shop_id).sort()).toEqual(['S1', 'S2'])
    expect(risek40Row.bestShop?.id).toBe('S2')
  })

  it('builds one-click suggestion assignments keeping manufacturer & origin while omitting rawName for placeholder clears', () => {
    const pTag = mkProd('AGNAR-TAB. (GETZ)', { country_of_origin: 'Pakistan' })
    const pMisc = mkProd('RANDOM DROPS', { manufacturer: 'DROPS' })
    const sugs = buildCompanySuggestions([pTag, pMisc], [])
    const batch = buildSuggestionAssignments(sugs)
    const byId = new Map(batch.map((a) => [a.productId, a]))

    expect(byId.get(pTag.id)).toEqual({
      productId: pTag.id,
      manufacturer: 'Getz Pharma',
      rawName: 'AGNAR-TAB. (GETZ)',
      countryOfOrigin: 'Pakistan',
    })
    expect(byId.get(pMisc.id)).toEqual({
      productId: pMisc.id,
      manufacturer: null,
      rawName: undefined,
      countryOfOrigin: undefined,
    })
  })
})
