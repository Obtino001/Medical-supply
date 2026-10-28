// Combines validated rows + match results + user choices into the payload for the atomic commit_import RPC.
import type { BuiltRow } from './importBuild'
import { matchProduct, type CatalogProduct, type MatchIndex, type MatchResult } from './matching'
import { identityKey } from './productParse'

export type Choice =
  | { action: 'use'; productId: string }
  | { action: 'new' }
  | { action: 'later' } // import now, resolve in the Review page
  | { action: 'skip' }

export interface RowMatch {
  match: MatchResult
  choice: Choice
}

export function defaultChoice(row: BuiltRow, match: MatchResult): Choice {
  if (row.kind === 'invalid' || row.kind === 'duplicate') return { action: 'skip' }
  if (match.productId && (match.confidence === 'exact' || match.confidence === 'high')) return { action: 'use', productId: match.productId }
  if (match.confidence === 'needs_review' || match.confidence === 'conflicting') return { action: 'later' }
  return { action: 'new' }
}

export function runMatching(rows: BuiltRow[], idx: MatchIndex, shopId: string): Map<number, RowMatch> {
  const out = new Map<number, RowMatch>()
  for (const row of rows) {
    const match = matchProduct(idx, shopId, row.incoming)
    out.set(row.rowNumber, { match, choice: defaultChoice(row, match) })
  }
  return out
}

export interface CommitPayload {
  rows: Record<string, unknown>[]
  newProducts: Record<string, unknown>[]
  summary: { imported: number; skipped: number; errors: number; newProducts: number; needsReview: number }
}

export function buildCommitPayload(rows: BuiltRow[], matches: Map<number, RowMatch>, catalog: CatalogProduct[]): CommitPayload {
  const existingByIdentity = new Map<string, string>()
  for (const p of catalog) {
    existingByIdentity.set(
      identityKey({
        normalizedName: p.normalized_name, strengthValue: p.strength_value, strengthUnit: p.strength_unit,
        weightValue: p.weight_value, weightUnit: p.weight_unit, packSize: p.pack_size, dosageForm: p.dosage_form,
        manufacturer: p.manufacturer,
      }),
      p.id,
    )
  }
  const newByKey = new Map<string, Record<string, unknown>>()
  const outRows: Record<string, unknown>[] = []
  const summary = { imported: 0, skipped: 0, errors: 0, newProducts: 0, needsReview: 0 }

  for (const row of rows) {
    const rm = matches.get(row.rowNumber)
    const choice: Choice = rm?.choice ?? { action: 'skip' }
    const base = { row_number: row.rowNumber, raw: row.raw }
    if (row.kind === 'invalid') {
      outRows.push({ ...base, status: 'error', error: row.errors.join('; ') })
      summary.errors++
      continue
    }
    if (row.kind === 'duplicate' || choice.action === 'skip') {
      outRows.push({ ...base, status: 'skipped', error: row.kind === 'duplicate' ? 'Duplicate row' : 'Skipped by user' })
      summary.skipped++
      continue
    }

    let productId: string | null = null
    let tempKey: string | null = null
    let matchStatus: string = 'unmatched'
    let saveDecision = false
    const inc = row.incoming

    if (choice.action === 'use') {
      productId = choice.productId
      const auto = rm!.match
      const confirmedAuto = auto.productId === choice.productId && (auto.confidence === 'exact' || auto.confidence === 'high')
      matchStatus = confirmedAuto ? auto.confidence : 'manual'
      saveDecision = !confirmedAuto
    } else if (choice.action === 'new') {
      const existing = existingByIdentity.get(row.identity)
      if (existing) {
        productId = existing
        matchStatus = 'exact'
      } else {
        tempKey = row.identity
        matchStatus = 'exact'
        if (!newByKey.has(tempKey)) {
          newByKey.set(tempKey, {
            temp_key: tempKey, name: inc.title.trim(), normalized_name: inc.normalizedName, brand: inc.brand,
            manufacturer: inc.manufacturer, strength_value: inc.strengthValue, strength_unit: inc.strengthUnit,
            weight_value: inc.weightValue, weight_unit: inc.weightUnit, pack_size: inc.packSize, dosage_form: inc.dosageForm,
            barcode: inc.barcode, mfr_code: inc.mfrCode, identity_key: row.identity,
          })
        }
      }
      saveDecision = true
    } else {
      const mc = rm?.match.confidence
      matchStatus = mc === 'needs_review' || mc === 'conflicting' ? mc : 'unmatched'
      summary.needsReview++
    }

    outRows.push({
      ...base,
      status: 'import',
      product_id: productId,
      temp_key: tempKey,
      source_key: inc.sourceKey,
      save_decision: saveDecision,
      match_status: matchStatus,
      match_candidates: choice.action === 'later' && rm!.match.candidates.length ? rm!.match.candidates : null,
      source_attrs: {
        brand: inc.brand, manufacturer: inc.manufacturer, barcode: inc.barcode, mfr_code: inc.mfrCode,
        strength_value: inc.strengthValue, strength_unit: inc.strengthUnit, weight_value: inc.weightValue,
        weight_unit: inc.weightUnit, pack_size: inc.packSize, dosage_form: inc.dosageForm,
        offer_raw: row.offerRaw, base_discount_pct: row.baseDiscountPct, carton_discount_pct: row.cartonDiscountPct,
        carton_rate: row.cartonRate, is_trade_price: row.isTradePrice,
      },
      original_title: row.title,
      original_code: row.code,
      base_price: row.price,
      mrp: row.mrp,
      discount_pct: row.discountPct,
      flat_discount: row.flatDiscount,
      scheme_text: row.schemeText,
      bonus_buy: row.bonusBuy,
      bonus_free: row.bonusFree,
      min_order_qty: row.minOrderQty,
      pack_size: row.packSize,
      availability: row.availability,
      expiry: row.expiry,
      tax_included: row.taxIncluded,
      price_is_net: row.priceIsNet,
      combine_discounts: row.combine,
      effective_cost: row.cost.effective,
      scheme_status: row.cost.status,
      calc_notes: row.cost.steps.join('\n'),
      notes: row.notes,
    })
    summary.imported++
  }
  summary.newProducts = newByKey.size
  return { rows: outRows, newProducts: [...newByKey.values()], summary }
}
