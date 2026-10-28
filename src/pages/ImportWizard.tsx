import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconFileSpreadsheet,
  IconPlus,
  IconStore,
  IconUpload,
} from '../components/icons'
import { AttrTable, ProductPicker, productView, type IncomingView } from '../components/Match'
import { ShopForm } from '../components/ShopForm'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Pagination, Select, Spinner, Stat, cx, fmtDate, rs, useToast } from '../components/ui'
import { ADDITIONAL_FIELDS, DEFAULT_OPTIONS, REQUIRED_FIELDS, suggestMapping, type ImportOptions, type Mapping } from '../lib/columns'
import { useData } from '../lib/data'
import { download, toCsv, toMatrix } from '../lib/exporter'
import { buildRows, detectColumns, detectHeaderRow, detectSideBySide, errorReportRows, getHeaders, type BuiltRow, type RowKind } from '../lib/importBuild'
import { buildCommitPayload, defaultChoice, runMatching, type Choice, type RowMatch } from '../lib/importPlan'
import { buildIndex, matchProduct, type CatalogDecision, type CatalogIdentifier, type CatalogRejection } from '../lib/matching'
import { FileError, readFile, type ParsedGrid } from '../lib/parseFile'
import { variantLabel } from '../lib/productParse'
import { fetchAll, supabase } from '../lib/supabase'
import type { Product } from '../lib/types'

const STEPS = ['Shop', 'Survey & file', 'Preview & map', 'Validate & confirm']
const today = () => new Date().toISOString().slice(0, 10)

export default function ImportWizard() {
  const { shops, products, productMap, reload, settings, policy } = useData()
  const [params] = useSearchParams()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [shopId, setShopId] = useState(params.get('shop') ?? '')
  const [addingShop, setAddingShop] = useState(false)
  const [surveyDate, setSurveyDate] = useState(today())
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<ParsedGrid | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [dupJob, setDupJob] = useState<{ created_at: string; filename: string } | null>(null)
  const [allowDup, setAllowDup] = useState(false)
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS)
  const [mapping, setMapping] = useState<Mapping>({})
  const [showAdditionalCols, setShowAdditionalCols] = useState(false)
  const [savePreset, setSavePreset] = useState(true)
  const [preset, setPreset] = useState<{ mapping: Mapping; options: ImportOptions } | null>(null)
  const [reviewTab, setReviewTab] = useState<'matching' | 'validation'>('matching')
  const [vPage, setVPage] = useState(0)
  const [vFilter, setVFilter] = useState<'problems' | RowKind | 'all'>('problems')
  const [catalog, setCatalog] = useState<{ ids: CatalogIdentifier[]; dec: CatalogDecision[]; rej: CatalogRejection[] } | null>(null)
  const [rejections, setRejections] = useState<CatalogRejection[]>([])
  const [matches, setMatches] = useState<Map<number, RowMatch>>(new Map())
  const [mPage, setMPage] = useState(0)
  const [mFilter, setMFilter] = useState<'attention' | 'all'>('attention')
  const [picker, setPicker] = useState<BuiltRow | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const matchKey = useRef('')
  const [commitErr, setCommitErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; new_products: number; survey_id: string } | null>(null)

  const activeShops = useMemo(() => shops.filter((s) => s.status === 'active'), [shops])
  const shop = shops.find((s) => s.id === shopId)

  // preset for the selected shop
  useEffect(() => {
    setPreset(null)
    if (!shopId) return
    supabase.from('import_mapping_presets').select('mapping,options').eq('shop_id', shopId).maybeSingle().then((r) => {
      if (r.data) setPreset({ mapping: r.data.mapping as Mapping, options: { ...DEFAULT_OPTIONS, ...(r.data.options as Partial<ImportOptions>) } })
    })
  }, [shopId])

  const headers = useMemo(() => (file ? getHeaders(file.grid, options.headerRow) : []), [file, options.headerRow])
  const sideBySide = useMemo(() => (file ? detectSideBySide(file.grid, options.headerRow) : { status: 'none' as const, groups: [] }), [file, options.headerRow])

  const applyMapping = (g: ParsedGrid, opt: ImportOptions, p: typeof preset) => {
    const hs = getHeaders(g.grid, opt.headerRow)
    const sug = suggestMapping(hs)
    if (p) {
      const kept: Mapping = {}
      for (const [k, h] of Object.entries(p.mapping)) if (h && hs.includes(h)) kept[k as keyof Mapping] = h
      setMapping({ ...sug, ...kept })
    } else setMapping(sug)
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setFileErr(null); setReading(true); setDupJob(null); setAllowDup(false); setCatalog(null); setMatches(new Map()); matchKey.current = ''
    try {
      const g = await readFile(f)
      if (g.grid.filter((r) => r.some(Boolean)).length < 2) throw new FileError('The file has no data rows.')
      const hr = detectHeaderRow(g.grid)
      const opt = { ...(preset?.options ?? DEFAULT_OPTIONS), headerRow: hr }
      setOptions(opt)
      setFile(g)
      applyMapping(g, opt, preset)
      const { data } = await supabase.from('import_jobs').select('created_at,filename').eq('shop_id', shopId).eq('file_hash', g.hash).limit(1)
      if (data && data.length) setDupJob(data[0])
    } catch (e) {
      setFile(null)
      setFileErr(e instanceof FileError ? e.message : `Could not read the file: ${(e as Error).message}`)
    } finally { setReading(false) }
  }

  const clearFile = () => {
    setFile(null)
    setFileErr(null)
    setDupJob(null)
    setAllowDup(false)
    setMatches(new Map())
    matchKey.current = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const built = useMemo(() => (file && step >= 2 ? buildRows(file.grid, mapping, options) : null), [file, mapping, options, step])
  const importable = built?.rows.filter((r) => r.kind === 'valid' || r.kind === 'review') ?? []

  // load catalogue data when entering step 3 (Validate & confirm)
  useEffect(() => {
    if (step !== 3 || catalog) return
    ;(async () => {
      try {
        const [ids, dec, rej] = await Promise.all([
          fetchAll<CatalogIdentifier>((a, b) => supabase.from('product_identifiers').select('product_id,kind,value,shop_id').range(a, b)),
          fetchAll<CatalogDecision>((a, b) => supabase.from('match_decisions').select('shop_id,source_key,product_id').range(a, b)),
          fetchAll<CatalogRejection>((a, b) => supabase.from('match_rejections').select('shop_id,source_key,product_id').range(a, b)),
        ])
        setCatalog({ ids, dec, rej })
      } catch (e) { toast('err', (e as Error).message) }
    })()
  }, [step, catalog, toast])

  const index = useMemo(
    () => (catalog ? buildIndex(products.filter((p) => !p.archived), catalog.ids, catalog.dec, [...catalog.rej, ...rejections], policy) : null),
    [catalog, products, rejections, policy],
  )
  useEffect(() => {
    if (!built || !index || step !== 3) return
    const key = (file?.hash ?? '') + JSON.stringify([mapping, options, shopId])
    if (matchKey.current === key) return
    matchKey.current = key
    setMatches(runMatching(built.rows, index, shopId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, index, step, shopId])

  const setChoice = (row: BuiltRow, choice: Choice) =>
    setMatches((m) => {
      const n = new Map(m)
      const cur = n.get(row.rowNumber)
      if (cur) n.set(row.rowNumber, { ...cur, choice })
      return n
    })

  const reject = (row: BuiltRow, productId: string) => {
    const rj: CatalogRejection = { shop_id: shopId, source_key: row.incoming.sourceKey, product_id: productId }
    setRejections((r) => [...r, rj])
    const idx = buildIndex(products.filter((p) => !p.archived), catalog!.ids, catalog!.dec, [...catalog!.rej, ...rejections, rj], policy)
    const match = matchProduct(idx, shopId, row.incoming)
    setMatches((m) => new Map(m).set(row.rowNumber, { match, choice: defaultChoice(row, match) }))
    toast('ok', 'Rejected. This pairing will not be suggested again.')
  }

  const incomingView = (r: BuiltRow): IncomingView => ({
    title: r.title, code: r.code, brand: r.incoming.brand, manufacturer: r.incoming.manufacturer,
    strength: r.incoming.strengthValue != null ? `${r.incoming.strengthValue}${r.incoming.strengthUnit ?? ''}` : null,
    weight: r.incoming.weightValue != null ? `${r.incoming.weightValue}${r.incoming.weightUnit ?? ''}` : null,
    pack: r.incoming.packSize, barcode: r.incoming.barcode, mfrCode: r.incoming.mfrCode, form: r.incoming.dosageForm,
  })

  const canNext = (): string | null => {
    if (step === 0 && !shopId) return 'Select or add a shop to continue.'
    if (step === 1) {
      if (reading) return 'Reading file…'
      if (!file) return 'Choose a CSV or Excel price list file to continue.'
      if (dupJob && !allowDup) return 'Tick the box to allow re-importing this file.'
    }
    if (step === 2) {
      if (!mapping.title || !mapping.price) return 'Map both Product Name / Item Name and Offer Rate / Price.'
      if (importable.length === 0) return 'No valid product rows found with this column mapping.'
    }
    return null
  }

  const nextReason = canNext()
  const next = () => {
    const m = canNext()
    if (m) return toast('err', m)
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
    window.scrollTo({ top: 0 })
  }

  const commit = async () => {
    if (!built || !file || busy) return
    setBusy(true); setCommitErr(null)
    try {
      const payload = buildCommitPayload(built.rows, matches, products)
      const { data, error } = await supabase.rpc('commit_import', {
        p_job: { shop_id: shopId, survey_date: surveyDate, survey_notes: notes.trim() || null, filename: file.filename, file_hash: file.hash, file_size: file.size, mapping, options },
        p_rows: payload.rows, p_new_products: payload.newProducts, p_decisions: [],
      })
      if (error) throw new Error(error.message)
      const res = data as { imported: number; skipped: number; errors: number; new_products: number; survey_id: string }
      if (savePreset) await supabase.from('import_mapping_presets').upsert({ shop_id: shopId, mapping, options }, { onConflict: 'shop_id' })
      if (rejections.length) await supabase.from('match_rejections').upsert(rejections, { onConflict: 'workspace_id,shop_id,source_key,product_id', ignoreDuplicates: true })
      setResult(res)
      await reload()
      toast('ok', `Imported ${res.imported} price records`)
    } catch (e) { setCommitErr((e as Error).message) } finally { setBusy(false) }
  }

  if (result) {
    return (
      <Card className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F4EA] text-[#188038]">
            <IconCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-medium text-[#202124]">Import complete</h1>
            <p className="text-sm text-[#5F6368]">Saved to the shared database. Your partner sees it after refreshing.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Price records imported" value={result.imported} tone="green" />
          <Stat label="New products created" value={result.new_products} />
          <Stat label="Rows skipped" value={result.skipped} />
          <Stat label="Rows with errors" value={result.errors} tone={result.errors ? 'amber' : undefined} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/compare"><Button>Compare prices</Button></Link>
          <Link to="/review"><Button variant="secondary">Review matches</Button></Link>
          <Button variant="secondary" onClick={() => location.assign('/import')}>Import another</Button>
        </div>
      </Card>
    )
  }

  const attention = (r: BuiltRow) => {
    const m = matches.get(r.rowNumber)
    return !!m && (m.match.confidence === 'needs_review' || m.match.confidence === 'conflicting')
  }
  const mRows = importable.filter((r) => mFilter === 'all' || attention(r))
  const counts = { exact: 0, high: 0, needs_review: 0, conflicting: 0, unmatched: 0 }
  for (const r of importable) {
    const m = matches.get(r.rowNumber)
    if (m) counts[m.match.confidence]++
  }
  const vRows = (built?.rows ?? []).filter((r) =>
    vFilter === 'all' ? true : vFilter === 'problems' ? r.kind !== 'valid' || r.warnings.length > 0 : r.kind === vFilter,
  )
  const mappedOptionalCount = ADDITIONAL_FIELDS.filter((f) => !!mapping[f.key]).length
  const mappedRequiredCount = REQUIRED_FIELDS.filter((f) => !!mapping[f.key]).length
  const totalMappedCols = new Set(Object.values(mapping).filter(Boolean)).size
  const unmappedCols = Math.max(0, headers.length - totalMappedCols)
  const commitSummary = built && matches.size > 0 ? buildCommitPayload(built.rows, matches, products).summary : null

  return (
    <div className="space-y-4 pb-16 md:pb-4">
      <PageHeader
        title="Import price list"
        subtitle="Upload a supplier CSV or Excel price list, verify columns, and save rates to the shared catalog."
      />

      {/* 4-Step Progress Indicator */}
      <ol aria-label="Import steps" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const isCurrent = i === step
          const isDone = i < step
          return (
            <li
              key={s}
              className={cx(
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
                isCurrent
                  ? 'border-[#1A73E8] bg-[#1A73E8] text-white'
                  : isDone
                    ? 'border-[#1A73E8]/30 bg-[#E8F0FE] text-[#1A73E8]'
                    : 'border-[#E1E5EA] bg-white text-[#5F6368]',
              )}
            >
              <span
                className={cx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                  isCurrent
                    ? 'bg-white/20 text-white'
                    : isDone
                      ? 'bg-[#1A73E8] text-white'
                      : 'bg-[#F8FAFC] text-[#5F6368] border border-[#E1E5EA]',
                )}
              >
                {isDone ? <IconCheck size={12} /> : i + 1}
              </span>
              <span className="truncate">{s}</span>
            </li>
          )
        })}
      </ol>

      {/* STEP 1: SHOP SELECTION */}
      {step === 0 && (
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE] text-[#1A73E8]">
              <IconStore size={20} />
            </div>
            <div>
              <h2 className="text-base font-medium text-[#202124]">Which shop is this price list from?</h2>
              <p className="text-xs text-[#5F6368]">Select an existing wholesale supplier or add a new shop.</p>
            </div>
          </div>

          {activeShops.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#E1E5EA] bg-[#F8FAFC] p-4 text-sm text-[#5F6368]">
              <div className="font-medium text-[#202124]">No shops added yet</div>
              <p className="mt-0.5 text-xs">Add your first wholesale supplier to import its price list.</p>
            </div>
          ) : (
            <Field label="Supplier / shop" required>
              <Select
                value={shopId}
                onChange={(e) => {
                  setShopId(e.target.value)
                  clearFile()
                }}
              >
                <option value="">Select a shop…</option>
                {activeShops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.city ? ` — ${s.city}` : ''}{s.market_area ? ` (${s.market_area})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E1E5EA] pt-3">
            <span className="text-xs text-[#5F6368]">Supplier not in the list?</span>
            <Button variant="secondary" onClick={() => setAddingShop(true)}>
              <IconPlus size={16} className="text-[#1A73E8]" />
              <span>Add a new shop</span>
            </Button>
          </div>

          {shop && (
            <div className="rounded-xl border border-[#E1E5EA] bg-[#F8FAFC] px-3.5 py-2.5 text-xs text-[#5F6368]">
              {preset
                ? 'Saved column mapping found for this shop — it will be applied automatically.'
                : 'No saved mapping for this shop yet — columns will be detected automatically.'}
            </div>
          )}
        </Card>
      )}

      {/* STEP 2: SURVEY & FILE UPLOAD */}
      {step === 1 && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E5EA] pb-3">
            <div className="flex items-center gap-2 text-sm text-[#5F6368]">
              <span>Selected supplier:</span>
              <Badge tone="blue">{shop?.name}</Badge>
            </div>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="text-xs font-medium text-[#1A73E8] hover:text-[#1557B0] hover:underline"
            >
              Change shop
            </button>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Survey date" required>
              <Input type="date" value={surveyDate} max={today()} onChange={(e) => setSurveyDate(e.target.value)} />
            </Field>
            <Field label="Survey notes (optional)">
              <Input placeholder="e.g. Monthly wholesale rate sheet" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-[#202124] sm:text-sm">
              Price list file <span className="font-semibold text-[#D93025]">*</span>
            </span>

            <input
              ref={fileInputRef}
              id="price-list-file-input"
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="sr-only"
            />

            {!file ? (
              <label
                htmlFor="price-list-file-input"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#E1E5EA] bg-[#F8FAFC] px-4 py-7 text-center transition-colors hover:border-[#1A73E8] hover:bg-[#E8F0FE]/30"
              >
                <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#E8F0FE] text-[#1A73E8]">
                  <IconUpload size={22} />
                </div>
                <span className="text-sm font-medium text-[#1A73E8]">Choose price list</span>
                <span className="mt-1 text-xs font-medium text-[#202124]">Supported formats: CSV, XLSX and XLS</span>
                <span className="mt-1 max-w-md text-xs text-[#5F6368]">
                  PDF and photo price lists are not supported yet — ask the supplier for Excel/CSV or export to .xlsx first.
                </span>
              </label>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#CEEAD6] bg-[#E6F4EA]/60 p-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#188038] text-white">
                    <IconFileSpreadsheet size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#202124]">{file.filename}</div>
                    <div className="text-xs text-[#5F6368] tabular-nums">
                      {file.sheetName ? `Sheet "${file.sheetName}" · ` : ''}
                      {file.grid.length} rows · {Math.max(1, Math.round(file.size / 1024))} KB
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="price-list-file-input"
                    className="inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-[#E1E5EA] bg-white px-3 py-1.5 text-xs font-medium text-[#202124] hover:bg-[#F8FAFC]"
                  >
                    Replace file
                  </label>
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Remove file"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E1E5EA] bg-white text-[#5F6368] hover:bg-[#FCE8E6] hover:text-[#D93025]"
                  >
                    <IconClose size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {reading && <Spinner label="Reading price list file…" />}
          {fileErr && <ErrorBox>{fileErr}</ErrorBox>}

          {dupJob && (
            <div className="rounded-xl border border-[#FDD663] bg-[#FEF7E0] p-3.5 text-sm text-[#202124]">
              <div className="font-medium text-[#B06000]">This exact file was already imported for this shop</div>
              <p className="mt-0.5 text-xs text-[#5F6368]">
                {dupJob.filename} · imported on {fmtDate(dupJob.created_at)}. Importing again creates a second set of price records.
              </p>
              <label className="mt-2.5 flex items-center gap-2 text-xs font-medium text-[#202124] sm:text-sm">
                <input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />
                Import this file again anyway
              </label>
            </div>
          )}
        </Card>
      )}

      {/* STEP 3: PREVIEW & COLUMN MAPPING */}
      {step === 2 && file && (
        <div className="space-y-4">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-medium text-[#202124]">Map columns</h2>
                <p className="mt-0.5 text-xs text-[#5F6368]">
                  Only <b>Product Name / Item Name</b> and <b>Offer Rate / Price</b> are required.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={mappedRequiredCount === REQUIRED_FIELDS.length ? 'green' : 'amber'}>
                  {mappedRequiredCount}/{REQUIRED_FIELDS.length} required mapped
                </Badge>
                <Badge tone="slate">
                  {totalMappedCols} mapped · {unmappedCols} unmapped
                </Badge>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              {REQUIRED_FIELDS.map((f) => {
                const sampleVal = mapping[f.key] ? file.grid[options.headerRow]?.[headers.indexOf(mapping[f.key]!)] ?? '' : ''
                return (
                  <Field
                    key={f.key}
                    label={f.label}
                    required
                    hint={sampleVal ? `Sample value: "${sampleVal}"` : f.hint}
                  >
                    <Select
                      value={mapping[f.key] ?? ''}
                      onChange={(e) => {
                        setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                        matchKey.current = ''
                      }}
                    >
                      <option value="">— select column —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )
              })}
            </div>

            <div className="border-t border-[#E1E5EA] pt-3">
              <button
                type="button"
                onClick={() => setShowAdditionalCols(!showAdditionalCols)}
                className="flex w-full items-center justify-between rounded-xl border border-[#E1E5EA] bg-[#F8FAFC] px-3.5 py-2.5 text-left text-sm font-medium text-[#202124] transition-colors hover:bg-[#E8F0FE]/40"
              >
                <span>
                  Additional columns <span className="font-normal text-[#5F6368]">(optional: Discount, Scheme / Bonus, Notes)</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[#5F6368]">
                  {mappedOptionalCount > 0 && <Badge tone="blue">{mappedOptionalCount} mapped</Badge>}
                  {showAdditionalCols ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                </span>
              </button>

              {showAdditionalCols && (
                <div className="mt-3 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ADDITIONAL_FIELDS.map((f) => {
                      const sampleVal = mapping[f.key] ? file.grid[options.headerRow]?.[headers.indexOf(mapping[f.key]!)] ?? '' : ''
                      return (
                        <Field
                          key={f.key}
                          label={`${f.label}${f.hint ? ` (${f.hint})` : ''}`}
                          hint={sampleVal ? `Sample: "${sampleVal}"` : undefined}
                        >
                          <Select
                            value={mapping[f.key] ?? ''}
                            onChange={(e) => {
                              setMapping({ ...mapping, [f.key]: e.target.value || undefined })
                              matchKey.current = ''
                            }}
                          >
                            <option value="">— not in file —</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )
                    })}
                  </div>
                  <div className="space-y-3 rounded-xl border border-[#E1E5EA] bg-[#F8FAFC] p-3.5">
                    <h3 className="text-sm font-medium text-[#202124]">Discount &amp; scheme calculation options</h3>
                    <Field
                      label="A plain number in the Discount column means"
                      hint="e.g. “2” = 2% or Rs 2. Text such as “2%” or “Rs. 20” is always read as written."
                    >
                      <Select
                        value={options.discountMode}
                        onChange={(e) => setOptions({ ...options, discountMode: e.target.value as ImportOptions['discountMode'] })}
                      >
                        <option value="percent">Percent (%)</option>
                        <option value="flat">Flat Rs per unit</option>
                      </Select>
                    </Field>
                    <label className="flex items-start gap-2 text-sm text-[#202124]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={options.priceIsNet}
                        onChange={(e) => setOptions({ ...options, priceIsNet: e.target.checked })}
                      />
                      <span>
                        The Rate column is <b>already net</b> of the discount (do not apply the discount again)
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm text-[#202124]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={options.combine}
                        onChange={(e) => setOptions({ ...options, combine: e.target.checked })}
                      />
                      <span>
                        This shop's percent discount, flat discount and bonus schemes <b>stack</b>
                      </span>
                    </label>
                    <Field label="Prices include tax?">
                      <Select
                        value={options.taxIncluded}
                        onChange={(e) => setOptions({ ...options, taxIncluded: e.target.value as ImportOptions['taxIncluded'] })}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 pt-1 text-sm text-[#202124]">
              <input type="checkbox" checked={savePreset} onChange={(e) => setSavePreset(e.target.checked)} />
              Remember this column mapping for {shop?.name}
            </label>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-medium text-[#202124]">File preview</h2>
            <Field label="Header row (the row containing column names)">
              <Select
                value={options.headerRow}
                onChange={(e) => {
                  const o = { ...options, headerRow: Number(e.target.value) }
                  setOptions(o)
                  applyMapping(file, o, preset)
                  matchKey.current = ''
                }}
              >
                {file.grid.slice(0, 15).map((r, i) => (
                  <option key={i} value={i + 1}>
                    Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}
                  </option>
                ))}
              </Select>
            </Field>
            {sideBySide.status === 'detected' && (
              <div className="rounded-xl border border-[#1A73E8]/30 bg-[#E8F0FE] p-3.5 text-sm text-[#202124]">
                <div className="font-medium text-[#1A73E8]">Side-by-side price list detected</div>
                <p className="mt-0.5 text-xs text-[#5F6368]">{sideBySide.reason}</p>
                <label className="mt-2 flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={options.combineSideBySide !== false}
                    onChange={(e) => setOptions({ ...options, combineSideBySide: e.target.checked })}
                  />
                  Combine all side-by-side product/rate pairs into one list ({built?.rows.length ?? 0} total items detected)
                </label>
              </div>
            )}
            {sideBySide.status === 'ambiguous' && (
              <div className="rounded-xl border border-[#FDD663] bg-[#FEF7E0] p-3.5 text-sm text-[#202124]">
                <div className="font-medium text-[#B06000]">Please verify column mapping</div>
                <p className="mt-0.5 text-xs text-[#5F6368]">{sideBySide.reason}</p>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-[#E1E5EA]">
              <table className="min-w-full text-xs">
                <thead className="bg-[#F8FAFC] text-[#5F6368]">
                  <tr>
                    {headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EA]">
                  {file.grid.slice(options.headerRow, options.headerRow + 6).map((r, i) => (
                    <tr key={i} className="hover:bg-[#F8FAFC]">
                      {headers.map((_, c) => (
                        <td key={c} className="whitespace-nowrap px-3 py-1.5 text-[#202124]">
                          {r[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs text-[#5F6368]">
              {detectColumns(headers, file.grid.slice(options.headerRow, options.headerRow + 50)).map(
                (c) => c.numericShare > 0.8 && <Badge key={c.header} tone="blue">{c.header}: numeric</Badge>,
              )}
            </div>
          </Card>
        </div>
      )}

      {/* STEP 4: VALIDATE & CONFIRM */}
      {step === 3 && built && (
        <div className="space-y-4">
          {/* Ready to Import Summary Card */}
          <Card className="space-y-3.5 border-[#1A73E8]/30 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-medium text-[#202124]">Ready to import</h2>
                <p className="text-xs text-[#5F6368]">
                  Shop <b className="font-medium text-[#202124]">{shop?.name}</b> · survey date{' '}
                  <b className="font-medium text-[#202124]">{fmtDate(surveyDate)}</b> · file{' '}
                  <b className="font-medium text-[#202124]">{file?.filename}</b>
                </p>
              </div>
              <Button onClick={() => void commit()} disabled={busy || !index || importable.length === 0}>
                <IconCheck size={16} />
                <span>{busy ? 'Importing…' : `Import ${commitSummary?.imported ?? importable.length} items now`}</span>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Price records to save" value={commitSummary?.imported ?? importable.length} tone="green" />
              <Stat label="New products" value={commitSummary?.newProducts ?? counts.unmatched} />
              <Stat
                label="Needs match review"
                value={commitSummary?.needsReview ?? (counts.needs_review + counts.conflicting)}
                tone={(commitSummary?.needsReview ?? (counts.needs_review + counts.conflicting)) ? 'amber' : undefined}
              />
              <Stat
                label="Invalid / skipped rows"
                value={(commitSummary?.skipped ?? built.stats.duplicate) + (commitSummary?.errors ?? built.stats.invalid)}
                tone={built.stats.invalid ? 'amber' : undefined}
              />
            </div>

            {commitErr && <ErrorBox>Import failed and nothing was saved: {commitErr}</ErrorBox>}
          </Card>

          {/* Segmented Toggle: Product Matching vs Row Validation */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-[#E1E5EA] bg-white p-1">
              <button
                type="button"
                onClick={() => setReviewTab('matching')}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  reviewTab === 'matching' ? 'bg-[#1A73E8] text-white' : 'text-[#5F6368] hover:text-[#202124]',
                )}
              >
                Product matching ({counts.needs_review + counts.conflicting} need review)
              </button>
              <button
                type="button"
                onClick={() => setReviewTab('validation')}
                className={cx(
                  'rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  reviewTab === 'validation' ? 'bg-[#1A73E8] text-white' : 'text-[#5F6368] hover:text-[#202124]',
                )}
              >
                Row validation ({built.stats.invalid} invalid · {built.stats.valid} valid)
              </button>
            </div>
          </div>

          {reviewTab === 'matching' ? (
            !index || (importable.length > 0 && matches.size === 0) ? (
              <Spinner label="Matching products against shared catalog…" />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Select
                    className="!w-auto"
                    value={mFilter}
                    onChange={(e) => {
                      setMFilter(e.target.value as typeof mFilter)
                      setMPage(0)
                    }}
                  >
                    <option value="attention">Needs my attention ({counts.needs_review + counts.conflicting})</option>
                    <option value="all">All importable rows ({importable.length})</option>
                  </Select>
                  <span className="text-xs text-[#5F6368]">
                    {counts.exact} exact · {counts.high} high confidence · {counts.unmatched} new products
                  </span>
                </div>

                {mRows.length === 0 ? (
                  <Card className="text-sm text-[#5F6368]">
                    Nothing needs your attention. All {importable.length} valid rows are matched or ready to be created as new products.
                  </Card>
                ) : (
                  mRows.slice(mPage * 15, mPage * 15 + 15).map((r) => {
                    const m = matches.get(r.rowNumber)
                    if (!m) return null
                    const sugg = m.match.productId ?? m.match.candidates[0]?.productId ?? null
                    const sel = m.choice.action === 'use' ? m.choice.productId : sugg
                    const existing: Product | undefined = sel ? productMap.get(sel) : undefined
                    return (
                      <Card key={r.rowNumber} className={m.match.confidence === 'conflicting' ? 'border-[#FAD2CF]' : ''}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-[#5F6368] tabular-nums">Row {r.rowNumber}</span>
                          <b className="font-medium text-[#202124]">{r.title}</b>
                          <Badge
                            tone={
                              m.match.confidence === 'exact' || m.match.confidence === 'high'
                                ? 'blue'
                                : m.match.confidence === 'conflicting'
                                  ? 'red'
                                  : m.match.confidence === 'needs_review'
                                    ? 'amber'
                                    : 'slate'
                            }
                          >
                            {{
                              exact: 'Exact match',
                              high: 'High confidence',
                              needs_review: 'Needs review',
                              conflicting: 'Conflicting attributes',
                              unmatched: 'Unmatched → new product',
                            }[m.match.confidence]}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-sm text-[#5F6368]">
                          {m.match.reason} ·{' '}
                          {r.price != null ? `Rate ${rs(r.price)}${r.schemeText ? ` (${r.schemeText})` : ''}` : `Offer: ${r.schemeText || '—'}`}
                        </div>
                        <div className="my-2">
                          <AttrTable imported={incomingView(r)} existing={existing ? productView(existing) : null} />
                        </div>
                        {m.match.candidates.length > 1 && (
                          <Field label="Other possible products">
                            <Select value={sel ?? ''} onChange={(e) => e.target.value && setChoice(r, { action: 'use', productId: e.target.value })}>
                              {m.match.candidates.map((c) => {
                                const p = productMap.get(c.productId)
                                const vl = variantLabel(p ?? {})
                                return (
                                  <option key={c.productId} value={c.productId}>
                                    {p?.name}{vl ? ` (${vl})` : ''} — {c.reason}
                                  </option>
                                )
                              })}
                            </Select>
                          </Field>
                        )}
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button small variant={m.choice.action === 'use' ? 'primary' : 'secondary'} disabled={!sel} onClick={() => sel && setChoice(r, { action: 'use', productId: sel })}>
                            Confirm match
                          </Button>
                          <Button small variant="secondary" onClick={() => setPicker(r)}>
                            Select another product
                          </Button>
                          <Button small variant={m.choice.action === 'new' ? 'primary' : 'secondary'} onClick={() => setChoice(r, { action: 'new' })}>
                            Create new product
                          </Button>
                          <Button small variant={m.choice.action === 'later' ? 'primary' : 'secondary'} onClick={() => setChoice(r, { action: 'later' })}>
                            Mark unmatched (decide later)
                          </Button>
                          <Button small variant={m.choice.action === 'skip' ? 'danger' : 'secondary'} onClick={() => setChoice(r, { action: 'skip' })}>
                            Skip row
                          </Button>
                          {existing && (
                            <Button small variant="ghost" onClick={() => reject(r, existing.id)}>
                              Reject suggested match
                            </Button>
                          )}
                          {existing && <WishlistToggle productId={existing.id} />}
                        </div>
                        <div className="mt-1.5 text-xs text-[#5F6368]">
                          Current choice:{' '}
                          <b className="font-medium text-[#202124]">
                            {{
                              use: 'use existing product',
                              new: 'create new product',
                              later: 'import unresolved (not ranked)',
                              skip: 'skip this row',
                            }[m.choice.action]}
                          </b>
                        </div>
                      </Card>
                    )
                  })
                )}
                <Pagination page={mPage} pages={Math.ceil(mRows.length / 15)} onPage={setMPage} />
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Valid rows" value={built.stats.valid} />
                <Stat label="Need scheme review" value={built.stats.review} tone={built.stats.review ? 'amber' : undefined} />
                <Stat label="Invalid rows" value={built.stats.invalid} tone={built.stats.invalid ? 'amber' : undefined} />
                <Stat label="Duplicate rows" value={built.stats.duplicate} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  className="!w-auto"
                  value={vFilter}
                  onChange={(e) => {
                    setVFilter(e.target.value as typeof vFilter)
                    setVPage(0)
                  }}
                >
                  <option value="problems">Rows with problems</option>
                  <option value="all">All rows</option>
                  <option value="invalid">Invalid</option>
                  <option value="duplicate">Duplicates</option>
                  <option value="review">Scheme review</option>
                  <option value="valid">Valid</option>
                </Select>
                <Button
                  variant="secondary"
                  small
                  onClick={() =>
                    download(
                      `import-errors-${file?.filename ?? 'file'}.csv`,
                      toCsv(
                        toMatrix(
                          errorReportRows(built.rows) as never,
                          Object.keys(errorReportRows(built.rows)[0] ?? { 'Source row': 1 }).map((k) => ({ key: k, header: k })),
                        ),
                      ),
                      'text/csv;charset=utf-8',
                    )
                  }
                  disabled={!errorReportRows(built.rows).length}
                >
                  Download error report
                </Button>
              </div>
              <div className="space-y-2">
                {vRows.slice(vPage * 20, vPage * 20 + 20).map((r) => (
                  <Card key={r.rowNumber} className="!p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[#5F6368] tabular-nums">Row {r.rowNumber}</span>
                      <b className="font-medium text-[#202124]">{r.title || '(no title)'}</b>
                      <Badge tone={r.kind === 'valid' ? 'green' : r.kind === 'invalid' ? 'red' : 'amber'}>{r.kind}</Badge>
                    </div>
                    <div className="mt-0.5 text-sm text-[#5F6368]">
                      {r.price != null ? (
                        <>
                          Rate {rs(r.price)} {r.schemeText ? `· ${r.schemeText}` : ''} → effective{' '}
                          {r.cost.effective != null && r.cost.status !== 'invalid' ? rs(r.cost.effective) : '—'}
                        </>
                      ) : r.schemeText ? (
                        <>
                          Offer: <b className="font-medium text-[#202124]">{r.schemeText}</b>
                        </>
                      ) : (
                        <>Rate —</>
                      )}
                    </div>
                    {[...r.errors, ...r.warnings].map((m, i) => (
                      <div key={i} className={`text-sm ${r.errors.includes(m) ? 'text-[#D93025]' : 'text-[#B06000]'}`}>
                        • {m}
                      </div>
                    ))}
                  </Card>
                ))}
                {vRows.length === 0 && <Card className="text-sm text-[#5F6368]">No rows in this view.</Card>}
              </div>
              <Pagination page={vPage} pages={Math.ceil(vRows.length / 20)} onPage={setVPage} />
            </div>
          )}
        </div>
      )}

      {/* Sticky Footer Navigation */}
      <div className="safe-bottom fixed inset-x-0 bottom-14 z-30 flex items-center justify-between gap-3 border-t border-[#E1E5EA] bg-white px-4 py-2.5 md:static md:mt-4 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <Button
          variant="secondary"
          disabled={step === 0 || busy}
          onClick={() => {
            setStep((s) => Math.max(0, s - 1))
            window.scrollTo({ top: 0 })
          }}
        >
          <IconArrowLeft size={16} />
          <span>Back</span>
        </Button>

        <div className="flex min-w-0 items-center gap-2.5">
          {nextReason && step < STEPS.length - 1 && (
            <span className="hidden truncate text-xs text-[#5F6368] sm:inline">{nextReason}</span>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={!!nextReason || busy}>
              <span>Next</span>
              <IconArrowRight size={16} />
            </Button>
          ) : (
            <Button onClick={() => void commit()} disabled={busy || !index || importable.length === 0}>
              <IconCheck size={16} />
              <span>{busy ? 'Importing…' : 'Import now'}</span>
            </Button>
          )}
        </div>
      </div>

      {addingShop && (
        <ShopForm
          open
          onClose={() => setAddingShop(false)}
          onSaved={async (s) => {
            await reload()
            if (s) setShopId(s.id)
          }}
        />
      )}
      {picker && (
        <ProductPicker
          open
          onClose={() => setPicker(null)}
          initialQuery={picker.incoming.normalizedName}
          onPick={(p) => {
            setChoice(picker, { action: 'use', productId: p.id })
            setPicker(null)
          }}
        />
      )}
      <span className="hidden">{settings.freshness_days}</span>
    </div>
  )
}
