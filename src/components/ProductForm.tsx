import { useState } from 'react'
import { identityKey, parseTitle } from '../lib/productParse'
import { supabase, updateChecked } from '../lib/supabase'
import type { Product } from '../lib/types'
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from './ui'

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function ProductForm({ open, onClose, product, onSaved }: { open: boolean; onClose: () => void; product?: Product; onSaved: (id: string) => void }) {
  const [f, setF] = useState(() => ({
    name: product?.name ?? '', brand: product?.brand ?? '', manufacturer: product?.manufacturer ?? '', active_ingredient: product?.active_ingredient ?? '',
    strength_value: product?.strength_value?.toString() ?? '', strength_unit: product?.strength_unit ?? '',
    weight_value: product?.weight_value?.toString() ?? '', weight_unit: product?.weight_unit ?? 'g',
    pack_size: product?.pack_size?.toString() ?? '', dosage_form: product?.dosage_form ?? '', barcode: product?.barcode ?? '',
    mfr_code: product?.mfr_code ?? '', notes: product?.notes ?? '',
  }))
  const hasExtra = Boolean(product && (product.brand || product.manufacturer || product.active_ingredient || product.barcode || product.mfr_code))
  const [showMore, setShowMore] = useState(hasExtra)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  const save = async () => {
    setErr(null)
    if (!f.name.trim()) return setErr('Product name is required.')
    const sv = num(f.strength_value), wv = num(f.weight_value), ps = num(f.pack_size)
    if ([sv, wv, ps].some((x) => Number.isNaN(x))) return setErr('Strength, weight and pack size must be positive numbers.')
    if (ps != null && (!Number.isInteger(ps) || ps <= 0)) return setErr('Pack size must be a whole number above zero.')
    const parsed = parseTitle(f.name)
    const strengthValue = sv ?? (f.strength_value ? null : parsed.strengthValue)
    const strengthUnit = sv != null ? f.strength_unit || null : sv == null ? parsed.strengthUnit : null
    const weightValue = wv ?? parsed.weightValue
    const weightUnit = (wv != null ? f.weight_unit : parsed.weightUnit) as 'g' | 'ml' | null
    const row = {
      name: f.name.trim(), normalized_name: parsed.name || f.name.trim().toLowerCase(),
      brand: f.brand.trim() || null, manufacturer: f.manufacturer.trim() || null, active_ingredient: f.active_ingredient.trim() || null,
      strength_value: strengthValue, strength_unit: strengthValue != null ? strengthUnit : null,
      weight_value: weightValue, weight_unit: weightValue != null ? weightUnit : null,
      pack_size: ps ?? parsed.packSize, dosage_form: f.dosage_form.trim().toLowerCase() || parsed.dosageForm,
      barcode: f.barcode.trim() || null, mfr_code: f.mfr_code.trim() || null, notes: f.notes.trim() || null,
    }
    const identity_key = identityKey({
      normalizedName: row.normalized_name, strengthValue: row.strength_value, strengthUnit: row.strength_unit,
      weightValue: row.weight_value, weightUnit: row.weight_unit, packSize: row.pack_size, dosageForm: row.dosage_form, manufacturer: row.manufacturer,
    })
    setBusy(true)
    try {
      if (product) {
        await updateChecked('products', product.id, product.updated_at, { ...row, identity_key })
        onSaved(product.id)
      } else {
        const { data, error } = await supabase.from('products').insert({ ...row, identity_key }).select('id').single()
        if (error) throw new Error(error.message)
        onSaved(data.id)
      }
      onClose()
    } catch (e) {
      const m = (e as Error).message
      setErr(/duplicate key/i.test(m) ? 'An identical product already exists.' : m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Edit product' : 'New product'} wide>
      <div className="space-y-3">
        <Field label="Product name *" hint="e.g. 2SUM 500MG INJ, ACABEL-4MG-TABS, ACENAC GEL. Any strength or form in the name is detected automatically."><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Notes (optional)"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div>
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span>Additional attributes (optional: brand, manufacturer, strength, pack, barcode…)</span>
            <span>{showMore ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showMore && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Brand"><Input value={f.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
              <Field label="Manufacturer"><Input value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></Field>
              <Field label="Active ingredient"><Input value={f.active_ingredient} onChange={(e) => set('active_ingredient', e.target.value)} /></Field>
              <Field label="Dosage form"><Input placeholder="tablet, syrup, cream…" value={f.dosage_form} onChange={(e) => set('dosage_form', e.target.value)} /></Field>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label="Strength"><Input inputMode="decimal" value={f.strength_value} onChange={(e) => set('strength_value', e.target.value)} /></Field>
                <Field label="Unit"><Select value={f.strength_unit} onChange={(e) => set('strength_unit', e.target.value)}><option value=""></option><option>mg</option><option>mcg</option><option>iu</option><option>%</option></Select></Field>
              </div>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <Field label="Grams / volume"><Input inputMode="decimal" value={f.weight_value} onChange={(e) => set('weight_value', e.target.value)} /></Field>
                <Field label="Unit"><Select value={f.weight_unit} onChange={(e) => set('weight_unit', e.target.value)}><option>g</option><option>ml</option></Select></Field>
              </div>
              <Field label="Pack size (units per pack)"><Input inputMode="numeric" value={f.pack_size} onChange={(e) => set('pack_size', e.target.value)} /></Field>
              <Field label="Barcode"><Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
              <Field label="Manufacturer product code"><Input value={f.mfr_code} onChange={(e) => set('mfr_code', e.target.value)} /></Field>
            </div>
          )}
        </div>
      </div>
      {err && <div className="mt-3"><ErrorBox>{err}</ErrorBox></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save product'}</Button>
      </div>
    </Modal>
  )
}
