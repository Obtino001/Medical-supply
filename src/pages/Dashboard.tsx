import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  IconCalendar,
  IconChevronRight,
  IconClose,
  IconDownload,
  IconFileSpreadsheet,
  IconGitCompare,
  IconPackage,
  IconPlus,
  IconScale,
  IconSearch,
  IconStar,
  IconStore,
  IconTrendingDown,
  IconUpload,
} from '../components/icons'
import { Badge, Button, Card, PageHeader, Stat, fmtDate, rs } from '../components/ui'
import { findOpportunities } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { supabase } from '../lib/supabase'

interface Job { id: string; filename: string; shop_id: string; row_imported: number; created_at: string; created_by: string | null }
interface Audit { id: number; user_id: string | null; table_name: string; action: string; detail: { label?: string } | null; created_at: string }

const TABLE: Record<string, string> = {
  shops: 'shop',
  surveys: 'survey',
  products: 'product',
  price_records: 'price record',
  import_jobs: 'price list import',
  wishlist_items: 'wishlist item',
  export_profiles: 'export profile',
  match_decisions: 'match mapping',
}

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
        supabase.from('audit_events').select('id,user_id,table_name,action,detail,created_at').order('created_at', { ascending: false }).limit(10),
        supabase.from('import_jobs').select('id', { count: 'exact', head: true }),
        supabase.from('price_records').select('id', { count: 'exact', head: true }),
      ])
      setJobs((j.data ?? []) as Job[]); setAudit((a.data ?? []) as Audit[])
      setCounts({ lists: nj.count ?? 0, records: nr.count ?? 0 })
    })()
  }, [])

  const opps = useMemo(
    () => findOpportunities(products, current, history, { freshnessDays: settings.freshness_days, excludeStale: false }),
    [products, current, history, settings],
  )
  const multi = useMemo(() => {
    const by = new Map<string, Set<string>>()
    for (const r of current) {
      const s = by.get(r.product_id!) ?? new Set()
      s.add(r.shop_id)
      by.set(r.product_id!, s)
    }
    return [...by.values()].filter((s) => s.size >= 2).length
  }, [current])
  const top = [...opps].filter((o) => o.verified).sort((a, b) => b.savingPct - a.savingPct).slice(0, 5)
  const newLowCount = opps.filter((o) => o.reasons.includes('new_low')).length
  const search = (e: FormEvent) => {
    e.preventDefault()
    nav(`/compare?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Overview"
        subtitle="Compare wholesale medicine rates, track supplier surveys, and share findings across partners."
      />

      {/* Global Search Bar */}
      <Card className="!p-3 sm:!p-4">
        <form onSubmit={search} className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search medicines, strengths, shops, or product codes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Quick search"
              className="min-h-10 w-full rounded-lg border border-slate-300 bg-slate-50/60 py-2 pr-9 pl-10 text-slate-900 transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
          <Button type="submit" className="shrink-0 sm:px-5">
            <IconSearch size={16} />
            <span>Search Prices</span>
          </Button>
        </form>

        {/* Quick Actions */}
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Quick Actions</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Link to="/import">
              <Button className="w-full justify-center" small>
                <IconUpload size={15} />
                <span className="truncate">Import / Survey</span>
              </Button>
            </Link>
            <Link to="/shops">
              <Button variant="secondary" className="w-full justify-center border-teal-200 bg-teal-50/50 text-teal-900 hover:bg-teal-100/60" small>
                <IconPlus size={15} />
                <span className="truncate">Add Shop</span>
              </Button>
            </Link>
            <Link to="/compare">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconScale size={15} />
                <span className="truncate">Compare Prices</span>
              </Button>
            </Link>
            <Link to="/review">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconGitCompare size={15} />
                <span className="truncate">Review Matches</span>
                {review.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">{review.length}</span>
                )}
              </Button>
            </Link>
            <Link to="/wishlist">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconStar size={15} />
                <span className="truncate">My Wishlist</span>
              </Button>
            </Link>
            <Link to="/opportunities">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconTrendingDown size={15} />
                <span className="truncate">Opportunities</span>
              </Button>
            </Link>
            <Link to="/export">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconDownload size={15} />
                <span className="truncate">Export Results</span>
              </Button>
            </Link>
            <Link to="/surveys">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconCalendar size={15} />
                <span className="truncate">Surveys</span>
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Key Metrics */}
      <section aria-label="Workspace statistics">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Shops" value={shops.filter((s) => s.status === 'active').length} to="/shops" icon={<IconStore size={16} />} />
          <Stat label="Imported Price Lists" value={counts?.lists ?? '…'} to="/imports" icon={<IconFileSpreadsheet size={16} />} />
          <Stat label="Unique Products" value={products.filter((p) => !p.archived).length} to="/products" icon={<IconPackage size={16} />} />
          <Stat label="Price Records" value={counts?.records ?? '…'} to="/compare" icon={<IconScale size={16} />} />
          <Stat label="Products Available at 2+ Shops" value={multi} to="/compare" tone={multi > 0 ? 'green' : undefined} icon={<IconScale size={16} />} />
          <Stat label="Newly Lower Prices" value={newLowCount} to="/opportunities" tone={newLowCount > 0 ? 'green' : undefined} icon={<IconTrendingDown size={16} />} />
          <Stat label="Need Manual Matching" value={review.length} to="/review" tone={review.length ? 'amber' : undefined} icon={<IconGitCompare size={16} />} />
          <Stat label="Wishlist Products" value={wishlist.length} to="/wishlist" icon={<IconStar size={16} />} />
        </div>
      </section>

      {/* Best Purchase Opportunities */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Best Purchase Opportunities</h2>
            <p className="text-xs text-slate-500">Top verified price savings across multiple suppliers</p>
          </div>
          <Link to="/opportunities" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 hover:underline sm:text-sm">
            <span>View all</span>
            <IconChevronRight size={15} />
          </Link>
        </div>

        {top.length === 0 ? (
          <Card className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="text-sm font-medium text-slate-800">No multi-shop opportunities yet</div>
              <p className="text-xs text-slate-500">Opportunities appear automatically once at least two shops offer the same medicine.</p>
            </div>
            <Link to="/import">
              <Button variant="secondary" small>
                <IconUpload size={14} />
                <span>Import price list</span>
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((o) => {
              const vl = variantLabel(o.product)
              return (
                <Link key={o.product.id} to={`/products/${o.product.id}`} className="block">
                  <Card className="h-full !p-3.5 transition-all hover:border-teal-600/60 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{o.product.name}</div>
                        {vl && <div className="mt-0.5"><Badge tone="blue">{vl}</Badge></div>}
                      </div>
                      <Badge tone="solid">Save {o.savingPct.toFixed(1)}%</Badge>
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs text-slate-600">
                      <span className="truncate">
                        Best: <b className="text-slate-800">{shopMap.get(o.best.rec.shop_id)?.name}</b>
                      </span>
                      <span className="font-semibold text-emerald-700 tabular-nums">
                        {rs(o.best.cents! / 100)} <span className="font-normal text-slate-500">(-{rs(o.saving)})</span>
                      </span>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Bottom 2-Column Grid: Imports/Surveys & Activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Recent Imports</h2>
              <Link to="/imports" className="text-xs font-semibold text-teal-800 hover:underline">History</Link>
            </div>
            <Card className="!p-0 overflow-hidden">
              {jobs.length === 0 ? (
                <div className="p-5 text-center text-sm text-slate-500">No price lists imported yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800">{j.filename}</div>
                        <div className="text-xs text-slate-500">
                          {shopMap.get(j.shop_id)?.name ?? 'Shop'} · {fmtDate(j.created_at)} · by {memberName(j.created_by)}
                        </div>
                      </div>
                      <Badge tone="green">{j.row_imported} items</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Recent Surveys</h2>
              <Link to="/surveys" className="text-xs font-semibold text-teal-800 hover:underline">All surveys</Link>
            </div>
            <Card className="!p-0 overflow-hidden">
              {surveys.length === 0 ? (
                <div className="p-5 text-center text-sm text-slate-500">No market surveys recorded yet.</div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {surveys.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800">{shopMap.get(s.shop_id)?.name ?? 'Shop'}</span>
                        <span className="ml-2 text-xs text-slate-500">Survey #{s.survey_no}</span>
                      </div>
                      <span className="text-xs font-medium text-slate-500 tabular-nums">{fmtDate(s.survey_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Recent Workspace Activity</h2>
            <span className="text-xs text-slate-500">Both partners</span>
          </div>
          <Card className="!p-0 overflow-hidden">
            {audit.length === 0 ? (
              <div className="p-5 text-center text-sm text-slate-500">No recent workspace activity yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs sm:text-sm">
                    <div className="min-w-0 flex-1 text-slate-700">
                      <span className="font-semibold text-slate-900">{memberName(a.user_id)}</span>{' '}
                      {a.action === 'insert'
                        ? 'added'
                        : a.action === 'update'
                          ? 'updated'
                          : a.action === 'delete'
                            ? 'removed'
                            : a.action.replace('_', ' ')}{' '}
                      <span className="text-slate-600">{TABLE[a.table_name] ?? a.table_name}</span>
                      {a.detail?.label && (
                        <span className="font-medium text-slate-800"> “{String(a.detail.label).slice(0, 42)}”</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400 tabular-nums">{fmtDate(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}
