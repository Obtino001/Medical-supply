// Product matching: decides whether an incoming supplier row is an existing canonical product.
// Rules: primary method is normalized product name + agreeing strength / formulation / quantity;
// strength / weight / pack / formulation conflicts always keep products separate;
// anything ambiguous is returned as "needs_review" and never merged silently.

import { normalizeText } from './productParse'

export type Confidence = 'exact' | 'high' | 'needs_review' | 'unmatched' | 'conflicting'

/** Workspace-configurable matching policy. Defaults are the safe ones. */
export interface MatchPolicy {
  /** auto-accept (High) only if manufacturer is known on both sides and agrees */
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

export interface IncomingProduct {
  title: string
  normalizedName: string
  supplierCode: string | null
  barcode: string | null
  mfrCode: string | null
  brand: string | null
  manufacturer: string | null
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
  decisions: Map<string, string> // shopId|sourceKey -> productId
  rejections: Map<string, Set<string>> // shopId|sourceKey -> rejected productIds
  policy: MatchPolicy
  byId: Map<string, CatalogProduct>
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

export interface CatalogRejection {
  shop_id: string
  source_key: string
  product_id: string
}

export function buildIndex(
  products: CatalogProduct[],
  identifiers: CatalogIdentifier[],
  decisions: CatalogDecision[],
  rejections: CatalogRejection[] = [],
  policy: MatchPolicy = DEFAULT_POLICY,
): MatchIndex {
  const idx: MatchIndex = {
    byName: new Map(), byToken: new Map(), byBarcode: new Map(), byMfrCode: new Map(),
    bySupplierCode: new Map(), decisions: new Map(), rejections: new Map(), policy, byId: new Map(),
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
  for (const d of decisions) idx.decisions.set(`${d.shop_id}|${d.source_key}`, d.product_id)
  for (const r of rejections) {
    const k = `${r.shop_id}|${r.source_key}`
    const set = idx.rejections.get(k) ?? new Set<string>()
    set.add(r.product_id)
    idx.rejections.set(k, set)
  }
  return idx
}

/** Register a product created during the current import so later rows in the same file can reuse it. */
export function addToIndex(idx: MatchIndex, p: CatalogProduct) {
  idx.byId.set(p.id, p)
  push(idx.byName, p.normalized_name, p)
  for (const t of new Set(tokens(p.normalized_name))) if (t.length >= 3) push(idx.byToken, t, p)
}

type Cmp = 'agree' | 'conflict' | 'unknown' | 'none'

function cmpNum(a: number | null, au: string | null, b: number | null, bu: string | null): Cmp {
  if (a == null && b == null) return 'none'
  if (a == null || b == null) return 'unknown'
  return a === b && clean(au) === clean(bu) ? 'agree' : 'conflict'
}

function cmpWeak(a: string | null, b: string | null): Cmp {
  const x = normalizeText(a), y = normalizeText(b)
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
    mfr: cmpWeak(i.manufacturer, p.manufacturer),
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
  strength: 'strength', weight: 'grams / volume', pack: 'pack size', form: 'dosage form', mfr: 'manufacturer',
}

/** Names of attributes that clearly contradict (both sides known and different). */
export function conflictingAttributes(i: IncomingProduct, p: CatalogProduct): string[] {
  const c = compareAttributes(i, p)
  const out: string[] = []
  for (const k of ['strength', 'weight', 'pack', 'form', 'mfr'] as const) if (c[k] === 'conflict') out.push(CONFLICT_LABELS[k])
  const bc = clean(i.barcode), pbc = clean(p.barcode)
  if (bc && pbc && bc !== pbc) out.push('barcode')
  const mc = clean(i.mfrCode), pmc = clean(p.mfr_code)
  if (mc && pmc && mc !== pmc) out.push('manufacturer code')
  return out
}

export function matchProduct(idx: MatchIndex, shopId: string, inc: IncomingProduct): MatchResult {
  const rejected = idx.rejections.get(`${shopId}|${inc.sourceKey}`)
  const isRejected = (id: string) => !!rejected && rejected.has(id)

  // 1. Saved human decision for this supplier (a human confirmation outranks everything)
  const dec = idx.decisions.get(`${shopId}|${inc.sourceKey}`)
  if (dec && idx.byId.has(dec) && !isRejected(dec)) {
    return { confidence: 'exact', productId: dec, reason: 'Previously confirmed match for this shop', candidates: [] }
  }

  // 2. Known identifiers. Accepted only if the remaining attributes do not contradict the product.
  const codeChecks: [string, string[] | undefined][] = [
    ['Supplier product code', inc.supplierCode ? idx.bySupplierCode.get(`${shopId}|${clean(inc.supplierCode)}`) : undefined],
    ['Barcode', inc.barcode ? idx.byBarcode.get(clean(inc.barcode)) : undefined],
    ['Manufacturer code', inc.mfrCode ? idx.byMfrCode.get(clean(inc.mfrCode)) : undefined],
  ]
  for (const [label, hits] of codeChecks) {
    const ids = uniq((hits ?? []).filter((id) => !isRejected(id)))
    if (ids.length === 0) continue
    if (ids.length > 1) {
      return {
        confidence: 'needs_review', productId: null, reason: `${label} matches ${ids.length} products`,
        candidates: ids.map((productId) => ({ productId, reason: `${label} match` })),
      }
    }
    const p = idx.byId.get(ids[0])
    const conflicts = p ? conflictingAttributes(inc, p).filter((c) => c !== 'barcode' && c !== 'manufacturer code') : []
    if (conflicts.length) {
      return {
        confidence: 'conflicting', productId: null,
        reason: `${label} matches "${p?.name}" but ${conflicts.join(', ')} differ`,
        candidates: [{ productId: ids[0], reason: `${label} match, conflicting ${conflicts.join(', ')}`, conflicts }],
      }
    }
    return { confidence: 'exact', productId: ids[0], reason: `${label} matches`, candidates: [] }
  }

  // 3. Normalized product name + attribute comparison (primary market matching method)
  const high: MatchCandidate[] = []
  const review: MatchCandidate[] = []
  const conflicting: MatchCandidate[] = []
  for (const p of idx.byName.get(inc.normalizedName) ?? []) {
    if (isRejected(p.id)) continue
    const c = compareAttributes(inc, p)
    if (c.strength === 'conflict' || c.weight === 'conflict' || c.pack === 'conflict' || c.form === 'conflict') continue // different variant: keep separate
    const idConflicts = conflictingAttributes(inc, p).filter((x) => x === 'barcode' || x === 'manufacturer code')
    if (idConflicts.length) {
      conflicting.push({ productId: p.id, reason: `Same name and size but ${idConflicts.join(' and ')} differ`, conflicts: idConflicts })
      continue
    }
    const unknownMeasure = c.strength === 'unknown' || c.weight === 'unknown' || c.pack === 'unknown' || c.form === 'unknown'
    if (c.mfr === 'conflict') review.push({ productId: p.id, reason: 'Same name but different manufacturer', conflicts: ['manufacturer'] })
    else if (unknownMeasure) review.push({ productId: p.id, reason: 'Same name; strength / weight / pack / form missing on one side' })
    else if (idx.policy.requireManufacturerAgreement && c.mfr !== 'agree') review.push({ productId: p.id, reason: 'Policy requires a manufacturer match' })
    else high.push({ productId: p.id, reason: 'Same normalized product name' })
  }
  if (high.length === 1 && review.length === 0 && conflicting.length === 0) {
    return { confidence: 'high', productId: high[0].productId, reason: high[0].reason, candidates: [] }
  }
  if (conflicting.length > 0 && high.length === 0) {
    return { confidence: 'conflicting', productId: null, reason: conflicting[0].reason, candidates: [...conflicting, ...review] }
  }
  if (high.length + review.length + conflicting.length > 0) {
    return {
      confidence: 'needs_review', productId: null,
      reason: high.length > 1 ? 'Several products fit this row' : (review[0] ?? conflicting[0]).reason,
      candidates: [...high, ...review, ...conflicting],
    }
  }

  // 4. Fuzzy name: only ever a suggestion (never auto-merged)
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
    fuzzy.push({ c: { productId: p.id, reason: `Similar name "${p.name}"` }, score })
  }
  if (fuzzy.length > 0) {
    fuzzy.sort((a, b) => b.score - a.score)
    return { confidence: 'needs_review', productId: null, reason: 'Similar name found', candidates: fuzzy.slice(0, 5).map((f) => f.c) }
  }
  return { confidence: 'unmatched', productId: null, reason: 'No matching product', candidates: [] }
}
