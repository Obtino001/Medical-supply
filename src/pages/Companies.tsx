import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AssignCompanyModal } from '../components/AssignCompanyModal'
import {
  IconArrowRight,
  IconBuilding,
  IconCheck,
  IconClose,
  IconDownload,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconStore,
} from '../components/icons'
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, Pagination, Select, Stat, cx, rs, useToast } from '../components/ui'
import { bulkAssignCompany } from '../lib/actions'
import {
  PHARMA_COMPANIES,
  buildCompanySummaries,
  buildCompanySuggestions,
  companySlug,
  resolveCanonicalCompany,
  resolveProductDisplayCompany,
  type CompanySummary,
  type DetectionReason,
} from '../lib/companies'
import { useData } from '../lib/data'
import { download, toCsv, toMatrix, toXlsxBuffer } from '../lib/exporter'
import { matchesQuery } from '../lib/tableModel'

type Tab = 'all' | 'top50' | 'categorize'
type DirSort = 'products' | 'rank' | 'name' | 'offers' | 'discount'
type DirFilter = 'all' | 'listed' | 'empty' | 'multi'
type CatScope = 'uncategorized' | 'suggested' | 'needs_cleanup' | 'all'

const REASON_LABELS: Record<DetectionReason, { title: string; hint: string }> = {
  supplier_record: {
    title: 'From supplier sheet (Company column)',
    hint: 'Products missing a company name, but an imported supplier offer record already contains its Company field.',
  },
  title_tag: {
    title: 'Company tag inside product name',
    hint: 'Explicit company tags in titles such as (CCL), (AGP), (ABBOTT), (GETZ), etc.',
  },
  canonical_existing: {
    title: 'Standardize abbreviated / legacy names',
    hint: 'Normalize shorthand like "A.G.P", "GETZ", "ABBOTT PHARMANET", "GSK-" into clean canonical Top 50 company names.',
  },
  brand_family: {
    title: 'Unambiguous brand family match',
    hint: 'Products whose medicine brand stem matches already-categorized products belonging to only one company.',
  },
  clear_placeholder: {
    title: 'Clear distributor placeholders',
    hint: 'Remove generic labels like "MISC.", "MIX ITEM", "DROPS", "CREAMS AND OINTMENT" mistakenly saved as manufacturer.',
  },
}

const ALL_REASONS: DetectionReason[] = ['supplier_record', 'title_tag', 'canonical_existing', 'brand_family', 'clear_placeholder']
const WORKBENCH_PER_PAGE = 50

export default function Companies() {
  const { products, current, shopMap, shops, reload } = useData()
  const toast = useToast()

  const activeProducts = useMemo(() => products.filter((p) => !p.archived), [products])

  const summaries = useMemo(
    () => buildCompanySummaries(activeProducts, current, shopMap),
    [activeProducts, current, shopMap],
  )

  const suggestions = useMemo(
    () => buildCompanySuggestions(activeProducts, current),
    [activeProducts, current],
  )

  const suggestionByProductId = useMemo(
    () => new Map(suggestions.map((s) => [s.productId, s])),
    [suggestions],
  )

  const uncategorizedSummary = useMemo(
    () => summaries.find((s) => s.isUncategorized) ?? null,
    [summaries],
  )

  const companyEntries = useMemo(
    () => summaries.filter((s) => !s.isUncategorized),
    [summaries],
  )

  const kpis = useMemo(() => {
    const total = activeProducts.length
    const uncat = uncategorizedSummary?.productCount ?? 0
    const categorized = Math.max(0, total - uncat)
    const pct = total > 0 ? Math.round((categorized / total) * 100) : 0
    const top50Total = companyEntries.filter((c) => c.top50Rank != null).length
    const top50Listed = companyEntries.filter((c) => c.top50Rank != null && c.productCount > 0).length
    const otherListed = companyEntries.filter((c) => c.top50Rank == null && c.productCount > 0).length
    return { total, categorized, uncat, pct, top50Total, top50Listed, otherListed }
  }, [activeProducts.length, uncategorizedSummary, companyEntries])

  const [tab, setTab] = useState<Tab>('all')
  const [dirSearch, setDirSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<DirFilter>('all')
  const [dirSort, setDirSort] = useState<DirSort>('products')

  // Auto-categorize review modal state
  const [showAutoModal, setShowAutoModal] = useState(false)
  const [enabledReasons, setEnabledReasons] = useState<Set<DetectionReason>>(() => new Set(ALL_REASONS))
  const [autoBusy, setAutoBusy] = useState(false)

  // Add custom / assign modal from a company card
  const [addingCustomOpen, setAddingCustomOpen] = useState(false)

  // Workbench state
  const [catScope, setCatScope] = useState<CatScope>('uncategorized')
  const [catShop, setCatShop] = useState('')
  const [catSearch, setCatSearch] = useState('')
  const [catPage, setCatPage] = useState(0)
  const [wbSelected, setWbSelected] = useState<Set<string>>(() => new Set())
  const [targetCompany, setTargetCompany] = useState<string>(PHARMA_COMPANIES[0].name)
  const [customTarget, setCustomTarget] = useState('')
  const [wbBusy, setWbBusy] = useState(false)

  // Filtered directory cards
  const filteredCompanies = useMemo(() => {
    const q = dirSearch.trim().toLowerCase()
    const base = tab === 'top50' ? companyEntries.filter((c) => c.top50Rank != null) : companyEntries
    const out = base.filter((c) => {
      if (dirFilter === 'listed' && c.productCount === 0) return false
      if (dirFilter === 'empty' && c.productCount > 0) return false
      if (dirFilter === 'multi' && c.multiShopCount === 0) return false
      if (q) {
        const hay = [
          c.name,
          c.shortName,
          c.top50Rank != null ? `#${c.top50Rank}` : '',
          ...c.aliases,
          ...c.shops.map((s) => s.shopName),
          ...c.sampleProducts.map((p) => p.name),
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    out.sort((a, b) => {
      if (dirSort === 'rank') {
        const ar = a.top50Rank ?? 9999
        const br = b.top50Rank ?? 9999
        return ar - br || b.productCount - a.productCount || a.name.localeCompare(b.name)
      }
      if (dirSort === 'name') return a.name.localeCompare(b.name)
      if (dirSort === 'offers') return b.offerCount - a.offerCount || b.productCount - a.productCount || a.name.localeCompare(b.name)
      if (dirSort === 'discount') return (b.bestDiscountPct ?? -1) - (a.bestDiscountPct ?? -1) || b.productCount - a.productCount
      // 'products' default: listed companies first, highest count first, then Top 50 rank
      return (
        b.productCount - a.productCount ||
        (a.top50Rank ?? 9999) - (b.top50Rank ?? 9999) ||
        a.name.localeCompare(b.name)
      )
    })
    return out
  }, [companyEntries, tab, dirFilter, dirSearch, dirSort])

  // Map records by product for workbench
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

  // Workbench items
  const workbenchProducts = useMemo(() => {
    return activeProducts.filter((p) => {
      const recs = recordsByProduct.get(p.id) ?? []
      const liveCompany = resolveProductDisplayCompany(p, recs)
      const sug = suggestionByProductId.get(p.id)

      if (catScope === 'uncategorized' && liveCompany !== null) return false
      if (catScope === 'suggested' && !sug) return false
      if (catScope === 'needs_cleanup' && !(sug && (sug.reason === 'canonical_existing' || sug.reason === 'clear_placeholder'))) return false
      if (catShop && !recs.some((r) => r.shop_id === catShop)) return false
      if (catSearch && !matchesQuery({ product: p, records: recs }, catSearch, shopMap)) return false
      return true
    })
  }, [activeProducts, recordsByProduct, suggestionByProductId, catScope, catShop, catSearch, shopMap])

  const wbPages = Math.max(1, Math.ceil(workbenchProducts.length / WORKBENCH_PER_PAGE))
  const safeWbPage = Math.min(catPage, wbPages - 1)
  const wbPageItems = useMemo(
    () => workbenchProducts.slice(safeWbPage * WORKBENCH_PER_PAGE, (safeWbPage + 1) * WORKBENCH_PER_PAGE),
    [workbenchProducts, safeWbPage],
  )

  const toggleWbSelect = (id: string) => {
    setWbSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleWbSelectPage = () => {
    const allSelected = wbPageItems.length > 0 && wbPageItems.every((p) => wbSelected.has(p.id))
    setWbSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const p of wbPageItems) next.delete(p.id)
      } else {
        for (const p of wbPageItems) next.add(p.id)
      }
      return next
    })
  }

  // Group auto-suggestions by reason for the review modal
  const reasonGroups = useMemo(() => {
    const counts = new Map<DetectionReason, typeof suggestions>()
    for (const r of ALL_REASONS) counts.set(r, [])
    for (const s of suggestions) {
      const arr = counts.get(s.reason)
      if (arr) arr.push(s)
    }
    return ALL_REASONS.map((reason) => ({
      reason,
      ...REASON_LABELS[reason],
      items: counts.get(reason) ?? [],
    })).filter((g) => g.items.length > 0)
  }, [suggestions])

  const selectedAutoSuggestions = useMemo(
    () => suggestions.filter((s) => enabledReasons.has(s.reason)),
    [suggestions, enabledReasons],
  )

  const runAutoCategorize = async () => {
    if (selectedAutoSuggestions.length === 0) return
    setAutoBusy(true)
    try {
      const n = await bulkAssignCompany(
        selectedAutoSuggestions.map((s) => ({ productId: s.productId, manufacturer: s.suggestedManufacturer })),
      )
      await reload()
      setShowAutoModal(false)
      toast('ok', `Updated company on ${n} product${n === 1 ? '' : 's'}`)
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setAutoBusy(false)
    }
  }

  const applyWorkbenchBulk = async (companyValue: string | null) => {
    const ids = [...wbSelected]
    if (ids.length === 0) return
    setWbBusy(true)
    try {
      const n = await bulkAssignCompany(ids.map((productId) => ({ productId, manufacturer: companyValue })))
      setWbSelected(new Set())
      await reload()
      toast(
        'ok',
        companyValue
          ? `Assigned ${n} product${n === 1 ? '' : 's'} to ${companyValue}`
          : `Cleared company on ${n} product${n === 1 ? '' : 's'}`,
      )
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setWbBusy(false)
    }
  }

  const applySingleSuggestion = async (productId: string, manufacturer: string | null) => {
    setWbBusy(true)
    try {
      await bulkAssignCompany([{ productId, manufacturer }])
      await reload()
      toast('ok', manufacturer ? `Assigned to ${manufacturer}` : 'Cleared placeholder')
    } catch (e) {
      toast('err', (e as Error).message)
    } finally {
      setWbBusy(false)
    }
  }

  const exportCompanySummary = (format: 'csv' | 'xlsx') => {
    const rows = [
      ...companyEntries.filter((c) => c.productCount > 0 || c.top50Rank != null),
      ...(uncategorizedSummary && uncategorizedSummary.productCount > 0 ? [uncategorizedSummary] : []),
    ].map((c) => ({
      top50_rank: c.top50Rank ?? '',
      company: c.name,
      products_listed: c.productCount,
      supplier_offers: c.offerCount,
      multi_shop_products: c.multiShopCount,
      valid_rs_rate_items: c.rsPriceCount,
      discount_only_items: c.discountOnlyCount,
      tp_items: c.tpCount,
      best_discount_pct: c.bestDiscountPct != null ? `${c.bestDiscountPct}%` : '',
      min_rs_price: c.minPriceRs != null ? Math.round(c.minPriceRs * 100) / 100 : '',
      max_rs_price: c.maxPriceRs != null ? Math.round(c.maxPriceRs * 100) / 100 : '',
      suppliers: c.shops.map((s) => `${s.shopName} (${s.count})`).join(', '),
      dosage_forms: c.forms.map((f) => `${f.form} (${f.count})`).join(', '),
    }))

    const cols = [
      { key: 'top50_rank', header: 'Top 50 Rank' },
      { key: 'company', header: 'Company' },
      { key: 'products_listed', header: 'Products Listed' },
      { key: 'supplier_offers', header: 'Supplier Offers' },
      { key: 'multi_shop_products', header: '2+ Shops' },
      { key: 'valid_rs_rate_items', header: 'Rs Rate Items' },
      { key: 'discount_only_items', header: 'Discount Offers' },
      { key: 'tp_items', header: 'TP Items' },
      { key: 'best_discount_pct', header: 'Max Discount %' },
      { key: 'min_rs_price', header: 'Lowest Rs' },
      { key: 'max_rs_price', header: 'Highest Rs' },
      { key: 'suppliers', header: 'Suppliers Carrying' },
      { key: 'dosage_forms', header: 'Dosage Forms' },
    ]
    const matrix = toMatrix(rows, cols)
    const stamp = new Date().toISOString().slice(0, 10)
    if (format === 'csv') {
      download(`hafsa-medicose-companies-${stamp}.csv`, toCsv(matrix), 'text/csv;charset=utf-8')
    } else {
      download(
        `hafsa-medicose-companies-${stamp}.xlsx`,
        toXlsxBuffer(matrix, { sheet: 'Companies', info: [['Exported', new Date().toLocaleString()], ['Companies', rows.length]] }),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    }
  }

  const effectiveTarget = customTarget.trim()
    ? resolveCanonicalCompany(customTarget.trim()) ?? customTarget.trim()
    : targetCompany

  const companyDropdownList = useMemo(() => {
    const names = new Set<string>(PHARMA_COMPANIES.map((c) => c.name))
    for (const c of companyEntries) if (!c.isUncategorized) names.add(c.name)
    return [...names]
  }, [companyEntries])

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Pharmaceutical companies"
        subtitle="Categorize all medicines by company, track Top 50 Pakistan Pharma coverage, and inspect listed items, offers & discounts."
      >
        {suggestions.length > 0 && (
          <Button small onClick={() => setShowAutoModal(true)}>
            <IconSparkles size={15} />
            <span>Auto-categorize ({suggestions.length})</span>
          </Button>
        )}
        <Button variant="secondary" small onClick={() => exportCompanySummary('xlsx')}>
          <IconDownload size={15} className="text-[var(--color-primary)]" />
          <span>Export Excel</span>
        </Button>
        <Button
          variant="secondary"
          small
          onClick={() => {
            if (wbSelected.size > 0) setAddingCustomOpen(true)
            else {
              setTab('categorize')
              setCatScope(kpis.uncat > 0 ? 'uncategorized' : 'all')
            }
          }}
        >
          <IconPlus size={15} className="text-[var(--color-primary)]" />
          <span>{wbSelected.size > 0 ? `Assign selected (${wbSelected.size})` : 'Assign products'}</span>
        </Button>
      </PageHeader>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Total catalog products" value={kpis.total.toLocaleString()} icon={<IconBuilding size={16} />} />
        <Stat
          label={`Categorized (${kpis.pct}%)`}
          value={kpis.categorized.toLocaleString()}
          tone={kpis.categorized > 0 ? 'green' : undefined}
          icon={<IconCheck size={16} />}
        />
        <div onClick={() => { setTab('categorize'); setCatScope('uncategorized') }} className="cursor-pointer">
          <Stat
            label="Uncategorized (tap to tag)"
            value={kpis.uncat.toLocaleString()}
            tone={kpis.uncat > 0 ? 'amber' : 'green'}
          />
        </div>
        <Stat
          label="Top 50 covered"
          value={`${kpis.top50Listed} / ${kpis.top50Total}${kpis.otherListed > 0 ? ` (+${kpis.otherListed})` : ''}`}
          tone="blue"
        />
      </div>

      {/* Auto-detect notice banner when items can be saved to DB */}
      {suggestions.length > 0 && (
        <Card className="!p-3.5 border-[var(--color-primary-border)] bg-[var(--color-primary-light)]/50">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <IconSparkles size={16} className="shrink-0 text-[var(--color-primary)]" />
                <span>
                  Smart detection found <b className="font-semibold text-[var(--color-primary)]">{suggestions.length}</b> products ready to categorize or standardize
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Includes supplier Company columns, title tags like (CCL)/(AGP)/(ABBOTT), shorthand standardization (GETZ → Getz Pharma), and catalog brand families.
              </p>
            </div>
            <Button small className="shrink-0" onClick={() => setShowAutoModal(true)}>
              <span>Review &amp; apply ({suggestions.length})</span>
            </Button>
          </div>
        </Card>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Company view mode">
          {(
            [
              ['all', `All companies (${companyEntries.length})`],
              ['top50', `Top 50 Pakistan (${kpis.top50Total})`],
              ['categorize', `Categorize products (${kpis.uncat} pending)`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx(
                'inline-flex min-h-9 items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-[13px]',
                tab === k
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-text)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab !== 'categorize' && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" small onClick={() => exportCompanySummary('csv')}>
              Export CSV
            </Button>
          </div>
        )}
      </div>

      {/* TAB 1 & 2: COMPANY DIRECTORY */}
      {tab !== 'categorize' && (
        <div className="space-y-3">
          {/* Search + Filter + Sort Toolbar */}
          <Card className="!p-3">
            <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
              <div className="relative min-w-0 flex-1">
                <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="search"
                  placeholder="Search company name, alias (GSK, CCL, AGP), supplier, or product…"
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  className="min-h-10 sm:min-h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
                {dirSearch && (
                  <button
                    type="button"
                    onClick={() => setDirSearch('')}
                    aria-label="Clear company search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={dirSort}
                  onChange={(e) => setDirSort(e.target.value as DirSort)}
                  aria-label="Sort companies"
                  className="!min-h-9 !w-auto text-xs sm:text-[13px]"
                >
                  <option value="products">Sort: Most products first</option>
                  <option value="rank">Sort: Top 50 Rank (#1 → #50)</option>
                  <option value="offers">Sort: Most supplier offers</option>
                  <option value="discount">Sort: Highest discount %</option>
                  <option value="name">Sort: Company Name A → Z</option>
                </Select>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-default)]/70 pt-2">
              {(
                [
                  ['all', `All (${tab === 'top50' ? kpis.top50Total : companyEntries.length})`],
                  ['listed', `Listed ≥ 1 product (${companyEntries.filter((c) => (tab !== 'top50' || c.top50Rank != null) && c.productCount > 0).length})`],
                  ['empty', `0 products yet (${companyEntries.filter((c) => (tab !== 'top50' || c.top50Rank != null) && c.productCount === 0).length})`],
                  ['multi', 'Comparable (2+ shops)'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDirFilter(k)}
                  className={cx(
                    'inline-flex min-h-7.5 items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    dirFilter === k
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* Uncategorized Bucket Quick Card */}
          {uncategorizedSummary && uncategorizedSummary.productCount > 0 && !dirSearch && dirFilter !== 'empty' && (
            <Card className="!p-3.5 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)]">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Uncategorized Products</span>
                    <Badge tone="amber">{uncategorizedSummary.productCount.toLocaleString()} items</Badge>
                    {uncategorizedSummary.offerCount > 0 && (
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        · {uncategorizedSummary.offerCount.toLocaleString()} offers · {uncategorizedSummary.shops.length} suppliers
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    Products imported without a Company column or tag (e.g. wholesale sheets with only Item Name &amp; Discount).
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    small
                    onClick={() => {
                      setTab('categorize')
                      setCatScope('uncategorized')
                    }}
                  >
                    <span>Assign companies →</span>
                  </Button>
                  <Link to="/companies/uncategorized">
                    <Button variant="secondary" small>
                      <span>View items ({uncategorizedSummary.productCount})</span>
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          )}

          {/* Company Cards Grid */}
          {filteredCompanies.length === 0 ? (
            <Empty title="No companies match your search">
              <p>Try clearing the search box or switching the filter pill above.</p>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredCompanies.map((c) => (
                <CompanyCard
                  key={c.id}
                  c={c}
                  onAssignToCompany={() => {
                    setTargetCompany(c.name)
                    setTab('categorize')
                    setCatScope('uncategorized')
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: INTERACTIVE BULK CATEGORIZATION WORKBENCH */}
      {tab === 'categorize' && (
        <div className="space-y-3">
          {/* Workbench Filters */}
          <Card className="!p-3 space-y-2.5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="search"
                  placeholder="Search medicine name, strength, code, or supplier title to assign company…"
                  value={catSearch}
                  onChange={(e) => {
                    setCatSearch(e.target.value)
                    setCatPage(0)
                  }}
                  className="min-h-10 sm:min-h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] py-1.5 pr-8 pl-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:border-[var(--color-primary)] focus:bg-[var(--bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                />
                {catSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setCatSearch('')
                      setCatPage(0)
                    }}
                    aria-label="Clear product search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    <IconClose size={14} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={catShop}
                  onChange={(e) => {
                    setCatShop(e.target.value)
                    setCatPage(0)
                  }}
                  aria-label="Filter by supplier"
                  className="!min-h-9 sm:!w-48 text-xs sm:text-[13px]"
                >
                  <option value="">All suppliers ({shops.length})</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-default)]/70 pt-2">
              {(
                [
                  ['uncategorized', `Uncategorized (${kpis.uncat})`],
                  ['suggested', `Auto-suggested (${suggestions.length})`],
                  ['needs_cleanup', 'Legacy / Placeholder cleanup'],
                  ['all', `All products (${activeProducts.length})`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setCatScope(k)
                    setCatPage(0)
                    setWbSelected(new Set())
                  }}
                  className={cx(
                    'inline-flex min-h-7.5 items-center rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
                    catScope === k
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* Sticky Bulk Assign Bar */}
          <Card className="!p-3 border-[var(--color-primary-border)] bg-[var(--bg-surface)]">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--border-default)]"
                    checked={wbPageItems.length > 0 && wbPageItems.every((p) => wbSelected.has(p.id))}
                    onChange={toggleWbSelectPage}
                  />
                  <span>Select page ({wbPageItems.length})</span>
                </label>
                <span className="tabular-nums">
                  · Showing <b className="font-medium text-[var(--text-primary)]">{workbenchProducts.length}</b> matching
                  {wbSelected.size > 0 && ` · ${wbSelected.size} selected`}
                </span>
                {wbSelected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setWbSelected(new Set())}
                    className="text-[var(--color-primary)] hover:underline"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={targetCompany}
                  onChange={(e) => {
                    setTargetCompany(e.target.value)
                    setCustomTarget('')
                  }}
                  aria-label="Target company"
                  className="!min-h-9 sm:!w-64 text-xs sm:text-[13px]"
                >
                  {companyDropdownList.map((name) => {
                    const def = PHARMA_COMPANIES.find((c) => c.name === name)
                    return (
                      <option key={name} value={name}>
                        {def?.top50Rank != null ? `#${def.top50Rank} ${name}` : name}
                      </option>
                    )
                  })}
                </Select>
                <Input
                  placeholder="Or custom company…"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  className="!min-h-9 sm:!w-44 text-xs sm:text-[13px]"
                />
                <Button
                  small
                  disabled={wbSelected.size === 0 || wbBusy || !effectiveTarget}
                  onClick={() => void applyWorkbenchBulk(effectiveTarget)}
                  className="shrink-0"
                >
                  <span>
                    {wbBusy
                      ? 'Saving…'
                      : wbSelected.size > 0
                        ? `Assign ${wbSelected.size} → ${effectiveTarget}`
                        : 'Select items to assign'}
                  </span>
                </Button>
              </div>
            </div>
          </Card>

          {/* Workbench List */}
          {wbPageItems.length === 0 ? (
            <Empty title="No products in this view">
              <p>Try choosing “All products” or adjusting the supplier/search filter above.</p>
            </Empty>
          ) : (
            <div className="overflow-clip rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] divide-y divide-[var(--border-default)]">
              {wbPageItems.map((p) => {
                const recs = recordsByProduct.get(p.id) ?? []
                const liveCompany = resolveProductDisplayCompany(p, recs)
                const sug = suggestionByProductId.get(p.id)
                const checked = wbSelected.has(p.id)
                const shopNames = [...new Set(recs.map((r) => shopMap.get(r.shop_id)?.name).filter(Boolean))]
                return (
                  <div
                    key={p.id}
                    className={cx(
                      'flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4',
                      checked && 'bg-[var(--color-primary-light)]/35',
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWbSelect(p.id)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border-default)]"
                        aria-label={`Select ${p.name}`}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/products/${p.id}`}
                            className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
                          >
                            {p.name}
                          </Link>
                          <span className="text-[11px] text-[var(--text-secondary)] tabular-nums">#{p.product_no}</span>
                          {p.dosage_form && <Badge tone="blue">{p.dosage_form}</Badge>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)]">
                          <span>
                            Company:{' '}
                            <b className="font-medium text-[var(--text-primary)]">
                              {liveCompany ?? (p.manufacturer ? `Raw "${p.manufacturer}"` : 'Uncategorized')}
                            </b>
                          </span>
                          {shopNames.length > 0 && (
                            <span className="truncate">· Shops: {shopNames.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
                      {sug && sug.suggestedManufacturer && (
                        <Button
                          small
                          variant="secondary"
                          disabled={wbBusy}
                          onClick={() => void applySingleSuggestion(p.id, sug.suggestedManufacturer)}
                          title={sug.reasonLabel}
                        >
                          <IconSparkles size={13} className="text-[var(--color-primary)]" />
                          <span>Apply: {sug.suggestedManufacturer}</span>
                        </Button>
                      )}
                      {liveCompany && (
                        <Link to={`/companies/${companySlug(liveCompany)}`}>
                          <Button small variant="ghost">Open</Button>
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <Pagination
            page={safeWbPage}
            pages={wbPages}
            onPage={(nextPage) => {
              setCatPage(nextPage)
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      )}

      {/* Auto-Categorize Preview & Confirmation Modal */}
      <Modal
        open={showAutoModal}
        onClose={() => !autoBusy && setShowAutoModal(false)}
        title="Auto-categorize & standardize companies"
        wide
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Review the detected company assignments below. Nothing changes unless you click Apply. Existing prices and offers remain untouched.
          </p>

          {reasonGroups.length === 0 ? (
            <Empty title="Everything is clean">No pending company standardizations or auto-suggestions right now.</Empty>
          ) : (
            <div className="space-y-2.5">
              {reasonGroups.map((g) => {
                const enabled = enabledReasons.has(g.reason)
                return (
                  <div
                    key={g.reason}
                    className={cx(
                      'rounded-xl border p-3 transition-colors',
                      enabled
                        ? 'border-[var(--color-primary-border)] bg-[var(--bg-surface)]'
                        : 'border-[var(--border-default)] bg-[var(--bg-subtle)] opacity-75',
                    )}
                  >
                    <label className="flex cursor-pointer items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => {
                            setEnabledReasons((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(g.reason)
                              else next.delete(g.reason)
                              return next
                            })
                          }}
                          className="mt-1 h-4 w-4 rounded border-[var(--border-default)]"
                        />
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">{g.title}</div>
                          <div className="text-xs text-[var(--text-secondary)]">{g.hint}</div>
                        </div>
                      </div>
                      <Badge tone="blue">{g.items.length} items</Badge>
                    </label>
                    <div className="mt-2 ml-6.5 space-y-1 border-t border-[var(--border-default)]/60 pt-2 text-xs text-[var(--text-secondary)]">
                      {g.items.slice(0, 4).map((it) => (
                        <div key={it.productId} className="flex items-center justify-between gap-2 truncate">
                          <span className="truncate font-medium text-[var(--text-primary)]">{it.product.name}</span>
                          <span className="shrink-0 text-[var(--color-primary)]">
                            {it.currentManufacturer ? `"${it.currentManufacturer}" → ` : ''}
                            {it.suggestedManufacturer ?? 'Uncategorized'}
                          </span>
                        </div>
                      ))}
                      {g.items.length > 4 && (
                        <div className="text-[11px] text-[var(--text-secondary)]">
                          + {g.items.length - 4} more products…
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3">
            <span className="text-xs text-[var(--text-secondary)] tabular-nums">
              {selectedAutoSuggestions.length} products will be updated
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={autoBusy} onClick={() => setShowAutoModal(false)}>
                Cancel
              </Button>
              <Button disabled={autoBusy || selectedAutoSuggestions.length === 0} onClick={() => void runAutoCategorize()}>
                {autoBusy ? 'Applying…' : `Apply (${selectedAutoSuggestions.length})`}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Bulk assign modal when items are selected */}
      {addingCustomOpen && wbSelected.size > 0 && (
        <AssignCompanyModal
          open
          onClose={() => setAddingCustomOpen(false)}
          productIds={[...wbSelected]}
          onAssigned={() => setWbSelected(new Set())}
        />
      )}
    </div>
  )
}

function CompanyCard({ c, onAssignToCompany }: { c: CompanySummary; onAssignToCompany: () => void }) {
  const detailPath = `/companies/${encodeURIComponent(c.id)}`
  const hasProducts = c.productCount > 0

  return (
    <Card className="flex flex-col justify-between !p-4 transition-colors hover:border-[var(--border-strong)]">
      <div>
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {c.top50Rank != null && (
                <span className="inline-flex shrink-0 items-center rounded-md bg-[var(--color-primary-light)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-primary)] tabular-nums">
                  #{c.top50Rank}
                </span>
              )}
              <Link
                to={detailPath}
                className="truncate text-[15px] font-semibold text-[var(--text-primary)] hover:text-[var(--color-primary)] hover:underline"
              >
                {c.name}
              </Link>
            </div>
            {c.aliases.length > 0 && (
              <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                Aliases: {c.aliases.slice(0, 4).join(' · ')}
              </div>
            )}
          </div>

          <div className="shrink-0">
            <Badge tone={hasProducts ? 'green' : 'slate'}>
              {c.productCount.toLocaleString()} {c.productCount === 1 ? 'product' : 'products'}
            </Badge>
          </div>
        </div>

        {/* Detailed Breakdown Strip */}
        {hasProducts ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.5 py-2 text-xs">
              <div>
                <div className="text-[10.5px] text-[var(--text-secondary)]">Offers</div>
                <div className="font-semibold text-[var(--text-primary)] tabular-nums">
                  {c.offerCount.toLocaleString()}
                  {c.multiShopCount > 0 && (
                    <span className="ml-1 text-[10.5px] font-normal text-[var(--color-primary)]">({c.multiShopCount} 2+)</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-[var(--text-secondary)]">Top Discount</div>
                <div className="font-semibold text-[var(--color-best)] tabular-nums">
                  {c.bestDiscountPct != null ? `Up to ${c.bestDiscountPct}%` : c.tpCount > 0 ? 'TP (0%)' : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-[var(--text-secondary)]">Rs Range</div>
                <div className="truncate font-semibold text-[var(--text-primary)] tabular-nums">
                  {c.minPriceRs != null
                    ? c.minPriceRs === c.maxPriceRs
                      ? rs(c.minPriceRs, 0)
                      : `${rs(c.minPriceRs, 0)}–${rs(c.maxPriceRs, 0).replace('Rs ', '')}`
                    : `${c.discountOnlyCount + c.tpCount} scheme`}
                </div>
              </div>
            </div>

            {c.shops.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
                <IconStore size={13} className="shrink-0 text-[var(--color-primary)]" />
                <span className="truncate">
                  {c.shops.slice(0, 3).map((s) => `${s.shopName} (${s.count})`).join(' · ')}
                  {c.shops.length > 3 ? ` +${c.shops.length - 3}` : ''}
                </span>
              </div>
            )}

            {c.forms.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {c.forms.slice(0, 4).map((f) => (
                  <span
                    key={f.form}
                    className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-secondary)] capitalize tabular-nums"
                  >
                    {f.form} ({f.count})
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-subtle)]/50 px-3 py-2 text-xs text-[var(--text-secondary)]">
            No products assigned to {c.shortName} yet.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-2.5">
        <Link to={detailPath}>
          <Button variant={hasProducts ? 'secondary' : 'ghost'} small>
            <span>{hasProducts ? `Open details & ${c.productCount} products` : 'Open company page'}</span>
            <IconArrowRight size={13} />
          </Button>
        </Link>
        <Button variant="ghost" small onClick={onAssignToCompany}>
          <IconPlus size={13} />
          <span>Assign items</span>
        </Button>
      </div>
    </Card>
  )
}
