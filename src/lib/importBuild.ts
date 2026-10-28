// Turns a raw grid + column mapping into validated, typed import rows. Pure and testable.
import { matchHeaderField, suggestMapping, type FieldKey, type ImportOptions, type Mapping } from './columns'
import type { IncomingProduct } from './matching'
import { identityKey, normalizeText, parseTitle, sourceKey } from './productParse'
import { calculateEffectiveCost, parseNumber, parseSchemeText, type CostResult, type SchemeComponents } from './scheme'

export type RowKind = 'valid' | 'review' | 'invalid' | 'duplicate'

export interface BuiltRow {
  rowNumber: number
  raw: Record<string, string>
  kind: RowKind
  errors: string[]
  warnings: string[]
  incoming: IncomingProduct
  identity: string
  title: string
  code: string | null
  price: number | null
  mrp: number | null
  discountPct: number | null
  flatDiscount: number | null
  bonusBuy: number | null
  bonusFree: number | null
  schemeText: string | null
  minOrderQty: number | null
  availability: string | null
  expiry: string | null
  notes: string | null
  taxIncluded: boolean | null
  priceIsNet: boolean
  combine: boolean
  packSize: number | null
  cost: CostResult
}

export interface BuildStats {
  total: number
  empty: number
  valid: number
  review: number
  invalid: number
  duplicate: number
  missingPrice: number
  missingTitle: number
  badNumbers: number
}

export interface SideBySideGroup {
  label: string
  mapping: Mapping
  colIndices: number[]
}

export interface SideBySideDetection {
  status: 'none' | 'detected' | 'ambiguous'
  groups: SideBySideGroup[]
  reason?: string
}

export function getHeaders(grid: string[][], headerRow: number): string[] {
  const row = grid[headerRow - 1] ?? []
  const seen = new Map<string, number>()
  return row.map((h, i) => {
    let name = (h ?? '').trim() || `Column ${i + 1}`
    const c = seen.get(name) ?? 0
    seen.set(name, c + 1)
    if (c > 0) name = `${name} (${c + 1})`
    return name
  })
}

/** Auto-select the 1-based header row (prefers rows containing recognized Product Name + Offer Rate headers over shop/date banner rows). */
export function detectHeaderRow(grid: string[][]): number {
  const limit = Math.min(grid.length, 15)
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] ?? []).filter(Boolean)
    if (cells.length < 2) continue
    const sug = suggestMapping(getHeaders(grid, i + 1))
    if (sug.title && sug.price) return i + 1
  }
  for (let i = 0; i < limit; i++) {
    const cells = (grid[i] ?? []).filter(Boolean)
    if (cells.length >= 2 && cells.filter((c) => isNaN(Number(c.replace(/,/g, '')))).length >= cells.length * 0.8) {
      return i + 1
    }
  }
  return 1
}

/** Cheap heuristics used by the preview step. */
export function detectColumns(headers: string[], sample: string[][]) {
  return headers.map((h, i) => {
    const vals = sample.map((r) => r[i] ?? '').filter(Boolean)
    const numeric = vals.filter((v) => parseNumber(v) !== null).length
    return { header: h, filled: vals.length, numericShare: vals.length ? numeric / vals.length : 0 }
  })
}

/**
 * Detect whether a sheet contains two (or more) side-by-side product/rate tables
 * (e.g. ITEM NAME | OFFER RATE on the left and ITEM NAME | OFFER RATE on the right).
 */
export function detectSideBySide(grid: string[][], headerRow: number): SideBySideDetection {
  const rawRow = grid[headerRow - 1] ?? []
  const headers = getHeaders(grid, headerRow)
  if (headers.length < 4) return { status: 'none', groups: [] }

  const fields: (FieldKey | null)[] = rawRow.map((cell) => matchHeaderField(cell ?? ''))
  const titleCols: number[] = []
  const priceCols: number[] = []
  fields.forEach((f, idx) => {
    if (f === 'title') titleCols.push(idx)
    else if (f === 'price') priceCols.push(idx)
  })

  if (titleCols.length >= 2 && priceCols.length === titleCols.length) {
    // Check that each (titleCols[k], priceCols[k]) forms a non-overlapping left-to-right pair
    let validPairs = true
    for (let k = 0; k < titleCols.length; k++) {
      if (k > 0) {
        const prevEnd = Math.max(titleCols[k - 1], priceCols[k - 1])
        const curStart = Math.min(titleCols[k], priceCols[k])
        if (curStart <= prevEnd) {
          validPairs = false
          break
        }
      }
    }
    if (!validPairs) {
      return {
        status: 'ambiguous',
        groups: [],
        reason: 'Multiple product and rate columns were found, but their column order is ambiguous. Please check the preview and verify the mapping below.',
      }
    }

    // Partition columns into groups around each (title, price) pair
    const boundaries: number[] = [0]
    for (let k = 1; k < titleCols.length; k++) {
      const nextPairStart = Math.min(titleCols[k], priceCols[k])
      // If the column immediately before nextPairStart is a code/serial column, include it in group k
      const splitAt = nextPairStart > 0 && fields[nextPairStart - 1] === 'code' && nextPairStart - 1 > Math.max(titleCols[k - 1], priceCols[k - 1])
        ? nextPairStart - 1
        : nextPairStart
      boundaries.push(splitAt)
    }
    boundaries.push(headers.length)

    const groups: SideBySideGroup[] = []
    for (let k = 0; k < titleCols.length; k++) {
      const start = boundaries[k]
      const end = boundaries[k + 1]
      const groupMapping: Mapping = {
        title: headers[titleCols[k]],
        price: headers[priceCols[k]],
      }
      const colIndices: number[] = []
      for (let c = start; c < end; c++) {
        colIndices.push(c)
        const f = fields[c]
        if (f && !groupMapping[f]) {
          groupMapping[f] = headers[c]
        }
      }
      const sideName = titleCols.length === 2 ? (k === 0 ? 'Left side' : 'Right side') : `Column group ${k + 1}`
      groups.push({
        label: `${sideName} (${headers[titleCols[k]]} / ${headers[priceCols[k]]})`,
        mapping: groupMapping,
        colIndices,
      })
    }
    return {
      status: 'detected',
      groups,
      reason: `Detected ${groups.length} side-by-side product/rate lists (${groups.map((g) => g.label).join(' and ')}). Both will be combined into a single product-price list.`,
    }
  }

  if (titleCols.length >= 2 && priceCols.length !== titleCols.length) {
    return {
      status: 'ambiguous',
      groups: [],
      reason: `Found ${titleCols.length} product name columns and ${priceCols.length} rate column(s). Automatic side-by-side pairing is ambiguous — please review the preview and confirm the mapping below.`,
    }
  }

  // Also check if there is 1 matched (title, price) pair plus another unmatched (text, numeric) pair in the data rows
  const sample = grid.slice(headerRow, headerRow + 25).filter((r) => r.some((c) => c && c.trim()))
  if (sample.length >= 2 && titleCols.length === 1 && priceCols.length === 1) {
    const colStats = detectColumns(headers, sample)
    const unmapped = headers
      .map((_, i) => i)
      .filter((i) => fields[i] === null && colStats[i].filled >= Math.min(2, sample.length))
    for (let u = 0; u < unmapped.length - 1; u++) {
      const c1 = unmapped[u]
      const c2 = unmapped[u + 1]
      if (c2 === c1 + 1 && colStats[c1].numericShare < 0.25 && colStats[c2].numericShare > 0.75) {
        return {
          status: 'ambiguous',
          groups: [],
          reason: `Columns "${headers[c1]}" and "${headers[c2]}" look like an additional side-by-side product/rate list with unrecognized headers. Please check the preview and mapping below.`,
        }
      }
    }
  }

  return { status: 'none', groups: [] }
}

const UNAVAILABLE = /^(out( of stock)?|oos|no|n\/a|na|nil|unavailable|not available|0|finished|short)$/i
export const isUnavailable = (s: string | null | undefined): boolean => !!s && UNAVAILABLE.test(s.trim())

export function buildRows(
  grid: string[][],
  mapping: Mapping,
  options: ImportOptions,
): { rows: BuiltRow[]; stats: BuildStats; headers: string[]; sideBySide: SideBySideDetection } {
  const headers = getHeaders(grid, options.headerRow)
  const sideBySide = detectSideBySide(grid, options.headerRow)
  const useSideBySide =
    options.combineSideBySide !== false &&
    sideBySide.status === 'detected' &&
    sideBySide.groups.length > 1 &&
    mapping.title === sideBySide.groups[0].mapping.title &&
    mapping.price === sideBySide.groups[0].mapping.price

  const activeMappings: Mapping[] = useSideBySide
    ? [{ ...sideBySide.groups[0].mapping, ...mapping }, ...sideBySide.groups.slice(1).map((g) => g.mapping)]
    : [mapping]

  const stats: BuildStats = { total: 0, empty: 0, valid: 0, review: 0, invalid: 0, duplicate: 0, missingPrice: 0, missingTitle: 0, badNumbers: 0 }
  const rows: BuiltRow[] = []
  const seen = new Set<string>()

  // Count completely blank spreadsheet rows once
  const blankRow = new Set<number>()
  for (let r = options.headerRow; r < grid.length; r++) {
    const cells = grid[r] ?? []
    if (cells.every((c) => !c || !c.trim())) {
      blankRow.add(r)
      stats.empty++
    }
  }

  for (let gIdx = 0; gIdx < activeMappings.length; gIdx++) {
    const curMap = activeMappings[gIdx]
    const colIndex = (field: keyof Mapping): number => {
      const h = curMap[field]
      return h ? headers.indexOf(h) : -1
    }
    const idx = {
      title: colIndex('title'), description: colIndex('description'), code: colIndex('code'), barcode: colIndex('barcode'),
      mfr: colIndex('mfr_code'), brand: colIndex('brand'), manufacturer: colIndex('manufacturer'), strength: colIndex('strength'),
      grams: colIndex('grams'), pack: colIndex('pack_size'), price: colIndex('price'), mrp: colIndex('mrp'),
      discount: colIndex('discount'), scheme: colIndex('scheme'), qty: colIndex('quantity'), expiry: colIndex('expiry'),
      avail: colIndex('availability'), notes: colIndex('notes'),
    }
    const groupCols = Object.values(idx).filter((c) => c >= 0)

    for (let r = options.headerRow; r < grid.length; r++) {
      if (blankRow.has(r)) continue
      const cells = grid[r] ?? []
      const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')

      // In side-by-side mode, if this specific side's mapped cells on row r are all empty, skip the empty slot
      if (activeMappings.length > 1 && groupCols.length > 0 && groupCols.every((c) => !get(c))) {
        continue
      }

      stats.total++
      const raw: Record<string, string> = {}
      headers.forEach((h, i) => (raw[h] = (cells[i] ?? '').trim()))
      const errors: string[] = []
      const warnings: string[] = []

      const title = get(idx.title) || get(idx.description)
      const desc = get(idx.title) ? get(idx.description) : ''
      if (!title) {
        errors.push('Missing product title')
        stats.missingTitle++
      }

      // ---- attributes from title, description and dedicated columns
      const pt = parseTitle(title)
      const pd = desc ? parseTitle(desc) : null
      let { strengthValue, strengthUnit, weightValue, weightUnit, packSize, dosageForm } = pt
      if (pd) {
        if (strengthValue == null && pd.strengthValue != null) { strengthValue = pd.strengthValue; strengthUnit = pd.strengthUnit }
        if (weightValue == null && pd.weightValue != null) { weightValue = pd.weightValue; weightUnit = pd.weightUnit }
        packSize ??= pd.packSize
        dosageForm ??= pd.dosageForm
      }
      const strengthCol = get(idx.strength)
      if (strengthCol) {
        const ps = parseTitle(strengthCol)
        if (ps.strengthValue != null) { strengthValue = ps.strengthValue; strengthUnit = ps.strengthUnit }
        else if (ps.weightValue != null) { weightValue = ps.weightValue; weightUnit = ps.weightUnit }
        else warnings.push(`Strength "${strengthCol}" has no unit (mg/mcg/g/ml); ignored`)
      }
      const gramsCol = get(idx.grams)
      if (gramsCol) {
        const num = parseNumber(gramsCol)
        if (num !== null && /^[\d.,\s]+$/.test(gramsCol)) { weightValue = num; weightUnit = 'g' }
        else {
          const pg = parseTitle(gramsCol)
          if (pg.weightValue != null) { weightValue = pg.weightValue; weightUnit = pg.weightUnit }
          else warnings.push(`Weight "${gramsCol}" not understood; ignored`)
        }
      }
      const packCol = get(idx.pack)
      if (packCol) {
        const num = parseNumber(packCol)
        if (num !== null && num > 0 && Number.isInteger(num)) packSize = num
        else {
          const pp = parseTitle(packCol).packSize
          if (pp) packSize = pp
          else warnings.push(`Pack size "${packCol}" not understood; ignored`)
        }
      }

      // ---- price & scheme
      const priceRaw = get(idx.price)
      let price = parseNumber(priceRaw)
      if (!priceRaw) {
        errors.push('Missing price')
        stats.missingPrice++
      } else if (price === null) {
        errors.push(`Price "${priceRaw}" is not a number`)
        stats.badNumbers++
      } else if (price <= 0) {
        errors.push('Price must be greater than zero')
        price = null
      }
      const mrpRaw = get(idx.mrp)
      const mrp = parseNumber(mrpRaw)
      if (mrpRaw && mrp === null) warnings.push(`MRP "${mrpRaw}" is not a number; ignored`)

      const comp: SchemeComponents = { discountPct: null, flatDiscount: null, bonusBuy: null, bonusFree: null, ambiguous: false, notes: [] }
      const discRaw = get(idx.discount)
      const schemeRaw = get(idx.scheme)
      if (discRaw) {
        const asNum = parseNumber(discRaw)
        if (asNum !== null && !/%/.test(discRaw) && !/rs|pkr/i.test(discRaw)) {
          if (options.discountMode === 'percent') comp.discountPct = asNum
          else comp.flatDiscount = asNum
        } else {
          const d = parseSchemeText(discRaw)
          Object.assign(comp, { ...d, notes: d.notes })
        }
      }
      if (schemeRaw) {
        const s = parseSchemeText(schemeRaw)
        for (const k of ['discountPct', 'flatDiscount', 'bonusBuy', 'bonusFree'] as const) {
          if (s[k] != null) {
            if (comp[k] != null && comp[k] !== s[k]) comp.ambiguous = true
            comp[k] = s[k]
          }
        }
        if (s.ambiguous) comp.ambiguous = true
        comp.notes.push(...s.notes)
      }
      if (comp.discountPct != null && (comp.discountPct < 0 || comp.discountPct >= 100)) errors.push(`Invalid discount ${comp.discountPct}%`)
      comp.notes.forEach((n) => warnings.push(n))

      const qtyRaw = get(idx.qty)
      const qty = parseNumber(qtyRaw)
      if (qtyRaw && qty === null) warnings.push(`Quantity "${qtyRaw}" is not a number; ignored`)

      const cost = calculateEffectiveCost({
        basePrice: price,
        discountPct: comp.discountPct,
        flatDiscount: comp.flatDiscount,
        bonusBuy: comp.bonusBuy,
        bonusFree: comp.bonusFree,
        priceIsNet: options.priceIsNet,
        combine: options.combine,
        ambiguous: comp.ambiguous,
      })
      if (price !== null && cost.status === 'invalid') errors.push(cost.steps[0])
      if (cost.status === 'review') warnings.push('Scheme needs review: offer will not be ranked until corrected')

      const normalizedName = pt.name
      if (title && !normalizedName) errors.push('Title contains no product name (only sizes / pack)')
      const code = get(idx.code) || null
      const incoming: IncomingProduct = {
        title,
        normalizedName,
        supplierCode: code,
        barcode: get(idx.barcode) || null,
        mfrCode: get(idx.mfr) || null,
        brand: get(idx.brand) || null,
        manufacturer: get(idx.manufacturer) || null,
        strengthValue, strengthUnit, weightValue, weightUnit, packSize, dosageForm,
        sourceKey: sourceKey(code, title),
      }
      const identity = identityKey({ normalizedName, strengthValue, strengthUnit, weightValue, weightUnit, packSize, dosageForm, manufacturer: incoming.manufacturer })

      let kind: RowKind = errors.length ? 'invalid' : cost.status === 'review' ? 'review' : 'valid'
      if (kind !== 'invalid') {
        const dk = [normalizeText(code), identity, price, discRaw.toLowerCase(), schemeRaw.toLowerCase()].join('~')
        if (seen.has(dk)) {
          kind = 'duplicate'
          warnings.push('Duplicate of an earlier row in this file')
        } else seen.add(dk)
      }
      stats[kind]++

      const tax = options.taxIncluded === 'yes' ? true : options.taxIncluded === 'no' ? false : null
      const rowNumber = gIdx === 0 ? r + 1 : gIdx * grid.length + (r + 1)
      rows.push({
        rowNumber, raw, kind, errors, warnings, incoming, identity, title, code, price, mrp,
        discountPct: comp.discountPct, flatDiscount: comp.flatDiscount, bonusBuy: comp.bonusBuy, bonusFree: comp.bonusFree,
        schemeText: [discRaw, schemeRaw].filter(Boolean).join(' | ') || null,
        minOrderQty: qty, availability: get(idx.avail) || null, expiry: get(idx.expiry) || null, notes: get(idx.notes) || null,
        taxIncluded: tax, priceIsNet: options.priceIsNet, combine: options.combine, packSize, cost,
      })
    }
  }
  return { rows, stats, headers, sideBySide }
}

/** CSV text of rows that were not importable, for the downloadable error report. */
export function errorReportRows(rows: BuiltRow[]): Record<string, string | number>[] {
  return rows
    .filter((r) => r.kind === 'invalid' || r.kind === 'duplicate' || r.kind === 'review')
    .map((r) => ({ 'Source row': r.rowNumber, Status: r.kind, Problems: [...r.errors, ...r.warnings].join('; '), ...r.raw }))
}
