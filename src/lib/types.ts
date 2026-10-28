export type Role = 'admin' | 'partner'

export interface Shop {
  id: string
  shop_no: number
  name: string
  owner_name: string | null
  phone: string | null
  address: string | null
  city: string | null
  notes: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface Survey {
  id: string
  survey_no: number
  shop_id: string
  survey_date: string
  notes: string | null
  created_at: string
  created_by: string | null
}

export interface Product {
  id: string
  product_no: number
  name: string
  normalized_name: string
  brand: string | null
  manufacturer: string | null
  active_ingredient: string | null
  strength_value: number | null
  strength_unit: string | null
  weight_value: number | null
  weight_unit: 'g' | 'ml' | null
  pack_size: number | null
  dosage_form: string | null
  variant: string | null
  barcode: string | null
  mfr_code: string | null
  notes: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface SourceAttrs {
  brand: string | null
  manufacturer: string | null
  barcode: string | null
  mfr_code: string | null
  strength_value: number | null
  strength_unit: string | null
  weight_value: number | null
  weight_unit: 'g' | 'ml' | null
  pack_size: number | null
  dosage_form: string | null
  /** Offer-rate cell exactly as imported (e.g. "15% COTON 8%", "TP"); scheme_text holds a normalized summary */
  offer_raw?: string | null
  /** Plain (non-carton) discount % parsed from the offer cell; null for TP / carton-only / unparsed */
  base_discount_pct?: number | null
  carton_discount_pct?: number | null
  carton_rate?: number | null
  is_trade_price?: boolean
}

export interface PriceRecord {
  id: string
  product_id: string | null
  shop_id: string
  survey_id: string
  import_job_id: string | null
  observed_on: string
  original_title: string
  original_code: string | null
  base_price: number | null
  mrp: number | null
  discount_pct: number | null
  flat_discount: number | null
  scheme_text: string | null
  bonus_buy: number | null
  bonus_free: number | null
  min_order_qty: number | null
  pack_size: number | null
  availability: string | null
  expiry: string | null
  valid_until: string | null
  tax_included: boolean | null
  price_is_net: boolean
  combine_discounts: boolean
  effective_cost: number | null
  scheme_status: 'ok' | 'review' | 'invalid' | 'missing'
  calc_notes: string | null
  match_status: 'exact' | 'high' | 'needs_review' | 'unmatched' | 'manual' | 'conflicting'
  match_candidates: { productId: string; reason: string; conflicts?: string[] }[] | null
  source_attrs: SourceAttrs | null
  updated_at: string
  created_by?: string | null
  notes: string | null
  archived: boolean
  created_at: string
}

/** Minimal columns used for history analysis. */
export interface RecordLite {
  id: string
  product_id: string | null
  shop_id: string
  observed_on: string
  effective_cost: number | null
  scheme_status: PriceRecord['scheme_status']
  created_at: string
}

export interface OpportunityStatus {
  product_id: string
  status: 'interesting' | 'verify' | 'contact' | 'purchased' | 'not_interested'
  note: string | null
}

export interface Member {
  user_id: string
  role: Role
  email: string | null
  display_name: string | null
}

export interface WishlistItem {
  id: string
  product_id: string
  priority: 'high' | 'medium' | 'low'
  status: 'active' | 'needs_fresh_price' | 'checked'
  notes: string | null
  last_checked_at: string | null
  created_at: string
  created_by: string | null
  updated_at: string
}
