import { describe, expect, it } from 'vitest'
import {
  buildOrderGroups,
  buildResolvedLines,
  buildWhatsAppOrderText,
  generateOrderPdf,
  parseOrderQtyNumber,
  pickDefaultShopForProduct,
} from './orderPrint'
import { parseTitle } from './productParse'
import type { PriceRecord, Product, Shop } from './types'

let seq = 0
function mkProd(name: string, extra: Partial<Product> = {}): Product {
  const p = parseTitle(name)
  return {
    id: 'op' + ++seq,
    product_no: seq,
    name,
    normalized_name: p.name,
    brand: null,
    manufacturer: 'Getz Pharma',
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
    created_at: '',
    updated_at: '',
    ...extra,
  }
}

function mkRec(over: Partial<PriceRecord>): PriceRecord {
  return {
    id: 'or' + ++seq,
    product_id: null,
    shop_id: 'S1',
    survey_id: 'sv1',
    import_job_id: null,
    observed_on: '2026-11-17',
    original_title: 'x',
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
    updated_at: '2026-11-17T00:00:00Z',
    notes: null,
    archived: false,
    created_at: '2026-11-17T00:00:00Z',
    ...over,
  }
}

const OPT = { freshnessDays: 15, excludeStale: false, today: new Date('2026-11-17T00:00:00') }

describe('order slip & PDF generation', () => {
  it('picks cheapest shop or highest discount shop by default and respects preferred/locked shop', () => {
    const p1 = mkProd('Risek 40mg Cap')
    const recs = [
      mkRec({ product_id: p1.id, shop_id: 'S1', base_price: 300, effective_cost: 270 }),
      mkRec({ product_id: p1.id, shop_id: 'S2', base_price: 290, effective_cost: 250 }),
    ]
    expect(pickDefaultShopForProduct(p1, recs, OPT)).toBe('S2')
    expect(pickDefaultShopForProduct(p1, recs, OPT, 'S1')).toBe('S1')

    const p2 = mkProd('Arinac Tab', { manufacturer: 'Abbott Laboratories Pakistan' })
    const discRecs = [
      mkRec({ product_id: p2.id, shop_id: 'S1', discount_pct: 8, scheme_text: '8% discount', source_attrs: { brand: null, manufacturer: null, barcode: null, mfr_code: null, strength_value: null, strength_unit: null, weight_value: null, weight_unit: null, pack_size: null, dosage_form: null, base_discount_pct: 8 } }),
      mkRec({ product_id: p2.id, shop_id: 'S2', discount_pct: 12, scheme_text: '12% discount', source_attrs: { brand: null, manufacturer: null, barcode: null, mfr_code: null, strength_value: null, strength_unit: null, weight_value: null, weight_unit: null, pack_size: null, dosage_form: null, base_discount_pct: 12 } }),
    ]
    expect(pickDefaultShopForProduct(p2, discRecs, OPT)).toBe('S2')
  })

  it('groups selected items by shop, calculates estimated line totals, and formats WhatsApp order text', () => {
    const p1 = mkProd('Risek 40mg Cap')
    const p2 = mkProd('Getryl 2mg Tab')
    const shops = new Map<string, Shop>([
      ['S1', { id: 'S1', name: 'Kirpal Medicos', phone: '0300-1112233' } as Shop],
      ['S2', { id: 'S2', name: 'Noman Impex', phone: '0321-4445566' } as Shop],
    ])
    const lines = buildResolvedLines(
      [
        {
          product: p1,
          company: 'Getz Pharma',
          records: [mkRec({ product_id: p1.id, shop_id: 'S1', base_price: 300, discount_pct: 10, scheme_text: '10% discount', effective_cost: 270 })],
          chosenShopId: 'S1',
          qty: '10',
        },
        {
          product: p2,
          company: 'Getz Pharma',
          records: [mkRec({ product_id: p2.id, shop_id: 'S2', discount_pct: 15, scheme_text: '15% discount' })],
          chosenShopId: 'S2',
          qty: '5 boxes',
        },
      ],
      shops,
    )

    expect(parseOrderQtyNumber('10')).toBe(10)
    expect(parseOrderQtyNumber('5 boxes')).toBe(5)
    expect(lines[0].lineTotal).toBe(2700)
    expect(lines[1].lineTotal).toBeNull()

    const groups = buildOrderGroups(lines, true)
    expect(groups).toHaveLength(2)
    expect(groups[0].shopName).toBe('Kirpal Medicos')
    expect(groups[0].estimatedTotal).toBe(2700)
    expect(groups[1].shopName).toBe('Noman Impex')

    const wa = buildWhatsAppOrderText({
      title: 'Morning Order',
      dateLabel: '17 Nov 2026',
      note: 'Urgent',
      groups,
      groupByShop: true,
      showPricing: true,
      pageBreakPerShop: true,
    })
    expect(wa).toContain('*HAFSA MEDICOSE — Morning Order*')
    expect(wa).toContain('*Supplier: Kirpal Medicos* (0300-1112233)')
    expect(wa).toContain('1. Risek 40mg Cap | Qty: *10*')
    expect(wa).toContain('Est. Total: Rs 2,700')
  })

  it('generates a spec-compliant multi-page A4 PDF with exact xref byte offsets', () => {
    const shops = new Map<string, Shop>([['S1', { id: 'S1', name: 'Noman Impex', phone: '0300-9998877', city: 'Nawabshah' } as Shop]])
    const manyDrafts = Array.from({ length: 65 }, (_, i) => {
      const prod = mkProd(`Test Medicine Name Long Variant ${i + 1} 500mg Tab`)
      return {
        product: prod,
        company: 'Getz Pharma',
        records: [mkRec({ product_id: prod.id, shop_id: 'S1', base_price: 100 + i, discount_pct: 10, scheme_text: '10% · CTN 12%', effective_cost: (100 + i) * 0.9 })],
        chosenShopId: 'S1',
        qty: String((i % 5) + 1),
      }
    })

    const groups = buildOrderGroups(buildResolvedLines(manyDrafts, shops), true)
    const pdf = generateOrderPdf({
      title: 'Noman Impex - Purchase Order',
      subtitle: 'Hafsa Medicose Market Order',
      dateLabel: '17 Nov 2026',
      note: 'Send with latest expiry stock.',
      groups,
      groupByShop: true,
      showPricing: true,
      pageBreakPerShop: true,
    })

    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    // Should span multiple pages for 65 items
    expect(text).toContain('Page 1 of ')
    expect(text).toContain('Page 2 of ')

    // Verify startxref offset points cleanly to the xref table
    const startXrefMatch = /startxref\n(\d+)\n%%EOF/.exec(text)
    expect(startXrefMatch).not.toBeNull()
    const xrefPos = Number(startXrefMatch![1])
    expect(text.slice(xrefPos, xrefPos + 5)).toBe('xref\n')

    // Verify every object entry in the xref table points to the exact "<id> 0 obj" header
    const xrefLines = text.slice(xrefPos).split('\n')
    const countLine = xrefLines[1].split(' ')
    const objCount = Number(countLine[1])
    expect(objCount).toBeGreaterThan(6)
    for (let id = 1; id < objCount; id++) {
      const entryOffset = Number(xrefLines[2 + id].slice(0, 10))
      expect(text.slice(entryOffset, entryOffset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`)
    }
  })

  it('sorts order lines A-Z and deduplicates duplicate company items in the same supplier group', () => {
    const pZ = mkProd('Zyloric 100mg Tab', { manufacturer: 'GlaxoSmithKline Pakistan (GSK)' })
    const pDup = mkProd('AUGMENTIN 625MG TAB. (GSK)', { manufacturer: 'GSK', dosage_form: 'tablet' })
    const pA = mkProd('Augmentin 625mg Tab', { manufacturer: 'GlaxoSmithKline Pakistan (GSK)', dosage_form: 'tablet' })
    const pDiffStrength = mkProd('Augmentin 1g Tab', { manufacturer: 'GlaxoSmithKline Pakistan (GSK)', dosage_form: 'tablet' })
    const shops = new Map<string, Shop>([['S1', { id: 'S1', name: 'Noman Impex' } as Shop]])

    const resolved = buildResolvedLines(
      [
        { product: pZ, company: 'GlaxoSmithKline Pakistan (GSK)', records: [mkRec({ product_id: pZ.id, shop_id: 'S1', base_price: 200, effective_cost: 180 })], chosenShopId: 'S1', qty: '2' },
        { product: pDup, company: 'GlaxoSmithKline Pakistan (GSK)', records: [mkRec({ product_id: pDup.id, shop_id: 'S1', base_price: 400, effective_cost: 360 })], chosenShopId: 'S1', qty: '' },
        { product: pA, company: 'GlaxoSmithKline Pakistan (GSK)', records: [mkRec({ product_id: pA.id, shop_id: 'S1', base_price: 400, effective_cost: 350 })], chosenShopId: 'S1', qty: '5' },
        { product: pDiffStrength, company: 'GlaxoSmithKline Pakistan (GSK)', records: [mkRec({ product_id: pDiffStrength.id, shop_id: 'S1', base_price: 550, effective_cost: 500 })], chosenShopId: 'S1', qty: '3' },
      ],
      shops,
    )

    const groups = buildOrderGroups(resolved, true)
    expect(groups).toHaveLength(1)
    expect(groups[0].lines.map((l) => l.product.name)).toEqual([
      'Augmentin 1g Tab',
      'Augmentin 625mg Tab',
      'Zyloric 100mg Tab',
    ])
    expect(groups[0].estimatedTotal).toBe(2 * 180 + 5 * 350 + 3 * 500)
  })
})
