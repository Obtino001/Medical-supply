// Product matching: decides whether an incoming supplier row is an existing canonical product.
// Rules:
// - Evaluates manufacturer, brand, normalized product name, strength, dosage form, pack size, country of origin, identifiers & aliases.
// - Never auto-merges products from different countries or uncertain country origin.
// - Never invents a manufacturer or country of origin.
// - Reuses confirmed match_decisions, product_aliases, and manufacturer_mappings across imports.

import { companyCompareKey, resolveCanonicalCompany } from './companies'
import { countryCompareKey, normalizeCountryOfOrigin, normalizeText } from './productParse'

export type Confidence = 'exact' | 'high' | 'needs_review' | 'unmatched' | 'conflicting'
export type MatchLevel = 'exact_match' | 'strong_match' | 'possible_match' | 'new_product'

export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  exact_match: 'Exact match',
  strong_match: 'Strong match',
  possible_match: 'Possible match',
  new_product: 'New product',
}

export function confidenceToMatchLevel(confidence: Confidence): MatchLevel {
  if (confidence === 'exact') return 'exact_match'
  if (confidence === 'high') return 'strong_match'
  if (confidence === 'unmatched') return 'new_product'
  return 'possible_match'
}

/** Workspace-configurable matching policy. Defaults are the safe ones. */
export interface MatchPolicy {
  /** auto-accept (High / Strong match) only if manufacturer is known on both sides and agrees */
  requireManufacturerAgreement: boolean
  /** a pack-size match + manufacturer match may count as strong evidence when no strength/weight exists */
  allowPackOnlyWhenManufacturerAgrees: boolean
}

export const DEFAULT_POLICY: MatchPolicy = { requireManufacturerAgreement: false, allowPackOnlyWhenManufacturerAgrees: true }

export interface CatalogProduct {
  id: string
  name: string
  normalized_name: string
  brand: string | null
  manufacturer: string | null
  country_of_origin?: string | null
  strength_value: number | null
  strength_unit: string | null
  weight_value: number | null
  weight_unit: string | null
  pack_size: number | null
  dosage_form: string | null
  barcode: string | null
  mfr_code: string | null
}

export interface CatalogIdentifier {
  product_id: string
  kind: 'barcode' | 'mfr_code' | 'supplier_code'
  value: string
  shop_id: string | null
}

export interface CatalogDecision {
  shop_id: string
  source_key: string
  product_id: string
}

export interface CatalogAlias {
  product_id: string
  shop_id: string | null
  title: string
}

export interface CatalogManufacturerMapping {
  pattern_key: string
  raw_name: string
  manufacturer: string
  country_of_origin?: string | null
  product_id?: string | null
}

export interface IncomingProduct {
  title: string
  normalizedName: string
  supplierCode: string | null
  barcode: string | null
  mfrCode: string | null
  brand: string | null
  manufacturer: string | null
  countryOfOrigin?: string | null
  strengthValue: number | null
  strengthUnit: string | null
  weightValue: number | null
  weightUnit: string | null
  packSize: number | null
  dosageForm: string | null
  sourceKey: string
}

export interface MatchCandidate {
  productId: string
  reason: string
  conflicts?: string[]
}

export interface MatchResult {
  confidence: Confidence
  matchLevel?: MatchLevel
  productId: string | null
  reason: string
  candidates: MatchCandidate[]
}

export interface MatchIndex {
  byName: Map<string, CatalogProduct[]>
  byToken: Map<string, CatalogProduct[]>
  byBarcode: Map<string, string[]>
  byMfrCode: Map<string, string[]>
  bySupplierCode: Map<string, string[]> // shopId|code
  byShopAlias: Map<string, string[]> // shopId|normalizedAliasTitle -> productIds
  byGlobalAlias: Map<string, string[]> // normalizedAliasTitle -> productIds
  decisions: Map<string, string> // shopId|sourceKey -> productId
  rejections: Map<string, Set<string>> // shopId|sourceKey -> rejected productIds
  manufacturerMappings: Map<string, CatalogManufacturerMapping> // pattern_key -> confirmed mapping
  policy: MatchPolicy
  byId: Map<string, CatalogProduct>
}

export interface CatalogRejection {
  shop_id: string
  source_key: string
  product_id: string
}

const clean = (s: string | null | undefined) => (s ?? '').toString().trim().toLowerCase()

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

export function tokens(name: string): string[] {
  return name.split(' ').filter((t) => t.length > 0)
}

/** Build deterministic pattern key for reusable product-to-manufacturer mappings. */
export function manufacturerPatternKey(normalizedName: string, countryOfOrigin?: string | null): string {
  const n = normalizeText(normalizedName)
  const c = countryCompareKey(countryOfOrigin)
  return c ? `name:${n}|country:${c}` : `name:${n}`
}

/** Country-aware exact title pattern key so products from different origins never overwrite each other's mappings. */
export function titlePatternKey(title: string, countryOfOrigin?: string | null): string {
  const t = clean(title).replace(/\s+/g, ' ')
  const c = countryCompareKey(countryOfOrigin)
  return c ? `title:${t}|country:${c}` : `title:${t}`
}

export function buildIndex(
  products: CatalogProduct[],
  identifiers: CatalogIdentifier[],
  decisions: CatalogDecision[],
  rejections: CatalogRejection[] = [],
  policy: MatchPolicy = DEFAULT_POLICY,
  aliases: CatalogAlias[] = [],
  mfrMappings: CatalogManufacturerMapping[] = [],
): MatchIndex {
  const idx: MatchIndex = {
    byName: new Map(),
    byToken: new Map(),
    byBarcode: new Map(),
    byMfrCode: new Map(),
    bySupplierCode: new Map(),
    byShopAlias: new Map(),
    byGlobalAlias: new Map(),
    decisions: new Map(),
    rejections: new Map(),
    manufacturerMappings: new Map(),
    policy,
    byId: new Map(),
  }

  for (const p of products) {
    idx.byId.set(p.id, p)
    push(idx.byName, p.normalized_name, p)
    for (const t of new Set(tokens(p.normalized_name))) if (t.length >= 3) push(idx.byToken, t, p)
    if (clean(p.barcode)) push(idx.byBarcode, clean(p.barcode), p.id)
    if (clean(p.mfr_code)) push(idx.byMfrCode, clean(p.mfr_code), p.id)
  }

  for (const i of identifiers) {
    const v = clean(i.value)
    if (!v) continue
    if (i.kind === 'barcode') push(idx.byBarcode, v, i.product_id)
    else if (i.kind === 'mfr_code') push(idx.byMfrCode, v, i.product_id)
    else push(idx.bySupplierCode, `${i.shop_id}|${v}`, i.product_id)
  }

  for (const a of aliases) {
    const nt = normalizeText(a.title)
    if (!nt) continue
    push(idx.byGlobalAlias, nt, a.product_id)
    if (a.shop_id) push(idx.byShopAlias, `${a.shop_id}|${nt}`, a.product_id)
  }

  for (const d of decisions) idx.decisions.set(`${d.shop_id}|${d.source_key}`, d.product_id)
  for (const r of rejections) {
    const k = `${r.shop_id}|${r.source_key}`
    const set = idx.rejections.get(k) ?? new Set<string>()
    set.add(r.product_id)
    idx.rejections.set(k, set)
  }

  for (const mm of mfrMappings) {
    const k = clean(mm.pattern_key)
    if (k && mm.manufacturer) idx.manufacturerMappings.set(k, mm)
  }

  return idx
}

/** Register a newly created product (and optional aliases/codes) into the matching index for subsequent rows. */
export function addToIndex(idx: MatchIndex, p: CatalogProduct, aliasTitle?: string, shopId?: string) {
  idx.byId.set(p.id, p)
  push(idx.byName, p.normalized_name, p)
  for (const t of new Set(tokens(p.normalized_name))) if (t.length >= 3) push(idx.byToken, t, p)
  if (clean(p.barcode)) push(idx.byBarcode, clean(p.barcode), p.id)
  if (clean(p.mfr_code)) push(idx.byMfrCode, clean(p.mfr_code), p.id)
  if (aliasTitle) {
    const nt = normalizeText(aliasTitle)
    if (nt) {
      push(idx.byGlobalAlias, nt, p.id)
      if (shopId) push(idx.byShopAlias, `${shopId}|${nt}`, p.id)
    }
  }
}

type Cmp = 'agree' | 'conflict' | 'unknown' | 'none'

function cmpNum(a: number | null, au: string | null, b: number | null, bu: string | null): Cmp {
  if (a == null && b == null) return 'none'
  if (a == null || b == null) return 'unknown'
  return a === b && clean(au) === clean(bu) ? 'agree' : 'conflict'
}

function cmpWeak(a: string | null | undefined, b: string | null | undefined): Cmp {
  const x = normalizeText(a), y = normalizeText(b)
  if (!x && !y) return 'none'
  if (!x || !y) return 'unknown'
  return x === y ? 'agree' : 'conflict'
}

function cmpCompany(a: string | null | undefined, b: string | null | undefined): Cmp {
  const x = companyCompareKey(a), y = companyCompareKey(b)
  if (!x && !y) return 'none'
  if (!x || !y) return 'unknown'
  return x === y ? 'agree' : 'conflict'
}

function cmpCountry(a: string | null | undefined, b: string | null | undefined): Cmp {
  const x = countryCompareKey(a), y = countryCompareKey(b)
  if (!x && !y) return 'none'
  if (!x || !y) return 'unknown'
  return x === y ? 'agree' : 'conflict'
}

interface Compared {
  strength: Cmp
  weight: Cmp
  pack: Cmp
  form: Cmp
  mfr: Cmp
  brand: Cmp
  country: Cmp
}

export function compareAttributes(i: IncomingProduct, p: CatalogProduct): Compared {
  let strength = cmpNum(i.strengthValue, i.strengthUnit, p.strength_value, p.strength_unit)
  let weight = cmpNum(i.weightValue, i.weightUnit, p.weight_value, p.weight_unit)
  // Crossed dimensions (one side only has a strength such as 100mg, the other only a weight such as 100g)
  // are different things, not merely "missing" data.
  if (strength === 'unknown' && weight === 'unknown') {
    const iStrengthOnly = i.strengthValue != null && i.weightValue == null
    const pStrengthOnly = p.strength_value != null && p.weight_value == null
    if (iStrengthOnly !== pStrengthOnly) { strength = 'conflict'; weight = 'conflict' }
  }
  return {
    strength,
    weight,
    pack: cmpNum(i.packSize, 'pc', p.pack_size, 'pc'),
    form: cmpWeak(i.dosageForm, p.dosage_form),
    mfr: cmpCompany(i.manufacturer, p.manufacturer),
    brand: cmpWeak(i.brand, p.brand),
    country: cmpCountry(i.countryOfOrigin, p.country_of_origin),
  }
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const uni = A.size + B.size - inter
  return uni === 0 ? 0 : inter / uni
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** Extract standalone numeric tokens (e.g. "125" in "acefyl 125 new") so different bare strengths never fuzzy-merge. */
function numericTokens(toks: string[]): string[] {
  return toks.filter((t) => /^\d+(?:[.,]\d+)?$/.test(t))
}

const CONFLICT_LABELS: Record<string, string> = {
  strength: 'strength',
  weight: 'grams / volume',
  pack: 'pack size',
  form: 'dosage form',
  mfr: 'manufacturer',
  country: 'country of origin',
}

/** Names of attributes that clearly contradict (both sides known and different). */
export function conflictingAttributes(i: IncomingProduct, p: CatalogProduct): string[] {
  const c = compareAttributes(i, p)
  const out: string[] = []
  for (const k of ['strength', 'weight', 'pack', 'form', 'mfr', 'country'] as const) {
    if (c[k] === 'conflict') out.push(CONFLICT_LABELS[k])
  }
  const bc = clean(i.barcode), pbc = clean(p.barcode)
  if (bc && pbc && bc !== pbc) out.push('barcode')
  const mc = clean(i.mfrCode), pmc = clean(p.mfr_code)
  if (mc && pmc && mc !== pmc) out.push('manufacturer code')
  return out
}

/**
 * Look up a previously confirmed manufacturer/country mapping for an incoming row
 * without ever inventing a value when no confirmed mapping exists.
 */
export function inferMappedManufacturer(
  idx: MatchIndex,
  inc: IncomingProduct,
): CatalogManufacturerMapping | null {
  if (inc.manufacturer) return null
  const ctryTitleKey = titlePatternKey(inc.title, inc.countryOfOrigin)
  const plainTitleKey = titlePatternKey(inc.title, null)
  const normKey = manufacturerPatternKey(inc.normalizedName, inc.countryOfOrigin)
  const fallbackNormKey = manufacturerPatternKey(inc.normalizedName, null)

  const candidates = [
    idx.manufacturerMappings.get(ctryTitleKey),
    idx.manufacturerMappings.get(plainTitleKey),
    idx.manufacturerMappings.get(normKey),
    // Fallback without country only if the stored mapping does not conflict on country
    idx.manufacturerMappings.get(fallbackNormKey),
  ]
  for (const hit of candidates) {
    if (!hit) continue
    if (inc.countryOfOrigin && hit.country_of_origin) {
      if (countryCompareKey(inc.countryOfOrigin) !== countryCompareKey(hit.country_of_origin)) continue
    }
    return hit
  }
  return null
}

function withLevel(res: Omit<MatchResult, 'matchLevel'>): MatchResult {
  return { ...res, matchLevel: confidenceToMatchLevel(res.confidence) }
}

export function matchProduct(idx: MatchIndex, shopId: string, incRaw: IncomingProduct): MatchResult {
  // Apply saved manufacturer mapping only when incoming row lacks one (never invents)
  const mappedMfr = !incRaw.manufacturer ? inferMappedManufacturer(idx, incRaw) : null
  const inc: IncomingProduct = mappedMfr
    ? {
        ...incRaw,
        manufacturer: resolveCanonicalCompany(mappedMfr.manufacturer) ?? mappedMfr.manufacturer,
        countryOfOrigin: incRaw.countryOfOrigin ?? mappedMfr.country_of_origin ?? null,
      }
    : incRaw

  const rejected = idx.rejections.get(`${shopId}|${inc.sourceKey}`)
  const isRejected = (id: string) => !!rejected && rejected.has(id)

  // 1. Saved human decision for this supplier (human confirmation outranks everything)
  const dec = idx.decisions.get(`${shopId}|${inc.sourceKey}`)
  if (dec && idx.byId.has(dec) && !isRejected(dec)) {
    return withLevel({ confidence: 'exact', productId: dec, reason: 'Previously confirmed match for this shop', candidates: [] })
  }

  // 2. Known identifiers (supplier code, barcode, manufacturer code). Never merge if attributes or country conflict.
  const codeChecks: [string, string[] | undefined][] = [
    ['Supplier product code', inc.supplierCode ? idx.bySupplierCode.get(`${shopId}|${clean(inc.supplierCode)}`) : undefined],
    ['Barcode', inc.barcode ? idx.byBarcode.get(clean(inc.barcode)) : undefined],
    ['Manufacturer code', inc.mfrCode ? idx.byMfrCode.get(clean(inc.mfrCode)) : undefined],
  ]
  for (const [label, hits] of codeChecks) {
    const ids = uniq((hits ?? []).filter((id) => !isRejected(id)))
    if (ids.length === 0) continue
    if (ids.length > 1) {
      // Narrow down when one candidate matches country/manufacturer while others conflict
      const compatible = ids.filter((id) => {
        const p = idx.byId.get(id)
        return p && conflictingAttributes(inc, p).filter((c) => c !== 'barcode' && c !== 'manufacturer code').length === 0
      })
      if (compatible.length === 1) {
        const p = idx.byId.get(compatible[0])!
        const c = compareAttributes(inc, p)
        if (c.country !== 'unknown' || c.mfr === 'agree') {
          return withLevel({ confidence: 'exact', productId: compatible[0], reason: `${label} matches`, candidates: [] })
        }
      }
      return withLevel({
        confidence: 'needs_review',
        productId: null,
        reason: `${label} matches ${ids.length} products`,
        candidates: ids.map((productId) => ({ productId, reason: `${label} match` })),
      })
    }
    const p = idx.byId.get(ids[0])
    const conflicts = p ? conflictingAttributes(inc, p).filter((c) => c !== 'barcode' && c !== 'manufacturer code') : []
    if (conflicts.length) {
      return withLevel({
        confidence: 'conflicting',
        productId: null,
        reason: `${label} matches "${p?.name}" but ${conflicts.join(', ')} differ`,
        candidates: [{ productId: ids[0], reason: `${label} match, conflicting ${conflicts.join(', ')}`, conflicts }],
      })
    }
    if (p) {
      const c = compareAttributes(inc, p)
      if (c.country === 'unknown' && c.mfr !== 'agree' && label === 'Supplier product code') {
        return withLevel({
          confidence: 'needs_review',
          productId: null,
          reason: `${label} matches "${p.name}", but country of origin is uncertain on one side`,
          candidates: [{ productId: p.id, reason: 'Country of origin missing on one side' }],
        })
      }
    }
    return withLevel({ confidence: 'exact', productId: ids[0], reason: `${label} matches`, candidates: [] })
  }

  // 3. Normalized product name + attribute comparison (strength, weight, pack, form, manufacturer, brand, country)
  const nameMatches = (idx.byName.get(inc.normalizedName) ?? []).filter((p) => !isRejected(p.id))
  const hasExactCountryMatch = Boolean(
    countryCompareKey(inc.countryOfOrigin) &&
      nameMatches.some((p) => {
        const c = compareAttributes(inc, p)
        return (
          c.strength !== 'conflict' &&
          c.weight !== 'conflict' &&
          c.pack !== 'conflict' &&
          c.form !== 'conflict' &&
          c.country === 'agree'
        )
      }),
  )
  const hasExactMfrMatch = Boolean(
    companyCompareKey(inc.manufacturer) &&
      nameMatches.some((p) => {
        const c = compareAttributes(inc, p)
        return (
          c.strength !== 'conflict' &&
          c.weight !== 'conflict' &&
          c.pack !== 'conflict' &&
          c.form !== 'conflict' &&
          c.country !== 'conflict' &&
          c.mfr === 'agree'
        )
      }),
  )

  const high: MatchCandidate[] = []
  const review: MatchCandidate[] = []
  const conflicting: MatchCandidate[] = []
  for (const p of nameMatches) {
    const c = compareAttributes(inc, p)
    if (c.strength === 'conflict' || c.weight === 'conflict' || c.pack === 'conflict' || c.form === 'conflict') continue // different variant: keep separate

    // If catalog already has a matching country SKU, ignore unrelated-country SKUs just like different pack/strength variants
    if (c.country === 'conflict' && hasExactCountryMatch) continue
    // If catalog already has a matching manufacturer SKU, don't let another manufacturer block it unless ambiguous
    if (c.mfr === 'conflict' && hasExactMfrMatch) continue

    const idConflicts = conflictingAttributes(inc, p).filter((x) => x === 'barcode' || x === 'manufacturer code')
    if (idConflicts.length) {
      conflicting.push({ productId: p.id, reason: `Same name and size but ${idConflicts.join(' and ')} differ`, conflicts: idConflicts })
      continue
    }

    if (c.country === 'conflict') {
      const incC = normalizeCountryOfOrigin(inc.countryOfOrigin) ?? inc.countryOfOrigin
      const pC = normalizeCountryOfOrigin(p.country_of_origin) ?? p.country_of_origin
      conflicting.push({
        productId: p.id,
        reason: `Different country of origin (${incC} vs ${pC})`,
        conflicts: ['country of origin'],
      })
      continue
    }

    const unknownMeasure = c.strength === 'unknown' || c.weight === 'unknown' || c.pack === 'unknown' || c.form === 'unknown'
    if (c.mfr === 'conflict') {
      review.push({ productId: p.id, reason: 'Same name but different manufacturer', conflicts: ['manufacturer'] })
    } else if (c.brand === 'conflict') {
      review.push({ productId: p.id, reason: 'Same name but different brand', conflicts: ['brand'] })
    } else if (c.country === 'unknown' && c.mfr !== 'agree') {
      // Never auto-merge products when country of origin is only specified on one side without manufacturer confirmation
      review.push({ productId: p.id, reason: 'Country of origin is specified on one side only — confirm if same origin' })
    } else if (unknownMeasure && !(idx.policy.allowPackOnlyWhenManufacturerAgrees && c.pack === 'agree' && c.mfr === 'agree')) {
      review.push({ productId: p.id, reason: 'Same name; strength / weight / pack / form missing on one side' })
    } else if (idx.policy.requireManufacturerAgreement && c.mfr !== 'agree') {
      review.push({ productId: p.id, reason: 'Policy requires a manufacturer match' })
    } else {
      const reasons = ['Same normalized product name']
      if (c.mfr === 'agree') reasons.push('manufacturer agrees')
      if (c.country === 'agree') reasons.push('same country of origin')
      high.push({ productId: p.id, reason: reasons.join(' · ') })
    }
  }

  if (high.length === 1 && review.length === 0 && conflicting.length === 0) {
    return withLevel({ confidence: 'high', productId: high[0].productId, reason: high[0].reason, candidates: [] })
  }
  if (conflicting.length > 0 && high.length === 0 && review.length === 0) {
    return withLevel({ confidence: 'conflicting', productId: null, reason: conflicting[0].reason, candidates: conflicting })
  }
  if (high.length + review.length + conflicting.length > 0) {
    return withLevel({
      confidence: conflicting.length > 0 && high.length === 0 ? 'conflicting' : 'needs_review',
      productId: null,
      reason: high.length > 1 ? 'Several products fit this row' : (review[0] ?? conflicting[0]).reason,
      candidates: [...high, ...review, ...conflicting],
    })
  }

  // 4. Saved product aliases (shop-level first, then workspace-level), respecting attribute/country safety
  const normAlias = normalizeText(inc.title)
  if (normAlias) {
    const shopHits = uniq((idx.byShopAlias.get(`${shopId}|${normAlias}`) ?? []).filter((id) => !isRejected(id)))
    const globalHits = uniq((idx.byGlobalAlias.get(normAlias) ?? []).filter((id) => !isRejected(id)))

    for (const [isShopScoped, aliasHits] of [[true, shopHits], [false, globalHits]] as const) {
      if (aliasHits.length === 0) continue
      const safeHits: CatalogProduct[] = []
      const warnHits: MatchCandidate[] = []
      for (const pid of aliasHits) {
        const p = idx.byId.get(pid)
        if (!p) continue
        const conflicts = conflictingAttributes(inc, p)
        const c = compareAttributes(inc, p)
        if (conflicts.length > 0) {
          warnHits.push({ productId: p.id, reason: `Saved alias for "${p.name}" but ${conflicts.join(', ')} differ`, conflicts })
        } else if (c.country === 'unknown' && c.mfr !== 'agree') {
          warnHits.push({ productId: p.id, reason: `Saved alias "${p.name}" — verify country of origin` })
        } else {
          safeHits.push(p)
        }
      }
      if (safeHits.length === 1 && warnHits.length === 0) {
        if (isShopScoped) {
          return withLevel({
            confidence: 'exact',
            productId: safeHits[0].id,
            reason: 'Matched saved supplier product alias',
            candidates: [],
          })
        }
        return withLevel({
          confidence: 'high',
          productId: safeHits[0].id,
          reason: 'Matched saved catalog alias',
          candidates: [],
        })
      }
      if (safeHits.length + warnHits.length > 0) {
        return withLevel({
          confidence: warnHits.length > 0 && safeHits.length === 0 ? 'conflicting' : 'needs_review',
          productId: null,
          reason: warnHits[0]?.reason ?? 'Saved alias matches multiple products',
          candidates: [
            ...safeHits.map((p) => ({ productId: p.id, reason: 'Saved product alias' })),
            ...warnHits,
          ],
        })
      }
    }
  }

  // 5. Fuzzy name: only ever a possible match suggestion (never auto-merged)
  const incTokens = tokens(inc.normalizedName)
  const incNums = numericTokens(incTokens)
  const pool = new Map<string, CatalogProduct>()
  for (const t of new Set(incTokens)) {
    if (t.length < 3) continue
    for (const p of idx.byToken.get(t) ?? []) {
      pool.set(p.id, p)
      if (pool.size > 400) break
    }
  }
  const fuzzy: { c: MatchCandidate; score: number }[] = []
  for (const p of pool.values()) {
    if (p.normalized_name === inc.normalizedName || isRejected(p.id)) continue
    const pTokens = tokens(p.normalized_name)
    const pNums = numericTokens(pTokens)
    // If both names contain bare numbers (e.g. "acefyl 125" vs "acefyl 250") and they differ, keep them separate
    if (incNums.length > 0 && pNums.length > 0 && incNums.join(',') !== pNums.join(',')) continue
    const score = jaccard(incTokens, pTokens)
    if (score < 0.6) continue
    const c = compareAttributes(inc, p)
    if (c.strength === 'conflict' || c.weight === 'conflict' || c.pack === 'conflict' || c.form === 'conflict') continue
    const conflicts = conflictingAttributes(inc, p)
    const countryDiff = c.country === 'conflict'
    fuzzy.push({
      c: {
        productId: p.id,
        reason: countryDiff ? `Similar name "${p.name}" (different country of origin)` : `Similar name "${p.name}"`,
        ...(conflicts.length ? { conflicts } : {}),
      },
      score: countryDiff ? score - 0.15 : score,
    })
  }
  if (fuzzy.length > 0) {
    fuzzy.sort((a, b) => b.score - a.score)
    return withLevel({
      confidence: 'needs_review',
      productId: null,
      reason: 'Similar name found',
      candidates: fuzzy.slice(0, 5).map((f) => f.c),
    })
  }

  return withLevel({ confidence: 'unmatched', productId: null, reason: 'No matching product', candidates: [] })
}
