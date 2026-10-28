// Discount / scheme parsing and effective-cost calculation. Pure functions.

export type SchemeStatus = 'ok' | 'review' | 'invalid' | 'missing'

export interface SchemeComponents {
  discountPct: number | null
  flatDiscount: number | null // per priced unit, in Rs
  bonusBuy: number | null
  bonusFree: number | null
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

function n(s: string): number {
  return parseFloat(s.replace(',', '.'))
}

/** Parse free text like "2%", "Rs. 20 discount", "10+1", "buy 10 get 1 free". Never guesses on ambiguity. */
export function parseSchemeText(text: string | null | undefined): SchemeComponents {
  const out: SchemeComponents = { discountPct: null, flatDiscount: null, bonusBuy: null, bonusFree: null, ambiguous: false, notes: [] }
  let t = (text ?? '').toString().trim().toLowerCase()
  if (!t || /^(-|--|n\/?a|nil|none|no|net|flat|flat rate)$/.test(t)) return out

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
    .replace(/\b(discount|disc|off|scheme|free|bonus|extra|on|per|unit|pack|of|the|and|net|less)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
  if (left) {
    out.ambiguous = true
    out.notes.push(`Could not interpret "${left}".`)
  }
  return out
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
