import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconPlus } from '../components/icons'
import { OfferCard } from '../components/Offers'
import { ProductPicker } from '../components/Match'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Pagination, Select, Stat, Textarea, fmtDate, rs, useConfirm, useLocalState, useToast } from '../components/ui'
import { addToWishlist, removeFromWishlist, updateWishlist } from '../lib/actions'
import { compareOffers, findOpportunities, ageInDays, type CompareResult } from '../lib/compare'
import { useData } from '../lib/data'
import { variantLabel } from '../lib/productParse'
import type { PriceRecord, Product, WishlistItem } from '../lib/types'

type SortKey = 'title' | 'priority' | 'lowest' | 'savings' | 'recent' | 'oldest' | 'offers'
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

export default function Wishlist() {
  const { wishlist, productMap, products, current, history, review, settings, shopMap, shops, reload, memberName } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [sort, setSort] = useLocalState<SortKey>('wl:sort', 'priority')
  const [tile, setTile] = useState<Tile>('')
  const [f, setF] = useState({ q: '', priority: '', brand: '', manufacturer: '', weight: '', strength: '', pack: '', shop: '', avail: '', match: '' })
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)

  const entries = useMemo<Entry[]>(() => {
    const opt = { freshnessDays: settings.freshness_days, excludeStale: false }
    const opps = new Map(findOpportunities(products, current, history, opt).map((o) => [o.product.id, o]))
    const out: Entry[] = []
    for (const item of wishlist) {
      const product = productMap.get(item.product_id)
      if (!product) continue
      const records = current.filter((r) => r.product_id === product.id)
      const cmp = compareOffers(records, product, opt)
      const lastSurvey = records.reduce<string | null>((m, r) => (!m || r.observed_on > m ? r.observed_on : m), null)
      const lastUpdate = records.reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null)
      out.push({
        item, product, records, cmp, lastSurvey, lastUpdate,
        stale: !lastSurvey || ageInDays(lastSurvey) > settings.freshness_days || item.status === 'needs_fresh_price',
        newLow: !!opps.get(product.id)?.reasons.includes('new_low'),
        reviewCount: review.filter((r) => r.match_candidates?.some((c) => c.productId === product.id)).length + records.filter((r) => r.scheme_status === 'review' || r.match_status === 'conflicting').length,
      })
    }
    return out
  }, [wishlist, productMap, products, current, history, review, settings])

  const shown = useMemo(() => {
    const out = entries.filter((e) => {
      const p = e.product
      if (f.q && !`${p.name} ${p.brand ?? ''} ${p.manufacturer ?? ''}`.toLowerCase().includes(f.q.toLowerCase())) return false
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
      title: (a, b) => a.product.normalized_name.localeCompare(b.product.normalized_name, 'en', { numeric: true }) || (a.product.weight_value ?? 0) - (b.product.weight_value ?? 0),
      priority: (a, b) => PRI[a.item.priority] - PRI[b.item.priority] || a.product.name.localeCompare(b.product.name),
      lowest: (a, b) => (a.cmp.bestCents ?? Infinity) - (b.cmp.bestCents ?? Infinity),
      savings: (a, b) => save(b) - save(a),
      recent: (a, b) => (b.lastSurvey ?? '').localeCompare(a.lastSurvey ?? ''),
      oldest: (a, b) => (a.item.last_checked_at ?? '').localeCompare(b.item.last_checked_at ?? ''),
      offers: (a, b) => b.cmp.eligibleCount - a.cmp.eligibleCount,
    }
    return out.sort(cmp[sort])
  }, [entries, f, tile, sort])

  const uniq = (g: (p: Product) => string | null) => [...new Set(entries.map((e) => g(e.product)).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const tiles: { key: Tile; label: string; n: number }[] = [
    { key: '', label: 'All wishlist products', n: entries.length },
    { key: 'high', label: 'High priority', n: entries.filter((e) => e.item.priority === 'high').length },
    { key: 'multiple', label: 'Multiple supplier offers', n: entries.filter((e) => e.cmp.eligibleCount >= 2).length },
    { key: 'newlow', label: 'Newly lower price', n: entries.filter((e) => e.newLow).length },
    { key: 'stale', label: 'Not checked recently', n: entries.filter((e) => e.stale).length },
    { key: 'missing', label: 'Missing / outdated price', n: entries.filter((e) => e.cmp.eligibleCount === 0).length },
    { key: 'review', label: 'Needs match review', n: entries.filter((e) => e.reviewCount > 0).length },
  ]

  const act = async (fn: () => Promise<void>, ok?: string) => {
    try { await fn(); await reload(); if (ok) toast('ok', ok) } catch (e) { toast('err', (e as Error).message); await reload() }
  }
  const per = 15
  return (
    <div className="space-y-4">
      <PageHeader
        title="My Wishlist"
        subtitle="Shared priority products: both partners see and edit the same list. Only the exact variant is compared; other sizes are shown separately as alternatives."
      >
        <Button onClick={() => setAdding(true)}>
          <IconPlus size={15} />
          <span>Add product</span>
        </Button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <button
            key={t.label}
            onClick={() => { setTile(t.key); setPage(0) }}
            className={`rounded-lg text-left transition-all ${tile === t.key ? 'ring-2 ring-[#1A73E8]' : 'hover:opacity-95'}`}
          >
            <Stat label={t.label} value={t.n} tone={tile === t.key ? 'blue' : undefined} />
          </button>
        ))}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Input type="search" placeholder="Search wishlist…" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(0) }} />
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort wishlist">
          <option value="priority">Sort: Priority</option><option value="title">Sort: Title A–Z</option><option value="lowest">Sort: Lowest effective price</option><option value="savings">Sort: Largest savings</option>
          <option value="recent">Sort: Most recent survey</option><option value="oldest">Sort: Oldest price check</option><option value="offers">Sort: Most supplier offers</option>
        </Select>
        {([['priority', 'Priority', ['high', 'medium', 'low']], ['brand', 'Brand', uniq((p) => p.brand)], ['manufacturer', 'Manufacturer', uniq((p) => p.manufacturer)], ['weight', 'Grams', uniq((p) => (p.weight_value != null ? `${p.weight_value}${p.weight_unit}` : null))], ['strength', 'Strength', uniq((p) => (p.strength_value != null ? `${p.strength_value}${p.strength_unit}` : null))], ['pack', 'Pack size', uniq((p) => (p.pack_size != null ? String(p.pack_size) : null))]] as const).map(([k, label, opts]) => (
          <Select key={k} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setPage(0) }} aria-label={label}><option value="">{label}: all</option>{opts.map((o) => <option key={o}>{o}</option>)}</Select>
        ))}
        <Select value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} aria-label="Shop"><option value="">Shop: all</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select value={f.avail} onChange={(e) => setF({ ...f, avail: e.target.value })} aria-label="Price availability"><option value="">Price: any</option><option value="yes">Has valid price</option><option value="no">No valid price</option></Select>
        <Select value={f.match} onChange={(e) => setF({ ...f, match: e.target.value })} aria-label="Match status"><option value="">Match: any</option><option value="exact">Exact</option><option value="high">High confidence</option><option value="manual">Confirmed</option><option value="conflicting">Conflicting</option></Select>
      </div>

      {shown.length === 0 ? <Empty title={entries.length ? 'No wishlist products match' : 'Your wishlist is empty'}>Add fast-moving products with the ☆ Wishlist button anywhere, or use “Add product”.</Empty> : (
        <div className="space-y-3">
          {shown.slice(page * per, page * per + per).map((e) => {
            const best = e.cmp.offers.find((o) => o.eligible)
            const schemeOnlyOffer = !best ? e.records.find((r) => r.scheme_status === 'ok' && r.scheme_text) : undefined
            const alt = products.filter((p) => p.id !== e.product.id && p.normalized_name === e.product.normalized_name && !p.archived)
            const isOpen = open.has(e.item.id)
            return (
              <Card key={e.item.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/products/${e.product.id}`} className="text-lg font-medium text-[#202124] hover:text-[#1A73E8] hover:underline">{e.product.name}</Link>
                    <div className="flex flex-wrap items-center gap-1.5">{variantLabel(e.product) && <Badge tone="blue">{variantLabel(e.product)}</Badge>}
                      {e.item.priority === 'high' ? <Badge tone="red">{PRI_LABEL.high}</Badge> : <Badge>{PRI_LABEL[e.item.priority]}</Badge>}
                      {e.item.status === 'needs_fresh_price' && <Badge tone="amber">Needs fresh price</Badge>}
                      {e.item.status === 'checked' && <Badge tone="blue">Checked {fmtDate(e.item.last_checked_at)}</Badge>}
                      {e.reviewCount > 0 && <Badge tone="amber">Match review pending</Badge>}
                      {e.newLow && <Badge tone="green">New lower price</Badge>}</div>
                    <div className="text-xs text-[#5F6368]">Added by {memberName(e.item.created_by)} on {fmtDate(e.item.created_at)} · last survey {fmtDate(e.lastSurvey)} · last price update {fmtDate(e.lastUpdate)}</div>
                  </div>
                  <div className="text-right">
                    {best ? (<>
                      <div className={`rounded px-2 py-1 text-xl font-bold tabular-nums ${best.isBest ? 'bg-[#188038] text-white' : 'text-[#202124]'}`}>{rs(best.cents! / 100)}</div>
                      <div className="text-sm">{best.isBest && <Badge tone="solid">{best.isTied ? 'BEST PRICE (TIED)' : 'BEST PRICE'}</Badge>} <b>{shopMap.get(best.rec.shop_id)?.name}</b></div>
                      <div className="text-xs text-[#5F6368]">{fmtDate(best.rec.observed_on)}{!best.fresh && ' · possibly outdated'}</div>
                      {e.cmp.nextBest && <div className="text-xs text-[#5F6368]">Next best {rs(e.cmp.nextBest.cents / 100)} · difference {rs(e.cmp.nextBest.saving)}</div>}
                    </>) : schemeOnlyOffer ? (<>
                      <div><Badge tone="blue">{schemeOnlyOffer.scheme_text}</Badge></div>
                      <div className="mt-0.5 text-sm"><b>{shopMap.get(schemeOnlyOffer.shop_id)?.name}</b></div>
                      <div className="text-xs text-[#5F6368]">{fmtDate(schemeOnlyOffer.observed_on)}</div>
                    </>) : <Badge tone="amber">No valid price</Badge>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select className="!w-auto !min-h-9 text-sm" value={e.item.priority} onChange={(ev) => void act(() => updateWishlist(e.item, { priority: ev.target.value as WishlistItem['priority'] }))} aria-label="Priority">
                    <option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option>
                  </Select>
                  <Button small variant="secondary" onClick={() => act(() => updateWishlist(e.item, { status: 'checked', last_checked_at: new Date().toISOString() }), 'Marked as checked')}>Mark checked</Button>
                  <Button small variant="secondary" onClick={() => act(() => updateWishlist(e.item, { status: 'needs_fresh_price' }), 'Marked: needs a fresh price')}>Needs fresh price</Button>
                  <Button small variant="ghost" onClick={() => { const s = new Set(open); if (isOpen) s.delete(e.item.id); else s.add(e.item.id); setOpen(s) }}>{isOpen ? 'Hide offers' : `Compare ${e.records.length} offer${e.records.length === 1 ? '' : 's'}`}</Button>
                  <Link to={`/products/${e.product.id}`}><Button small variant="ghost">Price history</Button></Link>
                  <Button small variant="danger" onClick={async () => { if (await confirm({ title: 'Remove from wishlist?', body: 'The product and all its price history stay. Both partners lose this wishlist entry.', confirmLabel: 'Remove', danger: true })) await act(() => removeFromWishlist(e.item.id), 'Removed from wishlist') }}>Remove</Button>
                </div>
                {isOpen && (
                  <div className="mt-3 space-y-2">
                    <Notes item={e.item} onSave={(n) => act(() => updateWishlist(e.item, { notes: n }), 'Note saved')} />
                    {e.cmp.offers.length === 0 ? <div className="text-sm text-slate-600">No price records for this exact variant yet.</div> : e.cmp.offers.map((o) => <OfferCard key={o.rec.id} o={o} shop={shopMap.get(o.rec.shop_id)} />)}
                    {alt.length > 0 && (
                      <div className="rounded-lg border border-dashed border-slate-300 p-2 text-sm">
                        <b>Other variants (not comparable, shown for reference only):</b>
                        {alt.map((p) => { const rs2 = current.filter((r) => r.product_id === p.id && r.scheme_status === 'ok' && r.effective_cost != null); const m = rs2.length ? Math.min(...rs2.map((r) => r.effective_cost!)) : null
                          return <div key={p.id}><Link className="underline" to={`/products/${p.id}`}>{variantLabel(p) || p.name}</Link>: {m != null ? `from ${rs(m)}` : 'no price'}</div> })}
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
      {adding && <ProductPicker open onClose={() => setAdding(false)} title="Add a product to the wishlist" onPick={(p) => { setAdding(false); void act(() => addToWishlist(p.id), 'Added to shared wishlist') }} />}
    </div>
  )
}

function Notes({ item, onSave }: { item: WishlistItem; onSave: (n: string | null) => void }) {
  const [v, setV] = useState<string | null>(null)
  return (
    <Field label="Wishlist note (shared)">
      <Textarea value={v ?? item.notes ?? ''} onChange={(e) => setV(e.target.value)} />
      <Button small className="mt-2" disabled={v === null} onClick={() => { onSave(v?.trim() || null); setV(null) }}>Save note</Button>
    </Field>
  )
}
