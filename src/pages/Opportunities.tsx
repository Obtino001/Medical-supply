import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconChevronDown, IconClose, IconScale, IconSearch, IconUpload } from '../components/icons'
import { FreshBadge, OfferRow } from '../components/Offers'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Button, Card, Empty, PageHeader, Pagination, Select, Stat, cx, fmtDate, rs, useDebounced, useLocalState, useToast } from '../components/ui'
import { compareOffers, findOpportunities, type OpportunityReason } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import { supabase } from '../lib/supabase'
import type { OpportunityStatus } from '../lib/types'

const LABEL: Record<OpportunityReason, string> = {
  multiple: 'Comparable offers',
  new_low: 'New lowest price',
  price_drop: 'Price dropped',
  scheme: 'Trade scheme',
}

const STATUS: Record<OpportunityStatus['status'], string> = {
  interesting: 'Interesting',
  verify: 'Need to verify',
  contact: 'Contact supplier',
  purchased: 'Purchased (note)',
  not_interested: 'Not interested',
}

type SortMode = 'abs' | 'pct' | 'lowest' | 'wishlist' | 'recent'
type QuickTab = 'all' | 'savings' | 'wishlist' | 'fresh' | 'new_low'

export default function Opportunities() {
  const { products, current, history, settings, shopMap, wishlistMap, opportunityStatus, reload } = useData()
  const toast = useToast()
  const [sort, setSort] = useLocalState<SortMode>('opp:sort:v2', 'abs')
  const [tab, setTab] = useState<QuickTab>('all')
  const [reason, setReason] = useState<'' | OpportunityReason>('')
  const [qInput, setQInput] = useState('')
  const q = useDebounced(qInput, 180)
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [hideStatus, setHideStatus] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)

  const opt = useMemo(() => ({ freshnessDays: settings.freshness_days, excludeStale: false }), [settings.freshness_days])
  const all = useMemo(() => findOpportunities(products, current, history, opt), [products, current, history, opt])

  const recordsByProduct = useMemo(() => {
    const m = new Map<string, typeof current>()
    for (const r of current) {
      if (!r.product_id) continue
      const arr = m.get(r.product_id)
      if (arr) arr.push(r)
      else m.set(r.product_id, [r])
    }
    return m
  }, [current])

  const multiShopTotal = useMemo(() => {
    let n = 0
    for (const recs of recordsByProduct.values()) {
      const shops = new Set(recs.map((r) => r.shop_id))
      if (shops.size >= 2) n++
    }
    return n
  }, [recordsByProduct])

  const counts = useMemo(() => {
    const base = all.filter(
      (o) =>
        (!verifiedOnly || o.verified) &&
        (!hideStatus || !['not_interested', 'purchased'].includes(opportunityStatus.get(o.product.id)?.status ?? '')),
    )
    return {
      all: base.length,
      savings: base.filter((o) => o.saving > 0).length,
      wishlist: base.filter((o) => wishlistMap.has(o.product.id)).length,
      fresh: base.filter((o) => o.best.fresh).length,
      new_low: base.filter((o) => o.reasons.includes('new_low')).length,
    }
  }, [all, verifiedOnly, hideStatus, opportunityStatus, wishlistMap])

  const list = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
    const out = all.filter((o) => {
      if (verifiedOnly && !o.verified) return false
      if (reason && !o.reasons.includes(reason)) return false
      if (hideStatus && ['not_interested', 'purchased'].includes(opportunityStatus.get(o.product.id)?.status ?? '')) return false
      if (tab === 'savings' && o.saving <= 0) return false
      if (tab === 'wishlist' && !wishlistMap.has(o.product.id)) return false
      if (tab === 'fresh' && !o.best.fresh) return false
      if (tab === 'new_low' && !o.reasons.includes('new_low')) return false
      if (tokens.length > 0) {
        const winShop = shopMap.get(o.best.rec.shop_id)?.name ?? ''
        const nextShop = o.next ? shopMap.get(o.next.rec.shop_id)?.name ?? '' : ''
        const hay = `${o.product.name} #${o.product.product_no} ${o.product.brand ?? ''} ${o.product.manufacturer ?? ''} ${winShop} ${nextShop}`.toLowerCase()
        if (!tokens.every((t) => hay.includes(t))) return false
      }
      return true
    })

    return out.sort((a, b) => {
      if (sort === 'abs') return b.saving - a.saving || (a.best.cents ?? Infinity) - (b.best.cents ?? Infinity)
      if (sort === 'pct') return b.savingPct - a.savingPct || b.saving - a.saving
      if (sort === 'lowest') return (a.best.cents ?? Infinity) - (b.best.cents ?? Infinity) || b.saving - a.saving
      if (sort === 'recent') return b.best.rec.observed_on.localeCompare(a.best.rec.observed_on) || b.saving - a.saving
      if (sort === 'wishlist') {
        const aw = wishlistMap.has(a.product.id) ? 0 : 1
        const bw = wishlistMap.has(b.product.id) ? 0 : 1
        return aw - bw || b.saving - a.saving || (a.best.cents ?? Infinity) - (b.best.cents ?? Infinity)
      }
      return 0
    })
  }, [all, verifiedOnly, reason, hideStatus, tab, q, sort, opportunityStatus, wishlistMap, shopMap])

  const setStatus = async (productId: string, status: string) => {
    const { error } = status
      ? await supabase.from('opportunity_status').upsert({ product_id: productId, status }, { onConflict: 'workspace_id,product_id' })
      : await supabase.from('opportunity_status').delete().eq('product_id', productId)
    if (error) return toast('err', error.message)
    await reload()
  }

  const toggleOpen = (productId: string) => {
    const s = new Set(open)
    if (s.has(productId)) s.delete(productId)
    else s.add(productId)
    setOpen(s)
  }

  const per = 25
  const tabs: { key: QuickTab; label: string; n: number; tone?: 'green' | 'blue' }[] = [
    { key: 'all', label: 'All comparable', n: counts.all },
    { key: 'savings', label: 'Verified Rs savings', n: counts.savings, tone: counts.savings > 0 ? 'green' : undefined },
    { key: 'wishlist', label: 'On Wishlist', n: counts.wishlist },
    { key: 'fresh', label: 'Fresh surveys', n: counts.fresh },
    { key: 'new_low', label: 'New lowest price', n: counts.new_low },
  ]

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Best opportunities"
        subtitle="Quick purchasing shortlist comparing verified rupee prices for the exact same medicine across suppliers."
      />

      {/* Quick Filter Tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key)
              setPage(0)
            }}
            className={cx(
              'min-w-0 rounded-xl text-left transition-all',
              tab === t.key ? 'ring-2 ring-[var(--color-primary)]' : 'hover:opacity-95',
            )}
          >
            <Stat label={t.label} value={t.n} tone={tab === t.key ? 'blue' : t.tone} />
          </button>
        ))}
      </div>

      {/* Compact Search & Sort Bar */}
      <Card className="!p-2.5 sm:!p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              placeholder="Search medicine or winning supplier…"
              value={qInput}
              onChange={(e) => {
                setQInput(e.target.value)
                setPage(0)
              }}
              aria-label="Search opportunities"
              className="min-h-10 sm:min-h-8.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] transition-colors placeholder:text-[var(--text-secondary)]/75 hover:border-[var(--border-strong)] focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
            {qInput && (
              <button
                type="button"
                onClick={() => {
                  setQInput('')
                  setPage(0)
                }}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
            <Select
              className="!min-h-9 sm:!min-h-8.5 sm:!w-52 !py-1 !px-2.5 text-xs sm:text-[13px]"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort opportunities"
            >
              <option value="abs">Sort: Largest Rs saving</option>
              <option value="pct">Sort: Largest % saving</option>
              <option value="lowest">Sort: Lowest effective price</option>
              <option value="wishlist">Sort: Wishlist products first</option>
              <option value="recent">Sort: Most recently surveyed</option>
            </Select>
            <Select
              className="!min-h-9 sm:!min-h-8.5 sm:!w-44 !py-1 !px-2.5 text-xs sm:text-[13px]"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as '')
                setPage(0)
              }}
              aria-label="Filter by reason"
            >
              <option value="">All reasons</option>
              {Object.entries(LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-[var(--border-default)]/70 pt-2 text-xs text-[var(--text-primary)]">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
            <span>Verified matches only</span>
          </label>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={hideStatus} onChange={(e) => setHideStatus(e.target.checked)} />
            <span>Hide purchased / not interested</span>
          </label>
        </div>
      </Card>

      {list.length === 0 ? (
        <Empty
          title={
            all.length > 0
              ? 'No opportunities match these filters'
              : multiShopTotal > 0
                ? 'Absolute Rs rates needed to compute monetary savings'
                : 'No multi-supplier opportunities yet'
          }
        >
          {all.length > 0 ? (
            <p>Try switching to “All comparable” or clearing your search filters.</p>
          ) : multiShopTotal > 0 ? (
            <>
              <p>
                {multiShopTotal} medicines are listed by 2+ suppliers, but at least one supplier list contains only discount percentages without base Rs rates. We never invent benchmark prices or treat discount % as Rs savings.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link to="/compare">
                  <Button small>
                    <IconScale size={15} />
                    <span>View offers in Compare Prices</span>
                  </Button>
                </Link>
                <Link to="/import">
                  <Button variant="secondary" small>
                    <IconUpload size={15} />
                    <span>Import Rs price list</span>
                  </Button>
                </Link>
              </div>
            </>
          ) : (
            <>
              <p>Opportunities appear automatically when at least two suppliers offer the same medicine with valid purchase prices.</p>
              <div className="mt-4">
                <Link to="/import">
                  <Button small>
                    <IconUpload size={15} />
                    <span>Import price list</span>
                  </Button>
                </Link>
              </div>
            </>
          )}
        </Empty>
      ) : (
        <div className="space-y-2">
          {list.slice(page * per, page * per + per).map((o) => {
            const st = opportunityStatus.get(o.product.id)
            const inWl = wishlistMap.has(o.product.id)
            const isOpen = open.has(o.product.id)
            const winShop = shopMap.get(o.best.rec.shop_id)
            const nextShop = o.next ? shopMap.get(o.next.rec.shop_id) : undefined
            const prodRecs = recordsByProduct.get(o.product.id) ?? []
            const fullCmp = isOpen ? compareOffers(prodRecs, o.product, opt) : null
            const vl = variantLabel(o.product) || o.product.dosage_form

            return (
              <Card key={o.product.id} className="!p-3 sm:!p-3.5 transition-colors hover:border-[var(--border-strong)]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        to={`/products/${o.product.id}`}
                        className="truncate text-sm sm:text-[15px] font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
                      >
                        {o.product.name}
                      </Link>
                      {vl && <Badge tone="blue">{vl}</Badge>}
                      {inWl && <Badge tone="green">On Wishlist</Badge>}
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">#{o.product.product_no}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    {o.saving > 0 ? (
                      <>
                        <div className="text-sm sm:text-base font-bold text-[var(--color-best)]">
                          Save {rs(o.saving)} <span className="text-xs font-semibold">({o.savingPct.toFixed(1)}%)</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          vs {nextShop?.name ?? 'next-best supplier'}
                        </div>
                      </>
                    ) : (
                      <Badge tone="solid">Tied best price</Badge>
                    )}
                  </div>
                </div>

                {/* Winning Offer vs Next-Best Offer */}
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--color-best-border)] border-l-3 border-l-[var(--color-best-solid)] bg-[var(--color-best-bg)] px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge tone="solid">{o.tied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>
                        <b className="truncate font-semibold text-[var(--text-primary)]">{winShop?.name ?? 'Supplier'}</b>
                      </div>
                      <b className="shrink-0 text-sm font-bold text-[var(--color-best)] tabular-nums">{rs(o.best.cents! / 100)}</b>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)] tabular-nums">
                      <span>
                        {o.best.rec.scheme_text
                          ? `Rate ${rs(o.best.rec.base_price)} · ${o.best.rec.scheme_text}`
                          : 'Net purchase price'}
                      </span>
                      <span>Surveyed {fmtDate(o.best.rec.observed_on)}</span>
                    </div>
                  </div>

                  {o.next && (
                    <div className="flex flex-col justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="truncate">
                          Next best: <b className="font-medium text-[var(--text-primary)]">{nextShop?.name ?? 'Supplier'}</b>
                        </span>
                        <span className="shrink-0 font-semibold text-[var(--text-primary)] tabular-nums">
                          {rs(o.next.cents! / 100)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] tabular-nums">
                        <span>{o.next.rec.scheme_text || 'Net rate'}</span>
                        <span>Surveyed {fmtDate(o.next.rec.observed_on)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Badges & Actions Footer */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {o.reasons
                      .filter((r) => r !== 'multiple')
                      .map((r) => (
                        <Badge key={r} tone="green">
                          {LABEL[r]}
                          {r === 'price_drop' && o.dropPct ? ` ${o.dropPct.toFixed(0)}%` : ''}
                          {r === 'new_low' && o.priorLow ? ` (was ${rs(o.priorLow)})` : ''}
                        </Badge>
                      ))}
                    <FreshBadge ageDays={o.best.ageDays} fresh={o.best.fresh} />
                    <Badge tone={o.verified ? 'blue' : 'amber'}>Match: {o.confidence}</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Select
                      className="!w-auto !min-h-8 !py-0.5 !px-2 text-xs"
                      value={st?.status ?? ''}
                      onChange={(e) => void setStatus(o.product.id, e.target.value)}
                      aria-label="Opportunity status"
                    >
                      <option value="">Status: none</option>
                      {Object.entries(STATUS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                    <WishlistToggle productId={o.product.id} compact />
                    <button
                      type="button"
                      onClick={() => toggleOpen(o.product.id)}
                      aria-expanded={isOpen}
                      className={cx(
                        'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors',
                        isOpen
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      <span className="tabular-nums">{isOpen ? 'Hide' : `All offers (${prodRecs.length})`}</span>
                      <IconChevronDown size={13} className={cx('transition-transform', isOpen && 'rotate-180')} />
                    </button>
                  </div>
                </div>

                {isOpen && fullCmp && (
                  <div className="mt-2.5 space-y-1.5 border-t border-[var(--border-default)] pt-2.5">
                    {fullCmp.offers.map((ov, idx) => (
                      <OfferRow
                        key={ov.rec.id}
                        o={ov}
                        rank={ov.eligible ? idx + 1 : undefined}
                        isWinner={ov.isBest}
                        shop={shopMap.get(ov.rec.shop_id)}
                      />
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(list.length / per)} onPage={setPage} />
    </div>
  )
}
