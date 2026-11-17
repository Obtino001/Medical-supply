import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ProductBrowser } from '../components/ProductBrowser'
import { IconArrowLeft, IconBuilding, IconClose, IconDownload, IconPlus, IconSearch, IconStore } from '../components/icons'
import { Badge, Button, Card, Empty, Modal, PageHeader, Stat, cx, rs, useToast } from '../components/ui'
import { bulkAssignCompany } from '../lib/actions'
import {
  PHARMA_COMPANIES,
  buildCompanySummaries,
  companySlug,
  resolveProductDisplayCompany,
} from '../lib/companies'
import { useData } from '../lib/data'
import { DEFAULT_COLUMN_KEYS, EXPORT_COLUMNS, buildExportRows, download, toCsv, toMatrix, toXlsxBuffer } from '../lib/exporter'
import { matchesQuery } from '../lib/tableModel'

export default function CompanyDetail() {
  const { companyId } = useParams()
  const rawParam = decodeURIComponent(companyId ?? '')
  const { products, current, shopMap, settings, reload } = useData()
  const toast = useToast()

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products])
  const summaries = useMemo(() => buildCompanySummaries(activeProducts, current, shopMap), [activeProducts, current, shopMap])

  const isUncategorized = rawParam === 'uncategorized' || rawParam === '__uncategorized__'
  const summary = useMemo(() => {
    if (isUncategorized) return summaries.find((s) => s.isUncategorized) ?? null
    const byId = summaries.find((s) => s.id === rawParam || companySlug(s.name) === rawParam)
    if (byId) return byId
    const byName = summaries.find((s) => s.name.toLowerCase() === rawParam.toLowerCase())
    if (byName) return byName
    const known = PHARMA_COMPANIES.find((c) => c.id === rawParam || c.name.toLowerCase() === rawParam.toLowerCase())
    if (known) {
      return {
        id: known.id,
        name: known.name,
        shortName: known.shortName,
        top50Rank: known.top50Rank,
        aliases: known.aliases,
        isUncategorized: false,
        productCount: 0,
        offerCount: 0,
        multiShopCount: 0,
        rsPriceCount: 0,
        discountOnlyCount: 0,
        tpCount: 0,
        bestDiscountPct: null,
        minPriceRs: null,
        maxPriceRs: null,
        shops: [],
        forms: [],
        sampleProducts: [],
      }
    }
    return null
  }, [summaries, rawParam, isUncategorized])

  const [shopFilter, setShopFilter] = useState('')
  const [formFilter, setFormFilter] = useState('')

  // Modal to quickly add / pull products from the catalog into this company
  const [addingProducts, setAddingProducts] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [pickScopeUncatOnly, setPickScopeUncatOnly] = useState(true)
  const [pickSelected, setPickSelected] = useState<Set<string>>(() => new Set())
  const [pickBusy, setPickBusy] = useState(false)

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

  const companyProducts = useMemo(() => {
    if (!summary) return []
    return activeProducts.filter((p) => {
      const resolved = resolveProductDisplayCompany(p, recordsByProduct.get(p.id))
      return summary.isUncategorized ? resolved === null : resolved === summary.name
    })
  }, [activeProducts, recordsByProduct, summary])

  const candidateProducts = useMemo(() => {
    if (!addingProducts || !summary || summary.isUncategorized) return []
    return activeProducts
      .filter((p) => {
        const cur = resolveProductDisplayCompany(p, recordsByProduct.get(p.id))
        if (cur === summary.name) return false
        if (pickScopeUncatOnly && cur !== null) return false
        if (pickQuery && !matchesQuery({ product: p, records: recordsByProduct.get(p.id) ?? [] }, pickQuery, shopMap)) return false
        return true
      })
      .slice(0, 60)
  }, [addingProducts, summary, activeProducts, recordsByProduct, pickScopeUncatOnly, pickQuery, shopMap])

  const applyAddedProducts = async () => {
    if (!summary || summary.isUncategorized || pickSelected.size === 0) return
    setPickBusy(true)
    try {
      const n = await bulkAssignCompany([...pickSelected].map((productId) => ({ productId, manufacturer: summary.name })))
      setPickSelected(new Set())
      setAddingProducts(false)
      await reload()
      toast('ok', `Added ${n} product${n === 1 ? '' : 's'} to ${summary.name}`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setPickBusy(false)
    }
  }

  const exportCompany = (format: 'csv' | 'xlsx') => {
    if (!summary) return
    const rows = buildExportRows('products', {
      products: companyProducts,
      shops: shopMap,
      current,
      review: [],
      opt: { freshnessDays: settings.freshness_days, excludeStale: false },
      selectedIds: new Set(),
    })
    const cols = DEFAULT_COLUMN_KEYS.map((k) => ({ key: k, header: EXPORT_COLUMNS.find((c) => c.key === k)!.header }))
    const matrix = toMatrix(rows, cols)
    const slug = summary.id || 'company'
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      download(`hafsa-medicose-${slug}-${stamp}.csv`, toCsv(matrix), 'text/csv;charset=utf-8')
    } else {
      download(
        `hafsa-medicose-${slug}-${stamp}.xlsx`,
        toXlsxBuffer(matrix, { sheet: summary.shortName, info: [['Company', summary.name], ['Products', companyProducts.length], ['Exported', new Date().toLocaleString()]] }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    }
  }

  if (!summary) {
    return (
      <div className="space-y-4">
        <Link to="/companies" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline">
          <IconArrowLeft size={14} />
          <span>Back to Companies</span>
        </Link>
        <Empty title="Company not found">
          <p>Could not find that pharmaceutical company in your catalog.</p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <Link to="/companies" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline">
          <IconArrowLeft size={14} />
          <span>All pharmaceutical companies</span>
        </Link>

        <PageHeader
          title={summary.name}
          subtitle={
            summary.isUncategorized
              ? 'Medicines that do not have a pharmaceutical company assigned yet.'
              : [
                  summary.top50Rank != null ? `Top 50 Pakistan Pharma · Rank #${summary.top50Rank}` : 'Pharmaceutical / Market Company',
                  summary.aliases.length > 0 ? `Market aliases: ${summary.aliases.slice(0, 5).join(', ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
          }
        >
          {!summary.isUncategorized && (
            <Button small onClick={() => setAddingProducts(true)}>
              <IconPlus size={15} />
              <span>Add products to {summary.shortName}</span>
            </Button>
          )}
          <Button variant="secondary" small disabled={companyProducts.length === 0} onClick={() => exportCompany('xlsx')}>
            <IconDownload size={15} className="text-[var(--color-primary)]" />
            <span>Export Excel</span>
          </Button>
          <Button variant="ghost" small disabled={companyProducts.length === 0} onClick={() => exportCompany('csv')}>
            CSV
          </Button>
        </PageHeader>
      </div>

      {/* Company Detail Stats */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Products listed" value={summary.productCount.toLocaleString()} icon={<IconBuilding size={16} />} />
        <Stat label="Supplier offers" value={summary.offerCount.toLocaleString()} />
        <Stat
          label="At 2+ shops (comparable)"
          value={summary.multiShopCount.toLocaleString()}
          tone={summary.multiShopCount > 0 ? 'blue' : undefined}
        />
        <Stat
          label={summary.minPriceRs != null ? 'Price range (Rs)' : 'Best offer rate'}
          value={
            summary.minPriceRs != null
              ? summary.minPriceRs === summary.maxPriceRs
                ? rs(summary.minPriceRs, 0)
                : `${rs(summary.minPriceRs, 0)}–${rs(summary.maxPriceRs, 0).replace('Rs ', '')}`
              : summary.bestDiscountPct != null
                ? `Up to ${summary.bestDiscountPct}%`
                : summary.tpCount > 0
                  ? `${summary.tpCount} TP`
                  : '—'
          }
          tone={summary.bestDiscountPct != null || summary.minPriceRs != null ? 'green' : undefined}
        />
      </div>

      {/* Interactive Supplier & Dosage Form Breakdowns */}
      {(summary.shops.length > 0 || summary.forms.length > 0) && (
        <Card className="!p-3.5 space-y-3">
          {summary.shops.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                <IconStore size={14} className="text-[var(--color-primary)]" />
                <span>Suppliers carrying {summary.shortName} ({summary.shops.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setShopFilter('')}
                  className={cx(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    !shopFilter
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  All suppliers ({summary.productCount})
                </button>
                {summary.shops.map((s) => (
                  <button
                    key={s.shopId}
                    type="button"
                    onClick={() => setShopFilter(shopFilter === s.shopId ? '' : s.shopId)}
                    className={cx(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors tabular-nums',
                      shopFilter === s.shopId
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    {s.shopName} <span className="text-[var(--text-secondary)]">({s.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {summary.forms.length > 0 && (
            <div className="border-t border-[var(--border-default)]/70 pt-2.5">
              <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Dosage forms &amp; types</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFormFilter('')}
                  className={cx(
                    'rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    !formFilter
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  All forms
                </button>
                {summary.forms.map((f) => {
                  const disabled = f.form === 'other'
                  return (
                    <button
                      key={f.form}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && setFormFilter(formFilter === f.form ? '' : f.form)}
                      className={cx(
                        'rounded-md border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors tabular-nums',
                        formFilter === f.form
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                        disabled && 'cursor-default opacity-75',
                      )}
                    >
                      {f.form} <span className="text-[var(--text-secondary)]">({f.count})</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Scoped Full Product & Best Price Browser */}
      {companyProducts.length === 0 ? (
        <Empty title={`No products listed for ${summary.name} yet`}>
          <p>
            You can add existing medicines from your catalog using “Add products to {summary.shortName}” above, or import a price list containing a Company column.
          </p>
        </Empty>
      ) : (
        <ProductBrowser
          mode="compare"
          companyScope={summary.isUncategorized ? '__uncategorized__' : summary.name}
          externalShop={shopFilter}
          externalForm={formFilter}
          onResetExternal={() => {
            setShopFilter('')
            setFormFilter('')
          }}
        />
      )}

      {/* Modal: Search & Add Existing Products to This Company */}
      {addingProducts && !summary.isUncategorized && (
        <Modal open onClose={() => !pickBusy && setAddingProducts(false)} title={`Add products to ${summary.name}`} wide>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="search"
                  placeholder="Type medicine name, strength, or shop name…"
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  className="min-h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] focus:border-[var(--color-primary)] focus:outline-none"
                  autoFocus
                />
                {pickQuery && (
                  <button
                    type="button"
                    onClick={() => setPickQuery('')}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)]"
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={pickScopeUncatOnly}
                  onChange={(e) => setPickScopeUncatOnly(e.target.checked)}
                />
                <span>Uncategorized only</span>
              </label>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] divide-y divide-[var(--border-default)]">
              {candidateProducts.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-secondary)]">
                  No matching products found. Uncheck “Uncategorized only” to move items from other companies.
                </div>
              ) : (
                candidateProducts.map((p) => {
                  const checked = pickSelected.has(p.id)
                  const cur = resolveProductDisplayCompany(p, recordsByProduct.get(p.id))
                  return (
                    <label
                      key={p.id}
                      className={cx(
                        'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-[var(--bg-hover)]',
                        checked && 'bg-[var(--color-primary-light)]/40',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setPickSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(p.id)) next.delete(p.id)
                              else next.add(p.id)
                              return next
                            })
                          }}
                          className="h-4 w-4 shrink-0 rounded"
                        />
                        <span className="min-w-0 truncate font-medium text-[var(--text-primary)]">{p.name}</span>
                      </span>
                      <Badge tone={cur ? 'slate' : 'amber'}>{cur ?? 'Uncategorized'}</Badge>
                    </label>
                  )
                })
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
              <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                {pickSelected.size} selected (showing up to 60 matches)
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={pickBusy} onClick={() => setAddingProducts(false)}>
                  Cancel
                </Button>
                <Button disabled={pickBusy || pickSelected.size === 0} onClick={() => void applyAddedProducts()}>
                  {pickBusy ? 'Saving…' : `Add ${pickSelected.size} to ${summary.shortName}`}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
