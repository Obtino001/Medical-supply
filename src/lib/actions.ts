// Mutations shared by several pages. All of them write to the shared database; RLS enforces who may do what.
import { parseTitle, identityKey } from './productParse'
import { fetchAll, supabase, updateChecked } from './supabase'
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

/** Delete products and their price records in safe chunks of 150 IDs so URL length limits are never exceeded. */
export async function deleteProductsByIds(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150)
    must(await supabase.from('price_records').delete().in('product_id', chunk))
    must(await supabase.from('products').delete().in('id', chunk))
  }
  return unique.length
}

/**
 * Remove any canonical products that belonged to a deleted shop/import/survey
 * and no longer have any price records from any other shop.
 */
async function deleteOrphanedProducts(candidateProductIds?: Set<string>): Promise<number> {
  const [allProducts, remainingRecords] = await Promise.all([
    fetchAll<{ id: string }>((a, b) => supabase.from('products').select('id').range(a, b)),
    fetchAll<{ product_id: string | null }>((a, b) =>
      supabase.from('price_records').select('product_id').not('product_id', 'is', null).range(a, b),
    ),
  ])
  const activeIds = new Set(remainingRecords.map((r) => r.product_id).filter((id): id is string => !!id))
  const toDelete = allProducts
    .map((p) => p.id)
    .filter((id) => !activeIds.has(id) && (!candidateProductIds || candidateProductIds.size === 0 || candidateProductIds.has(id)))
  return deleteProductsByIds(toDelete)
}

/**
 * Delete a shop along with all of its price records, imports, surveys, mappings,
 * and any products that only belonged to this shop (have no offers from other shops).
 */
export async function deleteShopWithItems(shopId: string): Promise<{ deletedOffers: number; deletedProducts: number }> {
  const [recs, aliases] = await Promise.all([
    fetchAll<{ id: string; product_id: string | null }>((a, b) =>
      supabase.from('price_records').select('id,product_id').eq('shop_id', shopId).range(a, b),
    ),
    fetchAll<{ product_id: string }>((a, b) =>
      supabase.from('product_aliases').select('product_id').eq('shop_id', shopId).range(a, b),
    ),
  ])

  const shopProductIds = new Set<string>()
  for (const r of recs) if (r.product_id) shopProductIds.add(r.product_id)
  for (const a of aliases) if (a.product_id) shopProductIds.add(a.product_id)

  // 1. Delete all dependent records in strict foreign-key order
  must(await supabase.from('price_records').delete().eq('shop_id', shopId))
  must(await supabase.from('import_jobs').delete().eq('shop_id', shopId))
  must(await supabase.from('surveys').delete().eq('shop_id', shopId))
  await supabase.from('match_decisions').delete().eq('shop_id', shopId)
  await supabase.from('match_rejections').delete().eq('shop_id', shopId)
  await supabase.from('product_aliases').delete().eq('shop_id', shopId)
  await supabase.from('product_identifiers').delete().eq('shop_id', shopId)
  await supabase.from('import_mapping_presets').delete().eq('shop_id', shopId)

  // 2. Delete the shop itself
  must(await supabase.from('shops').delete().eq('id', shopId))

  // 3. Delete products that belonged to this shop and have no offers from any other shop
  const deletedProducts = await deleteOrphanedProducts(shopProductIds)
  return { deletedOffers: recs.length, deletedProducts }
}

/** Delete a survey, its imports and price records, and any resulting orphaned products. */
export async function deleteSurveyWithItems(surveyId: string): Promise<{ deletedOffers: number; deletedProducts: number }> {
  const recs = await fetchAll<{ id: string; product_id: string | null }>((a, b) =>
    supabase.from('price_records').select('id,product_id').eq('survey_id', surveyId).range(a, b),
  )
  const productIds = new Set(recs.map((r) => r.product_id).filter((id): id is string => !!id))

  must(await supabase.from('price_records').delete().eq('survey_id', surveyId))
  must(await supabase.from('import_jobs').delete().eq('survey_id', surveyId))
  must(await supabase.from('surveys').delete().eq('id', surveyId))

  const deletedProducts = await deleteOrphanedProducts(productIds)
  return { deletedOffers: recs.length, deletedProducts }
}

/** Delete an import job, its price records, and any resulting orphaned products. */
export async function deleteImportJobWithItems(jobId: string): Promise<{ deletedOffers: number; deletedProducts: number }> {
  const recs = await fetchAll<{ id: string; product_id: string | null }>((a, b) =>
    supabase.from('price_records').select('id,product_id').eq('import_job_id', jobId).range(a, b),
  )
  const productIds = new Set(recs.map((r) => r.product_id).filter((id): id is string => !!id))

  must(await supabase.from('price_records').delete().eq('import_job_id', jobId))
  must(await supabase.from('import_jobs').delete().eq('id', jobId))

  const deletedProducts = await deleteOrphanedProducts(productIds)
  return { deletedOffers: recs.length, deletedProducts }
}
