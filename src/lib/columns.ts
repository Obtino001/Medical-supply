// Target fields for column mapping and automatic header suggestions.

export type FieldKey =
  | 'code' | 'barcode' | 'mfr_code' | 'title' | 'description' | 'brand' | 'manufacturer'
  | 'strength' | 'grams' | 'pack_size' | 'price' | 'mrp' | 'discount' | 'scheme' | 'quantity'
  | 'expiry' | 'availability' | 'notes'

export interface FieldDef {
  key: FieldKey
  label: string
  hint?: string
  required?: boolean
  essential?: boolean
  synonyms: string[]
}

export const FIELDS: FieldDef[] = [
  {
    key: 'title',
    label: 'Product Name / Item Name',
    hint: 'Required',
    required: true,
    essential: true,
    synonyms: [
      'item name', 'product name', 'medicine', 'medicine name', 'medicines', 'product title',
      'product', 'products', 'item', 'items', 'name', 'title', 'particulars',
      'description of goods', 'item description', 'product description', 'drug name',
    ],
  },
  {
    key: 'price',
    label: 'Offer Rate / Price',
    hint: 'Required',
    required: true,
    essential: true,
    synonyms: [
      'offer rate', 'rate', 'price', 'offer price', 'purchase price', 'trade price', 'tp',
      'unit price', 'cost', 'net rate', 'net price', 'sale rate', 'dp', 'wholesale price',
      'wholesale rate', 'market rate', 'invoice rate',
    ],
  },
  {
    key: 'discount',
    label: 'Discount',
    hint: 'Optional',
    essential: true,
    synonyms: ['discount', 'disc', 'disc %', 'discount %', 'less', 'dis', 'less %'],
  },
  {
    key: 'scheme',
    label: 'Scheme / Bonus',
    hint: 'Optional',
    essential: true,
    synonyms: ['scheme', 'bonus', 'bonus scheme', 'offer', 'free', 'deal', 'promo'],
  },
  {
    key: 'notes',
    label: 'Notes',
    hint: 'Optional',
    essential: true,
    synonyms: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments'],
  },
  { key: 'code', label: 'Product ID / item code', synonyms: ['product id', 'item code', 'code', 'item id', 'sku', 'product code', 'id', 'item no', 'sr no', 's no', 'sno'] },
  { key: 'barcode', label: 'Barcode', synonyms: ['barcode', 'bar code', 'ean', 'upc', 'gtin'] },
  { key: 'mfr_code', label: 'Manufacturer product code', synonyms: ['mfr code', 'manufacturer code', 'mfg code', 'company code'] },
  { key: 'description', label: 'Description', synonyms: ['description', 'desc', 'details', 'detail'] },
  { key: 'brand', label: 'Brand', synonyms: ['brand', 'brand name'] },
  { key: 'manufacturer', label: 'Manufacturer / company', synonyms: ['manufacturer', 'company', 'mfr', 'mfg', 'maker', 'principal', 'supplier company'] },
  { key: 'strength', label: 'Strength', synonyms: ['strength', 'potency', 'dose', 'dosage'] },
  { key: 'grams', label: 'Grams / weight / volume', synonyms: ['grams', 'gram', 'gm', 'weight', 'wt', 'size', 'volume', 'net weight', 'net content'] },
  { key: 'pack_size', label: 'Pack size', synonyms: ['pack size', 'pack', 'packing', 'pack qty', 'qty per pack', 'unit size', 'pcs per pack', 'packsize'] },
  { key: 'mrp', label: 'MRP / retail price', synonyms: ['mrp', 'retail price', 'retail', 'm.r.p', 'print price', 'max retail price'] },
  { key: 'quantity', label: 'Minimum order qty', synonyms: ['quantity', 'qty', 'min qty', 'moq', 'minimum order', 'min order'] },
  { key: 'expiry', label: 'Expiry', synonyms: ['expiry', 'exp', 'expiry date', 'exp date', 'best before'] },
  { key: 'availability', label: 'Stock / availability', synonyms: ['stock', 'availability', 'available', 'in stock', 'status', 'stock status'] },
]

export const REQUIRED_FIELDS = FIELDS.filter((f) => f.required)
export const ADDITIONAL_FIELDS = FIELDS.filter((f) => !f.required)

export type Mapping = Partial<Record<FieldKey, string>> // field -> source header

export const normHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(\d+\)\s*$/, '') // strip getHeaders duplicate suffix like "(2)"
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()

/** Classify a single header string into a FieldKey if it matches known synonyms. */
export function matchHeaderField(header: string): FieldKey | null {
  const hn = normHeader(header)
  if (!hn) return null
  for (const f of FIELDS) {
    if (f.synonyms.some((syn) => hn === syn)) return f.key
  }
  for (const f of FIELDS) {
    if (f.synonyms.some((syn) => syn.length >= 4 && (hn.startsWith(syn + ' ') || hn.endsWith(' ' + syn)))) return f.key
  }
  return null
}

/** Suggest a mapping from headers. Exact synonym match wins, then "contains". Each header is used once. */
export function suggestMapping(headers: string[]): Mapping {
  const result: Mapping = {}
  const used = new Set<string>()
  const normed = headers.map((h) => ({ h, n: normHeader(h) }))
  const pass = (test: (hn: string, syn: string) => boolean) => {
    for (const f of FIELDS) {
      if (result[f.key]) continue
      for (const syn of f.synonyms) {
        const hit = normed.find((x) => x.n && !used.has(x.h) && test(x.n, syn))
        if (hit) {
          result[f.key] = hit.h
          used.add(hit.h)
          break
        }
      }
    }
  }
  pass((hn, syn) => hn === syn)
  pass((hn, syn) => syn.length >= 4 && (hn.startsWith(syn + ' ') || hn.endsWith(' ' + syn)))
  return result
}

export interface ImportOptions {
  /** how a plain number in the Discount column is read */
  discountMode: 'percent' | 'flat'
  /** the supplied rate is already net of its discount: discount columns are not applied again */
  priceIsNet: boolean
  /** user confirms that percent + flat + bonus stack on this supplier's list */
  combine: boolean
  taxIncluded: 'yes' | 'no' | 'unknown'
  headerRow: number // 1-based row number holding the headers
  /** automatically combine side-by-side product/rate column pairs when detected */
  combineSideBySide?: boolean
}

export const DEFAULT_OPTIONS: ImportOptions = {
  discountMode: 'percent',
  priceIsNet: false,
  combine: false,
  taxIncluded: 'unknown',
  headerRow: 1,
  combineSideBySide: true,
}
