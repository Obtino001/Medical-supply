// Extracts structured attributes (strength, weight/volume, pack size, dosage form) from a free-text product title
// and builds normalized names / identity keys. Pure functions, no I/O.

export interface ParsedProduct {
  rawTitle: string
  name: string // title with measures/pack/form tokens stripped, normalized
  strengthValue: number | null
  strengthUnit: string | null // mg | mcg | iu | %
  weightValue: number | null
  weightUnit: 'g' | 'ml' | null
  packSize: number | null
  dosageForm: string | null
}

const UNIT_MAP: Record<string, { unit: string; factor: number }> = {
  mg: { unit: 'mg', factor: 1 },
  mgs: { unit: 'mg', factor: 1 },
  mcg: { unit: 'mcg', factor: 1 },
  ug: { unit: 'mcg', factor: 1 },
  µg: { unit: 'mcg', factor: 1 },
  iu: { unit: 'iu', factor: 1 },
  '%': { unit: '%', factor: 1 },
  g: { unit: 'g', factor: 1 },
  gm: { unit: 'g', factor: 1 },
  gms: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  grams: { unit: 'g', factor: 1 },
  gr: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  kgs: { unit: 'g', factor: 1000 },
  ml: { unit: 'ml', factor: 1 },
  mls: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  ltr: { unit: 'ml', factor: 1000 },
  litre: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
}

const FORMS: Record<string, string> = {
  tab: 'tablet', tabs: 'tablet', tablet: 'tablet', tablets: 'tablet',
  cap: 'capsule', caps: 'capsule', capsule: 'capsule', capsules: 'capsule',
  syp: 'syrup', syrup: 'syrup', susp: 'suspension', suspension: 'suspension',
  inj: 'injection', injection: 'injection', amp: 'injection', vial: 'injection',
  cream: 'cream', crm: 'cream', oint: 'ointment', ointment: 'ointment', gel: 'gel', lotion: 'lotion',
  drops: 'drops', drop: 'drops', sachet: 'sachet', spray: 'spray', powder: 'powder', shampoo: 'shampoo', soap: 'soap',
}

const MEASURE_RE = /(\d+(?:[.,]\d+)?)\s*(mgs?|mcg|µg|ug|iu|%|gms?|grams?|gr|g|kgs?|mls?|ltr|litre|liter|l)(?![a-z])/gi

// Order matters: most specific first. Group 1 (and 2 for NxM) hold the numbers.
const PACK_RES: RegExp[] = [
  /\b(\d+)\s*x\s*(\d+)\b/i, // 10x10
  /\bpack\s*of\s*(\d+)\b/i,
  /\b(\d+)\s*(?:'s|’s|tabs?|tablets?|caps?|capsules?|pcs|pieces|pc|sachets?|vials?|amps?)(?![a-z])/i,
  /\bx\s*(\d+)\b/i,
]

export function toNumber(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

export function parseTitle(title: string): ParsedProduct {
  const raw = (title ?? '').toString()
  let work = ' ' + raw.replace(/\s+/g, ' ').trim() + ' '

  let strengthValue: number | null = null
  let strengthUnit: string | null = null
  let weightValue: number | null = null
  let weightUnit: 'g' | 'ml' | null = null

  // First strength-type and first weight-type measure win. "500mg/5ml" -> strength 500mg, volume 5ml.
  work = work.replace(MEASURE_RE, (m, num: string, unitRaw: string) => {
    const u = UNIT_MAP[unitRaw.toLowerCase()]
    if (!u) return m
    const value = toNumber(num)
    if (u.unit === 'g' || u.unit === 'ml') {
      if (weightValue === null) {
        weightValue = round(value * u.factor)
        weightUnit = u.unit
      }
    } else if (strengthValue === null) {
      strengthValue = value
      strengthUnit = u.unit
    }
    return ' '
  })

  let packSize: number | null = null
  for (const re of PACK_RES) {
    const m = re.exec(work)
    if (!m) continue
    const size = re === PACK_RES[0] ? Number(m[1]) * Number(m[2]) : Number(m[1])
    if (size > 0 && size < 100000) {
      packSize = size
      work = work.replace(m[0], ' ')
      break
    }
  }

  let dosageForm: string | null = null
  const words = work.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const kept: string[] = []
  for (const w of words) {
    if (FORMS[w]) {
      dosageForm ??= FORMS[w]
      continue
    }
    if (w === 'of' || w === 'pack' || w === 'pk') continue
    kept.push(w)
  }
  return {
    rawTitle: raw,
    name: kept.join(' ').trim(),
    strengthValue,
    strengthUnit,
    weightValue,
    weightUnit,
    packSize,
    dosageForm,
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function normalizeText(s: string | null | undefined): string {
  return (s ?? '').toString().toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Source key used to remember a human match decision for one supplier. */
export function sourceKey(code: string | null | undefined, title: string): string {
  const c = (code ?? '').toString().trim().toLowerCase()
  if (c) return 'code:' + c
  return 'title:' + title.toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface ProductIdentityInput {
  normalizedName: string
  strengthValue: number | null
  strengthUnit: string | null
  weightValue: number | null
  weightUnit: string | null
  packSize: number | null
  dosageForm: string | null
  manufacturer: string | null
}

/** Stable key: two products are the same purchase item only if every part of this key is equal. */
export function identityKey(p: ProductIdentityInput): string {
  return [
    p.normalizedName,
    p.strengthValue ?? '',
    p.strengthUnit ?? '',
    p.weightValue ?? '',
    p.weightUnit ?? '',
    p.packSize ?? '',
    p.dosageForm ?? '',
    normalizeText(p.manufacturer),
  ].join('|')
}

/** Human label of the variant part: "100g · 500mg · 10 pcs". */
export function variantLabel(p: {
  strength_value?: number | null
  strength_unit?: string | null
  weight_value?: number | null
  weight_unit?: string | null
  pack_size?: number | null
  dosage_form?: string | null
}): string {
  const parts: string[] = []
  if (p.strength_value != null) parts.push(`${p.strength_value}${p.strength_unit ?? ''}`)
  if (p.weight_value != null) parts.push(`${p.weight_value}${p.weight_unit ?? ''}`)
  if (p.pack_size != null) parts.push(`${p.pack_size} pcs`)
  if (p.dosage_form) parts.push(p.dosage_form)
  return parts.join(' · ')
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
export const naturalCompare = (a: string, b: string): number => collator.compare(a ?? '', b ?? '')

/** Numeric-aware compare for nullable numbers; nulls last. */
export function numCompare(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}
