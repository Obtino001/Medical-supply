import { describe, expect, it } from 'vitest'
import { parseTitle } from './productParse'
import { matchesSearch, normalizeForSearch } from './search'
import { buildProductRows, matchesQuery } from './tableModel'
import type { PriceRecord, Product, Shop } from './types'

let seq = 0
function mkProd(name: string, extra: Partial<Product> = {}): Product {
  const p = parseTitle(name)
  return {
    id: 'sp' + ++seq,
    product_no: seq,
    name,
    normalized_name: p.name,
    brand: null,
    manufacturer: null,
    country_of_origin: p.countryOfOrigin,
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
    created_at: '2026-11-21T00:00:00Z',
    updated_at: '2026-11-21T00:00:00Z',
    ...extra,
  }
}

function mkRec(over: Partial<PriceRecord>): PriceRecord {
  return {
    id: 'sr' + ++seq,
    product_id: null,
    shop_id: 'S1',
    survey_id: 'sv1',
    import_job_id: null,
    observed_on: '2026-11-20',
    original_title: 'Item',
    original_code: null,
    base_price: 100,
    mrp: null,
    discount_pct: null,
    flat_discount: null,
    scheme_text: null,
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
    effective_cost: 100,
    scheme_status: 'ok',
    calc_notes: null,
    match_status: 'exact',
    match_candidates: null,
    source_attrs: null,
    updated_at: '2026-11-21T00:00:00Z',
    notes: null,
    archived: false,
    created_at: '2026-11-21T00:00:00Z',
    ...over,
  }
}

describe('Robust case-, punctuation-, unit-, and homoglyph-normalized search', () => {
  it('matches UPPERCASE, lowercase, Title Case, and trailing mobile keyboard spaces identically', () => {
    expect(normalizeForSearch('  ZOPENT\u00A040 MG   TAB  ')).toBe('zopent 40 mg tab')
    expect(matchesSearch(['ZOPENT 40 MG TAB'], 'zopen')).toBe(true)
    expect(matchesSearch(['ZOPENT 40 MG TAB'], 'ZOPEN')).toBe(true)
    expect(matchesSearch(['ZOPENT 40 MG TAB'], 'ZOPENT  ')).toBe(true)
    expect(matchesSearch(['zopent 40 mg tab'], 'ZOPENT TAB')).toBe(true)
    expect(matchesSearch(['zopent 40 mg tab'], 'ZOPENT TABLET')).toBe(true)
  })

  it('normalizes Cyrillic/Greek lookalike capital letters and diacritics', () => {
    // Cyrillic capital letters А, О, Р, С, Е, К, М, Т, Х copied from supplier PDFs
    const cyrillicQuery = '\u0410\u041C\u041EXIL 500MG'
    expect(matchesSearch(['Amoxil 500mg Cap'], cyrillicQuery)).toBe(true)
    const cyrillicZopent = 'Z\u041E\u0420\u0415NT'
    expect(matchesSearch(['ZOPENT 40 MG TAB'], cyrillicZopent)).toBe(true)
  })

  it('handles hyphens, dots, slashes, and spaced vs joined strength units seamlessly', () => {
    expect(matchesSearch(['PARAXYL-CR-25. (CCL)'], 'PARAXYL CR 25')).toBe(true)
    expect(matchesSearch(['PARAXYL-CR-25. (CCL)'], 'paraxyl-cr')).toBe(true)
    expect(matchesSearch(['ORINASE-MET-2.0/500 TAB.'], 'ORINASE MET 2.0 500')).toBe(true)
    expect(matchesSearch(['ZOPENT 40 MG TAB'], 'ZOPENT 40MG')).toBe(true)
    expect(matchesSearch(['ZOPENT 40 MG TAB'], 'ZOPENT40')).toBe(true)
    expect(matchesSearch(['ZOPENT 40MG TAB'], 'ZOPENT 40 MG')).toBe(true)
    // Does not falsely match unrelated drug names
    expect(matchesSearch(['ZOLAM 0.5MG TAB'], 'ZOPEN')).toBe(false)
  })

  it('searches across buildProductRows & matchesQuery including company aliases, country, codes, and shop names', () => {
    const p1 = mkProd('ZOPENT 40 MG TAB', {
      manufacturer: 'Hilton Pharma',
      country_of_origin: 'Pakistan',
      barcode: '89640011',
      mfr_code: 'HLT-40',
    })
    const p2 = mkProd('Augmentin 625mg Tab', {
      manufacturer: 'GlaxoSmithKline Pakistan (GSK)',
      country_of_origin: 'United Kingdom',
    })
    const shops = new Map<string, Shop>([['S1', { id: 'S1', name: 'Kirpal Medicos' } as Shop]])
    const recs = [
      mkRec({ product_id: p1.id, shop_id: 'S1', original_title: 'ZOPENT-40MG (HILTON)', original_code: 'KM99' }),
      mkRec({ product_id: p2.id, shop_id: 'S1', original_title: 'AUGMENTIN 625 UK' }),
    ]

    const rows = buildProductRows([p1, p2], recs, shops, { freshnessDays: 15, excludeStale: false })
    const r1 = rows[0]
    const r2 = rows[1]

    expect(matchesQuery(r1, 'ZOPENT 40MG', shops)).toBe(true)
    expect(matchesQuery(r1, 'HILTON 40', shops)).toBe(true)
    expect(matchesQuery(r1, 'KIRPAL ZOPENT', shops)).toBe(true)
    expect(matchesQuery(r1, 'HLT-40', shops)).toBe(true)
    expect(matchesQuery(r2, 'GSK AUGMENTIN', shops)).toBe(true)
    expect(matchesQuery(r2, 'UNITED KINGDOM 625MG', shops)).toBe(true)
    expect(matchesQuery(r2, 'ZOPEN', shops)).toBe(false)

    // Also works when called directly without prebuilt searchIndex
    expect(matchesQuery({ product: p1, records: [recs[0]] }, 'ZOPENT 40MG', shops)).toBe(true)
    expect(matchesQuery({ product: p2, records: [recs[1]] }, 'GSK 625', shops)).toBe(true)
  })
})
