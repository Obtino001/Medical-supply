import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { buildProductRows, GROUP_OPTIONS, groupRows, matchesQuery, SORT_OPTIONS, sortRows, type GroupKey, type ProductRow, type SortKey } from '../lib/tableModel'
import { IconChevronDown, IconFilter, IconSearch } from './icons'
import { OfferCard } from './Offers'
import { WishlistToggle } from './WishlistToggle'
import { Badge, Button, Card, Empty, Field, Pagination, Select, cx, fmtDate, rs, useDebounced, useLocalState, useToast } from './ui'

interface View {
  q: string; sort: SortKey; group: GroupKey; brand: string; manufacturer: string; strength: string; weight: string; pack: string
  shop: string; bestOnly: boolean; multiple: boolean; review: boolean; available: boolean; wishlistOnly: boolean
  excludeStale: boolean; freshness: number | null
}
const DEFAULT_VIEW: View = {
  q: '', sort: 'name_asc', group: 'none', brand: '', manufacturer: '', strength: '', weight: '', pack: '', shop: '',
  bestOnly: false, multiple: false, review: false, available: false, wishlistOnly: false, excludeStale: false, freshness: null,
}
const PAGE = 30

const distinct = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

export function ProductBrowser({ mode }: { mode: 'compare' | 'master' }) {
  const { products, current, shopMap, shops, settings, wishlistMap, selected, setSelected } = useData()
  const toast = useToast()
  const [params] = useSearchParams()
  const [stored, setView] = useLocalState<View>('view:' + mode, DEFAULT_VIEW)
  const urlQ = params.get('q')
  const view = urlQ !== null ? { ...stored, q: urlQ } : stored
  const v = { ...DEFAULT_VIEW, ...view }
  const set = (patch: Partial<View>) => { setView({ ...v, ...patch }); setPage(0) }
  const [qInput, setQInput] = useState(v.q)
  const dq = useDebounced(qInput, 200)
  useEffect(() => { if (dq !== v.q) set({ q: dq }) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq])
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [saved, setSaved] = useState<{ id: string; name: string; config: View }[]>([])

  useEffect(() => {
    supabase.from('saved_views').select('id,name,config').eq('page', mode).order('created_at').then((r) => setSaved((r.data ?? []) as typeof saved))
  }, [mode])

  const freshness = v.freshness ?? settings.freshness_days
  const rows = useMemo(
    () => buildProductRows(products.filter((p) => !p.archived), current, shopMap, { freshnessDays: freshness, excludeStale: v.excludeStale }),
    [products, current, shopMap, freshness, v.excludeStale],
  )
  const options = useMemo(() => ({
    brand: distinct(rows.map((r) => r.product.brand)),
    manufacturer: distinct(rows.map((r) => r.product.manufacturer)),
    strength: distinct(rows.map((r) => (r.product.strength_value != null ? `${r.product.strength_value}${r.product.strength_unit ?? ''}` : null))),
    weight: distinct(rows.map((r) => (r.product.weight_value != null ? `${r.product.weight_value}${r.product.weight_unit ?? ''}` : null))),
    pack: distinct(rows.map((r) => (r.product.pack_size != null ? String(r.product.pack_size) : null))),
  }), [rows])

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      const p = r.product
      if (v.q && !matchesQuery(r, v.q, shopMap)) return false
      if (v.brand && p.brand !== v.brand) return false
      if (v.manufacturer && p.manufacturer !== v.manufacturer) return false
      if (v.strength && `${p.strength_value}${p.strength_unit ?? ''}` !== v.strength) return false
      if (v.weight && `${p.weight_value}${p.weight_unit ?? ''}` !== v.weight) return false
      if (v.pack && String(p.pack_size) !== v.pack) return false
      if (v.shop && !r.records.some((x) => x.shop_id === v.shop)) return false
      if (v.bestOnly && r.cmp.eligibleCount < 2) return false
      if (v.multiple && r.records.length < 2) return false
      if (v.review && !r.records.some((x) => x.scheme_status !== 'ok')) return false
      if (v.available && r.cmp.eligibleCount === 0) return false
      if (v.wishlistOnly && !wishlistMap.has(p.id)) return false
      return true
    })
    return sortRows(out, v.sort)
  }, [rows, v, shopMap, wishlistMap])

  const items = useMemo(() => {
    const flat: ({ type: 'group'; label: string; count: number } | { type: 'row'; row: ProductRow })[] = []
    for (const g of groupRows(filtered, v.group)) {
      if (g.label) flat.push({ type: 'group', label: g.label, count: g.rows.length })
      for (const r of g.rows) flat.push({ type: 'row', row: r })
    }
    return flat
  }, [filtered, v.group])
  const pages = Math.max(1, Math.ceil(items.length / PAGE))
  const pageItems = items.slice(page * PAGE, page * PAGE + PAGE)

  const toggleSel = (id: string) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }
  const saveView = async () => {
    const name = window.prompt('Name for this view (e.g. "Creams by weight")')
    if (!name?.trim()) return
    const { data, error } = await supabase.from('saved_views').insert({ page: mode, name: name.trim(), config: v }).select('id,name,config').single()
    if (error) return toast('err', error.message)
    setSaved([...saved, data as (typeof saved)[number]])
    toast('ok', 'View saved')
  }

  return (
    <div className="space-y-3">
      <Card className="!p-3 sm:!p-4">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <IconSearch size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search product name, shop, strength, or code…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              aria-label="Search products"
              className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-10 text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
          <Select value={v.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="Sort">
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
          </Select>
          <Select value={v.group} onChange={(e) => set({ group: e.target.value as GroupKey })} aria-label="Group">
            {GROUP_OPTIONS.map((o) => <option key={o.key} value={o.key}>Group: {o.label}</option>)}
          </Select>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button variant="secondary" small onClick={() => setShowFilters(!showFilters)}>
            <IconFilter size={14} />
            <span>{showFilters ? 'Hide filters' : 'Filters'}</span>
          </Button>
          <label className={cx('flex min-h-8.5 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm', v.bestOnly ? 'border-teal-600 bg-teal-50/80 text-teal-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
            <input type="checkbox" className="accent-teal-700" checked={v.bestOnly} onChange={(e) => set({ bestOnly: e.target.checked })} />
            Best-price results only
          </label>
          <label className={cx('flex min-h-8.5 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors sm:text-sm', v.wishlistOnly ? 'border-teal-600 bg-teal-50/80 text-teal-900' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
            <input type="checkbox" className="accent-teal-700" checked={v.wishlistOnly} onChange={(e) => set({ wishlistOnly: e.target.checked })} />
            Wishlist only
          </label>
          {saved.length > 0 && (
            <Select className="!min-h-8.5 !w-auto text-xs sm:text-sm" value="" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) { setView({ ...DEFAULT_VIEW, ...s.config }); setQInput(s.config.q ?? ''); setPage(0) } }} aria-label="Saved views">
              <option value="">Saved views…</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Button variant="ghost" small onClick={saveView}>Save view</Button>
          <Button variant="ghost" small onClick={() => { setView(DEFAULT_VIEW); setQInput('') }}>Reset</Button>
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3 sm:grid-cols-3 lg:grid-cols-4">
            {(['brand', 'manufacturer', 'strength', 'weight', 'pack'] as const).map((k) => (
              <Field key={k} label={{ brand: 'Brand', manufacturer: 'Manufacturer', strength: 'Strength', weight: 'Grams / volume', pack: 'Pack size' }[k]}>
                <Select value={v[k]} onChange={(e) => set({ [k]: e.target.value })}>
                  <option value="">All</option>
                  {options[k].map((o) => <option key={o}>{o}</option>)}
                </Select>
              </Field>
            ))}
            <Field label="Shop">
              <Select value={v.shop} onChange={(e) => set({ shop: e.target.value })}>
                <option value="">All shops</option>
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Price freshness (days)">
              <Select value={String(freshness)} onChange={(e) => set({ freshness: Number(e.target.value) })}>
                {[7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
              </Select>
            </Field>
            <div className="col-span-2 flex flex-col justify-end gap-1.5 text-xs text-slate-700 sm:col-span-3 sm:text-sm lg:col-span-1">
              {([['excludeStale', 'Exclude outdated quotes'], ['multiple', 'Multiple offers'], ['available', 'Has a valid price'], ['review', 'Needs review']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" className="accent-teal-700" checked={v[k]} onChange={(e) => set({ [k]: e.target.checked })} />{label}</label>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-medium text-slate-500 sm:text-sm">
        <span className="tabular-nums">Showing {filtered.length} of {rows.length} products{selected.size > 0 && ` · ${selected.size} selected for export`}</span>
        {selected.size > 0 && (
          <span className="flex items-center gap-3">
            <Link to="/export" className="font-semibold text-teal-800 hover:underline">Export selected →</Link>
            <button type="button" className="text-slate-600 hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <Empty title={rows.length === 0 ? 'No products in workspace yet' : 'No products match these filters'}>
          {rows.length === 0 ? <>Import a supplier price list to populate products and compare rates. <Link to="/import" className="font-semibold text-teal-800 underline">Import price list</Link></> : 'Try clearing or resetting your active search and filter criteria.'}
        </Empty>
      ) : (
        <div className="space-y-2">
          {pageItems.map((it, i) =>
            it.type === 'group' ? (
              <div key={'g' + i + it.label} className="sticky top-14 z-10 mt-3 flex items-center justify-between rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-white uppercase">
                <span>{it.label}</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium tabular-nums">{it.count}</span>
              </div>
            ) : (
              <Row
                key={it.row.product.id}
                r={it.row}
                mode={mode}
                selected={selected.has(it.row.product.id)}
                onSelect={() => toggleSel(it.row.product.id)}
                open={open.has(it.row.product.id) || (mode === 'compare' && items.length < 6)}
                onToggle={() => {
                  const s = new Set(open)
                  if (s.has(it.row.product.id)) s.delete(it.row.product.id)
                  else s.add(it.row.product.id)
                  setOpen(s)
                }}
                bestOnly={v.bestOnly}
              />
            ),
          )}
        </div>
      )}
      <Pagination page={page} pages={pages} onPage={(p) => { setPage(p); window.scrollTo({ top: 0 }) }} />
    </div>
  )
}

function Row({ r, mode, selected, onSelect, open, onToggle, bestOnly }: { r: ProductRow; mode: 'compare' | 'master'; selected: boolean; onSelect: () => void; open: boolean; onToggle: () => void; bestOnly: boolean }) {
  const { shopMap } = useData()
  const p = r.product
  const best = r.cmp.offers.find((o) => o.eligible)
  const offers = bestOnly ? r.cmp.offers.filter((o) => o.isBest) : r.cmp.offers
  const brandMfr = [p.brand, p.manufacturer].filter(Boolean).join(' · ')
  return (
    <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4.5 w-4.5 shrink-0 rounded border-slate-300 accent-teal-700"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select ${p.name} for export`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/products/${p.id}`} className="text-[15px] font-semibold text-slate-900 hover:text-teal-800 hover:underline">
                {p.name}
              </Link>
              <span className="text-xs font-medium text-slate-400 tabular-nums">#{p.product_no}</span>
              {r.variant && <Badge tone="blue">{r.variant}</Badge>}
            </div>
            {brandMfr && <div className="mt-0.5 text-xs text-slate-500">{brandMfr}</div>}

            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs sm:text-sm">
              {best ? (
                <>
                  <span
                    className={cx(
                      'inline-flex items-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums',
                      best.isBest ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-900',
                    )}
                  >
                    {rs(best.cents! / 100)}
                  </span>
                  {best.isBest ? (
                    <Badge tone="solid">{best.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>
                  ) : (
                    <Badge>1 valid offer</Badge>
                  )}
                  <span className="text-slate-700">
                    at <b className="font-semibold text-slate-900">{shopMap.get(best.rec.shop_id)?.name}</b>
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    Rate {rs(best.rec.base_price)}{best.rec.scheme_text ? ` · ${best.rec.scheme_text}` : ''}
                  </span>
                  <span className="text-xs text-slate-400 tabular-nums">· {fmtDate(best.rec.observed_on)}</span>
                  {!best.fresh && <Badge tone="amber">Outdated</Badge>}
                </>
              ) : r.records.length ? (
                <Badge tone="amber">Needs review ({r.records.length} not rankable)</Badge>
              ) : (
                <span className="text-xs text-slate-400">No price records yet</span>
              )}
              {r.cmp.nextBest && (
                <span className="font-medium text-emerald-700 tabular-nums">
                  · saves {rs(r.cmp.nextBest.saving)} ({r.cmp.nextBest.savingPct.toFixed(1)}%) vs next best
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:flex-col sm:items-end">
          <WishlistToggle productId={p.id} />
          {r.records.length > 0 && (
            <Button variant="ghost" small onClick={onToggle}>
              <span>{open ? 'Hide offers' : `${mode === 'compare' ? 'Compare' : 'Offers'} (${r.records.length})`}</span>
              <IconChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {offers.map((o) => <OfferCard key={o.rec.id} o={o} shop={shopMap.get(o.rec.shop_id)} />)}
        </div>
      )}
    </div>
  )
}
