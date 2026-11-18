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
  countryOfOrigin: string | null
}

const COUNTRY_SYNONYMS: Record<string, string> = {
  pk: 'Pakistan', pak: 'Pakistan', pakistan: 'Pakistan',
  uk: 'United Kingdom', gb: 'United Kingdom', england: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom', 'united kingdom': 'United Kingdom',
  us: 'USA', usa: 'USA', america: 'USA', 'united states': 'USA', 'united states of america': 'USA',
  de: 'Germany', ger: 'Germany', germany: 'Germany', deutschland: 'Germany',
  ch: 'Switzerland', swiss: 'Switzerland', switzerland: 'Switzerland',
  fr: 'France', france: 'France', french: 'France',
  it: 'Italy', italy: 'Italy', italian: 'Italy',
  tr: 'Turkey', turkey: 'Turkey', turkiye: 'Turkey',
  cn: 'China', china: 'China', prc: 'China',
  in: 'India', ind: 'India', india: 'India',
  jp: 'Japan', jpn: 'Japan', japan: 'Japan',
  kr: 'South Korea', korea: 'South Korea', 'south korea': 'South Korea',
  es: 'Spain', spain: 'Spain',
  be: 'Belgium', belgium: 'Belgium',
  nl: 'Netherlands', holland: 'Netherlands', netherlands: 'Netherlands',
  ie: 'Ireland', ireland: 'Ireland',
  dk: 'Denmark', denmark: 'Denmark',
  se: 'Sweden', sweden: 'Sweden',
  at: 'Austria', austria: 'Austria',
  ae: 'UAE', uae: 'UAE', dubai: 'UAE', 'united arab emirates': 'UAE',
  sa: 'Saudi Arabia', ksa: 'Saudi Arabia', 'saudi arabia': 'Saudi Arabia',
  eg: 'Egypt', egypt: 'Egypt',
  bd: 'Bangladesh', bangladesh: 'Bangladesh',
  my: 'Malaysia', malaysia: 'Malaysia',
  id: 'Indonesia', indonesia: 'Indonesia',
  th: 'Thailand', thailand: 'Thailand',
  ca: 'Canada', can: 'Canada', canada: 'Canada',
  au: 'Australia', aus: 'Australia', australia: 'Australia',
  sg: 'Singapore', singapore: 'Singapore',
  pt: 'Portugal', portugal: 'Portugal',
  gr: 'Greece', greece: 'Greece',
  pl: 'Poland', poland: 'Poland',
  hu: 'Hungary', hungary: 'Hungary',
  cz: 'Czech Republic', 'czech republic': 'Czech Republic',
  jo: 'Jordan', jordan: 'Jordan',
  ir: 'Iran', iran: 'Iran',
}

export const COMMON_COUNTRIES = [
  'Pakistan',
  'Germany',
  'United Kingdom',
  'Switzerland',
  'USA',
  'France',
  'Italy',
  'Turkey',
  'Japan',
  'South Korea',
  'Spain',
  'Belgium',
  'Netherlands',
  'Ireland',
  'Denmark',
  'India',
  'China',
  'UAE',
  'Saudi Arabia',
  'Egypt',
  'Bangladesh',
  'Malaysia',
  'Indonesia',
  'Canada',
] as const

const COUNTRY_PLACEHOLDERS = new Set(['', '-', '--', 'n a', 'na', 'nil', 'none', 'unknown', 'other', 'local', 'imported'])

/** Canonicalize an explicit country string without inventing a country for blank/placeholder values. */
export function normalizeCountryOfOrigin(raw: string | null | undefined, knownOnly = false): string | null {
  if (!raw) return null
  const clean = normalizeHomoglyphs(raw)
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean || COUNTRY_PLACEHOLDERS.has(clean)) return null
  const hit = COUNTRY_SYNONYMS[clean]
  if (hit) return hit
  if (knownOnly) return null
  return clean.replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

/** Extract an unambiguous explicit country marker from a medicine title (e.g. "(Germany)", "(UK)", "Made in Turkey"). */
export function extractCountryFromTitle(title: string | null | undefined): { country: string; matchedSpan: string } | null {
  const s = normalizeHomoglyphs(title ?? '')
  if (!s.trim()) return null

  const madeInRe = /\b(?:made\s+in|origin\s*:?|product\s+of)\s+([A-Za-z][A-Za-z.\s]{1,24}?)(?=[,.;)\]]|\s*$)/gi
  let m: RegExpExecArray | null
  while ((m = madeInRe.exec(s)) !== null) {
    const c = normalizeCountryOfOrigin(m[1], true)
    if (c) return { country: c, matchedSpan: m[0] }
  }

  const parenRe = /[[(]\s*([A-Za-z][A-Za-z.\s]{1,24})\s*[\])]/g
  while ((m = parenRe.exec(s)) !== null) {
    const inner = m[1].trim()
    // Avoid ambiguous single 2-letter codes like "(IN)" matching prepositions or abbreviations unless clear
    if (inner.length === 2 && !/^(uk|us|pk|de|ch|fr|it|tr|cn|jp|kr|es|be|nl|ie|dk|se|at|ca|au|sg|ae|sa|eg)$/i.test(inner)) continue
    const c = normalizeCountryOfOrigin(inner, true)
    if (c) return { country: c, matchedSpan: m[0] }
  }

  // Also check explicit trailing full country name (min 4 chars) only when at end after dash/comma/space e.g. "Panadol 500mg - Germany"
  const tailFullRe = /(?:^|[\s\-,/])(Pakistan|Germany|Switzerland|United Kingdom|France|Italy|Turkey|Japan|South Korea|Spain|Belgium|Netherlands|Ireland|Denmark|Sweden|Austria|Bangladesh|Malaysia|Indonesia|Thailand|Canada|Australia|Singapore|USA|U\.S\.A\.|U\.K\.)\s*$/i
  const tm = tailFullRe.exec(s)
  if (tm) {
    const c = normalizeCountryOfOrigin(tm[1], true)
    if (c) return { country: c, matchedSpan: tm[1] }
  }

  return null
}

/** Normalized lowercase comparison key for country of origin. */
export function countryCompareKey(raw: string | null | undefined): string {
  const c = normalizeCountryOfOrigin(raw)
  return c ? c.toLowerCase() : ''
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

const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic lookalikes
  А: 'A', а: 'a', В: 'B', в: 'b', С: 'C', с: 'c', Е: 'E', е: 'e',
  Н: 'H', н: 'h', І: 'I', і: 'i', Ј: 'J', ј: 'j', К: 'K', к: 'k',
  М: 'M', м: 'm', О: 'O', о: 'o', Р: 'P', р: 'p', Ѕ: 'S', ѕ: 's',
  Т: 'T', т: 't', У: 'Y', у: 'y', Х: 'X', х: 'x',
  // Greek lookalikes
  Α: 'A', α: 'a', Β: 'B', β: 'b', Ε: 'E', ε: 'e', Ζ: 'Z', ζ: 'z',
  Η: 'H', η: 'h', Ι: 'I', ι: 'i', Κ: 'K', κ: 'k', Μ: 'M',
  Ν: 'N', ν: 'n', Ο: 'O', ο: 'o', Ρ: 'P', ρ: 'p', Τ: 'T', τ: 't',
  Υ: 'Y', υ: 'y', Χ: 'X', χ: 'x',
}

const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join('')}]`, 'g')

/** Transliterate Cyrillic/Greek OCR lookalike characters to standard Latin ASCII. */
export function normalizeHomoglyphs(s: string | null | undefined): string {
  if (!s) return ''
  return s.toString().replace(HOMOGLYPH_RE, (ch) => HOMOGLYPH_MAP[ch] ?? ch)
}

const FORMS: Record<string, string> = {
  tab: 'tablet', tabs: 'tablet', tablet: 'tablet', tablets: 'tablet', tabb: 'tablet', tba: 'tablet',
  cap: 'capsule', caps: 'capsule', capsule: 'capsule', capsules: 'capsule',
  syp: 'syrup', syrup: 'syrup', syrups: 'syrup', botl: 'syrup', botle: 'syrup', btl: 'syrup',
  susp: 'suspension', suspension: 'suspension',
  inj: 'injection', injs: 'injection', injection: 'injection', injections: 'injection', amp: 'injection', amps: 'injection', vial: 'injection', vials: 'injection', vail: 'injection',
  cream: 'cream', crm: 'cream', crem: 'cream', crea: 'cream', oint: 'ointment', ointment: 'ointment', gel: 'gel', lotion: 'lotion', lot: 'lotion',
  drops: 'drops', drop: 'drops', drp: 'drops',
  sachet: 'sachet', sachets: 'sachet', scheet: 'sachet', sahet: 'sachet', sach: 'sachet', sch: 'sachet',
  spray: 'spray', powder: 'powder',
  shampoo: 'shampoo', soap: 'soap', inf: 'infusion', infusion: 'infusion', inh: 'inhaler', inhaler: 'inhaler',
}

const MEASURE_RE = /(?<![a-z0-9])(\d+(?:[.,]\d+)?)[\s-]*(mgs?|mcg|µg|ug|iu|%|gms?|grams?|gr|g|kgs?|mls?|ltr|litre|liter|l)(?![a-z])/gi

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
  const raw = normalizeHomoglyphs((title ?? '').toString())
  const countryHit = extractCountryFromTitle(raw)
  const scrubbed = countryHit ? raw.replace(countryHit.matchedSpan, ' ') : raw
  let work = ' ' + scrubbed.replace(/\s+/g, ' ').trim() + ' '

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
    countryOfOrigin: countryHit?.country ?? null,
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function normalizeText(s: string | null | undefined): string {
  return normalizeHomoglyphs(s ?? '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Source key used to remember a human match decision for one supplier. */
export function sourceKey(code: string | null | undefined, title: string): string {
  const c = normalizeHomoglyphs(code ?? '').trim().toLowerCase()
  if (c) return 'code:' + c
  return 'title:' + normalizeHomoglyphs(title).trim().toLowerCase().replace(/\s+/g, ' ')
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
  countryOfOrigin?: string | null
}

/** Stable key: two products are the same purchase item only if every part of this key is equal. */
export function identityKey(p: ProductIdentityInput): string {
  const parts = [
    p.normalizedName,
    p.strengthValue ?? '',
    p.strengthUnit ?? '',
    p.weightValue ?? '',
    p.weightUnit ?? '',
    p.packSize ?? '',
    p.dosageForm ?? '',
    normalizeText(p.manufacturer),
  ]
  const ctry = countryCompareKey(p.countryOfOrigin)
  if (ctry) parts.push(ctry)
  return parts.join('|')
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
