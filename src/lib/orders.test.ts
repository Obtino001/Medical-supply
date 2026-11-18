import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertProductMatchesOrderCompany,
  buildCompanyProductCatalog,
  calculateLineTotal,
  calculateOrderTotals,
  calculateTargetPrice,
  evaluateProductSupplierOffers,
  generateNextOrderNumber,
  toSupplierSnapshots,
} from './orders'
import { parseTitle } from './productParse'
import { generatePurchaseOrderPdf } from './purchaseOrderPdf'
import type { PriceRecord, Product, PurchaseOrder, Shop } from './types'

let seq = 0
function mkProd(name: string, extra: Partial<Product> = {}): Product {
  const p = parseTitle(name)
  return {
    id: 'oprod_' + ++seq,
    product_no: seq,
    name,
    normalized_name: p.name,
    brand: null,
    manufacturer: 'Bosch Pharmaceuticals',
    country_of_origin: p.countryOfOrigin,
    active_ingredient: null,
    strength_value: p.strengthValue,
    strength_unit: p.strengthUnit,
    weight_value: p.weightValue,
    weight_unit: p.weightUnit,
    pack_size: p.packSize,
    dosage_form: p.dosageForm,
    variant: null,
    barcode: null,
    mfr_code: null,
    notes: null,
    archived: false,
    created_at: '2026-11-18T00:00:00Z',
    updated_at: '2026-11-18T00:00:00Z',
    ...extra,
  }
}

function mkRec(over: Partial<PriceRecord>): PriceRecord {
  return {
    id: 'orec_' + ++seq,
    product_id: null,
    shop_id: 'S1',
    survey_id: 'sv1',
    import_job_id: null,
    observed_on: '2026-11-18',
    original_title: 'Item',
    original_code: null,
    base_price: null,
    mrp: null,
    discount_pct: null,
    flat_discount: null,
    scheme_text: null,
    bonus_buy: null,
    bonus_free: null,
    min_order_qty: null,
    pack_size: null,
    availability: null,
    expiry: null,
    valid_until: null,
    tax_included: null,
    price_is_net: false,
    combine_discounts: false,
    effective_cost: null,
    scheme_status: 'ok',
    calc_notes: null,
    match_status: 'exact',
    match_candidates: null,
    source_attrs: null,
    updated_at: '2026-11-18T00:00:00Z',
    notes: null,
    archived: false,
    created_at: '2026-11-18T00:00:00Z',
    ...over,
  }
}

const SHOPS = new Map<string, Shop>([
  ['S1', { id: 'S1', name: 'Kirpal Medicos' } as Shop],
  ['S2', { id: 'S2', name: 'Noman Impex' } as Shop],
  ['S3', { id: 'S3', name: 'Al-Madina Wholesale' } as Shop],
  ['S4', { id: 'S4', name: 'Foreign Quote USD' } as Shop],
])

describe('Feature 2, 3, 4 — Purchase Orders, -5% Negotiation Target, Company Separation, PDF & RLS', () => {
  it('5 & 6. Compares supplier prices accurately, excludes incompatible variants/currencies, and flags stale dates', () => {
    const boschItem = mkProd("Cefspan 400mg Cap 5's", {
      manufacturer: 'Bosch Pharmaceuticals',
      pack_size: 5,
    })

    const records: PriceRecord[] = [
      mkRec({
        product_id: boschItem.id,
        shop_id: 'S1',
        observed_on: '2026-11-16',
        base_price: 1000,
        discount_pct: 5,
        scheme_text: '5% discount',
        effective_cost: 950,
      }),
      mkRec({
        product_id: boschItem.id,
        shop_id: 'S2',
        observed_on: '2026-11-12',
        base_price: 1000,
        discount_pct: 2,
        effective_cost: 980,
      }),
      // Incompatible pack size (10 instead of 5) -> MUST NOT be compared as lowest even if cheaper per pack or lower number
      mkRec({
        product_id: boschItem.id,
        shop_id: 'S3',
        observed_on: '2026-11-17',
        pack_size: 10,
        base_price: 800,
        effective_cost: 800,
      }),
      // Incompatible currency (USD) -> MUST NOT be mixed into PKR lowest comparison
      mkRec({
        product_id: boschItem.id,
        shop_id: 'S4',
        observed_on: '2026-11-17',
        base_price: 5,
        effective_cost: 5,
        source_attrs: {
          brand: null,
          manufacturer: 'Bosch Pharmaceuticals',
          currency: 'USD',
          barcode: null,
          mfr_code: null,
          strength_value: 400,
          strength_unit: 'mg',
          weight_value: null,
          weight_unit: null,
          pack_size: 5,
          dosage_form: 'capsule',
        },
      }),
    ]

    const pricing = evaluateProductSupplierOffers(boschItem, records, SHOPS, {
      freshnessDays: 15,
      excludeStale: false,
      today: new Date('2026-11-18T12:00:00Z'),
    })

    expect(pricing.lowestPrice).toBe(950)
    expect(pricing.lowestShopId).toBe('S1')
    expect(pricing.lowestDate).toBe('2026-11-16')
    expect(pricing.hasIncompatibleVariants).toBe(true)
    expect(pricing.hasIncompatibleCurrencies).toBe(true)
    expect(pricing.offers.find((o) => o.rec.shop_id === 'S3')?.comparable).toBe(false)
    expect(pricing.offers.find((o) => o.rec.shop_id === 'S4')?.comparable).toBe(false)

    // Outdated quote (>15 days) shows age and stale flag, and can be excluded when fresh-only comparison is chosen
    const staleRec = mkRec({
      product_id: boschItem.id,
      shop_id: 'S2',
      observed_on: '2026-09-01',
      base_price: 900,
      effective_cost: 900,
    })
    const withStale = evaluateProductSupplierOffers(boschItem, [records[0], staleRec], SHOPS, {
      freshnessDays: 15,
      excludeStale: false,
      today: new Date('2026-11-18T12:00:00Z'),
      includeStaleInLowest: true,
    })
    expect(withStale.hasStaleOffers).toBe(true)
    expect(withStale.lowestIsStale).toBe(true)
    expect(withStale.lowestDate).toBe('2026-09-01')

    const freshOnly = evaluateProductSupplierOffers(boschItem, [records[0], staleRec], SHOPS, {
      freshnessDays: 15,
      excludeStale: false,
      today: new Date('2026-11-18T12:00:00Z'),
      includeStaleInLowest: false,
    })
    expect(freshOnly.lowestPrice).toBe(950)
    expect(freshOnly.lowestIsStale).toBe(false)
  })

  it('7, 8 & 10. Computes additional 5% negotiation target (950 -> 902.50), manual overrides, line & grand totals', () => {
    expect(calculateTargetPrice(950, 5)).toBe(902.5)
    expect(calculateTargetPrice(1000, 5)).toBe(950)
    expect(calculateTargetPrice(null, 5)).toBeNull()

    expect(calculateLineTotal(4, 902.5)).toBe(3610)
    expect(calculateLineTotal(0, 902.5)).toBeNull()

    // Simulate draft PO editing: item 1 auto (-5%), item 2 manually edited target price & qty
    const summary = calculateOrderTotals([
      { quantity: 4, lowest_price: 950, target_price: 902.5 },
      { quantity: 10, lowest_price: 200, target_price: 185 }, // manual edit from 190 -> 185
    ])
    expect(summary.totalItems).toBe(2)
    expect(summary.totalUnits).toBe(14)
    expect(summary.marketTotal).toBe(4 * 950 + 10 * 200)
    expect(summary.targetTotal).toBe(3610 + 1850)
    expect(summary.estimatedExtraSavings).toBe(5800 - 5460)
  })

  it('9. Enforces strict company-wise order separation and deduplicates catalog per company A-Z', () => {
    const bosch1 = mkProd('Zestril 10mg Tab', { manufacturer: 'Bosch' })
    const bosch2 = mkProd('Amkay 500mg Inj', { manufacturer: 'Bosch Pharmaceuticals' })
    const getzProd = mkProd('Risek 40mg Cap', { manufacturer: 'Getz Pharma' })

    expect(assertProductMatchesOrderCompany('Bosch Pharmaceuticals', bosch1, [])).toBe('Bosch Pharmaceuticals')
    expect(() => assertProductMatchesOrderCompany('Bosch Pharmaceuticals', getzProd, [])).toThrow(
      /Orders are separated by company/,
    )

    const catalog = buildCompanyProductCatalog('Bosch Pharmaceuticals', [bosch1, getzProd, bosch2], [])
    expect(catalog.map((c) => c.product.name)).toEqual(['Amkay 500mg Inj', 'Zestril 10mg Tab'])

    const nextNum = generateNextOrderNumber(
      [{ order_number: 'PO-20261118-001' } as PurchaseOrder, { order_number: 'PO-20261118-004' } as PurchaseOrder],
      '2026-11-18',
    )
    expect(nextNum).toBe('PO-20261118-005')
  })

  it('11. Generates spec-compliant HAFSA MEDICALS PURCHASE ORDER PDF with totals, supplier quotes, and negotiation disclaimer', () => {
    const prod = mkProd("Cefspan 400mg Cap 5's", { manufacturer: 'Bosch Pharmaceuticals' })
    const recs: PriceRecord[] = [
      mkRec({ product_id: prod.id, shop_id: 'S1', observed_on: '2026-11-16', base_price: 950, effective_cost: 950 }),
      mkRec({ product_id: prod.id, shop_id: 'S2', observed_on: '2026-11-10', base_price: 985, effective_cost: 985 }),
    ]
    const pricing = evaluateProductSupplierOffers(prod, recs, SHOPS, {
      freshnessDays: 15,
      excludeStale: false,
      today: new Date('2026-11-18T12:00:00Z'),
    })

    const pdf = generatePurchaseOrderPdf({
      orderNumber: 'PO-20261118-001',
      dateLabel: '18 Nov 2026',
      manufacturer: 'Bosch Pharmaceuticals',
      status: 'draft',
      extraDiscountPct: 5,
      notes: 'Deliver urgent stock.',
      lines: [
        {
          productName: prod.name,
          variantLabel: '400mg - 5 pcs - capsule',
          manufacturer: 'Bosch Pharmaceuticals',
          quantity: 10,
          lowestPrice: pricing.lowestPrice,
          lowestShopName: pricing.lowestShopName,
          lowestPriceDate: pricing.lowestDate,
          targetPrice: pricing.targetPrice5Pct,
          isTargetManual: false,
          offers: toSupplierSnapshots(pricing.offers),
        },
      ],
    })

    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('HAFSA MEDICALS')
    expect(text).toContain('PURCHASE ORDER')
    expect(text).toContain('PO-20261118-001')
    expect(text).toContain('Bosch Pharmaceuticals')
    expect(text).toContain('Kirpal Medicos: Rs 950')
    expect(text).toContain('Rs 902.50')
    expect(text).toContain('Rs 9,025')
    expect(text).toContain('REQUESTED NEGOTIATION PRICE')
    expect(text).toContain('NOT a confirmed supplier price')

    const startXrefMatch = /startxref\n(\d+)\n%%EOF/.exec(text)
    expect(startXrefMatch).not.toBeNull()
    const xrefPos = Number(startXrefMatch![1])
    expect(text.slice(xrefPos, xrefPos + 5)).toBe('xref\n')
    const xrefLines = text.slice(xrefPos).split('\n')
    const objCount = Number(xrefLines[1].split(' ')[1])
    for (let id = 1; id < objCount; id++) {
      const entryOffset = Number(xrefLines[2 + id].slice(0, 10))
      expect(text.slice(entryOffset, entryOffset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
  })

  it('12. Migration 0004 enforces workspace RLS for both members, blocks cross-manufacturer items, and frontend never uses service_role', () => {
    const migSql = resolve(__dirname, '../../supabase/migrations/0004_matching_country_and_orders.sql')
    const sql = readFileSync(migSql, 'utf8')
    expect(sql).toMatch(/alter table public\.%I enable row level security/i)
    expect(sql).toMatch(/public\.is_member\(workspace_id\)/i)
    expect(sql).toContain('create table if not exists public.purchase_orders')
    expect(sql).toContain('create table if not exists public.purchase_order_items')
    expect(sql).toContain('create table if not exists public.manufacturer_mappings')
    expect(sql).toContain('enforce_po_item_company')
    expect(sql).not.toMatch(/create\s+policy.*using\s*\(\s*true\s*\)/i)

    const supaClient = readFileSync(resolve(__dirname, './supabase.ts'), 'utf8')
    expect(supaClient).toContain('service_role')
    expect(supaClient).toContain('throw new Error')
  })
})
