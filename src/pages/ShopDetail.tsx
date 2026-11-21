import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EditOfferModal } from '../components/EditOfferModal'
import { PrintOrderModal } from '../components/PrintOrderModal'
import { ShopForm } from '../components/ShopForm'
import { IconClose, IconEdit, IconPrinter, IconSearch, IconTrash } from '../components/icons'
import { Badge, Button, Card, Empty, PageHeader, Pagination, Stat, cx, fmtDate, rs, useConfirm, useToast } from '../components/ui'
import { deleteShopWithItems } from '../lib/actions'
import { resolveProductDisplayCompany } from '../lib/companies'
import { compareOffers } from '../lib/compare'
import { useData } from '../lib/data'
import { rankOffers } from '../lib/offerRank'
import { matchesSearch } from '../lib/search'
import { updateChecked } from '../lib/supabase'
import { matchesQuery } from '../lib/tableModel'
import type { PriceRecord } from '../lib/types'

const PER_PAGE = 50

export default function ShopDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { shopMap, surveys, current, productMap, settings, reload, history, products } = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [editingOffer, setEditingOffer] = useState<PriceRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [q, setQ] = useState('')
  const [onlyBest, setOnlyBest] = useState(params.get('best') === '1')
  const [page, setPage] = useState(0)
  const [checkedProducts, setCheckedProducts] = useState<Set<string>>(() => new Set())
  const [printingOrder, setPrintingOrder] = useState(false)

  const shop = id ? shopMap.get(id) : undefined

  const mine = useMemo(() => current.filter((r) => r.shop_id === id && r.product_id), [current, id])

  const { bestIds, bestCount } = useMemo(() => {
    const byProduct = new Map<string, typeof current>()
    for (const r of current) {
      if (!r.product_id) continue
      const a = byProduct.get(r.product_id)
      if (a) a.push(r)
      else byProduct.set(r.product_id, [r])
    }
    const winners = new Set<string>()
    let best = 0
    let compared = 0
    for (const p of products) {
      const recs = byProduct.get(p.id)
      if (!recs || !recs.some((r) => r.shop_id === id)) continue
      const c = compareOffers(recs, p, { freshnessDays: settings.freshness_days, excludeStale: false })
      const rk = rankOffers(c)
      const winsPrice = c.eligibleCount >= 2 && c.offers.some((o) => o.isBest && o.rec.shop_id === id)
      const winsOffer = rk.method === 'offer' && rk.winners.some((w) => w.view.rec.shop_id === id)
      if (winsPrice || winsOffer) winners.add(p.id)
      if (c.eligibleCount >= 2) {
        compared++
        if (winsPrice) best++
      }
    }
    return { bestIds: winners, bestCount: { best, compared } }
  }, [current, products, id, settings])

  const filteredMine = useMemo(() => {
    const trimmed = q.trim()
    return mine
      .filter((r) => {
        if (onlyBest && (!r.product_id || !bestIds.has(r.product_id))) return false
        if (!trimmed) return true
        const prod = r.product_id ? productMap.get(r.product_id) : undefined
        if (prod) return matchesQuery({ product: prod, records: [r] }, trimmed, shopMap)
        return matchesSearch([r.original_title, r.original_code, r.scheme_text, shopMap.get(r.shop_id)?.name], trimmed)
      })
      .sort((a, b) => (productMap.get(a.product_id!)?.name ?? '').localeCompare(productMap.get(b.product_id!)?.name ?? ''))
  }, [mine, onlyBest, bestIds, q, productMap, shopMap])

  const pages = Math.max(1, Math.ceil(filteredMine.length / PER_PAGE))
  const safePage = Math.min(page, pages - 1)
  const pageItems = useMemo(
    () => filteredMine.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE),
    [filteredMine, safePage],
  )

  if (!shop) return <Empty title="Shop not found"><Link className="underline" to="/shops">Back to shops</Link></Empty>
  const shopSurveys = surveys.filter((s) => s.shop_id === shop.id)
  const histCount = history.filter((h) => h.shop_id === shop.id).length

  const toggleProduct = (productId: string) => {
    setCheckedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const allPageChecked = pageItems.length > 0 && pageItems.every((r) => r.product_id && checkedProducts.has(r.product_id))
  const togglePageChecked = () => {
    setCheckedProducts((prev) => {
      const next = new Set(prev)
      if (allPageChecked) {
        for (const r of pageItems) if (r.product_id) next.delete(r.product_id)
      } else {
        for (const r of pageItems) if (r.product_id) next.add(r.product_id)
      }
      return next
    })
  }

  const toggleArchive = async () => {
    const archiving = shop.status === 'active'
    if (archiving && !(await confirm({ title: 'Archive this shop?', body: 'Its price history is kept. You can restore it later.', danger: true, confirmLabel: 'Archive' }))) return
    try { await updateChecked('shops', shop.id, shop.updated_at, { status: archiving ? 'archived' : 'active' }); await reload(); toast('ok', archiving ? 'Shop archived' : 'Shop restored') }
    catch (e) { toast('err', (e as Error).message); await reload() }
  }

  const handleDeleteShop = async () => {
    const ok = await confirm({
      title: `Delete "${shop.name}" and its items?`,
      body: `This will permanently delete "${shop.name}", all of its price records (${mine.length} current offers), surveys, import history, and any products that only belong to this shop.`,
      confirmLabel: 'Delete shop & items',
      danger: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await deleteShopWithItems(shop.id)
      await reload()
      toast('ok', `Deleted "${shop.name}" (${res.deletedOffers} offers, ${res.deletedProducts} products removed)`)
      nav('/shops')
    } catch (e) {
      toast('err', (e as Error).message)
      setDeleting(false)
      await reload()
    }
  }

  const printableProductIds = useMemo(() => {
    if (checkedProducts.size > 0) return [...checkedProducts]
    return filteredMine.slice(0, 200).map((r) => r.product_id!).filter(Boolean)
  }, [checkedProducts, filteredMine])

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title={shop.name}>
        {mine.length > 0 && (
          <Button
            small
            onClick={() => {
              if (checkedProducts.size === 0 && filteredMine.length > 200) {
                toast('ok', 'Showing first 200 filtered items (or select specific items with checkboxes)')
              }
              setPrintingOrder(true)
            }}
          >
            <IconPrinter size={14} />
            <span>{checkedProducts.size > 0 ? `Print / PDF Order (${checkedProducts.size})` : 'Print / PDF Order'}</span>
          </Button>
        )}
        <Link to={`/import?shop=${shop.id}`}><Button variant="secondary" small>Import price list</Button></Link>
        <Button variant="secondary" small onClick={() => setEditing(true)}>Edit</Button>
        <Button variant="secondary" small onClick={toggleArchive}>{shop.status === 'active' ? 'Archive' : 'Restore'}</Button>
        <Button variant="danger" small disabled={deleting} onClick={() => void handleDeleteShop()}>
          <IconTrash size={14} />
          <span>{deleting ? 'Deleting…' : 'Delete shop'}</span>
        </Button>
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
        <Stat label="Best offers won" value={`${bestIds.size}${bestCount.compared > 0 ? ` (${bestCount.best}/${bestCount.compared} Rs)` : ''}`} tone={bestIds.size > 0 ? 'green' : undefined} />
      </div>

      <section>
        <h2 className="mb-2 text-base font-medium text-[var(--text-primary)]">Surveys</h2>
        {shopSurveys.length === 0 ? <Empty title="No surveys yet" /> : (
          <div className="space-y-1.5">{shopSurveys.map((s) => <Card key={s.id} className="!p-3 text-sm">Survey #{s.survey_no} · {fmtDate(s.survey_date)}{s.notes ? ` · ${s.notes}` : ''}</Card>)}</div>
        )}
      </section>

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium text-[var(--text-primary)]">Latest prices offered ({filteredMine.length})</h2>
          {bestIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                small
                onClick={() => {
                  setCheckedProducts(new Set(bestIds))
                  toast('ok', `Selected ${bestIds.size} best-offer item${bestIds.size === 1 ? '' : 's'} at ${shop.name}`)
                }}
              >
                Select best offers ({bestIds.size})
              </Button>
            </div>
          )}
        </div>

        {mine.length > 0 && (
          <Card className="!p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <IconSearch size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="search"
                  placeholder={`Search items at ${shop.name} by medicine name, company, code…`}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(0) }}
                  className="min-h-9.5 sm:min-h-8.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1 pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--color-primary)] focus:outline-none"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => { setQ(''); setPage(0) }}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)]"
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {bestIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => { setOnlyBest(!onlyBest); setPage(0) }}
                    className={cx(
                      'inline-flex min-h-8.5 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors',
                      onlyBest
                        ? 'border-[var(--color-best-border)] bg-[var(--color-best-bg)] text-[var(--color-best)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    Only best offers ({bestIds.size})
                  </button>
                )}
              </div>
            </div>

            {checkedProducts.size > 0 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)]/70 pt-2 text-xs">
                <span className="font-medium text-[var(--text-primary)] tabular-nums">
                  {checkedProducts.size} product{checkedProducts.size === 1 ? '' : 's'} selected for {shop.name} order
                </span>
                <div className="flex items-center gap-2">
                  <Button small onClick={() => setPrintingOrder(true)}>
                    <IconPrinter size={13} />
                    <span>Print / PDF Order ({checkedProducts.size})</span>
                  </Button>
                  <button
                    type="button"
                    onClick={() => setCheckedProducts(new Set())}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </Card>
        )}

        {mine.length === 0 ? (
          <Empty title="No matched prices yet" />
        ) : pageItems.length === 0 ? (
          <Empty title="No matching items at this shop" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-default)] bg-[var(--bg-subtle)] text-left text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allPageChecked}
                      onChange={togglePageChecked}
                      aria-label="Select visible items"
                      className="h-4 w-4 rounded"
                    />
                  </th>
                  <th className="px-3 py-2">Product &amp; Company</th>
                  <th className="px-3 py-2">Offer Rate</th>
                  <th className="px-3 py-2">Scheme / Discount</th>
                  <th className="px-3 py-2">Effective Price</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {pageItems.map((r) => {
                  const prod = r.product_id ? productMap.get(r.product_id) : undefined
                  const comp = prod ? resolveProductDisplayCompany(prod, [r]) : null
                  const isWinner = r.product_id ? bestIds.has(r.product_id) : false
                  const isChecked = r.product_id ? checkedProducts.has(r.product_id) : false
                  return (
                    <tr key={r.id} className={cx('hover:bg-[var(--bg-hover)]', isChecked && 'bg-[var(--color-primary-light)]/30')}>
                      <td className="px-3 py-2">
                        {r.product_id && (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleProduct(r.product_id!)}
                            aria-label={`Select ${prod?.name ?? r.original_title}`}
                            className="h-4 w-4 rounded"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link className="font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline" to={`/products/${r.product_id}`}>
                            {prod?.name ?? r.original_title}
                          </Link>
                          {isWinner && <Badge tone="green">BEST</Badge>}
                        </div>
                        {comp && <div className="text-[11px] text-[var(--text-secondary)]">{comp}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--text-secondary)] tabular-nums">
                        {r.base_price != null ? rs(r.base_price) : r.scheme_text || '—'}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{r.scheme_text || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--text-primary)] tabular-nums">
                        {r.scheme_status === 'ok' ? (r.effective_cost != null ? rs(r.effective_cost) : r.scheme_text || '—') : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--text-secondary)]">{fmtDate(r.observed_on)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingOffer(r)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
                        >
                          <IconEdit size={13} />
                          <span>Edit</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={safePage} pages={pages} onPage={(p) => { setPage(p); window.scrollTo({ top: 0 }) }} />
      </section>

      {editing && <ShopForm open onClose={() => setEditing(false)} shop={shop} onSaved={reload} />}
      {editingOffer && <EditOfferModal open onClose={() => setEditingOffer(null)} record={editingOffer} product={editingOffer.product_id ? productMap.get(editingOffer.product_id) : null} />}
      {printingOrder && (
        <PrintOrderModal
          open
          onClose={() => setPrintingOrder(false)}
          productIds={printableProductIds}
          lockedShopId={shop.id}
          title={`${shop.name} - Order Slip`}
        />
      )}
    </div>
  )
}
