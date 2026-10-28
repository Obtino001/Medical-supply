import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronDown, IconClose, IconFilter, IconPlus, IconSearch } from '../components/icons'
import { OfferRow } from '../components/Offers'
import { ProductPicker } from '../components/Match'
import { Badge, Button, Card, Empty, Field, Modal, PageHeader, Pagination, Select, Stat, Textarea, cx, fmtDate, rs, useConfirm, useLocalState, useToast } from '../components/ui'
import { addToWishlist, removeFromWishlist, updateWishlist } from '../lib/actions'
import { compareOffers, findOpportunities, ageInDays, type CompareResult } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import type { PriceRecord, Product, WishlistItem } from '../lib/types'

type SortKey = 'lowest' | 'savings' | 'priority' | 'title' | 'recent' | 'oldest' | 'offers'
type Tile = '' | 'high' | 'multiple' | 'newlow' | 'stale' | 'missing' | 'review'
const PRI = { high: 0, medium: 1, low: 2 } as const
const PRI_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' } as const

interface Entry {
  item: WishlistItem
  product: Product
  records: PriceRecord[]
  cmp: CompareResult
  lastSurvey: string | null
  lastUpdate: string | null
  stale: boolean
  newLow: boolean
  reviewCount: number
}

const DEFAULT_F = { q: '', priority: '', brand: '', manufacturer: '', weight: '', strength: '', pack: '', shop: '', avail: '', match: '' }

export default function Wishlist() {
  const { wishlist, productMap, products, current, history, review, settings, shopMap, shops, reload, memberName } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [sort, setSort] = useLocalState<SortKey>('wl:sort:v2', 'lowest')
  const [tile, setTile] = useState<Tile>('')
  const [f, setF] = useState(DEFAULT_F)
  const [showFilters, setShowFilters] = useState(false)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)

  const entries = useMemo<Entry[]>(() => {
    const opt = { freshnessDays: settings.freshness_days, excludeStale: false }
    const opps = new Map(findOpportunities(products, current, history, opt).map((o) => [o.product.id, o]))
    const byProduct = new Map<string, PriceRecord[]>()
    for (const r of current) {
      if (!r.product_id) continue
      const arr = byProduct.get(r.product_id)
      if (arr) arr.push(r)
      else byProduct.set(r.product_id, [r])
    }
    const out: Entry[] = []
    for (const item of wishlist) {
      const product = productMap.get(item.product_id)
      if (!product) continue
      const records = byProduct.get(product.id) ?? []
      const cmp = compareOffers(records, product, opt)
      const lastSurvey = records.reduce<string | null>((m, r) => (!m || r.observed_on > m ? r.observed_on : m), null)
      const lastUpdate = records.reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null)
      out.push({
        item,
        product,
        records,
        cmp,
        lastSurvey,
        lastUpdate,
        stale: !lastSurvey || ageInDays(lastSurvey) > settings.freshness_days || item.status === 'needs_fresh_price',
        newLow: !!opps.get(product.id)?.reasons.includes('new_low'),
        reviewCount:
          review.filter((r) => r.match_candidates?.some((c) => c.productId === product.id)).length +
          records.filter((r) => r.scheme_status === 'review' || r.match_status === 'conflicting').length,
      })
    }
    return out
  }, [wishlist, productMap, products, current, history, review, settings])

  const shown = useMemo(() => {
    const out = entries.filter((e) => {
      const p = e.product
      if (f.q) {
        const shopNames = e.records.map((r) => shopMap.get(r.shop_id)?.name ?? '').join(' ')
        if (!`${p.name} #${p.product_no} ${p.brand ?? ''} ${p.manufacturer ?? ''} ${shopNames}`.toLowerCase().includes(f.q.toLowerCase())) return false
      }
      if (f.priority && e.item.priority !== f.priority) return false
      if (f.brand && p.brand !== f.brand) return false
      if (f.manufacturer && p.manufacturer !== f.manufacturer) return false
      if (f.weight && `${p.weight_value}${p.weight_unit}` !== f.weight) return false
      if (f.strength && `${p.strength_value}${p.strength_unit}` !== f.strength) return false
      if (f.pack && String(p.pack_size) !== f.pack) return false
      if (f.shop && !e.records.some((r) => r.shop_id === f.shop)) return false
      if (f.avail === 'yes' && e.cmp.eligibleCount === 0) return false
      if (f.avail === 'no' && e.cmp.eligibleCount > 0) return false
      if (f.match && !e.records.some((r) => r.match_status === f.match)) return false
      if (tile === 'high' && e.item.priority !== 'high') return false
      if (tile === 'multiple' && e.cmp.eligibleCount < 2) return false
      if (tile === 'newlow' && !e.newLow) return false
      if (tile === 'stale' && !e.stale) return false
      if (tile === 'missing' && e.cmp.eligibleCount > 0) return false
      if (tile === 'review' && e.reviewCount === 0) return false
      return true
    })
    const save = (e: Entry) => e.cmp.nextBest?.saving ?? -1
    const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
      lowest: (a, b) => (a.cmp.bestCents ?? Infinity) - (b.cmp.bestCents ?? Infinity) || PRI[a.item.priority] - PRI[b.item.priority],
      savings: (a, b) => save(b) - save(a) || (a.cmp.bestCents ?? Infinity) - (b.cmp.bestCents ?? Infinity),
      priority: (a, b) => PRI[a.item.priority] - PRI[b.item.priority] || (a.cmp.bestCents ?? Infinity) - (b.cmp.bestCents ?? Infinity),
      title: (a, b) =>
        a.product.normalized_name.localeCompare(b.product.normalized_name, 'en', { numeric: true }) ||
        (a.product.weight_value ?? 0) - (b.product.weight_value ?? 0),
      recent: (a, b) => (b.lastSurvey ?? '').localeCompare(a.lastSurvey ?? ''),
      oldest: (a, b) => (a.item.last_checked_at ?? '').localeCompare(b.item.last_checked_at ?? ''),
      offers: (a, b) => b.cmp.eligibleCount - a.cmp.eligibleCount || (a.cmp.bestCents ?? Infinity) - (b.cmp.bestCents ?? Infinity),
    }
    return out.sort(cmp[sort] ?? cmp.lowest)
  }, [entries, f, tile, sort, shopMap])

  const uniq = (g: (p: Product) => string | null) =>
    [...new Set(entries.map((e) => g(e.product)).filter((x): x is string => !!x))].sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true }),
    )
  const tiles: { key: Tile; label: string; n: number }[] = [
    { key: '', label: 'All wishlist', n: entries.length },
    { key: 'high', label: 'High priority', n: entries.filter((e) => e.item.priority === 'high').length },
    { key: 'multiple', label: '2+ valid suppliers', n: entries.filter((e) => e.cmp.eligibleCount >= 2).length },
    { key: 'newlow', label: 'New lower price', n: entries.filter((e) => e.newLow).length },
    { key: 'stale', label: 'Needs check', n: entries.filter((e) => e.stale).length },
    { key: 'missing', label: 'Missing Rs price', n: entries.filter((e) => e.cmp.eligibleCount === 0).length },
    { key: 'review', label: 'Needs review', n: entries.filter((e) => e.reviewCount > 0).length },
  ]

  const activeFilterCount = [f.priority, f.brand, f.manufacturer, f.weight, f.strength, f.pack, f.shop, f.avail, f.match].filter(Boolean).length

  const act = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn()
      await reload()
      if (ok) toast('ok', ok)
    } catch (e) {
      toast('err', (e as Error).message)
      await reload()
    }
  }
  const per = 20

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="My wishlist"
        subtitle="Shared priority purchasing list with automatic cheapest-supplier ranking and verified savings."
      >
        <Button small onClick={() => setAdding(true)}>
          <IconPlus size={15} />
          <span>Add product</span>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => {
              setTile(t.key)
              setPage(0)
            }}
            className={cx(
              'min-w-0 rounded-xl text-left transition-all',
              tile === t.key ? 'ring-2 ring-[var(--color-primary)]' : 'hover:opacity-95',
            )}
          >
            <Stat label={t.label} value={t.n} tone={tile === t.key ? 'blue' : undefined} />
          </button>
        ))}
      </div>

      {/* Compact Search & Filter Bar */}
      <Card className="!p-2.5 sm:!p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative min-w-0">
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              placeholder="Search wishlist medicines or suppliers…"
              value={f.q}
              onChange={(e) => {
                setF({ ...f, q: e.target.value })
                setPage(0)
              }}
              aria-label="Search wishlist"
              className="min-h-10 sm:min-h-8.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)]/75 hover:border-[var(--border-strong)] focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
            {f.q && (
              <button
                type="button"
                onClick={() => {
                  setF({ ...f, q: '' })
                  setPage(0)
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort wishlist"
            className="!min-h-9 sm:!min-h-8.5 sm:!w-52 !py-1 !px-2.5 text-xs sm:text-[13px]"
          >
            <option value="lowest">Sort: Lowest effective price</option>
            <option value="savings">Sort: Largest verified savings</option>
            <option value="priority">Sort: Priority</option>
            <option value="title">Sort: Product name A–Z</option>
            <option value="recent">Sort: Most recent survey</option>
            <option value="oldest">Sort: Oldest price check</option>
            <option value="offers">Sort: Most supplier offers</option>
          </Select>
          <Button variant="secondary" small onClick={() => setShowFilters(true)}>
            <IconFilter size={14} className="text-[var(--color-primary)]" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold text-[var(--color-primary-text)] tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </Card>

      {/* Wishlist Filters Bottom Sheet / Dialog */}
      <Modal open={showFilters} onClose={() => setShowFilters(false)} title="Filter wishlist">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['priority', 'Priority', ['high', 'medium', 'low']],
                ['brand', 'Brand', uniq((p) => p.brand)],
                ['manufacturer', 'Manufacturer', uniq((p) => p.manufacturer)],
                ['weight', 'Grams / volume', uniq((p) => (p.weight_value != null ? `${p.weight_value}${p.weight_unit}` : null))],
                ['strength', 'Strength', uniq((p) => (p.strength_value != null ? `${p.strength_value}${p.strength_unit}` : null))],
                ['pack', 'Pack size', uniq((p) => (p.pack_size != null ? String(p.pack_size) : null))],
              ] as const
            ).map(([k, label, opts]) => (
              <Field key={k} label={label}>
                <Select
                  value={f[k]}
                  onChange={(e) => {
                    setF({ ...f, [k]: e.target.value })
                    setPage(0)
                  }}
                >
                  <option value="">All</option>
                  {opts.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Supplier / Shop">
              <Select value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })}>
                <option value="">All suppliers</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Price availability">
              <Select value={f.avail} onChange={(e) => setF({ ...f, avail: e.target.value })}>
                <option value="">Any</option>
                <option value="yes">Has valid Rs price</option>
                <option value="no">No valid Rs price</option>
              </Select>
            </Field>
            <Field label="Match status">
              <Select value={f.match} onChange={(e) => setF({ ...f, match: e.target.value })}>
                <option value="">Any</option>
                <option value="exact">Exact</option>
                <option value="high">High confidence</option>
                <option value="manual">Confirmed</option>
                <option value="conflicting">Conflicting</option>
              </Select>
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
            <Button
              variant="ghost"
              onClick={() => {
                setF(DEFAULT_F)
                setTile('')
                setPage(0)
              }}
            >
              Reset all
            </Button>
            <Button onClick={() => setShowFilters(false)}>
              Show {shown.length} item{shown.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </Modal>

      {shown.length === 0 ? (
        <Empty title={entries.length ? 'No wishlist products match' : 'Your wishlist is empty'}>
          <p>Add fast-moving medicines with the ☆ Wishlist button anywhere, or tap “Add product”.</p>
          {!entries.length && (
            <div className="mt-4">
              <Button onClick={() => setAdding(true)}>
                <IconPlus size={15} />
                <span>Add product</span>
              </Button>
            </div>
          )}
        </Empty>
      ) : (
        <div className="space-y-2.5">
          {shown.slice(page * per, page * per + per).map((e) => {
            const best = e.cmp.offers.find((o) => o.eligible)
            const schemeOnlyOffer = !best ? e.cmp.offers.find((o) => o.isDiscountOnly)?.rec ?? e.records.find((r) => r.scheme_status === 'ok' && r.scheme_text) : undefined
            const bestShopName = best ? shopMap.get(best.rec.shop_id)?.name : null
            const nextBestShopName = e.cmp.nextBest ? shopMap.get(e.cmp.nextBest.shopId)?.name : null
            const alt = products.filter((p) => p.id !== e.product.id && p.normalized_name === e.product.normalized_name && !p.archived)
            const isOpen = open.has(e.item.id)
            const vl = variantLabel(e.product) || e.product.dosage_form

            return (
              <Card key={e.item.id} className="!p-3 sm:!p-3.5">
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(200px,1.4fr)_minmax(260px,2fr)] md:items-start">
                  {/* Left: Product Details & Wishlist Status */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        to={`/products/${e.product.id}`}
                        className="truncate text-[14.5px] font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline sm:text-[15px]"
                      >
                        {e.product.name}
                      </Link>
                      {vl && <Badge tone="blue">{vl}</Badge>}
                      {e.item.priority === 'high' ? <Badge tone="red">{PRI_LABEL.high}</Badge> : <Badge>{PRI_LABEL[e.item.priority]}</Badge>}
                      {e.item.status === 'needs_fresh_price' && <Badge tone="amber">Needs fresh price</Badge>}
                      {e.item.status === 'checked' && <Badge tone="blue">Checked {fmtDate(e.item.last_checked_at)}</Badge>}
                      {e.reviewCount > 0 && <Badge tone="amber">Review pending</Badge>}
                      {e.newLow && <Badge tone="green">New lower price</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-secondary)]">
                      <span>#{e.product.product_no}</span>
                      <span>·</span>
                      <span>
                        <b className="font-medium text-[var(--text-primary)] tabular-nums">{e.cmp.eligibleCount}</b> valid supplier{e.cmp.eligibleCount === 1 ? '' : 's'}
                        {e.records.length > e.cmp.eligibleCount ? ` (${e.records.length} total)` : ''}
                      </span>
                      <span>·</span>
                      <span>
                        Last survey <b className="font-medium text-[var(--text-primary)] tabular-nums">{fmtDate(e.lastSurvey)}</b>
                      </span>
                      <span>·</span>
                      <span>Added by {memberName(e.item.created_by)}</span>
                    </div>
                    {e.item.notes && !isOpen && (
                      <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                        Note: <span className="text-[var(--text-primary)]">{e.item.notes}</span>
                      </div>
                    )}
                  </div>

                  {/* Right: Green-Highlighted Winning Supplier Offer Box */}
                  <div className="min-w-0">
                    {best ? (
                      <div className="rounded-lg border border-[var(--color-best-border)] border-l-3 border-l-[var(--color-best-solid)] bg-[var(--color-best-bg)] px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Badge tone="solid">{best.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>
                            <b className="truncate text-xs sm:text-[13px] font-semibold text-[var(--text-primary)]">
                              {bestShopName ?? 'Supplier'}
                            </b>
                          </div>
                          <span className="shrink-0 text-sm sm:text-base font-bold text-[var(--color-best)] tabular-nums">
                            {rs(best.cents! / 100)}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                          <span>
                            {best.rec.scheme_text
                              ? best.rec.base_price != null
                                ? `Rate ${rs(best.rec.base_price)} · ${best.rec.scheme_text}`
                                : best.rec.scheme_text
                              : best.rec.base_price != null && best.rec.base_price !== best.cents! / 100
                                ? `Rate ${rs(best.rec.base_price)}`
                                : 'Net rate'}
                          </span>
                          <span>
                            Surveyed {fmtDate(best.rec.observed_on)}
                            {!best.fresh ? ' · Stale' : ''}
                          </span>
                        </div>

                        {e.cmp.nextBest && (
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-best-border)]/70 pt-1 text-[11px] tabular-nums">
                            <span className="truncate text-[var(--text-secondary)]">
                              Next best: <b className="font-medium text-[var(--text-primary)]">{nextBestShopName ?? 'Supplier'}</b> ({rs(e.cmp.nextBest.cents / 100)})
                            </span>
                            <span className="shrink-0 font-semibold text-[var(--color-best)]">
                              Save {rs(e.cmp.nextBest.saving)} ({e.cmp.nextBest.savingPct.toFixed(1)}%)
                            </span>
                          </div>
                        )}
                      </div>
                    ) : schemeOnlyOffer ? (
                      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Badge tone="blue">{schemeOnlyOffer.scheme_text}</Badge>
                            <b className="truncate font-medium text-[var(--text-primary)]">
                              {shopMap.get(schemeOnlyOffer.shop_id)?.name ?? 'Supplier'}
                            </b>
                          </div>
                          <Badge tone="amber">Incomplete · no Rs rate</Badge>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-secondary)] tabular-nums">
                          <span>Discount/scheme only — base rate needed for Rs ranking</span>
                          <span>{fmtDate(schemeOnlyOffer.observed_on)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-2 text-xs text-[var(--color-warning-text)]">
                        No valid supplier offer recorded yet
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Controls Strip */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Select
                      className="!w-auto !min-h-8 !py-0.5 !px-2 text-xs"
                      value={e.item.priority}
                      onChange={(ev) => void act(() => updateWishlist(e.item, { priority: ev.target.value as WishlistItem['priority'] }))}
                      aria-label="Priority"
                    >
                      <option value="high">High priority</option>
                      <option value="medium">Medium priority</option>
                      <option value="low">Low priority</option>
                    </Select>
                    <Button
                      small
                      variant="secondary"
                      onClick={() => act(() => updateWishlist(e.item, { status: 'checked', last_checked_at: new Date().toISOString() }), 'Marked as checked')}
                    >
                      Mark checked
                    </Button>
                    <Button
                      small
                      variant="secondary"
                      onClick={() => act(() => updateWishlist(e.item, { status: 'needs_fresh_price' }), 'Marked: needs a fresh price')}
                    >
                      Needs fresh price
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const s = new Set(open)
                        if (isOpen) s.delete(e.item.id)
                        else s.add(e.item.id)
                        setOpen(s)
                      }}
                      aria-expanded={isOpen}
                      className={cx(
                        'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors',
                        isOpen
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span>{isOpen ? 'Hide offers & notes' : `Compare (${e.records.length}) & notes`}</span>
                      <IconChevronDown size={13} className={cx('transition-transform', isOpen && 'rotate-180')} />
                    </button>
                    <Link to={`/products/${e.product.id}`}>
                      <Button small variant="ghost">
                        History
                      </Button>
                    </Link>
                    <Button
                      small
                      variant="danger"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Remove from wishlist?',
                            body: 'The product and all its price history stay. Both partners lose this wishlist entry.',
                            confirmLabel: 'Remove',
                            danger: true,
                          })
                        )
                          await act(() => removeFromWishlist(e.item.id), 'Removed from wishlist')
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2.5 space-y-2 border-t border-[var(--border-default)] pt-2.5">
                    <Notes item={e.item} onSave={(n) => act(() => updateWishlist(e.item, { notes: n }), 'Note saved')} />
                    {e.cmp.offers.length === 0 ? (
                      <div className="text-sm text-[var(--text-secondary)]">No price records for this exact variant yet.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {e.cmp.offers.map((o, idx) => (
                          <OfferRow
                            key={o.rec.id}
                            o={o}
                            rank={o.eligible ? idx + 1 : undefined}
                            isWinner={best ? o.rec.id === best.rec.id || o.isBest : false}
                            shop={shopMap.get(o.rec.shop_id)}
                          />
                        ))}
                      </div>
                    )}
                    {alt.length > 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)] p-2.5 text-xs text-[var(--text-secondary)]">
                        <b className="font-medium text-[var(--text-primary)]">Other variants (shown for reference only):</b>
                        {alt.map((p) => {
                          const rs2 = current.filter((r) => r.product_id === p.id && r.scheme_status === 'ok' && r.effective_cost != null)
                          const m = rs2.length ? Math.min(...rs2.map((r) => r.effective_cost!)) : null
                          return (
                            <div key={p.id} className="mt-0.5">
                              <Link className="font-medium text-[var(--color-primary)] underline" to={`/products/${p.id}`}>
                                {variantLabel(p) || p.name}
                              </Link>
                              : {m != null ? `from ${rs(m)}` : 'no price'}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(shown.length / per)} onPage={setPage} />
      {adding && (
        <ProductPicker
          open
          onClose={() => setAdding(false)}
          title="Add a product to the wishlist"
          onPick={(p) => {
            setAdding(false)
            void act(() => addToWishlist(p.id), 'Added to shared wishlist')
          }}
        />
      )}
    </div>
  )
}

function Notes({ item, onSave }: { item: WishlistItem; onSave: (n: string | null) => void }) {
  const [v, setV] = useState<string | null>(null)
  return (
    <Field label="Wishlist note (shared with partner)">
      <Textarea
        value={v ?? item.notes ?? ''}
        onChange={(e) => setV(e.target.value)}
        placeholder="Add market notes, preferred supplier, or target rate…"
      />
      <Button
        small
        className="mt-2"
        disabled={v === null}
        onClick={() => {
          onSave(v?.trim() || null)
          setV(null)
        }}
      >
        Save note
      </Button>
    </Field>
  )
}
