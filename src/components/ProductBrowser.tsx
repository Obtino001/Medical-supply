import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { buildProductRows, GROUP_OPTIONS, groupRows, matchesQuery, SORT_OPTIONS, sortRows, type GroupKey, type ProductRow, type SortKey } from '../lib/tableModel'
import { IconArrowRight, IconChevronDown, IconClose, IconFilter, IconSearch, IconUpload } from './icons'
import { OfferLeadBox, OfferRow } from './Offers'
import { WishlistToggle } from './WishlistToggle'
import { Button, Card, Empty, Field, Modal, Pagination, Select, cx, fmtDate, rs, useDebounced, useLocalState, useToast } from './ui'

interface View {
  q: string
  sort: SortKey
  group: GroupKey
  brand: string
  manufacturer: string
  strength: string
  weight: string
  pack: string
  shop: string
  bestOnly: boolean
  multiple: boolean
  review: boolean
  available: boolean
  incompleteOnly: boolean
  wishlistOnly: boolean
  excludeStale: boolean
  freshOnly: boolean
  validOnly: boolean
  expiredOnly: boolean
  freshness: number | null
}

function getDefaultView(mode: 'compare' | 'master'): View {
  return {
    q: '',
    sort: mode === 'compare' ? 'price_low' : 'price_low',
    group: 'none',
    brand: '',
    manufacturer: '',
    strength: '',
    weight: '',
    pack: '',
    shop: '',
    bestOnly: false,
    multiple: false,
    review: false,
    available: false,
    incompleteOnly: false,
    wishlistOnly: false,
    excludeStale: false,
    freshOnly: false,
    validOnly: false,
    expiredOnly: false,
    freshness: null,
  }
}

const PAGE = 50

const distinct = (vals: (string | null)[]) =>
  [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

const DESKTOP_GRID =
  'md:grid-cols-[20px_minmax(190px,1.45fr)_minmax(270px,2.25fr)_212px] md:items-center md:gap-x-3.5'

export function ProductBrowser({ mode }: { mode: 'compare' | 'master' }) {
  const { products, current, shopMap, shops, settings, wishlistMap, selected, setSelected } = useData()
  const toast = useToast()
  const [params] = useSearchParams()
  const defaultView = useMemo(() => getDefaultView(mode), [mode])
  const [stored, setView] = useLocalState<View>(`view:${mode}:v2`, defaultView)
  const urlQ = params.get('q')
  const view = urlQ !== null ? { ...stored, q: urlQ } : stored
  const v: View = { ...defaultView, ...view }

  const [page, setPage] = useState(0)
  const [extraPages, setExtraPages] = useState(0)
  const set = useCallback(
    (patch: Partial<View>) => {
      setView({ ...v, ...patch })
      setPage(0)
      setExtraPages(0)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v, setView],
  )

  const [qInput, setQInput] = useState(v.q)
  const dq = useDebounced(qInput, 180)
  useEffect(() => {
    if (dq !== v.q) set({ q: dq })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq])

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [saved, setSaved] = useState<{ id: string; name: string; config: View }[]>([])

  useEffect(() => {
    supabase
      .from('saved_views')
      .select('id,name,config')
      .eq('page', mode)
      .order('created_at')
      .then((r) => setSaved((r.data ?? []) as typeof saved))
  }, [mode])

  const freshness = v.freshness ?? settings.freshness_days
  const rows = useMemo(
    () =>
      buildProductRows(products.filter((p) => !p.archived), current, shopMap, {
        freshnessDays: freshness,
        excludeStale: v.excludeStale || v.freshOnly,
      }),
    [products, current, shopMap, freshness, v.excludeStale, v.freshOnly],
  )

  const options = useMemo(
    () => ({
      brand: distinct(rows.map((r) => r.product.brand)),
      manufacturer: distinct(rows.map((r) => r.product.manufacturer)),
      strength: distinct(rows.map((r) => (r.product.strength_value != null ? `${r.product.strength_value}${r.product.strength_unit ?? ''}` : null))),
      weight: distinct(rows.map((r) => (r.product.weight_value != null ? `${r.product.weight_value}${r.product.weight_unit ?? ''}` : null))),
      pack: distinct(rows.map((r) => (r.product.pack_size != null ? String(r.product.pack_size) : null))),
    }),
    [rows],
  )

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
      if (v.review && !r.hasIncompleteOffer) return false
      if (v.available && r.cmp.eligibleCount === 0) return false
      if (v.incompleteOnly && (r.cmp.eligibleCount > 0 || r.records.length === 0)) return false
      if (v.freshOnly && !r.hasFreshOffer) return false
      if (v.validOnly && (r.cmp.eligibleCount === 0 || (r.hasExpiredOffer && r.cmp.eligibleCount === 0))) return false
      if (v.expiredOnly && !r.hasExpiredOffer) return false
      if (v.wishlistOnly && !wishlistMap.has(p.id)) return false
      return true
    })
    return sortRows(out, v.sort, wishlistMap)
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
  const startIdx = page * PAGE
  const endIdx = Math.min(items.length, (page + 1 + extraPages) * PAGE)
  const pageItems = useMemo(() => items.slice(startIdx, endIdx), [items, startIdx, endIdx])

  const sheetFilterCount = [
    v.brand,
    v.manufacturer,
    v.strength,
    v.weight,
    v.pack,
    v.shop,
    v.excludeStale,
    v.freshOnly,
    v.validOnly,
    v.expiredOnly,
    v.multiple,
    v.available,
    v.incompleteOnly,
    v.review,
    v.freshness != null && v.freshness !== settings.freshness_days,
  ].filter(Boolean).length

  const hasAnyFilter = Boolean(
    v.q ||
      qInput ||
      v.bestOnly ||
      v.wishlistOnly ||
      sheetFilterCount > 0 ||
      v.sort !== defaultView.sort ||
      v.group !== 'none',
  )

  const toggleSel = useCallback(
    (id: string) => {
      const s = new Set(selected)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      setSelected(s)
    },
    [selected, setSelected],
  )

  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }, [])

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
    const name = window.prompt('Name for this view (e.g. "Best prices by supplier")')
    if (!name?.trim()) return
    const { data, error } = await supabase
      .from('saved_views')
      .insert({ page: mode, name: name.trim(), config: v })
      .select('id,name,config')
      .single()
    if (error) return toast('err', error.message)
    setSaved([...saved, data as (typeof saved)[number]])
    toast('ok', 'View saved')
  }

  // Summary counts for quick context
  const stats = useMemo(() => {
    let withBestPrice = 0
    let multiShopComparable = 0
    let incompleteOnlyCount = 0
    for (const r of rows) {
      if (r.cmp.eligibleCount >= 1) withBestPrice++
      if (r.cmp.eligibleCount >= 2) multiShopComparable++
      else if (r.cmp.eligibleCount === 0 && r.records.length > 0) incompleteOnlyCount++
    }
    return { withBestPrice, multiShopComparable, incompleteOnlyCount }
  }, [rows])

  return (
    <div className="min-w-0 space-y-2.5">
      {/* Compact Product Toolbar */}
      <Card className="!p-2.5 sm:!p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {/* Search Input */}
          <div className="relative min-w-0 flex-1">
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              placeholder="Search medicine name, supplier, strength, form, or code…"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              aria-label="Search products"
              className="min-h-10 sm:min-h-8.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)]/75 hover:border-[var(--border-strong)] focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
            {qInput && (
              <button
                type="button"
                onClick={() => {
                  setQInput('')
                  set({ q: '' })
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          {/* Sort, Supplier Quick Filter & Filters Button */}
          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
            <Select
              value={v.sort}
              onChange={(e) => set({ sort: e.target.value as SortKey })}
              aria-label="Sort products"
              className="!min-h-9 sm:!min-h-8.5 sm:!w-52 !py-1 !px-2.5 text-xs sm:text-[13px]"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  Sort: {o.label}
                </option>
              ))}
            </Select>
            <Select
              value={v.shop}
              onChange={(e) => set({ shop: e.target.value })}
              aria-label="Filter by supplier"
              className="!min-h-9 sm:!min-h-8.5 sm:!w-40 !py-1 !px-2.5 text-xs sm:text-[13px]"
            >
              <option value="">All suppliers ({shops.length})</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
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
            {stats.withBestPrice > 0 && (
              <FilterPill
                active={v.available}
                onClick={() => set({ available: !v.available, incompleteOnly: false })}
                label={`Valid Rs price (${stats.withBestPrice})`}
              />
            )}
            {stats.multiShopComparable > 0 && (
              <FilterPill
                active={v.bestOnly}
                onClick={() => set({ bestOnly: !v.bestOnly })}
                label={`2+ comparable (${stats.multiShopComparable})`}
              />
            )}
            <FilterPill
              active={v.multiple}
              onClick={() => set({ multiple: !v.multiple })}
              label="2+ suppliers"
            />
            <FilterPill
              active={v.freshOnly}
              onClick={() => set({ freshOnly: !v.freshOnly })}
              label="Fresh only"
            />
            <FilterPill
              active={v.wishlistOnly}
              onClick={() => set({ wishlistOnly: !v.wishlistOnly })}
              label="Wishlist"
            />
            {saved.length > 0 && (
              <Select
                className="!min-h-7.5 !w-auto !py-0.5 !px-2 text-xs"
                value=""
                onChange={(e) => {
                  const s = saved.find((x) => x.id === e.target.value)
                  if (s) {
                    setView({ ...defaultView, ...s.config })
                    setQInput(s.config.q ?? '')
                    setPage(0)
                    setExtraPages(0)
                  }
                }}
                aria-label="Saved views"
              >
                <option value="">Saved views…</option>
                {saved.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="flex items-center gap-1">
            {open.size > 0 && (
              <button
                type="button"
                onClick={() => setOpen(new Set())}
                className="rounded-md px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                Collapse ({open.size})
              </button>
            )}
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
                  setView(defaultView)
                  setQInput('')
                  setPage(0)
                  setExtraPages(0)
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
      <Modal open={showFilters} onClose={() => setShowFilters(false)} title="Filter & group products">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['brand', 'manufacturer', 'strength', 'weight', 'pack'] as const).map((k) => (
              <Field key={k} label={{ brand: 'Brand', manufacturer: 'Manufacturer', strength: 'Strength', weight: 'Grams / volume', pack: 'Pack size' }[k]}>
                <Select value={v[k]} onChange={(e) => set({ [k]: e.target.value })}>
                  <option value="">All</option>
                  {options[k].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Supplier / Shop">
              <Select value={v.shop} onChange={(e) => set({ shop: e.target.value })}>
                <option value="">All suppliers</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Group rows by">
              <Select value={v.group} onChange={(e) => set({ group: e.target.value as GroupKey })}>
                {GROUP_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Price freshness threshold">
              <Select value={String(freshness)} onChange={(e) => set({ freshness: Number(e.target.value) })}>
                {[7, 15, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3.5 text-sm text-[var(--text-primary)]">
            {(
              [
                ['available', 'Only products with complete, calculable Rs purchase prices'],
                ['incompleteOnly', 'Only products with incomplete (discount-only / missing Rs rate) offers'],
                ['bestOnly', 'Only best-price opportunities (2+ valid supplier Rs prices)'],
                ['multiple', 'Listed by multiple suppliers (2+ shops)'],
                ['freshOnly', 'Only fresh survey offers (exclude stale quotes)'],
                ['excludeStale', 'Exclude outdated quotes from best-price ranking'],
                ['validOnly', 'Valid (non-expired) offers only'],
                ['expiredOnly', 'Has expired supplier quotes'],
                ['review', 'Needs scheme or calculation review'],
              ] as const
            ).map(([k, label]) => (
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
                setView(defaultView)
                setQInput('')
                setPage(0)
                setExtraPages(0)
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
          <div className="flex flex-wrap items-center gap-2.5">
            {pageProductIds.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] md:hidden">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--border-default)]"
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
            {stats.incompleteOnlyCount > 0 && stats.withBestPrice === 0 && (
              <span className="text-[11.5px] text-[var(--color-warning-text)]">
                · Imports contain offer rates only: suppliers are ranked by discount, not by purchase price
              </span>
            )}
          </div>
          {selected.size > 0 && (
            <span className="flex items-center gap-3">
              <Link to="/export" className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">
                <span>Export selected ({selected.size})</span>
                <IconArrowRight size={13} />
              </Link>
              <button
                type="button"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                onClick={() => setSelected(new Set())}
              >
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
                  setView(defaultView)
                  setQInput('')
                  setPage(0)
                  setExtraPages(0)
                }}
              >
                Reset filters
              </Button>
            </div>
          </Empty>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] divide-y divide-[var(--border-default)]">
          {/* Desktop Column Header Strip — 4 explicit in-flow columns matching DESKTOP_GRID */}
          <div
            className={cx(
              'hidden md:grid bg-[var(--bg-subtle)] px-3.5 sm:px-4 py-2 text-[11px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase',
              DESKTOP_GRID,
            )}
          >
            <div className="flex items-center">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--border-default)]"
                checked={allPageSelected}
                onChange={toggleSelectPage}
                title="Select all products on this page"
                aria-label="Select all products on this page"
              />
            </div>
            <div>Product &amp; form</div>
            <div>{stats.withBestPrice > 0 ? 'Best supplier & effective price' : 'Best offer & supplier'}</div>
            <div className="text-right">Actions</div>
          </div>

          {pageItems.map((it, i) =>
            it.type === 'group' ? (
              <div
                key={'g' + i + it.label}
                className="flex items-center justify-between bg-[var(--bg-elevated)] px-3.5 sm:px-4 py-1.5 text-xs font-medium tracking-wide text-[var(--text-primary)] uppercase"
              >
                <span className="truncate">{it.label}</span>
                <span className="shrink-0 rounded-full bg-[var(--color-primary-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-primary)] tabular-nums">
                  {it.count}
                </span>
              </div>
            ) : (
              <Row
                key={it.row.product.id}
                r={it.row}
                mode={mode}
                selected={selected.has(it.row.product.id)}
                onSelect={toggleSel}
                open={open.has(it.row.product.id)}
                onToggle={toggleOpen}
                bestOnly={v.bestOnly}
              />
            ),
          )}
        </div>
      )}

      {/* Progressive Load More + Page Navigation */}
      {endIdx < items.length && (
        <div className="flex justify-center pt-1">
          <Button variant="secondary" small onClick={() => setExtraPages((p) => p + 1)}>
            <span>
              Show {Math.min(PAGE, items.length - endIdx)} more products ({endIdx} of {items.length} shown)
            </span>
          </Button>
        </div>
      )}
      <Pagination
        page={page}
        pages={pages}
        onPage={(p) => {
          setPage(p)
          setExtraPages(0)
          window.scrollTo({ top: 0 })
        }}
      />
    </div>
  )
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-7.5 items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      <span>{label}</span>
    </button>
  )
}

const Row = memo(function Row({
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
  onSelect: (id: string) => void
  open: boolean
  onToggle: (id: string) => void
  bestOnly: boolean
}) {
  const { shopMap } = useData()
  const p = r.product
  const best = r.bestOffer
  const ranking = r.ranking
  const bestShopName = r.bestShop?.name ?? (best ? shopMap.get(best.rec.shop_id)?.name : null)
  const fallbackRec = r.records[0]
  const fallbackShopName = fallbackRec ? shopMap.get(fallbackRec.shop_id)?.name : null

  const ordered = bestOnly ? ranking.ordered.filter((e) => e.winner || e.view.eligible) : ranking.ordered
  const formBadge = r.variant || p.dosage_form
  const codeAndMeta = [`#${p.product_no}`, p.mfr_code ? `Code ${p.mfr_code}` : null, p.brand, p.manufacturer]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cx(
        'min-w-0 transition-colors duration-100',
        selected ? 'bg-[var(--color-primary-light)]/35' : 'hover:bg-[var(--bg-hover)]/60',
      )}
    >
      {/* Compact 4-column CSS Grid on desktop, compact 2-row grid on mobile */}
      <div
        className={cx(
          'grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1.5 px-3 py-2.5 sm:px-4 md:py-2',
          DESKTOP_GRID,
        )}
      >
        {/* Col 1: Checkbox */}
        <div className="flex items-center pt-0.5 md:pt-0">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-[var(--border-default)]"
            checked={selected}
            onChange={() => onSelect(p.id)}
            aria-label={`Select ${p.name} for export`}
          />
        </div>

        {/* Col 2 (Left): Product Name, Form/Strength & Code */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              to={`/products/${p.id}`}
              title={p.name}
              className="truncate text-[13.5px] sm:text-sm font-medium leading-snug text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
            >
              {p.name}
            </Link>
            {formBadge && (
              <span className="shrink-0 rounded bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--color-primary)] whitespace-nowrap">
                {formBadge}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)] tabular-nums" title={codeAndMeta}>
            {codeAndMeta}
          </div>
        </div>

        {/* Col 3 (Middle): Winning Supplier Offer Highlight (spans full width below title on mobile) */}
        <div className="col-span-3 col-start-1 min-w-0 md:col-auto">
          {best ? (
            <div className="rounded-lg border border-[var(--color-best-border)] border-l-3 border-l-[var(--color-best-solid)] bg-[var(--color-best-bg)] px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 rounded bg-[var(--color-best-solid)] px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-[var(--color-best-solid-text)] uppercase">
                    {best.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}
                  </span>
                  <span
                    className="truncate text-xs sm:text-[13px] font-semibold text-[var(--text-primary)]"
                    title={bestShopName ?? undefined}
                  >
                    {bestShopName ?? 'Supplier'}
                  </span>
                </div>
                <span className="shrink-0 text-sm sm:text-[15px] font-bold text-[var(--color-best)] tabular-nums">
                  {rs(best.cents! / 100)}
                </span>
              </div>

              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                  <span>
                    {best.rec.scheme_text
                      ? best.rec.base_price != null
                        ? `Rate ${rs(best.rec.base_price)} · ${best.rec.scheme_text}`
                        : best.rec.scheme_text
                      : best.rec.base_price != null && best.rec.base_price !== best.cents! / 100
                        ? `Rate ${rs(best.rec.base_price)}`
                        : 'Net rate'}
                  </span>
                  {best.perUnit && (
                    <span>
                      ({rs(best.perUnit.value, 2)}/{best.perUnit.label.replace('per ', '')})
                    </span>
                  )}
                  {r.cmp.nextBest && (
                    <span className="font-semibold text-[var(--color-best)]">
                      · Save {rs(r.cmp.nextBest.saving)} ({r.cmp.nextBest.savingPct.toFixed(0)}%)
                      {r.nextBestShop ? ` vs ${r.nextBestShop.name}` : ''}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span>{fmtDate(best.rec.observed_on)}</span>
                  {!best.fresh && <span className="font-medium text-[var(--color-warning-text)]">· Stale</span>}
                </div>
              </div>
            </div>
          ) : ranking.lead ? (
            <OfferLeadBox ranking={ranking} shopName={(id) => shopMap.get(id)?.name ?? 'Supplier'} />
          ) : r.records.length > 0 ? (
            <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--color-warning-text)]">
                  {r.hasExpiredOffer ? 'Offer expired — not ranked' : 'Comparison incomplete — needs review'}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                  {fallbackShopName ? `${fallbackShopName} · ` : ''}
                  {fmtDate(fallbackRec?.observed_on)}
                </span>
              </div>
            </div>
          ) : (
            <div className="px-1 text-xs text-[var(--text-secondary)]">
              No supplier offers recorded · Updated {fmtDate(p.updated_at?.slice(0, 10))}
            </div>
          )}
        </div>

        {/* Col 4 (Right): Actions (Wishlist + Expand Offers) */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1.5 md:col-auto md:row-auto">
          <WishlistToggle productId={p.id} compact />
          {r.records.length > 0 ? (
            <button
              type="button"
              onClick={() => onToggle(p.id)}
              aria-expanded={open}
              title={open ? 'Collapse supplier offers' : `Compare all ${r.records.length} supplier offers`}
              className={cx(
                'inline-flex h-8 sm:h-7.5 items-center gap-1 whitespace-nowrap rounded-md border px-2 sm:px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]',
                open
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className="tabular-nums">
                {open ? (
                  'Hide'
                ) : (
                  <>
                    <span className="hidden sm:inline">{mode === 'compare' ? 'Compare' : 'Offers'} </span>({r.records.length})
                  </>
                )}
              </span>
              <IconChevronDown size={13} className={cx('transition-transform duration-150', open && 'rotate-180')} />
            </button>
          ) : (
            <Link
              to={`/products/${p.id}`}
              className="inline-flex h-8 sm:h-7.5 items-center rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              Details
            </Link>
          )}
        </div>
      </div>

      {/* Expandable Competing Supplier Offers — Ranked Lowest Effective Cost First */}
      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span>
              Supplier offers for <b className="font-medium text-[var(--text-primary)]">{p.name}</b> — {ranking.method === 'price' ? 'ranked by effective purchase price' : 'ranked by offer rate (no purchase prices)'} ({ordered.length})
            </span>
            <Link to={`/products/${p.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
              Full price history →
            </Link>
          </div>
          <div className="space-y-1.5">
            {ordered.map((e, idx) => (
              <OfferRow
                key={e.view.rec.id}
                o={e.view}
                entry={e}
                ranking={ranking}
                rank={e.view.eligible ? idx + 1 : undefined}
                isWinner={best ? e.view.rec.id === best.rec.id || e.view.isBest : false}
                shop={shopMap.get(e.view.rec.shop_id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
