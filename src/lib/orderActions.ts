// Supabase persistence layer for shared workspace company-wise Purchase Orders & draft items.
import { resolveCanonicalCompany } from './companies'
import type { CompareOptions } from './compare'
import {
  assertProductMatchesOrderCompany,
  calculateTargetPrice,
  DEFAULT_EXTRA_DISCOUNT_PCT,
  evaluateProductSupplierOffers,
  roundMoney2,
  toSupplierSnapshots,
} from './orders'
import { variantLabel } from './productParse'
import { supabase } from './supabase'
import type { PriceRecord, Product, PurchaseOrder, PurchaseOrderItem, Shop } from './types'

function must<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message)
  return res
}

export interface CreatePurchaseOrderInput {
  manufacturer: string
  orderNumber: string
  title?: string
  orderDate?: string
  extraDiscountPct?: number
  notes?: string | null
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const mfr = resolveCanonicalCompany(input.manufacturer) ?? input.manufacturer.trim()
  if (!mfr) throw new Error('Manufacturer / company is required for a purchase order.')
  const orderDate = input.orderDate || new Date().toISOString().slice(0, 10)
  const title = input.title?.trim() || `${mfr} Order`
  const pct = input.extraDiscountPct ?? DEFAULT_EXTRA_DISCOUNT_PCT

  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({
      manufacturer: mfr,
      order_number: input.orderNumber.trim(),
      title,
      status: 'draft',
      order_date: orderDate,
      extra_discount_pct: pct,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as PurchaseOrder
}

export async function updatePurchaseOrder(
  orderId: string,
  patch: Partial<Pick<PurchaseOrder, 'title' | 'status' | 'order_date' | 'extra_discount_pct' | 'notes'>>,
): Promise<PurchaseOrder> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .update(patch)
    .eq('id', orderId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PurchaseOrder
}

export async function deletePurchaseOrder(orderId: string): Promise<void> {
  must(await supabase.from('purchase_orders').delete().eq('id', orderId))
}

export interface OrderItemAddInput {
  product: Product
  records: PriceRecord[]
  shops: Map<string, Shop>
  quantity: number
  targetPrice?: number | null
  isTargetManual?: boolean
  notes?: string | null
  opt: CompareOptions
}

export async function upsertPurchaseOrderItems(
  order: PurchaseOrder,
  items: OrderItemAddInput[],
  startSortOrder = 0,
): Promise<PurchaseOrderItem[]> {
  if (items.length === 0) return []

  const payload = items.map((it, idx) => {
    const validatedMfr = assertProductMatchesOrderCompany(order.manufacturer, it.product, it.records)
    const pricing = evaluateProductSupplierOffers(it.product, it.records, it.shops, it.opt)
    const defaultTarget = calculateTargetPrice(pricing.lowestPrice, order.extra_discount_pct)
    const isManual = Boolean(it.isTargetManual && it.targetPrice != null)
    const targetPrice = isManual ? roundMoney2(it.targetPrice!) : (it.targetPrice != null ? roundMoney2(it.targetPrice) : defaultTarget)
    const qty = Number.isFinite(it.quantity) && it.quantity > 0 ? Math.round(it.quantity * 100) / 100 : 1
    const vLabel = [variantLabel(it.product), it.product.country_of_origin].filter(Boolean).join(' · ') || null

    return {
      order_id: order.id,
      product_id: it.product.id,
      product_name: it.product.name,
      variant_label: vLabel,
      manufacturer: validatedMfr,
      quantity: qty,
      selected_shop_id: pricing.lowestShopId,
      selected_shop_name: pricing.lowestShopName,
      lowest_price: pricing.lowestPrice,
      lowest_price_date: pricing.lowestDate,
      target_price: targetPrice,
      is_target_manual: isManual,
      supplier_offers_snapshot: toSupplierSnapshots(pricing.offers),
      notes: it.notes?.trim() || null,
      sort_order: startSortOrder + idx,
    }
  })

  const inserted: PurchaseOrderItem[] = []
  for (let i = 0; i < payload.length; i += 100) {
    const chunk = payload.slice(i, i + 100)
    const { data, error } = await supabase
      .from('purchase_order_items')
      .upsert(chunk, { onConflict: 'order_id,product_id' })
      .select('*')
    if (error) throw new Error(error.message)
    if (data) inserted.push(...(data as PurchaseOrderItem[]))
  }
  return inserted
}

export async function updatePurchaseOrderItem(
  itemId: string,
  patch: Partial<
    Pick<
      PurchaseOrderItem,
      | 'quantity'
      | 'target_price'
      | 'is_target_manual'
      | 'notes'
      | 'selected_shop_id'
      | 'selected_shop_name'
      | 'lowest_price'
      | 'lowest_price_date'
      | 'supplier_offers_snapshot'
    >
  >,
): Promise<PurchaseOrderItem> {
  const { data, error } = await supabase
    .from('purchase_order_items')
    .update(patch)
    .eq('id', itemId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PurchaseOrderItem
}

export async function deletePurchaseOrderItem(itemId: string): Promise<void> {
  must(await supabase.from('purchase_order_items').delete().eq('id', itemId))
}
