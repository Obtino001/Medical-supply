// Fast, case-insensitive, homoglyph-safe, punctuation- & unit-normalized search helpers. Pure functions.
import { findKnownCompany } from './companies'
import { normalizeHomoglyphs } from './productParse'

export interface SearchIndexEntry {
  /** Space-delimited normalized text with punctuation removed and digit/letter boundaries split (e.g. "40mg" -> "40 mg"). */
  spaced: string
  /** Fully compacted lowercase alphanumeric string with zero spaces (e.g. "zopent40mgtab") for spaceless queries like "ZOPENT40". */
  compact: string
}

const FORM_SYNONYMS: Record<string, string> = {
  tab: 'tab tablet tablets',
  tablet: 'tab tablet tablets',
  cap: 'cap capsule capsules',
  capsule: 'cap capsule capsules',
  syp: 'syp syrup syrups',
  syrup: 'syp syrup syrups',
  inj: 'inj injection injections',
  injection: 'inj injection injections',
  susp: 'susp suspension',
  suspension: 'susp suspension',
  oint: 'oint ointment',
  ointment: 'oint ointment',
  crm: 'crm cream',
  cream: 'crm cream',
  drp: 'drp drops drop',
  drops: 'drp drops drop',
}

/**
 * Normalize any input string (query or catalog field) regardless of UPPERCASE/lowercase,
 * Cyrillic/Greek OCR lookalike capitals, accents, smart dashes, extra spaces, or punctuation.
 */
export function normalizeForSearch(raw: string | null | undefined): string {
  if (!raw) return ''
  return normalizeHomoglyphs(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function expandCompanySearchTerms(company: string | null | undefined): string[] {
  if (!company) return []
  const known = findKnownCompany(company)
  if (!known) return [company]
  return [company, known.name, known.shortName, ...known.aliases]
}

export function buildSearchIndexEntry(parts: (string | number | null | undefined)[]): SearchIndexEntry {
  const rawJoined = parts.filter((x) => x !== null && x !== undefined && x !== '').join(' ')
  const rawLower = normalizeHomoglyphs(rawJoined).toLowerCase()
  const spacedNorm = normalizeForSearch(rawJoined)
  const formExtras: string[] = []
  for (const tok of spacedNorm.split(' ')) {
    const syn = FORM_SYNONYMS[tok]
    if (syn) formExtras.push(syn)
  }
  const spaced = [spacedNorm, rawLower, ...formExtras].filter(Boolean).join(' ')
  const compact = spacedNorm.replace(/\s+/g, '')
  return { spaced, compact }
}

/** Parse a user search query into normalized tokens (supports ALL CAPS, hyphens, dots, spaced/unspaced strengths). */
export function parseSearchTokens(query: string): { tokens: string[]; compactQuery: string } {
  const spaced = normalizeForSearch(query)
  const tokens = spaced ? spaced.split(' ').filter(Boolean) : []
  return { tokens, compactQuery: tokens.join('') }
}

/**
 * Match a search query against a prebuilt SearchIndexEntry or list of field strings.
 * - Case-insensitive ("ZOPENT" === "zopent" === "Zopent")
 * - Handles homoglyphs, hyphens, dots, slashes ("PARAXYL CR" matches "PARAXYL-CR-25.", "2.0 500" matches "2.0/500")
 * - Handles joined/split units & numbers ("ZOPENT 40MG" === "ZOPENT 40 MG" === "ZOPENT40")
 * - Multi-word order independent ("ZOPENT TAB" matches "ZOPENT 40 MG TAB")
 */
export function matchesSearch(
  target: SearchIndexEntry | (string | number | null | undefined)[],
  query: string,
): boolean {
  const { tokens, compactQuery } = parseSearchTokens(query)
  if (tokens.length === 0) return true

  const entry = Array.isArray(target) ? buildSearchIndexEntry(target) : target

  // Every token must appear in spaced index (or compact index as fallback for unspaced partial queries >= 3 chars)
  if (tokens.every((t) => entry.spaced.includes(t))) return true
  if (compactQuery.length >= 3 && entry.compact.includes(compactQuery)) return true
  return false
}
