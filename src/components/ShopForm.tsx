import { useState } from 'react'
import { useData } from '../lib/data'
import { supabase, updateChecked } from '../lib/supabase'
import type { Shop } from '../lib/types'
import { Button, ErrorBox, Field, Input, Modal, Textarea, useToast } from './ui'

const digits = (s: string | null) => (s ?? '').replace(/\D/g, '')
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function ShopForm({ open, onClose, shop, onSaved }: { open: boolean; onClose: () => void; shop?: Shop; onSaved: (s?: Shop) => void | Promise<void> }) {
  const { shops } = useData()
  const toast = useToast()
  const [f, setF] = useState({ name: shop?.name ?? '', owner_name: shop?.owner_name ?? '', phone: shop?.phone ?? '', address: shop?.address ?? '', city: shop?.city ?? 'Karachi', notes: shop?.notes ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setAck(false) }

  // Warn (never auto-merge) on a similar name or same phone number
  const similar = shops.filter((s) => s.id !== shop?.id && (
    (squash(f.name).length >= 3 && (squash(s.name) === squash(f.name) || squash(s.name).includes(squash(f.name)) || squash(f.name).includes(squash(s.name)))) ||
    (digits(f.phone).length >= 7 && digits(s.phone).slice(-9) === digits(f.phone).slice(-9))))

  const save = async () => {
    setErr(null)
    if (!f.name.trim()) return setErr('Shop name is required.')
    if (similar.length && !ack) return setErr('A similar shop already exists. Tick the box below to confirm this is a different shop.')
    const row = { name: f.name.trim(), owner_name: f.owner_name.trim() || null, phone: f.phone.trim() || null, address: f.address.trim() || null, city: f.city.trim() || null, notes: f.notes.trim() || null }
    setBusy(true)
    try {
      if (shop) await updateChecked('shops', shop.id, shop.updated_at, row)
      else {
        const { data, error } = await supabase.from('shops').insert(row).select('*').single()
        if (error) throw new Error(error.message)
        await onSaved(data as Shop)
        toast('ok', 'Shop added'); onClose(); return
      }
      await onSaved(); toast('ok', 'Shop saved'); onClose()
    } catch (e) { setErr((e as Error).message); await onSaved() } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={shop ? 'Edit shop' : 'Add shop'}>
      <div className="space-y-3">
        <Field label="Shop name *"><Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Owner / contact person"><Input value={f.owner_name} onChange={(e) => set('owner_name', e.target.value)} /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Address / market location"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="City"><Input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        {similar.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <b>Possible duplicate:</b> {similar.map((s) => `${s.name}${s.phone ? ` (${s.phone})` : ''}`).join('; ')}
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />This is a different shop</label>
          </div>
        )}
        {err && <ErrorBox>{err}</ErrorBox>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </Modal>
  )
}
