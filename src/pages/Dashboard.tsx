import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Card, Input, Stat, fmtDate, rs } from '../components/ui'
import { findOpportunities } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { supabase } from '../lib/supabase'

interface Job { id: string; filename: string; shop_id: string; row_imported: number; created_at: string; created_by: string | null }
interface Audit { id: number; user_id: string | null; table_name: string; action: string; detail: { label?: string } | null; created_at: string }

const TABLE: Record<string, string> = { shops: 'shop', surveys: 'survey', products: 'product', price_records: 'price', import_jobs: 'import', wishlist_items: 'wishlist item', export_profiles: 'export profile', match_decisions: 'match mapping' }

export default function Dashboard() {
  const { shops, surveys, products, current, history, review, wishlist, settings, shopMap, memberName } = useData()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [counts, setCounts] = useState<{ lists: number; records: number } | null>(null)

  useEffect(() => {
    void (async () => {
      const [j, a, nj, nr] = await Promise.all([
        supabase.from('import_jobs').select('id,filename,shop_id,row_imported,created_at,created_by').order('created_at', { ascending: false }).limit(5),
        supabase.from('audit_events').select('id,user_id,table_name,action,detail,created_at').order('created_at', { ascending: false }).limit(12),
        supabase.from('import_jobs').select('id', { count: 'exact', head: true }),
        supabase.from('price_records').select('id', { count: 'exact', head: true }),
      ])
      setJobs((j.data ?? []) as Job[]); setAudit((a.data ?? []) as Audit[])
      setCounts({ lists: nj.count ?? 0, records: nr.count ?? 0 })
    })()
  }, [])

  const opps = useMemo(() => findOpportunities(products, current, history, { freshnessDays: settings.freshness_days, excludeStale: false }), [products, current, history, settings])
  const multi = useMemo(() => {
    const by = new Map<string, Set<string>>()
    for (const r of current) { const s = by.get(r.product_id!) ?? new Set(); s.add(r.shop_id); by.set(r.product_id!, s) }
    return [...by.values()].filter((s) => s.size >= 2).length
  }, [current])
  const top = [...opps].filter((o) => o.verified).sort((a, b) => b.savingPct - a.savingPct).slice(0, 5)
  const search = (e: FormEvent) => { e.preventDefault(); nav(`/compare?q=${encodeURIComponent(q)}`) }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
      <form onSubmit={search} className="flex gap-2">
        <Input type="search" placeholder="Search product, ID, barcode, shop, manufacturer…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Quick search" />
        <Button type="submit">Search</Button>
      </form>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link to="/shops"><Button className="w-full">+ Add shop</Button></Link>
        <Link to="/import"><Button className="w-full">Import / new survey</Button></Link>
        <Link to="/compare"><Button variant="secondary" className="w-full">Compare prices</Button></Link>
        <Link to="/review"><Button variant="secondary" className="w-full">Review matches</Button></Link>
        <Link to="/export"><Button variant="secondary" className="w-full">Export results</Button></Link>
        <Link to="/wishlist"><Button variant="secondary" className="w-full">My Wishlist</Button></Link>
        <Link to="/opportunities"><Button variant="secondary" className="w-full">Best opportunities</Button></Link>
        <Link to="/surveys"><Button variant="secondary" className="w-full">Surveys</Button></Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Shops" value={shops.filter((s) => s.status === 'active').length} />
        <Stat label="Imported price lists" value={counts?.lists ?? '…'} />
        <Stat label="Unique products" value={products.filter((p) => !p.archived).length} />
        <Stat label="Price records" value={counts?.records ?? '…'} />
        <Stat label="Products with 2+ shops" value={multi} />
        <Stat label="Newly lower prices" value={opps.filter((o) => o.reasons.includes('new_low')).length} />
        <Stat label="Need manual matching" value={review.length} tone={review.length ? 'amber' : undefined} />
        <Stat label="Wishlist products" value={wishlist.length} />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Best purchase opportunities</h2><Link to="/opportunities" className="text-sm font-semibold text-emerald-800 underline">See all</Link></div>
        {top.length === 0 ? <Card className="text-sm text-slate-600">No opportunities yet. They appear once two shops offer the same variant.</Card> : (
          <div className="space-y-2">{top.map((o) => (
            <Link key={o.product.id} to={`/products/${o.product.id}`}><Card className="mb-2 !p-3 hover:border-emerald-600">
              <div className="flex justify-between gap-2"><div><b>{o.product.name}</b> <Badge tone="blue">{variantLabel(o.product)}</Badge></div><b className="text-emerald-800">save {o.savingPct.toFixed(1)}%</b></div>
              <div className="text-sm text-slate-600">Best: {shopMap.get(o.best.rec.shop_id)?.name} at {rs(o.best.cents! / 100)} · saves {rs(o.saving)}</div>
            </Card></Link>))}</div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-bold">Recent imports</h2>
          {jobs.length === 0 ? <Card className="text-sm text-slate-600">No imports yet.</Card> : jobs.map((j) => (
            <Card key={j.id} className="mb-2 !p-3 text-sm"><b className="break-all">{j.filename}</b><div className="text-slate-600">{shopMap.get(j.shop_id)?.name} · {j.row_imported} rows · {fmtDate(j.created_at)} · {memberName(j.created_by)}</div></Card>
          ))}
          <h2 className="mb-2 mt-4 text-lg font-bold">Recent surveys</h2>
          {surveys.slice(0, 5).map((s) => <Card key={s.id} className="mb-2 !p-3 text-sm">#{s.survey_no} · {shopMap.get(s.shop_id)?.name} · {fmtDate(s.survey_date)}</Card>)}
          {surveys.length === 0 && <Card className="text-sm text-slate-600">No surveys yet.</Card>}
        </section>
        <section>
          <h2 className="mb-2 text-lg font-bold">Recent activity (both partners)</h2>
          <Card className="!p-3">
            {audit.length === 0 ? <div className="text-sm text-slate-600">Nothing yet.</div> : (
              <ul className="space-y-1.5 text-sm">{audit.map((a) => (
                <li key={a.id}><b>{memberName(a.user_id)}</b> {a.action === 'insert' ? 'added' : a.action === 'update' ? 'changed' : a.action === 'delete' ? 'deleted' : a.action.replace('_', ' ')} {TABLE[a.table_name] ?? a.table_name}{a.detail?.label ? ` “${String(a.detail.label).slice(0, 40)}”` : ''} <span className="text-xs text-slate-500">{fmtDate(a.created_at)}</span></li>
              ))}</ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}
