import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ProductPicker } from '../components/Match'
import { OfferCard } from '../components/Offers'
import { ProductForm } from '../components/ProductForm'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Button, Card, Empty, PageHeader, Spinner, Textarea, fmtDate, rs, useConfirm, useToast } from '../components/ui'
import { confirmMatch } from '../lib/actions'
import { compareOffers } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { supabase, updateChecked } from '../lib/supabase'
import type { PriceRecord } from '../lib/types'

interface Alias { id: string; title: string; shop_id: string | null }
interface Ident { id: string; kind: string; value: string; shop_id: string | null }

export default function ProductDetail() {
  const { id } = useParams()
  const { productMap, products, current, shopMap, settings, reload, memberName } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const product = id ? productMap.get(id) : undefined
  const [history, setHistory] = useState<PriceRecord[] | null>(null)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [idents, setIdents] = useState<Ident[]>([])
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState<PriceRecord | null>(null)
  const [notes, setNotes] = useState<string | null>(null)

  const load = async () => {
    if (!id) return
    const [h, a, i] = await Promise.all([
      supabase.from('price_records').select('*').eq('product_id', id).order('observed_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('product_aliases').select('id,title,shop_id').eq('product_id', id),
      supabase.from('product_identifiers').select('id,kind,value,shop_id').eq('product_id', id),
    ])
    setHistory((h.data ?? []) as PriceRecord[])
    setAliases((a.data ?? []) as Alias[])
    setIdents((i.data ?? []) as Ident[])
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id])

  const records = useMemo(() => current.filter((r) => r.product_id === id), [current, id])
  const cmp = useMemo(() => compareOffers(records, product, { freshnessDays: settings.freshness_days, excludeStale: false }), [records, product, settings])
  if (!product) return <Empty title="Product not found"><Link to="/products" className="underline">Back to Product master</Link></Empty>
  if (!history) return <Spinner />
  const family = products.filter((p) => p.id !== product.id && p.normalized_name === product.normalized_name && !p.archived)
  const latestIds = new Set(records.map((r) => r.id))

  const archive = async () => {
    const ok = await confirm({ title: product.archived ? 'Restore product?' : 'Archive product?', body: 'Price history is kept either way.', danger: !product.archived })
    if (!ok) return
    try {
      await updateChecked('products', product.id, product.updated_at, { archived: !product.archived })
      await reload(); toast('ok', product.archived ? 'Restored' : 'Archived')
    } catch (e) { toast('err', (e as Error).message); await reload() }
  }
  const saveNotes = async () => {
    try {
      await updateChecked('products', product.id, product.updated_at, { notes: notes?.trim() || null })
      await reload(); setNotes(null); toast('ok', 'Note saved')
    } catch (e) { toast('err', (e as Error).message); await reload() }
  }
  const move = async (to: string) => {
    if (!moving) return
    try {
      await confirmMatch(moving.id, to)
      toast('ok', 'Price record moved; the mapping is saved for future imports')
      setMoving(null); await reload(); await load()
    } catch (e) { toast('err', (e as Error).message) }
  }

  // history grouped by shop for the change table
  const byShop = new Map<string, PriceRecord[]>()
  for (const r of history) { const a = byShop.get(r.shop_id); if (a) a.push(r); else byShop.set(r.shop_id, [r]) }

  return (
    <div className="space-y-4">
      <PageHeader title={product.name}>
        <WishlistToggle productId={product.id} small={false} />
        <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="secondary" onClick={archive}>{product.archived ? 'Restore' : 'Archive'}</Button>
      </PageHeader>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          {variantLabel(product) && <Badge tone="blue">{variantLabel(product)}</Badge>}
          {product.archived && <Badge tone="amber">Archived</Badge>}
          <span className="text-sm text-slate-500">Product #{product.product_no} · updated {fmtDate(product.updated_at)}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {([['Brand', product.brand], ['Manufacturer', product.manufacturer], ['Ingredient', product.active_ingredient], ['Dosage form', product.dosage_form], ['Barcode', product.barcode], ['Manufacturer code', product.mfr_code], ['Normalized name', product.normalized_name]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>
          ))}
        </dl>
        {family.length > 0 && (
          <div className="mt-3 text-sm"><span className="text-slate-500">Other variants of this title (compared separately): </span>
            {family.map((p) => <Link key={p.id} to={`/products/${p.id}`} className="mr-2 inline-block"><Badge>{variantLabel(p) || p.name}</Badge></Link>)}
          </div>
        )}
      </Card>

      <section>
        <h2 className="mb-2 text-lg font-bold">Current offers (latest per shop)</h2>
        {cmp.offers.length === 0 ? <Empty title="No price records yet" /> : (
          <div className="space-y-2">
            {cmp.offers.map((o) => <OfferCard key={o.rec.id} o={o} shop={shopMap.get(o.rec.shop_id)} extra={<Button variant="ghost" small onClick={() => setMoving(o.rec)}>Wrong product? Move…</Button>} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Price history</h2>
        {history.length === 0 ? <Empty title="No history" /> : (
          <div className="space-y-3">
            {[...byShop.entries()].map(([shopId, recs]) => (
              <Card key={shopId}>
                <div className="mb-2 font-bold">{shopMap.get(shopId)?.name ?? 'Shop'}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="pr-2">Survey date</th><th className="pr-2">Price</th><th className="pr-2">Scheme</th><th className="pr-2">Effective</th><th className="pr-2">Change</th><th>By</th></tr></thead>
                    <tbody>
                      {recs.map((r, i) => {
                        const prev = recs[i + 1]
                        const ch = prev?.effective_cost && r.effective_cost ? ((r.effective_cost - prev.effective_cost) / prev.effective_cost) * 100 : null
                        return (
                          <tr key={r.id} className={`border-t border-[#DADCE0] ${r.archived ? 'text-[#5F6368] line-through' : ''}`}>
                            <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(r.observed_on)} {latestIds.has(r.id) ? <Badge tone="blue">Latest</Badge> : <Badge>Older</Badge>}</td>
                            <td className="pr-2 whitespace-nowrap tabular-nums">{rs(r.base_price)}</td>
                            <td className="pr-2">{r.scheme_text || '—'}</td>
                            <td className="pr-2 font-medium whitespace-nowrap tabular-nums">{r.scheme_status === 'ok' ? rs(r.effective_cost) : <Badge tone="amber">{r.scheme_status}</Badge>}</td>
                            <td className={`pr-2 whitespace-nowrap tabular-nums ${ch == null ? '' : ch < 0 ? 'font-semibold text-[#188038]' : ch > 0 ? 'text-[#D93025]' : ''}`}>{ch == null ? '—' : `${ch > 0 ? '+' : ''}${ch.toFixed(1)}%`}</td>
                            <td>{memberName(r.created_by)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card>
        <h2 className="mb-2 font-bold">Names and codes seen in shop lists</h2>
        {aliases.length === 0 && idents.length === 0 ? <div className="text-sm text-slate-500">None yet.</div> : (
          <ul className="space-y-1 text-sm">
            {aliases.map((a) => <li key={a.id}>“{a.title}” <span className="text-slate-500">— {a.shop_id ? shopMap.get(a.shop_id)?.name : 'any shop'}</span></li>)}
            {idents.map((a) => <li key={a.id}><Badge>{a.kind}</Badge> {a.value} <span className="text-slate-500">— {a.shop_id ? shopMap.get(a.shop_id)?.name : 'any shop'}</span></li>)}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-bold">Notes (shared)</h2>
        <Textarea value={notes ?? product.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-2"><Button small disabled={notes === null} onClick={saveNotes}>Save note</Button></div>
      </Card>

      {editing && <ProductForm open onClose={() => setEditing(false)} product={product} onSaved={async () => { await reload(); toast('ok', 'Product saved') }} />}
      {moving && <ProductPicker open onClose={() => setMoving(null)} onPick={(p) => p.id !== product.id && move(p.id)} initialQuery={moving.original_title} title="Move this price record to…" />}
    </div>
  )
}
