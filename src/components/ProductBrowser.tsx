import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { buildProductRows, GROUP_OPTIONS, groupRows, matchesQuery, SORT_OPTIONS, sortRows, type GroupKey, type ProductRow, type SortKey } from '../lib/tableModel'
import { IconArrowRight, IconChevronDown, IconClose, IconFilter, IconSearch, IconUpload } from './icons'
import { OfferCard } from './Offers'
import { WishlistToggle } from './WishlistToggle'
import { Badge, Button, Card, Empty, Field, Modal, Pagination, Select, cx, fmtDate, rs, useDebounced, useLocalState, useToast } from './ui'

interface View {
  q: string; sort: SortKey; group: GroupKey; brand: string; manufacturer: string; strength: string; weight: string; pack: string
  shop: string; bestOnly: boolean; multiple: boolean; review: boolean; available: boolean; wishlistOnly: boolean
  excludeStale: boolean; freshness: number | null
}
const DEFAULT_VIEW: View = {
  q: '', sort: 'name_asc', group: 'none', brand: '', manufacturer: '', strength: '', weight: '', pack: '', shop: '',
  bestOnly: false, multiple: false, review: false, available: false, wishlistOnly: false, excludeStale: false, freshness: null,
}
const PAGE = 50

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

  const sheetFilterCount = [
    v.brand,
    v.manufacturer,
    v.strength,
    v.weight,
    v.pack,
    v.shop,
    v.excludeStale,
    v.multiple,
    v.available,
    v.review,
    v.freshness != null && v.freshness !== settings.freshness_days,
  ].filter(Boolean).length

  const hasAnyFilter =
    Boolean(v.q || qInput || v.bestOnly || v.wishlistOnly || sheetFilterCount > 0 || v.sort !== 'name_asc' || v.group !== 'none')

  const toggleSel = (id: string) => {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelected(s)
  }

  const pageProductIds = useMemo(
    () => pageItems.filter((it): it is { type: 'row'; row: ProductRow } => it.type === 'row').map((it) => it.row.product.id),
    [pageItems],
  )
  const allPageSelected = pageProductIds.length > 0 && pageProductIds.every((id) => selected.has(id))
  const toggleSelectPage = () => {
    const s = new Set(selected)
    if (allPageSelected) {
      for (const id of pageProductIds) s.delete(id)
    } else {
      for (const id of pageProductIds) s.add(id)
    }
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
    <div className="space-y-2.5">
      {/* Compact Product Toolbar */}
      <Card className="!p-2.5 sm:!p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {/* Search Input */}
          <div className="relative min-w-0 flex-1">
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              placeholder="Search medicine name, shop, strength, or code…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              aria-label="Search products"
              className="min-h-10 sm:min-h-8.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)]/75 hover:border-[var(--border-strong)] focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
            {qInput && (
              <button
                type="button"
                onClick={() => { setQInput(''); set({ q: '' }) }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          {/* Sort, Group & Filters Button */}
          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
            <Select
              value={v.sort}
              onChange={(e) => set({ sort: e.target.value as SortKey })}
              aria-label="Sort"
              className="!min-h-9 sm:!min-h-8.5 sm:!w-44 !py-1 !px-2.5 text-xs sm:text-[13px]"
            >
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
            </Select>
            <Select
              value={v.group}
              onChange={(e) => set({ group: e.target.value as GroupKey })}
              aria-label="Group"
              className="!min-h-9 sm:!min-h-8.5 sm:!w-40 !py-1 !px-2.5 text-xs sm:text-[13px]"
            >
              {GROUP_OPTIONS.map((o) => <option key={o.key} value={o.key}>Group: {o.label}</option>)}
            </Select>
            <Button
              variant="secondary"
              small
              onClick={() => setShowFilters(true)}
              className="col-span-2 sm:col-span-1 !min-h-9 sm:!min-h-8.5"
            >
              <IconFilter size={14} className="text-[var(--color-primary)]" />
              <span>Filters</span>
              {sheetFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold text-[var(--color-primary-text)] tabular-nums">
                  {sheetFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Secondary Compact Filter Pills & View Actions */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 border-t border-[var(--border-default)]/70 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => set({ bestOnly: !v.bestOnly })}
              aria-pressed={v.bestOnly}
              className={cx(
                'inline-flex min-h-7.5 items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                v.bestOnly
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <span>Best-price only</span>
            </button>
            <button
              type="button"
              onClick={() => set({ wishlistOnly: !v.wishlistOnly })}
              aria-pressed={v.wishlistOnly}
              className={cx(
                'inline-flex min-h-7.5 items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                v.wishlistOnly
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <span>Wishlist only</span>
            </button>
            {saved.length > 0 && (
              <Select
                className="!min-h-7.5 !w-auto !py-0.5 !px-2 text-xs"
                value=""
                onChange={(e) => {
                  const s = saved.find((x) => x.id === e.target.value)
                  if (s) {
                    setView({ ...DEFAULT_VIEW, ...s.config })
                    setQInput(s.config.q ?? '')
                    setPage(0)
                  }
                }}
                aria-label="Saved views"
              >
                <option value="">Saved views…</option>
                {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={saveView}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
            >
              Save view
            </button>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={() => {
                  setView(DEFAULT_VIEW)
                  setQInput('')
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Filters Bottom Sheet / Dialog */}
      <Modal open={showFilters} onClose={() => setShowFilters(false)} title="Filter products">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>

          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3.5 text-sm text-[var(--text-primary)]">
            {([
              ['excludeStale', 'Exclude outdated quotes'],
              ['multiple', 'Multiple supplier offers (2+ shops)'],
              ['available', 'Has a valid purchase price'],
              ['review', 'Needs scheme or calculation review'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5">
                <input type="checkbox" checked={v[k]} onChange={(e) => set({ [k]: e.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
            <Button
              variant="ghost"
              onClick={() => {
                setView(DEFAULT_VIEW)
                setQInput('')
              }}
            >
              Reset all
            </Button>
            <Button onClick={() => setShowFilters(false)}>
              Show {filtered.length} product{filtered.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Status & Bulk Selection Strip */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--text-secondary)]">
          <div className="flex items-center gap-2.5">
            {pageProductIds.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-[var(--border-default)]"
                  checked={allPageSelected}
                  onChange={toggleSelectPage}
                  aria-label="Select all products on this page"
                />
                <span>Select page</span>
              </label>
            )}
            <span className="tabular-nums">
              Showing <b className="font-medium text-[var(--text-primary)]">{filtered.length}</b> of {rows.length} products
              {selected.size > 0 && ` · ${selected.size} selected`}
            </span>
          </div>
          {selected.size > 0 && (
            <span className="flex items-center gap-3">
              <Link to="/export" className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">
                <span>Export selected ({selected.size})</span>
                <IconArrowRight size={13} />
              </Link>
              <button type="button" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {/* Product Catalogue List */}
      {items.length === 0 ? (
        rows.length === 0 ? (
          <Empty title="No products yet">
            <p>Import a supplier price list to start comparing offers.</p>
            <div className="mt-4">
              <Link to="/import">
                <Button>
                  <IconUpload size={16} />
                  <span>Import price list</span>
                </Button>
              </Link>
            </div>
          </Empty>
        ) : (
          <Empty title="No products match these filters">
            <p>Try clearing or resetting your active search and filter criteria.</p>
            <div className="mt-3">
              <Button
                variant="secondary"
                small
                onClick={() => {
                  setView(DEFAULT_VIEW)
                  setQInput('')
                }}
              >
                Reset filters
              </Button>
            </div>
          </Empty>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] divide-y divide-[var(--border-default)]">
          {/* Desktop Column Header Strip */}
          <div className="hidden md:grid md:grid-cols-[24px_minmax(220px,2.2fr)_minmax(190px,1.6fr)_minmax(140px,1.1fr)_auto] md:items-center md:gap-3 bg-[var(--bg-subtle)] px-3.5 py-1.5 text-[11px] font-medium tracking-wider text-[var(--text-secondary)] uppercase">
            <span className="sr-only">Select</span>
            <span>Product &amp; form</span>
            <span>Best offer / rate</span>
            <span>Supplier &amp; updated</span>
            <span className="text-right">Actions</span>
          </div>

          {pageItems.map((it, i) =>
            it.type === 'group' ? (
              <div
                key={'g' + i + it.label}
                className="flex items-center justify-between bg-[var(--bg-elevated)] px-3.5 py-1.5 text-xs font-medium tracking-wide text-[var(--text-primary)] uppercase"
              >
                <span>{it.label}</span>
                <span className="rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)] tabular-nums">
                  {it.count}
                </span>
              </div>
            ) : (
              <Row
                key={it.row.product.id}
                r={it.row}
                mode={mode}
                selected={selected.has(it.row.product.id)}
                onSelect={() => toggleSel(it.row.product.id)}
                open={open.has(it.row.product.id)}
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

function Row({
  r,
  mode,
  selected,
  onSelect,
  open,
  onToggle,
  bestOnly,
}: {
  r: ProductRow
  mode: 'compare' | 'master'
  selected: boolean
  onSelect: () => void
  open: boolean
  onToggle: () => void
  bestOnly: boolean
}) {
  const { shopMap } = useData()
  const p = r.product
  const best = r.cmp.offers.find((o) => o.eligible)
  const schemeOnlyOffer = !best ? r.records.find((x) => x.scheme_status === 'ok' && x.scheme_text) : undefined
  const primaryRec = best?.rec ?? schemeOnlyOffer ?? r.records[0]
  const shopName = primaryRec ? shopMap.get(primaryRec.shop_id)?.name : null
  const updatedDate = primaryRec?.observed_on ?? p.updated_at?.slice(0, 10)
  const offers = bestOnly ? r.cmp.offers.filter((o) => o.isBest) : r.cmp.offers
  const codeAndMeta = [
    `#${p.product_no}`,
    p.mfr_code ? `Code ${p.mfr_code}` : null,
    p.brand,
    p.manufacturer,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cx(
        'transition-colors duration-100',
        selected ? 'bg-[var(--color-primary-light)]/40' : 'hover:bg-[var(--bg-hover)]/70',
      )}
    >
      {/* Compact Row Main Line (54–68px on desktop, 2 compact lines on mobile) */}
      <div className="px-3 py-2 sm:px-3.5 sm:py-2.5 md:grid md:grid-cols-[24px_minmax(220px,2.2fr)_minmax(190px,1.6fr)_minmax(140px,1.1fr)_auto] md:items-center md:gap-3">
        {/* Top / Col 1+2 on Mobile, Col 1 & Col 2 on Desktop */}
        <div className="flex items-start justify-between gap-2 md:contents">
          <div className="flex min-w-0 flex-1 items-start gap-2.5 md:contents">
            {/* Checkbox */}
            <div className="flex items-center pt-0.5 md:pt-0">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 rounded border-[var(--border-default)]"
                checked={selected}
                onChange={onSelect}
                aria-label={`Select ${p.name} for export`}
              />
            </div>

            {/* Product Identity Column */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Link
                  to={`/products/${p.id}`}
                  title={p.name}
                  className="text-[13.5px] sm:text-sm font-medium leading-snug text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
                >
                  {p.name}
                </Link>
                {r.variant && (
                  <span className="rounded bg-[var(--color-primary-light)] px-1.5 py-0.2 text-[11px] font-medium text-[var(--color-primary)] whitespace-nowrap">
                    {r.variant}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)] tabular-nums" title={codeAndMeta}>
                {codeAndMeta}
              </div>
            </div>
          </div>

          {/* Mobile-only quick actions on top-right */}
          <div className="flex shrink-0 items-center gap-1 md:hidden">
            <WishlistToggle productId={p.id} compact />
            {r.records.length > 0 && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--bg-hover)]"
              >
                <span className="tabular-nums">{r.records.length}</span>
                <IconChevronDown size={13} className={cx('transition-transform duration-150', open && 'rotate-180')} />
              </button>
            )}
          </div>
        </div>

        {/* Col 3 (Desktop) / Second Compact Line (Mobile): Offer & Price */}
        <div className="mt-1.5 pl-6.5 md:mt-0 md:pl-0">
          {best ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={cx(
                  'text-[13.5px] sm:text-sm font-semibold tabular-nums',
                  best.isBest ? 'text-[var(--color-best)]' : 'text-[var(--text-primary)]',
                )}
              >
                {rs(best.cents! / 100)}
              </span>
              {best.isBest && (
                <span className="rounded bg-[var(--color-best-solid)] px-1.5 py-0.2 text-[10px] font-semibold tracking-wide text-[var(--color-best-solid-text)] uppercase">
                  {best.isTied ? 'Best (Tied)' : 'Best'}
                </span>
              )}
              <span className="text-[11.5px] text-[var(--text-secondary)] tabular-nums">
                {best.rec.scheme_text
                  ? `Rate ${rs(best.rec.base_price)} · ${best.rec.scheme_text}`
                  : best.rec.base_price != null && best.rec.base_price !== best.cents! / 100
                    ? `Rate ${rs(best.rec.base_price)}`
                    : 'Net rate'}
              </span>
              {best.perUnit && (
                <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                  ({rs(best.perUnit.value, 2)}/{best.perUnit.label.replace('Per ', '')})
                </span>
              )}
              {r.cmp.nextBest && (
                <span className="text-[11px] font-medium text-[var(--color-best)] tabular-nums">
                  · Save {rs(r.cmp.nextBest.saving)} ({r.cmp.nextBest.savingPct.toFixed(0)}%)
                </span>
              )}
            </div>
          ) : schemeOnlyOffer ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="blue">{schemeOnlyOffer.scheme_text}</Badge>
              <span className="text-[11.5px] text-[var(--text-secondary)]">Trade / scheme offer</span>
            </div>
          ) : r.records.length ? (
            <Badge tone="amber">Needs review ({r.records.length})</Badge>
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">No price records</span>
          )}

          {/* Mobile inline shop + date */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--text-secondary)] md:hidden">
            {shopName && (
              <span>
                at <b className="font-medium text-[var(--text-primary)]">{shopName}</b>
              </span>
            )}
            {updatedDate && <span className="tabular-nums">· {fmtDate(updatedDate)}</span>}
            {best && !best.fresh && <span className="text-[var(--color-warning-text)]">· Outdated</span>}
          </div>
        </div>

        {/* Col 4 (Desktop): Supplier & Last Updated Date */}
        <div className="hidden min-w-0 md:block">
          {shopName ? (
            <>
              <div className="truncate text-xs font-medium text-[var(--text-primary)]" title={shopName}>
                {shopName}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                <span>{fmtDate(updatedDate)}</span>
                {best && !best.fresh && (
                  <span className="text-[var(--color-warning-text)] font-medium">· Outdated</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[var(--text-secondary)] tabular-nums">
              Updated {fmtDate(updatedDate)}
            </div>
          )}
        </div>

        {/* Col 5 (Desktop): Compact Actions */}
        <div className="hidden shrink-0 items-center justify-end gap-1.5 md:flex">
          <WishlistToggle productId={p.id} compact />
          {r.records.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className={cx(
                'inline-flex h-7.5 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]',
                open
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className="tabular-nums">
                {open ? 'Hide' : `${mode === 'compare' ? 'Compare' : 'Offers'} (${r.records.length})`}
              </span>
              <IconChevronDown size={13} className={cx('transition-transform duration-150', open && 'rotate-180')} />
            </button>
          ) : (
            <Link
              to={`/products/${p.id}`}
              className="inline-flex h-7.5 items-center rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              Details
            </Link>
          )}
        </div>
      </div>

      {/* Expandable Competing Offer Details */}
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>
              All recorded supplier offers for <b className="font-medium text-[var(--text-primary)]">{p.name}</b>
            </span>
            <Link to={`/products/${p.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
              Full price history →
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {offers.map((o) => <OfferCard key={o.rec.id} o={o} shop={shopMap.get(o.rec.shop_id)} />)}
          </div>
        </div>
      )}
    </div>
  )
}
