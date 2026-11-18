import { describe, expect, it } from 'vitest'
import { suggestMapping, DEFAULT_OPTIONS } from './columns'
import { buildRows } from './importBuild'
import { buildCommitPayload, runMatching, runMatchingAsync } from './importPlan'
import {
  buildIndex,
  confidenceToMatchLevel,
  inferMappedManufacturer,
  manufacturerPatternKey,
  matchProduct,
  MATCH_LEVEL_LABEL,
  type CatalogManufacturerMapping,
  type CatalogProduct,
  type IncomingProduct,
} from './matching'
import { parseCsvText } from './parseFile'
import { extractCountryFromTitle, identityKey, normalizeCountryOfOrigin, parseTitle, sourceKey } from './productParse'

let seq = 0
function mkCatalog(title: string, extra: Partial<CatalogProduct> = {}): CatalogProduct {
  const p = parseTitle(title)
  return {
    id: 'mcat_' + ++seq,
    name: title,
    normalized_name: p.name,
    brand: null,
    manufacturer: null,
    country_of_origin: p.countryOfOrigin,
    strength_value: p.strengthValue,
    strength_unit: p.strengthUnit,
    weight_value: p.weightValue,
    weight_unit: p.weightUnit,
    pack_size: p.packSize,
    dosage_form: p.dosageForm,
    barcode: null,
    mfr_code: null,
    ...extra,
  }
}

function mkIncoming(title: string, extra: Partial<IncomingProduct> = {}): IncomingProduct {
  const p = parseTitle(title)
  return {
    title,
    normalizedName: p.name,
    supplierCode: null,
    barcode: null,
    mfrCode: null,
    brand: null,
    manufacturer: null,
    countryOfOrigin: p.countryOfOrigin,
    strengthValue: p.strengthValue,
    strengthUnit: p.strengthUnit,
    weightValue: p.weightValue,
    weightUnit: p.weightUnit,
    packSize: p.packSize,
    dosageForm: p.dosageForm,
    sourceKey: sourceKey(null, title),
    ...extra,
  }
}

describe('Feature 1 — Product Identification, Country Origin, Alias Reuse & Sync Performance', () => {
  it('1. Never auto-merges products from different or uncertain countries of origin', () => {
    expect(normalizeCountryOfOrigin('UK')).toBe('United Kingdom')
    expect(normalizeCountryOfOrigin('de')).toBe('Germany')
    expect(normalizeCountryOfOrigin('N/A')).toBeNull()
    expect(extractCountryFromTitle('Augmentin 625mg Tab (Germany)')?.country).toBe('Germany')
    expect(extractCountryFromTitle('Panadol 500mg Tab')).toBeNull()

    const pkProd = mkCatalog('Augmentin 625mg Tab (Pakistan)', {
      manufacturer: 'GlaxoSmithKline Pakistan (GSK)',
      country_of_origin: 'Pakistan',
    })
    const ukProd = mkCatalog('Augmentin 625mg Tab (UK)', {
      manufacturer: 'GlaxoSmithKline Pakistan (GSK)',
      country_of_origin: 'United Kingdom',
    })

    // Only Pakistan exists -> UK edition is flagged conflicting / possible match and NEVER auto-merged
    const idxPkOnly = buildIndex([pkProd], [], [])
    const resDiff = matchProduct(idxPkOnly, 'shopA', mkIncoming('Augmentin 625mg Tab (UK)', { manufacturer: 'GSK' }))
    expect(resDiff.productId).toBeNull()
    expect(resDiff.confidence).toBe('conflicting')
    expect(resDiff.matchLevel).toBe('possible_match')
    expect(resDiff.candidates[0]?.conflicts).toContain('country of origin')

    // Uncertain country (one side specifies Turkey, catalog has null country & different/unknown mfr) -> never auto-merge
    const noCtryProd = mkCatalog('Nexum 40mg Cap', { manufacturer: null, country_of_origin: null })
    const idxNoCtry = buildIndex([noCtryProd], [], [])
    const resUncertain = matchProduct(idxNoCtry, 'shopA', mkIncoming('Nexum 40mg Cap (Turkey)'))
    expect(resUncertain.productId).toBeNull()
    expect(resUncertain.confidence).toBe('needs_review')
    expect(resUncertain.matchLevel).toBe('possible_match')

    // When both Pakistan and UK products exist, UK matches UK cleanly with Strong match
    const idxBoth = buildIndex([pkProd, ukProd], [], [])
    const resExactCtry = matchProduct(idxBoth, 'shopA', mkIncoming('Augmentin 625mg Tab (UK)', { manufacturer: 'GSK' }))
    expect(resExactCtry.confidence).toBe('high')
    expect(resExactCtry.matchLevel).toBe('strong_match')
    expect(MATCH_LEVEL_LABEL[resExactCtry.matchLevel!]).toBe('Strong match')
    expect(resExactCtry.productId).toBe(ukProd.id)

    // identityKey keeps products from different countries distinct
    expect(
      identityKey({
        normalizedName: 'augmentin',
        strengthValue: 625,
        strengthUnit: 'mg',
        weightValue: null,
        weightUnit: null,
        packSize: null,
        dosageForm: 'tablet',
        manufacturer: 'GlaxoSmithKline Pakistan (GSK)',
        countryOfOrigin: 'Pakistan',
      }),
    ).not.toBe(
      identityKey({
        normalizedName: 'augmentin',
        strengthValue: 625,
        strengthUnit: 'mg',
        weightValue: null,
        weightUnit: null,
        packSize: null,
        dosageForm: 'tablet',
        manufacturer: 'GlaxoSmithKline Pakistan (GSK)',
        countryOfOrigin: 'United Kingdom',
      }),
    )
  })

  it('2. Distinguishes different manufacturers with similar medicine names and selects exact match when catalog has both', () => {
    const prodA = mkCatalog('Amoxil 500mg Cap', { manufacturer: 'Manufacturer Alpha' })
    const prodB = mkCatalog('Amoxil 500mg Cap', { manufacturer: 'Manufacturer Beta' })

    // Single product Alpha vs incoming Beta -> Possible match (never auto-merged)
    const rConflict = matchProduct(
      buildIndex([prodA], [], []),
      'shopA',
      mkIncoming('Amoxil 500mg Cap', { manufacturer: 'Manufacturer Beta' }),
    )
    expect(rConflict.productId).toBeNull()
    expect(rConflict.confidence).toBe('needs_review')
    expect(rConflict.matchLevel).toBe('possible_match')

    // Catalog has BOTH Alpha and Beta -> incoming specifying Alpha matches Alpha cleanly
    const rSpecific = matchProduct(
      buildIndex([prodA, prodB], [], []),
      'shopA',
      mkIncoming('Amoxil 500mg Cap', { manufacturer: 'Manufacturer Alpha' }),
    )
    expect(rSpecific.confidence).toBe('high')
    expect(rSpecific.productId).toBe(prodA.id)
  })

  it('3. Keeps different strengths, weights, dosage forms, and pack sizes strictly separate', () => {
    const tab500_10 = mkCatalog("Panadol 500mg Tab 10's")
    const idx = buildIndex([tab500_10], [], [])

    const diffStrength = matchProduct(idx, 'shopA', mkIncoming("Panadol 250mg Tab 10's"))
    expect(diffStrength.confidence).toBe('unmatched')
    expect(confidenceToMatchLevel(diffStrength.confidence)).toBe('new_product')

    const diffPack = matchProduct(idx, 'shopA', mkIncoming("Panadol 500mg Tab 20's"))
    expect(diffPack.confidence).toBe('unmatched')
    expect(diffPack.matchLevel).toBe('new_product')

    const diffForm = matchProduct(idx, 'shopA', mkIncoming("Panadol 500mg Syp 10's"))
    expect(diffForm.confidence).toBe('unmatched')
  })

  it('4. Reuses saved product_aliases & manufacturer_mappings across imports and prevents duplicate product creation', async () => {
    const boschProd = mkCatalog('Risek 40mg Cap', {
      manufacturer: 'Bosch Pharmaceuticals',
      country_of_origin: 'Pakistan',
    })
    const savedMappings: CatalogManufacturerMapping[] = [
      {
        pattern_key: manufacturerPatternKey('bosch omeprazole', 'Pakistan'),
        raw_name: 'BOSCH OMEPRAZOLE 40MG',
        manufacturer: 'Bosch Pharmaceuticals',
        country_of_origin: 'Pakistan',
        product_id: boschProd.id,
      },
    ]

    // Incoming row lacks Manufacturer column, uses supplier alias title -> auto-matched via alias without nagging
    const idx = buildIndex(
      [boschProd],
      [],
      [],
      [],
      undefined,
      [{ product_id: boschProd.id, shop_id: 'shop2', title: 'OMEPRAZOLE BOSCH 40 CAP' }],
      savedMappings,
    )

    const aliasHitSameShop = matchProduct(
      idx,
      'shop2',
      mkIncoming('OMEPRAZOLE BOSCH 40 CAP', { manufacturer: null, countryOfOrigin: 'Pakistan' }),
    )
    expect(aliasHitSameShop.confidence).toBe('exact')
    expect(aliasHitSameShop.matchLevel).toBe('exact_match')
    expect(aliasHitSameShop.productId).toBe(boschProd.id)

    const inferred = inferMappedManufacturer(
      idx,
      mkIncoming('BOSCH OMEPRAZOLE 40MG CAP', { manufacturer: null, countryOfOrigin: 'Pakistan' }),
    )
    expect(inferred?.manufacturer).toBe('Bosch Pharmaceuticals')

    // Never invents a manufacturer or country for unknown product
    const unknownInferred = inferMappedManufacturer(idx, mkIncoming('Totally Unknown Herb', { manufacturer: null }))
    expect(unknownInferred).toBeNull()

    // Duplicate rows inside same CSV + country column parsing + async chunked matcher parity
    const csv = [
      'ITEM NAME,RATE,COMPANY,COUNTRY',
      'Augmentin 625mg Tab,950,GSK,UK',
      'Augmentin 625mg Tab,950,GSK,UK',
      'Augmentin 625mg Tab,780,GSK,Pakistan',
    ].join('\n')
    const grid = parseCsvText(csv)
    const mapping = suggestMapping(grid[0])
    expect(mapping.country).toBe('COUNTRY')
    const built = buildRows(grid, mapping, DEFAULT_OPTIONS)
    expect(built.stats.valid).toBe(2)
    expect(built.stats.duplicate).toBe(1)

    const syncRes = runMatching(built.rows, idx, 'shopA')
    const progressCalls: number[] = []
    const asyncRes = await runMatchingAsync(built.rows, idx, 'shopA', (p) => progressCalls.push(p.pct))
    expect(progressCalls[progressCalls.length - 1]).toBe(100)
    expect(asyncRes.size).toBe(syncRes.size)

    // buildCommitPayload creates distinct identity keys per country and emits p_decisions manufacturer mappings
    const payload = buildCommitPayload(built.rows, asyncRes, [boschProd], idx)
    expect(payload.newProducts).toHaveLength(2)
    expect(payload.newProducts.map((n) => n.country_of_origin)).toEqual(['United Kingdom', 'Pakistan'])
    expect(payload.decisions.length).toBeGreaterThanOrEqual(2)
    expect(payload.decisions.every((d) => d.manufacturer === 'GlaxoSmithKline Pakistan (GSK)')).toBe(true)
  })
})
