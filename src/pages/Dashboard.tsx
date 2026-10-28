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
    <div className="space-y-5">
      <PageHeader
        title="Market overview"
        subtitle="Compare wholesale medicine rates, track supplier surveys, and share findings across partners."
      />

      {/* Global Search Bar & Primary Actions */}
      <Card className="!p-3.5 sm:!p-4">
        <form onSubmit={search} className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <IconSearch size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              placeholder="Search medicines, strengths, shops, or product codes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Quick search"
              className="min-h-11 sm:min-h-9.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-2 pr-9 pl-10 text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)]/80 hover:border-[var(--border-strong)] focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
          <Button type="submit" className="shrink-0 sm:px-5">
            <IconSearch size={16} />
            <span>Search prices</span>
          </Button>
        </form>

        {/* Primary & Secondary Quick Actions */}
        <div className="mt-3.5 border-t border-[var(--border-default)] pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Link to="/import">
              <Button className="w-full justify-center" small>
                <IconUpload size={15} />
                <span className="truncate">Import price list</span>
              </Button>
            </Link>
            <Link to="/shops">
              <Button variant="secondary" className="w-full justify-center text-[var(--color-primary)]" small>
                <IconPlus size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Add shop</span>
              </Button>
            </Link>
            <Link to="/compare">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconScale size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Compare prices</span>
              </Button>
            </Link>
            <Link to="/wishlist">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconStar size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Open wishlist</span>
              </Button>
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Link to="/review">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconGitCompare size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Review matches</span>
                {review.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-[var(--color-warning)] px-1.5 py-0.2 text-[10px] font-semibold text-[#202124]">{review.length}</span>
                )}
              </Button>
            </Link>
            <Link to="/opportunities">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconTrendingDown size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Opportunities</span>
              </Button>
            </Link>
            <Link to="/export">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconDownload size={15} className="text-[var(--color-primary)]" />
                <span className="truncate">Export results</span>
              </Button>
            </Link>
            <Link to="/surveys">
              <Button variant="secondary" className="w-full justify-center" small>
                <IconCalendar size={15} className="text-[var(--color-primary)]" />
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
          <Stat label="Imported price lists" value={counts?.lists ?? '…'} to="/imports" icon={<IconFileSpreadsheet size={16} />} />
          <Stat label="Unique products" value={products.filter((p) => !p.archived).length} to="/products" icon={<IconPackage size={16} />} />
          <Stat label="Price records" value={counts?.records ?? '…'} to="/compare" icon={<IconScale size={16} />} />
          <Stat label="Available at 2+ shops" value={multi} to="/compare" icon={<IconScale size={16} />} />
          <Stat label="Newly lower prices" value={newLowCount} to="/opportunities" tone={newLowCount > 0 ? 'green' : undefined} icon={<IconTrendingDown size={16} />} />
          <Stat label="Need manual matching" value={review.length} to="/review" tone={review.length ? 'amber' : undefined} icon={<IconGitCompare size={16} />} />
          <Stat label="Wishlist products" value={wishlist.length} to="/wishlist" icon={<IconStar size={16} />} />
        </div>
      </section>

      {/* Best Purchase Opportunities */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-[var(--text-primary)]">Best purchase opportunities</h2>
            <p className="text-xs text-[var(--text-secondary)]">Top verified price savings across multiple suppliers</p>
          </div>
          <Link to="/opportunities" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline sm:text-sm">
            <span>View all</span>
            <IconChevronRight size={15} />
          </Link>
        </div>

        {top.length === 0 ? (
          <Card className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">No multi-shop opportunities yet</div>
              <p className="text-xs text-[var(--text-secondary)]">Opportunities appear automatically once at least two shops offer the same medicine.</p>
            </div>
            <Link to="/import">
              <Button variant="secondary" small>
                <IconUpload size={14} className="text-[var(--color-primary)]" />
                <span>Import price list</span>
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((o) => {
              const vl = variantLabel(o.product)
              return (
                <Link key={o.product.id} to={`/products/${o.product.id}`} className="block">
                  <Card className="h-full !p-3.5 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--bg-hover)]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{o.product.name}</div>
                        {vl && <div className="mt-0.5"><Badge tone="blue">{vl}</Badge></div>}
                      </div>
                      <Badge tone="solid">Save {o.savingPct.toFixed(1)}%</Badge>
                    </div>
                    <div className="mt-2.5 flex items-baseline justify-between border-t border-[var(--border-default)] pt-2 text-xs text-[var(--text-secondary)]">
                      <span className="truncate">
                        Best: <b className="font-medium text-[var(--text-primary)]">{shopMap.get(o.best.rec.shop_id)?.name}</b>
                      </span>
                      <span className="font-semibold text-[var(--color-best)] tabular-nums">
                        {rs(o.best.cents! / 100)} <span className="font-normal text-[var(--text-secondary)]">(-{rs(o.saving)})</span>
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
              <h2 className="text-base font-medium text-[var(--text-primary)]">Recent imports</h2>
              <Link to="/imports" className="text-xs font-medium text-[var(--color-primary)] hover:underline">History</Link>
            </div>
            <Card className="!p-0 overflow-hidden">
              {jobs.length === 0 ? (
                <div className="p-5 text-center text-sm text-[var(--text-secondary)]">No price lists imported yet.</div>
              ) : (
                <ul className="divide-y divide-[var(--border-default)]">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--text-primary)]">{j.filename}</div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {shopMap.get(j.shop_id)?.name ?? 'Shop'} · {fmtDate(j.created_at)} · by {memberName(j.created_by)}
                        </div>
                      </div>
                      <Badge tone="blue">{j.row_imported} items</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-base font-medium text-[var(--text-primary)]">Recent surveys</h2>
              <Link to="/surveys" className="text-xs font-medium text-[var(--color-primary)] hover:underline">All surveys</Link>
            </div>
            <Card className="!p-0 overflow-hidden">
              {surveys.length === 0 ? (
                <div className="p-5 text-center text-sm text-[var(--text-secondary)]">No market surveys recorded yet.</div>
              ) : (
                <ul className="divide-y divide-[var(--border-default)]">
                  {surveys.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-[var(--text-primary)]">{shopMap.get(s.shop_id)?.name ?? 'Shop'}</span>
                        <span className="ml-2 text-xs text-[var(--text-secondary)]">Survey #{s.survey_no}</span>
                      </div>
                      <span className="text-xs font-medium text-[var(--text-secondary)] tabular-nums">{fmtDate(s.survey_date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>

        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-base font-medium text-[var(--text-primary)]">Recent workspace activity</h2>
            <span className="text-xs text-[var(--text-secondary)]">Both partners</span>
          </div>
          <Card className="!p-0 overflow-hidden">
            {audit.length === 0 ? (
              <div className="p-5 text-center text-sm text-[var(--text-secondary)]">No recent workspace activity yet.</div>
            ) : (
              <ul className="divide-y divide-[var(--border-default)]">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-xs sm:text-sm">
                    <div className="min-w-0 flex-1 text-[var(--text-secondary)]">
                      <span className="font-medium text-[var(--text-primary)]">{memberName(a.user_id)}</span>{' '}
                      {a.action === 'insert'
                        ? 'added'
                        : a.action === 'update'
                          ? 'updated'
                          : a.action === 'delete'
                            ? 'removed'
                            : a.action.replace('_', ' ')}{' '}
                      <span className="text-[var(--text-secondary)]">{TABLE[a.table_name] ?? a.table_name}</span>
                      {a.detail?.label && (
                        <span className="font-medium text-[var(--text-primary)]"> “{String(a.detail.label).slice(0, 42)}”</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-secondary)] tabular-nums">{fmtDate(a.created_at)}</span>
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
