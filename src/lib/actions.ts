// Mutations shared by several pages. All of them write to the shared database; RLS enforces who may do what.
import { parseTitle, identityKey } from './productParse'
import { supabase, updateChecked } from './supabase'
import type { Product, SourceAttrs, WishlistItem } from './types'

const must = <T extends { error: { message: string } | null }>(r: T): T => {
  if (r.error) throw new Error(r.error.message)
  return r
}

export async function addToWishlist(productId: string, priority: WishlistItem['priority'] = 'medium') {
  const { error } = await supabase.from('wishlist_items').insert({ product_id: productId, priority })
  // unique (workspace, product): the other partner may already have added it, which is fine
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message)
}

export async function removeFromWishlist(id: string) {
  must(await supabase.from('wishlist_items').delete().eq('id', id))
}

export async function updateWishlist(item: WishlistItem, patch: Partial<Pick<WishlistItem, 'priority' | 'status' | 'notes' | 'last_checked_at'>>) {
  await updateChecked('wishlist_items', item.id, item.updated_at, patch)
}

export async function confirmMatch(recordId: string, productId: string) {
  must(await supabase.rpc('rematch_price_record', { p_record: recordId, p_product: productId, p_save_decision: true }))
}

export async function markUnmatched(recordId: string) {
  must(await supabase.rpc('rematch_price_record', { p_record: recordId, p_product: null, p_save_decision: false }))
}

export async function rejectMatch(recordId: string, productId: string) {
  must(await supabase.rpc('reject_match', { p_record: recordId, p_product: productId }))
}

export async function undoDecision(decisionId: string) {
  must(await supabase.rpc('undo_match_decision', { p_decision: decisionId }))
}

/** Create a canonical product from a supplier row's own attributes (never from another product). */
export async function createProductFromSource(title: string, attrs: SourceAttrs | null): Promise<Product> {
  const p = parseTitle(title)
  const a = attrs
  const row = {
    name: title.trim(),
    normalized_name: p.name,
    brand: a?.brand ?? null,
    manufacturer: a?.manufacturer ?? null,
    strength_value: a?.strength_value ?? p.strengthValue,
    strength_unit: a?.strength_unit ?? p.strengthUnit,
    weight_value: a?.weight_value ?? p.weightValue,
    weight_unit: a?.weight_unit ?? p.weightUnit,
    pack_size: a?.pack_size ?? p.packSize,
    dosage_form: a?.dosage_form ?? p.dosageForm,
    barcode: a?.barcode ?? null,
    mfr_code: a?.mfr_code ?? null,
  }
  const identity_key = identityKey({
    normalizedName: row.normalized_name, strengthValue: row.strength_value, strengthUnit: row.strength_unit,
    weightValue: row.weight_value, weightUnit: row.weight_unit, packSize: row.pack_size, dosageForm: row.dosage_form,
    manufacturer: row.manufacturer,
  })
  const { data, error } = await supabase.from('products').insert({ ...row, identity_key }).select('*').single()
  if (error) {
    if (/duplicate key/i.test(error.message)) throw new Error('An identical product already exists in the Product Master. Use "Select another product" and pick it.')
    throw new Error(error.message)
  }
  return data as Product
}
