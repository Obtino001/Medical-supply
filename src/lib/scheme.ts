// Discount / scheme parsing and effective-cost calculation. Pure functions.

export type SchemeStatus = 'ok' | 'review' | 'invalid' | 'missing'

export interface SchemeComponents {
  discountPct: number | null
  flatDiscount: number | null // per priced unit, in Rs
  bonusBuy: number | null
  bonusFree: number | null
  /** Full-box / carton discount percentage when specified (e.g. "15% COTON 8%" or "COTON 8%") */
  cartonDiscountPct?: number | null
  /** Full-box / carton net rate in Rs when specified (e.g. "240 COTON 220") */
  cartonRate?: number | null
  /** True when the offer is explicitly Trade Price (TP / 1TP / T.P = 0% discount) */
  isTradePrice?: boolean
  /** Human-readable normalized summary of the scheme/discount */
  summary?: string | null
  /** true when the text had pieces we could not interpret or that are ambiguous */
  ambiguous: boolean
  notes: string[]
}

export interface CostInput {
  basePrice: number | null
  discountPct?: number | null
  flatDiscount?: number | null
  bonusBuy?: number | null
  bonusFree?: number | null
  /** supplied price is already net of discount: percent/flat discounts must not be applied again */
  priceIsNet?: boolean
  /** user confirmed that different discount kinds stack (percent first, then flat, then bonus spread) */
  combine?: boolean
  /** scheme text could not be understood: force review */
  ambiguous?: boolean
}

export interface CostResult {
  status: SchemeStatus
  effective: number | null
  steps: string[]
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const CARTON_KW = String.raw`(?:full\s*box(?:es)?|master\s*carton|c[oa]tt?on|cart[ao]n|cr?tn|box|peti|case)`
const TP_TOKEN = String.raw`(?:[1il!|]?\s*t\.?\s*p\.?|trade\s*price|net\s*t\.?\s*p\.?)`

function n(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

/**
 * Parse free text like "2%", "Rs. 20 discount", "10+1", "buy 10 get 1 free",
 * as well as Pakistani wholesale market terms:
 * - "TP", "1TP", "T.P", "NET TP" -> 0% discount (Trade Price)
 * - "15% COTON 8%", "COTON 8%", "CARTON 8%", "FULL BOX 8%" -> full-box / carton discount
 * - "↑ 12%", "TP 12%" -> 12% discount
 */
export function parseSchemeText(text: string | null | undefined): SchemeComponents {
  const out: SchemeComponents = {
    discountPct: null,
    flatDiscount: null,
    bonusBuy: null,
    bonusFree: null,
    cartonDiscountPct: null,
    cartonRate: null,
    isTradePrice: false,
    summary: null,
    ambiguous: false,
    notes: [],
  }
  let t = (text ?? '').toString().trim().toLowerCase()
  if (!t || /^(-|--|n\/?a|nil|none|no|net|flat|flat rate)$/.test(t)) return out

  // Normalize unicode arrows and common symbols (e.g. "↑ 12%", "↓ 12%", "→")
  t = t.replace(/[↑↓←→↖↗↘↙⇧⇩]/g, ' ').trim()

  // Check for standalone Trade Price token (e.g. "TP", "1TP", "T.P", "NET TP", "TRADE PRICE")
  const tpOnlyRe = new RegExp(String.raw`^(?:on\s+|at\s+|full\s+|net\s+)?${TP_TOKEN}(?:\s*(?:net|rate|only|price))?$`, 'i')
  if (tpOnlyRe.test(t)) {
    out.discountPct = 0
    out.isTradePrice = true
    out.summary = 'TP (0% discount)'
    return out
  }

  // Strip leading/trailing TP markers when combined with a discount or carton offer (e.g. "1TP COTON 8%", "TP 12%", "T.P - 10%")
  const tpMarkerRe = new RegExp(String.raw`\b${TP_TOKEN}\b|(?:^|\s)[1il!|]?t\.?p\.?(?=\s|$|-|/)`, 'gi')
  if (tpMarkerRe.test(t)) {
    out.isTradePrice = true
    t = t.replace(tpMarkerRe, ' ')
  }

  // Extract Carton / Full Box ("COTON 8%", "CARTON 8%", "FULL BOX 8%", or "8% COTON")
  const cartonAfterRe = new RegExp(String.raw`\b${CARTON_KW}\s*[:=-]?\s*${NUM}\s*%`, 'i')
  const cartonBeforeRe = new RegExp(String.raw`${NUM}\s*%\s*${CARTON_KW}\b`, 'i')
  const mCartonAfter = cartonAfterRe.exec(t)
  if (mCartonAfter) {
    out.cartonDiscountPct = n(mCartonAfter[1])
    t = t.replace(mCartonAfter[0], ' ')
  } else {
    const mCartonBefore = cartonBeforeRe.exec(t)
    if (mCartonBefore) {
      out.cartonDiscountPct = n(mCartonBefore[1])
      t = t.replace(mCartonBefore[0], ' ')
    }
  }

  // Extract Carton / Full Box flat rate if written like "COTON 220" or "CARTON Rs 220" (without %)
  if (out.cartonDiscountPct === null) {
    const cartonRateRe = new RegExp(String.raw`\b${CARTON_KW}\s*[:=-]?\s*(?:rs\.?|pkr|₨)?\s*${NUM}(?!\s*%)`, 'i')
    const mCartonRate = cartonRateRe.exec(t)
    if (mCartonRate) {
      out.cartonRate = n(mCartonRate[1])
      t = t.replace(mCartonRate[0], ' ')
    }
  }

  const buyGet = new RegExp(String.raw`buy\s*${NUM}\s*(?:,|and|&)?\s*get\s*${NUM}(?:\s*free)?`).exec(t)
  if (buyGet) {
    out.bonusBuy = n(buyGet[1])
    out.bonusFree = n(buyGet[2])
    t = t.replace(buyGet[0], ' ')
  }

  const pctRe = new RegExp(NUM + String.raw`\s*%`, 'g')
  const pcts = [...t.matchAll(pctRe)]
  if (pcts.length === 1) {
    out.discountPct = n(pcts[0][1])
    t = t.replace(pcts[0][0], ' ')
  } else if (pcts.length > 1) {
    out.ambiguous = true
    out.notes.push('Several percentages found; confirm whether they stack.')
    t = t.replace(pctRe, ' ')
  }

  // If only a carton discount percentage was given (e.g. "COTON 8%") and no other percentage,
  // use cartonDiscountPct as the primary discountPct unless TP was explicitly specified alongside it.
  if (out.discountPct === null && out.cartonDiscountPct !== null) {
    out.discountPct = out.isTradePrice ? 0 : out.cartonDiscountPct
  } else if (out.discountPct === null && out.isTradePrice) {
    out.discountPct = 0
  }

  const flat =
    new RegExp(String.raw`(?:rs\.?|pkr|₨)\s*${NUM}`).exec(t) ?? new RegExp(String.raw`${NUM}\s*(?:rs\.?|pkr|₨)(?![a-z])`).exec(t)
  if (flat) {
    out.flatDiscount = n(flat[1])
    t = t.replace(flat[0], ' ')
  }

  if (out.bonusBuy === null) {
    const plus = [...t.matchAll(new RegExp(NUM + String.raw`\s*(?:\+|&)\s*` + NUM, 'g'))]
    if (plus.length === 1) {
      out.bonusBuy = n(plus[0][1])
      out.bonusFree = n(plus[0][2])
      t = t.replace(plus[0][0], ' ')
    } else if (plus.length > 1) {
      out.ambiguous = true
      out.notes.push('Several X+Y patterns found.')
      t = t.replace(new RegExp(NUM + String.raw`\s*(?:\+|&)\s*` + NUM, 'g'), ' ')
    }
  }

  const left = t
    .replace(new RegExp(String.raw`\b${CARTON_KW}\b`, 'gi'), ' ')
    .replace(/\b(discount|disc|off|scheme|free|bonus|extra|on|per|unit|pack|of|the|and|net|less|rate|price|full|loose)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
  if (left) {
    out.ambiguous = true
    out.notes.push(`Could not interpret "${left}".`)
  }

  // Build a clean human-readable summary
  const parts: string[] = []
  if (out.isTradePrice && (out.discountPct === 0 || out.discountPct === null)) {
    parts.push('TP (0% discount)')
  } else if (out.discountPct !== null) {
    if (out.cartonDiscountPct !== null && out.discountPct === out.cartonDiscountPct && !out.isTradePrice) {
      parts.push(`Full box (carton) ${out.cartonDiscountPct}% discount`)
    } else {
      parts.push(`${out.discountPct}% discount`)
    }
  }
  if (out.cartonDiscountPct !== null && !(out.discountPct === out.cartonDiscountPct && !out.isTradePrice)) {
    parts.push(`Full box (carton) ${out.cartonDiscountPct}%`)
  }
  if (out.cartonRate !== null) {
    parts.push(`Full box (carton) Rs ${out.cartonRate}`)
  }
  if (out.flatDiscount !== null) {
    parts.push(`Rs ${out.flatDiscount} off`)
  }
  if (out.bonusBuy !== null && out.bonusFree !== null) {
    parts.push(`Bonus ${out.bonusBuy}+${out.bonusFree}`)
  }
  if (parts.length > 0) {
    out.summary = parts.join(' · ')
  }

  return out
}

export interface ParsedOfferCell {
  /** Numeric base price in Rs if the cell contains a Rupee rate, or null if the cell is a TP / % / carton offer */
  price: number | null
  /** Parsed scheme/discount components when the Offer Rate cell contains TP, %, carton discount, or bonus */
  scheme: SchemeComponents | null
}

/**
 * Parse a cell from the "Offer Rate / Price" column.
 * Supports:
 * 1. Standard numeric prices ("145", "1,250.50", "Rs. 480")
 * 2. Trade Price markers ("TP", "1TP", "T.P", "NET TP") -> 0% discount
 * 3. Percentage & Carton/Full-box discounts ("15% COTON 8%", "COTON 8%", "↑ 12%", "12%")
 * 4. Numeric base price followed by carton/scheme info ("240 COTON 8%", "240 COTON 220")
 */
export function parseOfferRateCell(raw: string | null | undefined): ParsedOfferCell {
  const s = (raw ?? '').trim()
  if (!s) return { price: null, scheme: null }

  // If the cell does not contain %, +, TP, or carton/box keywords, try parsing as a plain Rupee number
  const hasSchemeTokens =
    /%|\+/.test(s) ||
    new RegExp(String.raw`(?:^|\s|[0-9])${TP_TOKEN}(?:\s|$)|^${TP_TOKEN}$|\b${CARTON_KW}\b`, 'i').test(s)

  if (!hasSchemeTokens) {
    const num = parseNumber(s)
    return { price: num, scheme: null }
  }

  // Check if the cell starts with a plain Rupee price followed by carton/discount info (e.g. "240 COTON 8%" or "240 COTON 220")
  const leadingPriceRe = new RegExp(String.raw`^(?:rs\.?|pkr|₨)?\s*${NUM}\s+(${CARTON_KW}\b.*)$`, 'i')
  const mLead = leadingPriceRe.exec(s)
  if (mLead) {
    const base = n(mLead[1])
    const restScheme = parseSchemeText(mLead[2])
    if (!restScheme.ambiguous) {
      return { price: base, scheme: restScheme }
    }
  }

  // Otherwise parse the cell as a Trade Price / percentage / carton discount / bonus scheme
  const scheme = parseSchemeText(s)
  const hasValidScheme =
    !scheme.ambiguous &&
    (scheme.isTradePrice ||
      scheme.discountPct !== null ||
      scheme.cartonDiscountPct !== null ||
      scheme.cartonRate !== null ||
      scheme.flatDiscount !== null ||
      (scheme.bonusBuy !== null && scheme.bonusFree !== null))

  if (hasValidScheme) {
    return { price: null, scheme }
  }

  return { price: null, scheme: null }
}

export const money = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100

export function calculateEffectiveCost(i: CostInput): CostResult {
  const steps: string[] = []
  const base = i.basePrice
  if (base == null || Number.isNaN(base)) return { status: 'missing', effective: null, steps: ['No price supplied.'] }
  if (base < 0) return { status: 'invalid', effective: null, steps: ['Negative price.'] }
  if (base === 0) return { status: 'invalid', effective: null, steps: ['Price is zero.'] }

  const pct = i.discountPct ?? null
  const flat = i.flatDiscount ?? null
  const buy = i.bonusBuy ?? null
  const free = i.bonusFree ?? null

  if (pct != null && (pct < 0 || pct >= 100)) return { status: 'invalid', effective: null, steps: [`Invalid discount ${pct}%.`] }
  if (flat != null && (flat < 0 || flat >= base)) return { status: 'invalid', effective: null, steps: [`Invalid flat discount Rs ${flat}.`] }
  if ((buy != null || free != null) && (!buy || buy <= 0 || !free || free <= 0)) {
    return { status: 'invalid', effective: null, steps: [`Invalid bonus scheme ${buy ?? '?'}+${free ?? '?'}.`] }
  }

  const useDiscounts = !i.priceIsNet
  const hasPct = useDiscounts && pct != null && pct > 0
  const hasFlat = useDiscounts && flat != null && flat > 0
  const hasBonus = buy != null && free != null
  const kinds = [hasPct, hasFlat, hasBonus].filter(Boolean).length
  if (i.priceIsNet && ((pct ?? 0) > 0 || (flat ?? 0) > 0)) steps.push('Price is already net of discount: discount not applied again.')

  let status: SchemeStatus = 'ok'
  if (i.ambiguous) {
    status = 'review'
    steps.push('Scheme text is ambiguous: needs review.')
  }
  if (kinds > 1 && !i.combine) {
    status = 'review'
    steps.push('Multiple discount types present; stacking not confirmed, so this offer is not ranked.')
  }

  let cost = base
  steps.push(`Base price Rs ${fmt(base)}`)
  if (hasPct) {
    const d = (cost * pct!) / 100
    steps.push(`Discount ${pct}% = Rs ${fmt(d)} -> Rs ${fmt(cost - d)}`)
    cost -= d
  }
  if (hasFlat) {
    steps.push(`Flat discount Rs ${fmt(flat!)} -> Rs ${fmt(cost - flat!)}`)
    cost -= flat!
  }
  if (hasBonus) {
    const total = buy! + free!
    const eff = (cost * buy!) / total
    steps.push(`Bonus ${buy}+${free}: pay for ${buy}, receive ${total} -> Rs ${fmt(cost)} x ${buy} / ${total} = Rs ${fmt(eff)} per unit`)
    cost = eff
  }
  if (cost <= 0) return { status: 'invalid', effective: null, steps: [...steps, 'Resulting cost is not positive.'] }
  steps.push(`Effective cost per unit: Rs ${fmt(money(cost))}`)
  return { status, effective: cost, steps }
}

function fmt(x: number): string {
  return (Math.round(x * 10000) / 10000).toLocaleString('en-PK', { maximumFractionDigits: 4 })
}

/** Parse numbers written like "1,250.50", "Rs. 1250", "12%" -> number, or null when not numeric. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).trim()
  if (!s) return null
  s = s.replace(/rs\.?|pkr|₨|%/gi, '').replace(/[\s,]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return parseFloat(s)
}
