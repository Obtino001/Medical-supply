// Pakistan Pharmaceutical Companies registry, alias canonicalization, and smart catalog categorization.
// Pure functions — no I/O.
import { normalizeHomoglyphs } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

export interface PharmaCompanyDef {
  id: string
  name: string
  shortName: string
  /** 1-based rank in the user's Top 50 Pakistan Pharmaceutical Companies list, or null for other companies */
  top50Rank: number | null
  aliases: string[]
  /** Explicit short codes used inside parentheses or product titles, e.g. "(CCL)", "(AGP)" */
  titleTags?: string[]
}

/**
 * Top 50 Pharmaceutical Companies of Pakistan (curated from the user's list; duplicate rows #5/#21 The Searle Company
 * and #18/#31 Barrett Hodgson collapse cleanly to one canonical entry each with their primary rank preserved)
 * followed by widely traded Pakistani & multinational pharma companies seen on wholesale price lists.
 */
export const PHARMA_COMPANIES: PharmaCompanyDef[] = [
  // ---- Top 50 Pakistan Pharmaceutical Companies
  { id: 'getz-pharma', name: 'Getz Pharma', shortName: 'Getz', top50Rank: 1, aliases: ['getz', 'getz pharma'], titleTags: ['getz'] },
  { id: 'sami-pharmaceuticals', name: 'Sami Pharmaceuticals', shortName: 'Sami', top50Rank: 2, aliases: ['sami', 'sami pharma', 'sami pharmaceuticals'], titleTags: ['sami'] },
  {
    id: 'abbott-laboratories-pakistan',
    name: 'Abbott Laboratories Pakistan',
    shortName: 'Abbott',
    top50Rank: 3,
    aliases: ['abbott', 'abbot', 'abbott labs', 'abbott laboratories', 'abbott laboratories pakistan', 'abbott pharmanet', 'abbott udl'],
    titleTags: ['abbott', 'abbot'],
  },
  {
    id: 'glaxosmithkline-pakistan',
    name: 'GlaxoSmithKline Pakistan (GSK)',
    shortName: 'GSK',
    top50Rank: 4,
    aliases: ['gsk', 'glaxosmithkline', 'glaxosmithkline pakistan', 'glaxo smithkline', 'glaxo', 'beecham', 'smithkline', 'glaxo wellcome'],
    titleTags: ['gsk', 'beecham'],
  },
  { id: 'the-searle-company', name: 'The Searle Company', shortName: 'Searle', top50Rank: 5, aliases: ['searle', 'searle pharma', 'the searle company', 'searle company'], titleTags: ['searle'] },
  { id: 'martin-dow', name: 'Martin Dow', shortName: 'Martin Dow', top50Rank: 6, aliases: ['martin dow', 'martindow', 'martin dow marker', 'martin dow pharmaceuticals'], titleTags: ['martin dow', 'mdm'] },
  { id: 'hilton-pharma', name: 'Hilton Pharma', shortName: 'Hilton', top50Rank: 7, aliases: ['hilton', 'hilton pharma'], titleTags: ['hilton'] },
  { id: 'high-q-international', name: 'High-Q International', shortName: 'High-Q', top50Rank: 8, aliases: ['high q', 'highq', 'high q international', 'high q pharma'], titleTags: ['high q', 'highq'] },
  { id: 'haleon-pakistan', name: 'Haleon Pakistan', shortName: 'Haleon', top50Rank: 9, aliases: ['haleon', 'haleon pakistan', 'gsk consumer', 'gsk ch'], titleTags: ['haleon'] },
  { id: 'obs-pakistan', name: 'OBS Pakistan', shortName: 'OBS', top50Rank: 10, aliases: ['obs', 'obs pakistan', 'obs pharma', 'obs agp'], titleTags: ['obs'] },
  { id: 'highnoon-laboratories', name: 'Highnoon Laboratories', shortName: 'Highnoon', top50Rank: 11, aliases: ['highnoon', 'high noon', 'highnoon laboratory', 'highnoon laboratories'], titleTags: ['highnoon'] },
  { id: 'ferozsons-laboratories', name: 'Ferozsons Laboratories', shortName: 'Ferozsons', top50Rank: 12, aliases: ['ferozsons', 'feroz sons', 'ferozson', 'ferozsons laboratories'], titleTags: ['ferozsons', 'feroz'] },
  { id: 'agp-limited', name: 'AGP Limited', shortName: 'AGP', top50Rank: 13, aliases: ['agp', 'a g p', 'agp limited', 'agp pharma'], titleTags: ['agp'] },
  { id: 'ccl-pharmaceuticals', name: 'CCL Pharmaceuticals', shortName: 'CCL', top50Rank: 14, aliases: ['ccl', 'ccl pharma', 'ccl pharmaceuticals'], titleTags: ['ccl'] },
  { id: 'atco-laboratories', name: 'ATCO Laboratories', shortName: 'ATCO', top50Rank: 15, aliases: ['atco', 'atco laboratory', 'atco laboratories', 'atco pharma'], titleTags: ['atco'] },
  { id: 'bosch-pharmaceuticals', name: 'Bosch Pharmaceuticals', shortName: 'Bosch', top50Rank: 16, aliases: ['bosch', 'bosch pharma', 'bosch pharmaceuticals'], titleTags: ['bosch'] },
  { id: 'pharmevo', name: 'PharmEvo', shortName: 'PharmEvo', top50Rank: 17, aliases: ['pharmevo', 'pharm evo', 'pharmevo pvt ltd'], titleTags: ['pharmevo'] },
  {
    id: 'barrett-hodgson-pakistan',
    name: 'Barrett Hodgson Pakistan',
    shortName: 'Barrett Hodgson',
    top50Rank: 18,
    aliases: ['barrett', 'barrett hodgson', 'barrett hodgson pakistan', 'barrett hodson'],
    titleTags: ['barrett', 'bh'],
  },
  { id: 'sanofi-pakistan', name: 'Sanofi Pakistan', shortName: 'Sanofi', top50Rank: 19, aliases: ['sanofi', 'sanofi pakistan', 'aventis', 'sanofi aventis'], titleTags: ['sanofi', 'aventis'] },
  { id: 'hoechst-pakistan', name: 'Hoechst Pakistan', shortName: 'Hoechst', top50Rank: 20, aliases: ['hoechst', 'hoechst pakistan'], titleTags: ['hoechst'] },
  // (#21 The Searle Company merges with #5 above)
  { id: 'citi-pharma', name: 'Citi Pharma', shortName: 'Citi Pharma', top50Rank: 22, aliases: ['citi', 'citi pharma', 'city pharma'], titleTags: ['citi pharma'] },
  { id: 'macter-international', name: 'Macter International', shortName: 'Macter', top50Rank: 23, aliases: ['macter', 'macter international'], titleTags: ['macter'] },
  { id: 'otsuka-pakistan', name: 'Otsuka Pakistan', shortName: 'Otsuka', top50Rank: 24, aliases: ['otsuka', 'otsuka pakistan'], titleTags: ['otsuka'] },
  { id: 'nabiqasim-industries', name: 'Nabiqasim Industries', shortName: 'Nabiqasim', top50Rank: 25, aliases: ['nabiqasim', 'nabi qasim', 'nabiqasim industries', 'n q', 'nq'], titleTags: ['nabiqasim', 'nq'] },
  { id: 'sante', name: 'Sante (Pvt.) Ltd.', shortName: 'Sante', top50Rank: 26, aliases: ['sante', 'sante pharma', 'sante pvt ltd'], titleTags: ['sante'] },
  { id: 'genix-pharma', name: 'Genix Pharma', shortName: 'Genix', top50Rank: 27, aliases: ['genix', 'genix pharma'], titleTags: ['genix'] },
  { id: 'brookes-pharma', name: 'Brookes Pharma', shortName: 'Brookes', top50Rank: 28, aliases: ['brookes', 'brookes pharma', 'brookes laboratories'], titleTags: ['brookes'] },
  { id: 'pharmedic-laboratories', name: 'Pharmedic Laboratories', shortName: 'Pharmedic', top50Rank: 29, aliases: ['pharmedic', 'pharmedic laboratories'], titleTags: ['pharmedic'] },
  { id: 'helix-pharma', name: 'Helix Pharma', shortName: 'Helix', top50Rank: 30, aliases: ['helix', 'helix pharma'], titleTags: ['helix'] },
  // (#31 Barrett Hodgson merges with #18 above)
  { id: 'schazoo-pharmaceuticals', name: 'Schazoo Pharmaceuticals', shortName: 'Schazoo', top50Rank: 32, aliases: ['schazoo', 'schazoo pharmaceuticals', 'schazoo zaka'], titleTags: ['schazoo'] },
  { id: 'pharmatec-pakistan', name: 'Pharmatec Pakistan', shortName: 'Pharmatec', top50Rank: 33, aliases: ['pharmatec', 'pharmatec pakistan'], titleTags: ['pharmatec'] },
  { id: 'novamed-pharmaceuticals', name: 'NovaMed Pharmaceuticals', shortName: 'NovaMed', top50Rank: 34, aliases: ['novamed', 'nova med', 'novamed pharmaceuticals'], titleTags: ['novamed'] },
  { id: 'indus-pharma', name: 'Indus Pharma', shortName: 'Indus', top50Rank: 35, aliases: ['indus', 'indus pharma'], titleTags: ['indus'] },
  { id: 'medisure-laboratories', name: 'Medisure Laboratories', shortName: 'Medisure', top50Rank: 36, aliases: ['medisure', 'medisure laboratories', 'medisure pharma'], titleTags: ['medisure'] },
  { id: 'popular-pharmaceuticals', name: 'Popular Pharmaceuticals', shortName: 'Popular', top50Rank: 37, aliases: ['popular', 'popular pharma', 'popular pharmaceuticals'], titleTags: ['popular pharma'] },
  { id: 'zafa-pharmaceutical-laboratories', name: 'Zafa Pharmaceutical Laboratories', shortName: 'Zafa', top50Rank: 38, aliases: ['zafa', 'zafa pharma', 'zafa pharmaceutical laboratories', 'zafa laboratories'], titleTags: ['zafa'] },
  { id: 'global-pharmaceuticals', name: 'Global Pharmaceuticals', shortName: 'Global', top50Rank: 39, aliases: ['global', 'global pharma', 'global pharmaceuticals'], titleTags: ['global pharma'] },
  { id: 'remington-pharmaceuticals', name: 'Remington Pharmaceuticals', shortName: 'Remington', top50Rank: 40, aliases: ['remington', 'remington pharma', 'remington pharmaceuticals'], titleTags: ['remington'] },
  { id: 'wilshire-laboratories', name: 'Wilshire Laboratories', shortName: 'Wilshire', top50Rank: 41, aliases: ['wilshire', 'wilshire labs', 'wilshire laboratories'], titleTags: ['wilshire'] },
  { id: 'pacific-pharmaceuticals', name: 'Pacific Pharmaceuticals', shortName: 'Pacific', top50Rank: 42, aliases: ['pacific', 'pacific pharma', 'pacific pharmaceuticals', 'lepetit pacific'], titleTags: ['pacific'] },
  { id: 'lederle-laboratories', name: 'Lederle Laboratories', shortName: 'Lederle', top50Rank: 43, aliases: ['lederle', 'lederle laboratories'], titleTags: ['lederle'] },
  { id: 'roche-pakistan', name: 'Roche Pakistan', shortName: 'Roche', top50Rank: 44, aliases: ['roche', 'roche pakistan'], titleTags: ['roche'] },
  { id: 'bayer-pakistan', name: 'Bayer Pakistan', shortName: 'Bayer', top50Rank: 45, aliases: ['bayer', 'bayer pakistan'], titleTags: ['bayer'] },
  { id: 'pfizer-pakistan', name: 'Pfizer Pakistan', shortName: 'Pfizer', top50Rank: 46, aliases: ['pfizer', 'pfizer pakistan', 'lci pfizer', 'ici pfizer'], titleTags: ['pfizer'] },
  { id: 'novo-nordisk-pakistan', name: 'Novo Nordisk Pakistan', shortName: 'Novo Nordisk', top50Rank: 47, aliases: ['novo', 'novo nordisk', 'novo nordisk pakistan'], titleTags: ['novo'] },
  { id: 'eli-lilly-pakistan', name: 'Eli Lilly Pakistan', shortName: 'Eli Lilly', top50Rank: 48, aliases: ['eli lilly', 'eli lilly pakistan', 'lilly'], titleTags: ['lilly', 'eli lilly'] },
  { id: 'merck-pakistan', name: 'Merck Pakistan', shortName: 'Merck', top50Rank: 49, aliases: ['merck', 'merck pakistan', 'merck sharp', 'msd'], titleTags: ['merck'] },
  { id: 'wyeth-pakistan', name: 'Wyeth Pakistan', shortName: 'Wyeth', top50Rank: 50, aliases: ['wyeth', 'wyeth pakistan'], titleTags: ['wyeth'] },

  // ---- Additional reputable companies frequently found on Pakistani wholesale lists
  { id: 'novartis-pakistan', name: 'Novartis Pakistan', shortName: 'Novartis', top50Rank: null, aliases: ['novartis', 'novartis pakistan', 'sandoz'], titleTags: ['novartis', 'sandoz'] },
  { id: 'platinum-pharmaceuticals', name: 'Platinum Pharmaceuticals', shortName: 'Platinum', top50Rank: null, aliases: ['platinum', 'platinum company', 'platinum pharma', 'platinum pharmaceuticals'], titleTags: ['platinum'] },
  { id: 'servier-pakistan', name: 'Servier Pakistan', shortName: 'Servier', top50Rank: null, aliases: ['servier', 'servier pakistan'], titleTags: ['servier'] },
  { id: 'chiesi-pakistan', name: 'Chiesi Pakistan', shortName: 'Chiesi', top50Rank: null, aliases: ['chiesi', 'chiesi pakistan'], titleTags: ['chiesi'] },
  { id: 'efroze-chemical', name: 'Efroze Chemical', shortName: 'Efroze', top50Rank: null, aliases: ['efroze', 'efroz', 'efroz chemical', 'efroze chemical'], titleTags: ['efroze', 'efroz'] },
  { id: 'ici-pakistan', name: 'ICI Pakistan / Lucky Core', shortName: 'ICI', top50Rank: null, aliases: ['ici', 'lci', 'ici pakistan', 'lucky core'], titleTags: ['ici', 'lci'] },
  { id: 'werrick-pharmaceuticals', name: 'Werrick Pharmaceuticals', shortName: 'Werrick', top50Rank: null, aliases: ['werrick', 'werrick pharma', 'werrick pharmaceuticals'], titleTags: ['werrick'] },
  { id: 'tabros-pharma', name: 'Tabros Pharma', shortName: 'Tabros', top50Rank: null, aliases: ['tabros', 'tabros pharma'], titleTags: ['tabros'] },
  { id: 'shaigan-pharmaceuticals', name: 'Shaigan Pharmaceuticals', shortName: 'Shaigan', top50Rank: null, aliases: ['shaigan', 'shaigan pharma', 'shaigan pharmaceuticals'], titleTags: ['shaigan'] },
  { id: 'scilife-pharma', name: 'Scilife Pharma', shortName: 'Scilife', top50Rank: null, aliases: ['scilife', 'scilife pharma'], titleTags: ['scilife'] },
  { id: 'scotmann-pharmaceuticals', name: 'Scotmann Pharmaceuticals', shortName: 'Scotmann', top50Rank: null, aliases: ['scotmann', 'scotmann pharmaceuticals'], titleTags: ['scotmann'] },
  { id: 'allergan-pakistan', name: 'Allergan', shortName: 'Allergan', top50Rank: null, aliases: ['allergan'], titleTags: ['allergan'] },
  { id: 'alcon-pakistan', name: 'Alcon', shortName: 'Alcon', top50Rank: null, aliases: ['alcon'], titleTags: ['alcon'] },
  { id: 'genetics-pharmaceuticals', name: 'Genetics Pharmaceuticals', shortName: 'Genetics', top50Rank: null, aliases: ['genetics', 'genetics pharmaceuticals'], titleTags: ['genetics'] },
  { id: 'pdh-laboratories', name: 'P.D.H. Laboratories', shortName: 'PDH', top50Rank: null, aliases: ['pdh', 'p d h', 'pdh laboratories'], titleTags: ['pdh'] },
  { id: 'sj-and-g', name: 'S.J. & G. Fazul Ellahie', shortName: 'SJ & G', top50Rank: null, aliases: ['s j g', 'sj g', 'sj and g', 'sj & g'], titleTags: ['sjg'] },
  { id: 'wilsons-pharmaceuticals', name: "Wilson's Pharmaceuticals", shortName: 'Wilson', top50Rank: null, aliases: ['wilson', 'wilsons', 'wilson pharmaceuticals'], titleTags: ['wilson'] },
  { id: 'woodwards-pakistan', name: 'Woodwards', shortName: 'Woodwards', top50Rank: null, aliases: ['wood wards', 'woodwards'], titleTags: ['woodwards'] },
  { id: 'pharma-health', name: 'Pharma Health Pakistan', shortName: 'Pharma Health', top50Rank: null, aliases: ['pharma health', 'pharma-health'], titleTags: ['pharma health'] },
  { id: 'maxitech-pharma', name: 'Maxitech Pharma', shortName: 'Maxitech', top50Rank: null, aliases: ['maxitech', 'maxitech pharma'], titleTags: ['maxitech'] },
  { id: 'matrix-pharma', name: 'Matrix Pharma', shortName: 'Matrix', top50Rank: null, aliases: ['matrix', 'matrix pharma'], titleTags: ['matrix'] },
  { id: 'adamjee-pharmaceuticals', name: 'Adamjee Pharmaceuticals', shortName: 'Adamjee', top50Rank: null, aliases: ['adamjee', 'adamjee pharmaceuticals'], titleTags: ['adamjee'] },
  { id: 'saffron-pharmaceuticals', name: 'Saffron Pharmaceuticals', shortName: 'Saffron', top50Rank: null, aliases: ['saffron', 'saffron pharma', 'saffron pharmaceuticals'], titleTags: ['saffron'] },
  { id: 'himont-pharmaceuticals', name: 'Himont Pharmaceuticals', shortName: 'Himont', top50Rank: null, aliases: ['himont', 'himont pharmaceuticals'], titleTags: ['himont'] },
  { id: 'herbion-pakistan', name: 'Herbion / Herbiotics', shortName: 'Herbion', top50Rank: null, aliases: ['herbion', 'herbiotics'], titleTags: ['herbion', 'herbiotics'] },
  { id: 'jenpharm', name: 'Jenpharm Life Sciences', shortName: 'Jenpharm', top50Rank: null, aliases: ['jenpharm'], titleTags: ['jenpharm'] },
  { id: 'cibex-pharma', name: 'Cibex Pharma', shortName: 'Cibex', top50Rank: null, aliases: ['cbx', 'cibex', 'cibex pharma'], titleTags: ['cibex', 'cbx'] },
  { id: 'aspin-pharma', name: 'Aspin Pharma', shortName: 'Aspin', top50Rank: null, aliases: ['aspin', 'aspin pharma', 'aspin johnson'], titleTags: ['aspin'] },
]

/** Placeholder/category labels in distributor sheets that are NOT actual pharmaceutical companies. */
const NON_COMPANY_TOKENS = new Set([
  '', '-', '--', 'n a', 'na', 'nil', 'none', 'unknown', 'other', 'others',
  'misc', 'mix', 'mix item', 'mix items', 'local', 'local item', 'c',
  'drops', 'drop', 'creams and ointment', 'cream and ointment', 'creams', 'ointments', 'syrups', 'tablets',
  'herbal consumer item', 'consumer item', 'muller items',
])

const ALIAS_TO_COMPANY = new Map<string, PharmaCompanyDef>()
const COMPANY_BY_ID = new Map<string, PharmaCompanyDef>()
const TITLE_TAG_TO_COMPANY = new Map<string, PharmaCompanyDef>()

export function cleanCompanyToken(s: string | null | undefined): string {
  return normalizeHomoglyphs(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEGAL_SUFFIX_RE = /\b(pvt|private|limited|ltd|inc|llc|co|company|pakistan|pharma|pharmaceutical|pharmaceuticals|laboratories|laboratory|labs|lab|industries|international)\b/g

function stripCompanySuffixes(tok: string): string {
  return tok.replace(LEGAL_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim()
}

for (const c of PHARMA_COMPANIES) {
  COMPANY_BY_ID.set(c.id, c)
  const allNames = new Set([c.name, c.shortName, ...c.aliases])
  for (const alias of allNames) {
    const cleaned = cleanCompanyToken(alias)
    if (cleaned) ALIAS_TO_COMPANY.set(cleaned, c)
    const stripped = stripCompanySuffixes(cleaned)
    if (stripped && !NON_COMPANY_TOKENS.has(stripped)) {
      if (!ALIAS_TO_COMPANY.has(stripped)) ALIAS_TO_COMPANY.set(stripped, c)
    }
  }
  for (const tag of c.titleTags ?? []) {
    const ct = cleanCompanyToken(tag)
    if (ct) TITLE_TAG_TO_COMPANY.set(ct, c)
  }
}

/** True when a raw manufacturer string is an empty placeholder or a distributor category label like "MISC." or "DROPS". */
export function isPlaceholderCompany(raw: string | null | undefined): boolean {
  const c = cleanCompanyToken(raw)
  return !c || NON_COMPANY_TOKENS.has(c)
}

/** Find a curated PharmaCompanyDef for any raw company string or alias, or null if not in the curated list. */
export function findKnownCompany(raw: string | null | undefined): PharmaCompanyDef | null {
  if (!raw || isPlaceholderCompany(raw)) return null
  const c = cleanCompanyToken(raw)
  if (!c) return null
  const direct = ALIAS_TO_COMPANY.get(c)
  if (direct) return direct
  const stripped = stripCompanySuffixes(c)
  if (stripped && ALIAS_TO_COMPANY.has(stripped)) return ALIAS_TO_COMPANY.get(stripped)!
  return null
}

/**
 * Resolve any raw manufacturer value to its canonical company display name.
 * - "A.G.P", "AGP PHARMA" -> "AGP Limited"
 * - "ABBOTT PHARMANET", "ABBOTT UDL" -> "Abbott Laboratories Pakistan"
 * - "MISC.", "MIX ITEM", "DROPS" -> null (uncategorized)
 * - Unknown real companies -> trimmed raw string (e.g. "Apex Pharma")
 */
export function resolveCanonicalCompany(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = normalizeHomoglyphs(raw).replace(/\s+/g, ' ').trim()
  if (!trimmed || isPlaceholderCompany(trimmed)) return null
  const known = findKnownCompany(trimmed)
  if (known) return known.name
  return trimmed
}

/** Stable URL/comparison slug for any company name. */
export function companySlug(name: string): string {
  const known = findKnownCompany(name)
  if (known) return known.id
  return cleanCompanyToken(name).replace(/\s+/g, '-') || 'uncategorized'
}

/** Canonical comparison key for product matching: recognizes aliases like "GETZ" === "Getz Pharma". */
export function companyCompareKey(raw: string | null | undefined): string {
  const canonical = resolveCanonicalCompany(raw)
  if (!canonical) return ''
  return cleanCompanyToken(canonical)
}

/** Extract an explicit company marker from a medicine title, e.g. "PARAXYL-CR-25. (CCL)" or "SOMOGELL ABBOT". */
export function extractCompanyFromTitle(title: string | null | undefined): PharmaCompanyDef | null {
  const s = normalizeHomoglyphs(title ?? '').trim()
  if (!s) return null

  // 1. Check parenthetical / bracketed tags anywhere in the title, including truncated trailing "(ABBOTT"
  const parenRe = /[[(]\s*([A-Za-z][A-Za-z0-9.\s&-]{1,28})\s*(?:[\])]|\s*$)/g
  let m: RegExpExecArray | null
  while ((m = parenRe.exec(s)) !== null) {
    const inner = cleanCompanyToken(m[1])
    if (!inner) continue
    const tagHit = TITLE_TAG_TO_COMPANY.get(inner) ?? findKnownCompany(inner)
    if (tagHit) return tagHit
  }

  // 2. Check trailing standalone unambiguous company token (e.g. "SOMOGELL ABBOT", "MED GETZ PHARMA")
  const words = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const last2 = words.slice(-2).join(' ')
    const hit2 = TITLE_TAG_TO_COMPANY.get(last2)
    if (hit2) return hit2
    const last1 = words[words.length - 1]
    const hit1 = TITLE_TAG_TO_COMPANY.get(last1)
    if (hit1) return hit1
  }

  return null
}

// Generic medicine words that are NEVER sufficient by themselves to identify a brand family across products.
const GENERIC_BRAND_STOPWORDS = new Set([
  'aqua', 'anti', 'baby', 'adult', 'child', 'cold', 'cough', 'pain', 'plus', 'extra', 'forte', 'super', 'ultra',
  'max', 'mini', 'mild', 'gold', 'silver', 'care', 'cure', 'med', 'medi', 'life', 'health', 'bio', 'neo', 'pro',
  'vitamin', 'multi', 'calcium', 'iron', 'zinc', 'folic', 'b12', 'd3', 'saline', 'normal', 'water', 'glucose',
  'dextrose', 'ringer', 'sodium', 'potassium', 'chloride', 'paracetamol', 'ibuprofen', 'amoxicillin', 'cefixime',
  'omeprazole', 'azithromycin', 'ciprofloxacin', 'metronidazole', 'cetirizine', 'diclofenac', 'aspirin',
  'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'cap', 'caps', 'syrup', 'syp', 'suspension', 'susp', 'injection',
  'inj', 'cream', 'crm', 'ointment', 'oint', 'gel', 'lotion', 'drops', 'drop', 'sachet', 'spray', 'powder',
  'eye', 'ear', 'skin', 'oral', 'nasal', 'dental', 'herbal', 'cotton', 'bandage', 'gauze', 'syringe', 'mask',
])

function extractBrandStem(normalizedName: string): string | null {
  const toks = normalizedName.toLowerCase().split(/\s+/).filter(Boolean)
  if (toks.length === 0) return null
  const t0 = toks[0]
  if (/^\d+$/.test(t0)) return null
  if (t0.length <= 2 && toks.length >= 2 && !/^\d+$/.test(toks[1])) {
    const pair = `${t0} ${toks[1]}`
    return pair.length >= 5 ? pair : null
  }
  if (t0.length < 4 || GENERIC_BRAND_STOPWORDS.has(t0)) return null
  return t0
}

export type DetectionReason =
  | 'canonical_existing'
  | 'supplier_record'
  | 'title_tag'
  | 'brand_family'
  | 'clear_placeholder'

export interface CompanySuggestion {
  productId: string
  product: Product
  currentManufacturer: string | null
  suggestedManufacturer: string | null
  reason: DetectionReason
  reasonLabel: string
}

/**
 * Compute live canonical company name for display/grouping of a product WITHOUT requiring DB writes yet.
 * Falls back from canonical `product.manufacturer` -> linked `price_records.source_attrs.manufacturer`
 * -> title company tag `(CCL)/(AGP)/(ABBOTT)` -> `null` (Uncategorized).
 */
export function resolveProductDisplayCompany(product: Product, linkedRecords?: PriceRecord[]): string | null {
  const fromProduct = resolveCanonicalCompany(product.manufacturer)
  if (fromProduct) return fromProduct
  if (linkedRecords) {
    for (const r of linkedRecords) {
      const fromAttr = resolveCanonicalCompany(r.source_attrs?.manufacturer)
      if (fromAttr) return fromAttr
    }
  }
  const fromTitle = extractCompanyFromTitle(product.name)
  if (fromTitle) return fromTitle.name
  if (linkedRecords) {
    for (const r of linkedRecords) {
      const fromRecTitle = extractCompanyFromTitle(r.original_title)
      if (fromRecTitle) return fromRecTitle.name
    }
  }
  return null
}

/**
 * Inspect all active products and linked price records to find safe, actionable company assignments & standardizations:
 * 1. Canonicalizing non-standard names already stored in `products.manufacturer` (e.g. "GETZ" -> "Getz Pharma")
 * 2. Clearing invalid placeholder values in `products.manufacturer` (e.g. "MISC.", "DROPS", "MIX ITEM" -> Uncategorized)
 * 3. Filling missing `products.manufacturer` from `price_records.source_attrs.manufacturer`
 * 4. Filling missing `products.manufacturer` from explicit title tags like "(CCL)", "(AGP)", "(ABBOTT"
 * 5. Propagating from unambiguous brand stems in already-assigned catalog products (when all peers agree on 1 company)
 */
export function buildCompanySuggestions(products: Product[], currentRecords: PriceRecord[]): CompanySuggestion[] {
  const recordsByProduct = new Map<string, PriceRecord[]>()
  for (const r of currentRecords) {
    if (!r.product_id) continue
    const arr = recordsByProduct.get(r.product_id)
    if (arr) arr.push(r)
    else recordsByProduct.set(r.product_id, [r])
  }

  // First pass: direct & record-level assignments + collect unambiguous brand-stem map
  const stemCompanies = new Map<string, Set<string>>()
  const directResolved = new Map<string, string | null>()

  for (const p of products) {
    if (p.archived) continue
    const recs = recordsByProduct.get(p.id)
    const direct = resolveProductDisplayCompany(p, recs)
    directResolved.set(p.id, direct)
    if (direct) {
      const stem = extractBrandStem(p.normalized_name)
      if (stem) {
        const set = stemCompanies.get(stem) ?? new Set<string>()
        set.add(direct)
        stemCompanies.set(stem, set)
      }
    }
  }

  const out: CompanySuggestion[] = []
  for (const p of products) {
    if (p.archived) continue
    const cur = p.manufacturer?.trim() || null
    const recs = recordsByProduct.get(p.id) ?? []

    // Case 1: Placeholder/junk string currently saved in `products.manufacturer` ("MISC.", "DROPS", "MIX ITEM")
    if (cur && isPlaceholderCompany(cur)) {
      const better = resolveProductDisplayCompany({ ...p, manufacturer: null }, recs)
      out.push({
        productId: p.id,
        product: p,
        currentManufacturer: cur,
        suggestedManufacturer: better,
        reason: better ? 'title_tag' : 'clear_placeholder',
        reasonLabel: better
          ? `Replace placeholder "${cur}" with ${better}`
          : `Clear non-company category "${cur}"`,
      })
      continue
    }

    // Case 2: Raw company string in `products.manufacturer` differs from canonical Top-50 name ("GETZ" -> "Getz Pharma")
    if (cur) {
      const canonical = resolveCanonicalCompany(cur)
      if (canonical && canonical !== cur) {
        out.push({
          productId: p.id,
          product: p,
          currentManufacturer: cur,
          suggestedManufacturer: canonical,
          reason: 'canonical_existing',
          reasonLabel: `Standardize "${cur}" → ${canonical}`,
        })
      }
      continue
    }

    // Case 3: Missing `products.manufacturer` — check linked price records (`Company` column)
    let fromRec: string | null = null
    for (const r of recs) {
      const c = resolveCanonicalCompany(r.source_attrs?.manufacturer)
      if (c) {
        fromRec = c
        break
      }
    }
    if (fromRec) {
      out.push({
        productId: p.id,
        product: p,
        currentManufacturer: null,
        suggestedManufacturer: fromRec,
        reason: 'supplier_record',
        reasonLabel: `From supplier sheet (${fromRec})`,
      })
      continue
    }

    // Case 4: Title company tag e.g. "(CCL)", "(AGP)", "(ABBOTT"
    const tagHit = extractCompanyFromTitle(p.name) ?? recs.map((r) => extractCompanyFromTitle(r.original_title)).find(Boolean) ?? null
    if (tagHit) {
      out.push({
        productId: p.id,
        product: p,
        currentManufacturer: null,
        suggestedManufacturer: tagHit.name,
        reason: 'title_tag',
        reasonLabel: `Detected tag in product title → ${tagHit.name}`,
      })
      continue
    }

    // Case 5: Unambiguous brand family match in catalog
    const stem = extractBrandStem(p.normalized_name)
    if (stem) {
      const candidates = stemCompanies.get(stem)
      if (candidates && candidates.size === 1) {
        const company = [...candidates][0]
        out.push({
          productId: p.id,
          product: p,
          currentManufacturer: null,
          suggestedManufacturer: company,
          reason: 'brand_family',
          reasonLabel: `Brand family "${stem}" → ${company}`,
        })
      }
    }
  }

  return out
}

export interface CompanySummary {
  id: string
  name: string
  shortName: string
  top50Rank: number | null
  aliases: string[]
  isUncategorized: boolean
  productCount: number
  offerCount: number
  multiShopCount: number
  rsPriceCount: number
  discountOnlyCount: number
  tpCount: number
  bestDiscountPct: number | null
  minPriceRs: number | null
  maxPriceRs: number | null
  /** Shops offering products from this company, sorted by product count descending */
  shops: { shopId: string; shopName: string; count: number }[]
  /** Breakdown of dosage forms */
  forms: { form: string; count: number }[]
  sampleProducts: Product[]
}

/**
 * Aggregate every active product and current supplier offer into rich company summaries.
 * Ensures every Top-50 Pakistan Pharma company always has a directory entry (even when productCount === 0),
 * alongside all other/custom companies found in the catalog plus one Uncategorized bucket if any exist.
 */
export function buildCompanySummaries(
  products: Product[],
  currentRecords: PriceRecord[],
  shops: Map<string, Shop>,
): CompanySummary[] {
  const recordsByProduct = new Map<string, PriceRecord[]>()
  for (const r of currentRecords) {
    if (!r.product_id || r.archived) continue
    const arr = recordsByProduct.get(r.product_id)
    if (arr) arr.push(r)
    else recordsByProduct.set(r.product_id, [r])
  }

  type Acc = {
    def: PharmaCompanyDef | null
    id: string
    name: string
    shortName: string
    top50Rank: number | null
    aliases: string[]
    isUncategorized: boolean
    products: Product[]
    offerCount: number
    multiShopCount: number
    rsPriceCount: number
    discountOnlyCount: number
    tpCount: number
    bestDiscountPct: number | null
    minPriceRs: number | null
    maxPriceRs: number | null
    shopCounts: Map<string, Set<string>>
    formCounts: Map<string, number>
  }

  const accMap = new Map<string, Acc>()

  const getOrCreate = (def: PharmaCompanyDef | null, name: string, isUncategorized = false): Acc => {
    const key = isUncategorized ? '__uncategorized__' : def ? def.id : `custom:${companySlug(name)}`
    let acc = accMap.get(key)
    if (!acc) {
      acc = {
        def,
        id: isUncategorized ? 'uncategorized' : def ? def.id : companySlug(name),
        name,
        shortName: def ? def.shortName : name,
        top50Rank: def?.top50Rank ?? null,
        aliases: def ? def.aliases : [],
        isUncategorized,
        products: [],
        offerCount: 0,
        multiShopCount: 0,
        rsPriceCount: 0,
        discountOnlyCount: 0,
        tpCount: 0,
        bestDiscountPct: null,
        minPriceRs: null,
        maxPriceRs: null,
        shopCounts: new Map(),
        formCounts: new Map(),
      }
      accMap.set(key, acc)
    }
    return acc
  }

  // Pre-seed all Top 50 Pakistani pharmaceutical companies so zero-count gaps are visible
  for (const c of PHARMA_COMPANIES) {
    if (c.top50Rank != null) getOrCreate(c, c.name, false)
  }

  for (const p of products) {
    if (p.archived) continue
    const recs = recordsByProduct.get(p.id) ?? []
    const resolvedName = resolveProductDisplayCompany(p, recs)
    const known = resolvedName ? findKnownCompany(resolvedName) : null
    const acc = resolvedName ? getOrCreate(known, known?.name ?? resolvedName, false) : getOrCreate(null, 'Uncategorized', true)

    acc.products.push(p)
    const form = (p.dosage_form || 'other').toLowerCase()
    acc.formCounts.set(form, (acc.formCounts.get(form) ?? 0) + 1)

    const distinctShops = new Set<string>()
    let hasRs = false
    let hasDisc = false
    let hasTp = false
    for (const r of recs) {
      acc.offerCount++
      distinctShops.add(r.shop_id)
      const sSet = acc.shopCounts.get(r.shop_id) ?? new Set<string>()
      sSet.add(p.id)
      acc.shopCounts.set(r.shop_id, sSet)

      if (r.scheme_status === 'ok' && r.effective_cost != null && r.effective_cost > 0) {
        hasRs = true
        acc.minPriceRs = acc.minPriceRs == null ? r.effective_cost : Math.min(acc.minPriceRs, r.effective_cost)
        acc.maxPriceRs = acc.maxPriceRs == null ? r.effective_cost : Math.max(acc.maxPriceRs, r.effective_cost)
      }
      if (r.source_attrs?.is_trade_price && (r.discount_pct == null || r.discount_pct === 0)) {
        hasTp = true
      } else if (r.discount_pct != null && r.discount_pct > 0) {
        hasDisc = true
        acc.bestDiscountPct = acc.bestDiscountPct == null ? r.discount_pct : Math.max(acc.bestDiscountPct, r.discount_pct)
      }
    }
    if (distinctShops.size >= 2) acc.multiShopCount++
    if (hasRs) acc.rsPriceCount++
    else if (hasDisc) acc.discountOnlyCount++
    else if (hasTp) acc.tpCount++
  }

  return [...accMap.values()].map((a) => ({
    id: a.id,
    name: a.name,
    shortName: a.shortName,
    top50Rank: a.top50Rank,
    aliases: a.aliases,
    isUncategorized: a.isUncategorized,
    productCount: a.products.length,
    offerCount: a.offerCount,
    multiShopCount: a.multiShopCount,
    rsPriceCount: a.rsPriceCount,
    discountOnlyCount: a.discountOnlyCount,
    tpCount: a.tpCount,
    bestDiscountPct: a.bestDiscountPct,
    minPriceRs: a.minPriceRs,
    maxPriceRs: a.maxPriceRs,
    shops: [...a.shopCounts.entries()]
      .map(([shopId, pIds]) => ({
        shopId,
        shopName: shops.get(shopId)?.name ?? 'Supplier',
        count: pIds.size,
      }))
      .sort((x, y) => y.count - x.count || x.shopName.localeCompare(y.shopName)),
    forms: [...a.formCounts.entries()]
      .map(([form, count]) => ({ form, count }))
      .sort((x, y) => y.count - x.count || x.form.localeCompare(y.form)),
    sampleProducts: a.products.slice(0, 5),
  }))
}
