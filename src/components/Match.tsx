// Side-by-side attribute comparison and product picker used by import matching, the Review page and product detail.
import { useMemo, useState } from 'react'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { matchesQuery } from '../lib/tableModel'
import type { Product } from '../lib/types'
import { Badge, Button, Input, Modal, cx } from './ui'

export interface IncomingView {
  title: string
  code: string | null
  brand: string | null
  manufacturer: string | null
  strength: string | null
  weight: string | null
  pack: number | null
  barcode: string | null
  mfrCode: string | null
  form: string | null
}

export const productView = (p: Product) => ({
  title: p.name,
  code: p.mfr_code,
  brand: p.brand,
  manufacturer: p.manufacturer,
  strength: p.strength_value != null ? `${p.strength_value}${p.strength_unit ?? ''}` : null,
  weight: p.weight_value != null ? `${p.weight_value}${p.weight_unit ?? ''}` : null,
  pack: p.pack_size,
  barcode: p.barcode,
  mfrCode: p.mfr_code,
  form: p.dosage_form,
})

const norm = (v: string | number | null | undefined) => (v == null ? '' : String(v).trim().toLowerCase())

export function AttrTable({ imported, existing }: { imported: IncomingView; existing: IncomingView | null }) {
  const allRows: [string, string | number | null, string | number | null | undefined, boolean][] = [
    ['Product name', imported.title, existing?.title, false],
    ['Strength', imported.strength, existing?.strength, true],
    ['Dosage form', imported.form, existing?.form, true],
    ['Grams / volume', imported.weight, existing?.weight, true],
    ['Pack size', imported.pack, existing?.pack, true],
    ['Manufacturer', imported.manufacturer, existing?.manufacturer, true],
    ['Brand', imported.brand, existing?.brand, true],
    ['Product code', imported.code, existing?.mfrCode, true],
    ['Barcode', imported.barcode, existing?.barcode, true],
  ]
  const rows = allRows.filter(([label, a, b]) => label === 'Product name' || !!norm(a) || !!norm(b))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-[var(--text-secondary)]">
            <th className="py-1 pr-2 font-medium">Field</th><th className="px-2 font-medium">Imported</th><th className="px-2 font-medium">Existing product</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, comparable]) => {
            const conflict = comparable && !!norm(a) && !!norm(b) && norm(a) !== norm(b)
            const missing = comparable && (!!norm(a) !== !!norm(b))
            return (
              <tr key={label} className={cx('border-t border-[var(--border-default)]', conflict && 'bg-[var(--color-error-bg)]')}>
                <td className="py-1.5 pr-2 font-medium text-[var(--text-secondary)]">{label}</td>
                <td className={cx('px-2 text-[var(--text-primary)]', conflict && 'font-bold text-[var(--color-error-text)]')}>{a == null || a === '' ? <span className="text-[var(--text-secondary)]">—</span> : a}</td>
                <td className={cx('px-2 text-[var(--text-primary)]', conflict && 'font-bold text-[var(--color-error-text)]')}>
                  {existing === null ? <span className="text-[var(--text-secondary)]">—</span> : b == null || b === '' ? <span className="text-[var(--text-secondary)]">—</span> : b}
                  {conflict && <span className="ml-1.5"><Badge tone="red">CONFLICT</Badge></span>}
                  {missing && existing && <span className="ml-1 text-xs text-[var(--color-warning-text)]">(missing on one side)</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ProductPicker({ open, onClose, onPick, initialQuery = '', title = 'Select a product' }: { open: boolean; onClose: () => void; onPick: (p: Product) => void; initialQuery?: string; title?: string }) {
  const { products, shopMap } = useData()
  const [q, setQ] = useState(initialQuery)
  const results = useMemo(() => {
    const live = products.filter((p) => !p.archived)
    return (q.trim() ? live.filter((p) => matchesQuery({ product: p, records: [] }, q, shopMap)) : live).slice(0, 30)
  }, [products, q, shopMap])
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <Input autoFocus placeholder="Search product name, brand, manufacturer…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 space-y-1.5">
        {results.length === 0 && <div className="p-4 text-center text-sm text-[var(--text-secondary)]">No products found.</div>}
        {results.map((p) => {
          const meta = [variantLabel(p), p.brand, p.manufacturer].filter(Boolean).join(' · ')
          return (
            <button key={p.id} onClick={() => onPick(p)} className="block w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] p-2.5 text-left transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]">
              <div className="text-sm font-medium text-[var(--text-primary)]">{p.name} <span className="text-xs text-[var(--text-secondary)]">#{p.product_no}</span></div>
              {meta && <div className="text-xs text-[var(--text-secondary)]">{meta}</div>}
            </button>
          )
        })}
        {results.length === 30 && <div className="text-xs text-[var(--text-secondary)]">Showing first 30. Type more to narrow down.</div>}
      </div>
      <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
    </Modal>
  )
}
