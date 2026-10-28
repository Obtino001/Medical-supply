import { useEffect, useState } from 'react'
import { AttrTable, ProductPicker, productView, type IncomingView } from '../components/Match'
import { MatchBadge } from '../components/Offers'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Button, Card, Empty, Field, PageHeader, Pagination, Select, Spinner, fmtDate, rs, useConfirm, useToast } from '../components/ui'
import { confirmMatch, createProductFromSource, markUnmatched, rejectMatch, undoDecision } from '../lib/actions'
import { useData } from '../lib/data'
import { parseTitle } from '../lib/productParse'
import { supabase } from '../lib/supabase'
import type { PriceRecord } from '../lib/types'

interface Decision { id: string; shop_id: string; source_key: string; product_id: string; created_by: string | null; created_at: string }
interface Rejection { id: string; shop_id: string; source_key: string; product_id: string; created_at: string }

function sourceView(r: PriceRecord): IncomingView {
  const t = parseTitle(r.original_title)
  const a = r.source_attrs
  const sv = a?.strength_value ?? t.strengthValue, su = a?.strength_unit ?? t.strengthUnit
  const wv = a?.weight_value ?? t.weightValue, wu = a?.weight_unit ?? t.weightUnit
  return {
    title: r.original_title, code: r.original_code, brand: a?.brand ?? null, manufacturer: a?.manufacturer ?? null,
    strength: sv != null ? `${sv}${su ?? ''}` : null, weight: wv != null ? `${wv}${wu ?? ''}` : null,
    pack: a?.pack_size ?? t.packSize, barcode: a?.barcode ?? null, mfrCode: a?.mfr_code ?? null, form: a?.dosage_form ?? t.dosageForm,
  }
}

export default function Review() {
  const [tab, setTab] = useState<'review' | 'saved'>('review')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Match review"
        subtitle="Verify uncertain product matches or inspect saved supplier-to-catalog mappings."
      />
      <div className="flex gap-2">
        <Button small variant={tab === 'review' ? 'primary' : 'secondary'} onClick={() => setTab('review')}>To review</Button>
        <Button small variant={tab === 'saved' ? 'primary' : 'secondary'} onClick={() => setTab('saved')}>Saved mappings</Button>
      </div>
      {tab === 'review' ? <ToReview /> : <Saved />}
    </div>
  )
}

function ToReview() {
  const { review, productMap, shopMap, reload } = useData()
  const toast = useToast()
  const [page, setPage] = useState(0)
  const [picker, setPicker] = useState<PriceRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sel, setSel] = useState<Record<string, string>>({})

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id)
    try { await fn(); await reload(); toast('ok', ok) } catch (e) { toast('err', (e as Error).message) } finally { setBusy(null) }
  }
  if (review.length === 0) return <Empty title="Nothing to review">Every imported row is matched to a product.</Empty>
  const per = 10
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-secondary)]">These price records are saved but not linked to a product, so they are never ranked. Different grams / strengths / pack sizes are never merged automatically. Conflicts are highlighted in red.</p>
      {review.slice(page * per, page * per + per).map((r) => {
        const cands = (r.match_candidates ?? []).filter((c) => productMap.has(c.productId))
        const chosen = sel[r.id] ?? cands[0]?.productId ?? null
        const existing = chosen ? productMap.get(chosen) : undefined
        const reason = cands.find((c) => c.productId === chosen)
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-center gap-2"><b className="font-medium text-[var(--text-primary)]">{r.original_title}</b><MatchBadge status={r.match_status} /></div>
            <div className="text-sm text-[var(--text-secondary)]">{shopMap.get(r.shop_id)?.name} · {fmtDate(r.observed_on)} · Rate {rs(r.base_price)}{r.scheme_text ? ` · ${r.scheme_text}` : ''}</div>
            {reason && <div className="mt-1 text-sm text-[var(--color-warning-text)]">Why: {reason.reason}</div>}
            <div className="my-2"><AttrTable imported={sourceView(r)} existing={existing ? productView(existing) : null} /></div>
            {cands.length > 1 && (
              <Field label="Suggested products"><Select value={chosen ?? ''} onChange={(e) => setSel({ ...sel, [r.id]: e.target.value })}>
                {cands.map((c) => <option key={c.productId} value={c.productId}>{productMap.get(c.productId)?.name} — {c.reason}</option>)}
              </Select></Field>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button small disabled={!chosen || busy === r.id} onClick={() => run(r.id, () => confirmMatch(r.id, chosen!), 'Match confirmed and saved for future imports')}>Confirm match</Button>
              <Button small variant="secondary" onClick={() => setPicker(r)}>Select another product</Button>
              <Button small variant="secondary" disabled={busy === r.id} onClick={() => run(r.id, async () => { const p = await createProductFromSource(r.original_title, r.source_attrs); await confirmMatch(r.id, p.id) }, 'New product created and linked')}>Create new product</Button>
              <Button small variant="secondary" disabled={busy === r.id || r.match_status === 'unmatched'} onClick={() => run(r.id, () => markUnmatched(r.id), 'Marked as unmatched')}>Mark as unmatched</Button>
              {chosen && <Button small variant="ghost" disabled={busy === r.id} onClick={() => run(r.id, () => rejectMatch(r.id, chosen), 'Rejected: will not be suggested again')}>Reject suggested match</Button>}
              {existing && <WishlistToggle productId={existing.id} />}
            </div>
          </Card>
        )
      })}
      <Pagination page={page} pages={Math.ceil(review.length / per)} onPage={setPage} />
      {picker && <ProductPicker open onClose={() => setPicker(null)} initialQuery={parseTitle(picker.original_title).name} onPick={(p) => { const id = picker.id; setPicker(null); void run(id, () => confirmMatch(id, p.id), 'Match confirmed and saved') }} />}
    </div>
  )
}

function Saved() {
  const { shopMap, productMap, memberName } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [dec, setDec] = useState<Decision[] | null>(null)
  const [rej, setRej] = useState<Rejection[]>([])
  const [page, setPage] = useState(0)
  const load = async () => {
    const [d, r] = await Promise.all([
      supabase.from('match_decisions').select('id,shop_id,source_key,product_id,created_by,created_at').order('created_at', { ascending: false }).limit(1000),
      supabase.from('match_rejections').select('id,shop_id,source_key,product_id,created_at').order('created_at', { ascending: false }).limit(1000),
    ])
    setDec((d.data ?? []) as Decision[]); setRej((r.data ?? []) as Rejection[])
  }
  useEffect(() => { void load() }, [])
  if (!dec) return <Spinner />
  const undo = async (d: Decision) => {
    if (!(await confirm({ title: 'Undo this mapping?', body: 'Future imports will no longer use it. Price records that were already linked stay linked: move them from the product page if they are wrong.', confirmLabel: 'Undo mapping', danger: true }))) return
    try { await undoDecision(d.id); toast('ok', 'Mapping removed'); await load() } catch (e) { toast('err', (e as Error).message) }
  }
  const unreject = async (r: Rejection) => {
    const { error } = await supabase.from('match_rejections').delete().eq('id', r.id)
    if (error) return toast('err', error.message)
    toast('ok', 'Rejection removed'); await load()
  }
  const per = 20
  const label = (k: string) => k.replace(/^(code|title):/, (m) => (m === 'code:' ? 'code ' : ''))
  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 text-base font-medium text-[var(--text-primary)]">Confirmed mappings ({dec.length})</h2>
        {dec.length === 0 ? <Empty title="No saved mappings yet" /> : dec.slice(page * per, page * per + per).map((d) => (
          <Card key={d.id} className="mb-2 !p-3">
            <div className="text-sm"><Badge>{shopMap.get(d.shop_id)?.name}</Badge> “{label(d.source_key)}” → <b className="font-medium text-[var(--text-primary)]">{productMap.get(d.product_id)?.name}</b></div>
            <div className="text-xs text-[var(--text-secondary)]">Confirmed by {memberName(d.created_by)} on {fmtDate(d.created_at)}</div>
            <Button small variant="ghost" onClick={() => undo(d)}>Undo mapping</Button>
          </Card>
        ))}
        <Pagination page={page} pages={Math.ceil(dec.length / per)} onPage={setPage} />
      </section>
      <section>
        <h2 className="mb-2 text-base font-medium text-[var(--text-primary)]">Rejected pairings ({rej.length})</h2>
        {rej.length === 0 ? <Empty title="None" /> : rej.slice(0, 50).map((r) => (
          <Card key={r.id} className="mb-2 !p-3">
            <div className="text-sm"><Badge>{shopMap.get(r.shop_id)?.name}</Badge> “{label(r.source_key)}” is <b className="font-medium text-[var(--text-primary)]">not</b> {productMap.get(r.product_id)?.name}</div>
            <Button small variant="ghost" onClick={() => unreject(r)}>Allow this pairing again</Button>
          </Card>
        ))}
      </section>
    </div>
  )
}
