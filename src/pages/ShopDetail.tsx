import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShopForm } from '../components/ShopForm'
import { Badge, Button, Card, Empty, PageHeader, Stat, fmtDate, rs, useConfirm, useToast } from '../components/ui'
import { compareOffers } from '../lib/compare'
import { useData } from '../lib/data'
import { updateChecked } from '../lib/supabase'

export default function ShopDetail() {
  const { id } = useParams()
  const { shopMap, surveys, current, productMap, settings, reload, history, products } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const shop = id ? shopMap.get(id) : undefined

  const mine = useMemo(() => current.filter((r) => r.shop_id === id), [current, id])
  const bestCount = useMemo(() => {
    const byProduct = new Map<string, typeof current>()
    for (const r of current) { const a = byProduct.get(r.product_id!); if (a) a.push(r); else byProduct.set(r.product_id!, [r]) }
    let best = 0, compared = 0
    for (const p of products) {
      const recs = byProduct.get(p.id)
      if (!recs || !recs.some((r) => r.shop_id === id)) continue
      const c = compareOffers(recs, p, { freshnessDays: settings.freshness_days, excludeStale: false })
      if (c.eligibleCount < 2) continue
      compared++
      if (c.offers.some((o) => o.isBest && o.rec.shop_id === id)) best++
    }
    return { best, compared }
  }, [current, products, id, settings])
  if (!shop) return <Empty title="Shop not found"><Link className="underline" to="/shops">Back to shops</Link></Empty>
  const shopSurveys = surveys.filter((s) => s.shop_id === shop.id)
  const histCount = history.filter((h) => h.shop_id === shop.id).length

  const toggleArchive = async () => {
    const archiving = shop.status === 'active'
    if (archiving && !(await confirm({ title: 'Archive this shop?', body: 'Its price history is kept. You can restore it later.', danger: true, confirmLabel: 'Archive' }))) return
    try { await updateChecked('shops', shop.id, shop.updated_at, { status: archiving ? 'archived' : 'active' }); await reload(); toast('ok', archiving ? 'Shop archived' : 'Shop restored') }
    catch (e) { toast('err', (e as Error).message); await reload() }
  }
  return (
    <div className="space-y-4">
      <PageHeader title={shop.name}>
        <Link to={`/import?shop=${shop.id}`}><Button>Import price list</Button></Link>
        <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="secondary" onClick={toggleArchive}>{shop.status === 'active' ? 'Archive' : 'Restore'}</Button>
      </PageHeader>
      <Card>
        <div className="text-sm text-[var(--text-secondary)]">
          {shop.status === 'archived' && <Badge tone="amber">Archived</Badge>} Shop #{shop.shop_no} · added {fmtDate(shop.created_at)}
          <div className="mt-0.5 text-[var(--text-primary)]">{[shop.owner_name, shop.phone].filter(Boolean).join(' · ') || 'No contact recorded'}</div>
          <div>{[shop.address, shop.city].filter(Boolean).join(', ')}</div>
          {shop.notes && <div className="mt-1 whitespace-pre-wrap text-[var(--text-secondary)]">{shop.notes}</div>}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Surveys" value={shopSurveys.length} />
        <Stat label="Current price records" value={mine.length} />
        <Stat label="All historical records" value={histCount} />
        <Stat label="Best price on" value={`${bestCount.best} / ${bestCount.compared}`} />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">“Best price on” counts products with 2+ comparable offers where this shop is the cheapest (ties included).</p>
      <section>
        <h2 className="mb-2 text-base font-medium text-[var(--text-primary)]">Surveys</h2>
        {shopSurveys.length === 0 ? <Empty title="No surveys yet" /> : (
          <div className="space-y-1.5">{shopSurveys.map((s) => <Card key={s.id} className="!p-3 text-sm">Survey #{s.survey_no} · {fmtDate(s.survey_date)}{s.notes ? ` · ${s.notes}` : ''}</Card>)}</div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-base font-medium text-[var(--text-primary)]">Latest prices offered</h2>
        {mine.length === 0 ? <Empty title="No matched prices yet" /> : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-default)] bg-[var(--bg-subtle)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                <tr><th className="px-3.5 py-2">Product</th><th className="px-3 py-2">Offer Rate</th><th className="px-3 py-2">Scheme / Discount</th><th className="px-3 py-2">Effective Price</th><th className="px-3.5 py-2">Date</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {mine.slice(0, 200).sort((a, b) => (productMap.get(a.product_id!)?.name ?? '').localeCompare(productMap.get(b.product_id!)?.name ?? '')).map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--bg-hover)]">
                    <td className="px-3.5 py-2"><Link className="font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline" to={`/products/${r.product_id}`}>{productMap.get(r.product_id!)?.name}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--text-secondary)] tabular-nums">{r.base_price != null ? rs(r.base_price) : r.scheme_text || '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{r.scheme_text || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--text-primary)] tabular-nums">{r.scheme_status === 'ok' ? (r.effective_cost != null ? rs(r.effective_cost) : r.scheme_text || '—') : '—'}</td>
                    <td className="whitespace-nowrap px-3.5 py-2 text-xs text-[var(--text-secondary)]">{fmtDate(r.observed_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mine.length > 200 && <div className="border-t border-[var(--border-default)] px-3.5 py-2 text-xs text-[var(--text-secondary)]">Showing first 200 of {mine.length}. Use Export for the full list.</div>}
          </div>
        )}
      </section>
      {editing && <ShopForm open onClose={() => setEditing(false)} shop={shop} onSaved={reload} />}
    </div>
  )
}
