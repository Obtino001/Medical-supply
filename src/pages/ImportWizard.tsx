import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { IconCheck, IconChevronDown, IconChevronRight, IconFileSpreadsheet, IconPlus } from '../components/icons'
import { AttrTable, ProductPicker, productView, type IncomingView } from '../components/Match'
import { ShopForm } from '../components/ShopForm'
import { WishlistToggle } from '../components/WishlistToggle'
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Pagination, Select, Stat, fmtDate, rs, useToast } from '../components/ui'
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

const STEPS = ['Shop', 'Survey & file', 'Preview & map', 'Validate', 'Match products', 'Import']
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
  const [vPage, setVPage] = useState(0)
  const [vFilter, setVFilter] = useState<'problems' | RowKind | 'all'>('problems')
  const [catalog, setCatalog] = useState<{ ids: CatalogIdentifier[]; dec: CatalogDecision[]; rej: CatalogRejection[] } | null>(null)
  const [rejections, setRejections] = useState<CatalogRejection[]>([])
  const [matches, setMatches] = useState<Map<number, RowMatch>>(new Map())
  const [mPage, setMPage] = useState(0)
  const [mFilter, setMFilter] = useState<'attention' | 'all'>('attention')
  const [picker, setPicker] = useState<BuiltRow | null>(null)
  const [busy, setBusy] = useState(false)
  const matchKey = useRef('')
  const [commitErr, setCommitErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number; new_products: number; survey_id: string } | null>(null)

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
    setFileErr(null); setReading(true); setDupJob(null); setAllowDup(false); setCatalog(null); setMatches(new Map())
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

  const built = useMemo(() => (file && step >= 2 ? buildRows(file.grid, mapping, options) : null), [file, mapping, options, step])
  const importable = built?.rows.filter((r) => r.kind === 'valid' || r.kind === 'review') ?? []

  // load catalogue data when entering the matching step
  useEffect(() => {
    if (step !== 4 || catalog) return
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
    if (!built || !index || step !== 4) return
    const key = (file?.hash ?? '') + JSON.stringify([mapping, options, shopId])
    if (matchKey.current === key) return
    matchKey.current = key
    setMatches(runMatching(built.rows, index, shopId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, index, step, shopId])

  const setChoice = (row: BuiltRow, choice: Choice) => setMatches((m) => { const n = new Map(m); const cur = n.get(row.rowNumber); if (cur) n.set(row.rowNumber, { ...cur, choice }); return n })
  const reject = (row: BuiltRow, productId: string) => {
    const rj: CatalogRejection = { shop_id: shopId, source_key: row.incoming.sourceKey, product_id: productId }
    setRejections((r) => [...r, rj])
    // re-run matching for this row with the new rejection
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
    if (step === 0 && !shopId) return 'Select or add a shop first.'
    if (step === 1) { if (!file) return 'Choose a CSV or Excel file.'; if (dupJob && !allowDup) return 'This exact file was already imported for this shop. Tick the box to import it again.' }
    if (step === 2 && (!mapping.title || !mapping.price)) return 'Map at least the Product Name / Item Name and Offer Rate / Price columns.'
    if (step === 3 && importable.length === 0) return 'There are no importable rows. Fix the mapping or the file.'
    return null
  }
  const next = () => { const m = canNext(); if (m) return toast('err', m); setStep(step + 1) }

  const commit = async () => {
    if (!built || !file) return
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

  // ---------------------------------------------------------------- render
  if (result) {
    return (
      <Card className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E6F4EA] text-[#188038]">
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

  const attention = (r: BuiltRow) => { const m = matches.get(r.rowNumber); return !!m && (m.match.confidence === 'needs_review' || m.match.confidence === 'conflicting') }
  const mRows = importable.filter((r) => mFilter === 'all' || attention(r))
  const counts = { exact: 0, high: 0, needs_review: 0, conflicting: 0, unmatched: 0 }
  for (const r of importable) { const m = matches.get(r.rowNumber); if (m) counts[m.match.confidence]++ }
  const vRows = (built?.rows ?? []).filter((r) => (vFilter === 'all' ? true : vFilter === 'problems' ? r.kind !== 'valid' || r.warnings.length > 0 : r.kind === vFilter))
  const mappedOptionalCount = ADDITIONAL_FIELDS.filter((f) => !!mapping[f.key]).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import price list"
        subtitle="Upload a supplier CSV or Excel (.xlsx / .xls) price list, verify columns, and match items into the shared catalog."
      />
      <ol className="flex gap-1.5 overflow-x-auto pb-1 text-xs font-medium">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${
              i === step
                ? 'bg-[#1A73E8] text-white'
                : i < step
                  ? 'bg-[#E8F0FE] text-[#1A73E8] ring-1 ring-inset ring-[#1A73E8]/30'
                  : 'bg-[#F8F9FA] text-[#5F6368] ring-1 ring-inset ring-[#DADCE0]'
            }`}
          >
            {i < step ? <IconCheck className="h-3.5 w-3.5 text-[#1A73E8]" /> : <span>{i + 1}.</span>}
            <span>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card className="space-y-4">
          <Field label="Which shop is this price list from?">
            <Select value={shopId} onChange={(e) => { setShopId(e.target.value); setFile(null) }}>
              <option value="">Select a shop…</option>
              {shops.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}
            </Select>
          </Field>
          <div>
            <Button variant="secondary" onClick={() => setAddingShop(true)}>
              <IconPlus className="h-4 w-4 text-slate-600" />
              Add a new shop
            </Button>
          </div>
          {shop && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-600">
              {preset ? 'A saved column mapping exists for this shop and will be applied automatically.' : 'No saved column mapping for this shop yet — columns will be detected automatically.'}
            </div>
          )}
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-[#5F6368]">
            <span>Selected supplier:</span>
            <Badge tone="blue">{shop?.name}</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Survey date"><Input type="date" value={surveyDate} max={today()} onChange={(e) => setSurveyDate(e.target.value)} /></Field>
            <Field label="Survey notes (optional)"><Input placeholder="e.g. Monthly wholesale rate sheet" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <Field label="Price list file (CSV or Excel .xlsx / .xls)" hint="PDF and photo price lists are not supported yet: ask the shop for Excel/CSV or export to .xlsx first.">
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full min-h-11 rounded-md border border-[#DADCE0] bg-white p-2 text-sm text-[#202124] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[#1A73E8] file:px-3.5 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-[#1557B0]" />
          </Field>
          {reading && <div className="text-sm text-[#5F6368]">Reading file…</div>}
          {fileErr && <ErrorBox>{fileErr}</ErrorBox>}
          {file && (
            <div className="flex items-center gap-2.5 rounded-md border border-[#CEEAD6] bg-[#E6F4EA] px-3.5 py-2.5 text-sm text-[#188038]">
              <IconFileSpreadsheet className="h-4 w-4 shrink-0 text-[#188038]" />
              <span>Loaded <b>{file.filename}</b>{file.sheetName ? ` (sheet "${file.sheetName}")` : ''} · {file.grid.length} rows · {(file.size / 1024).toFixed(0)} KB</span>
            </div>
          )}
          {dupJob && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950">
              <b>This exact file was already imported</b> for this shop ({dupJob.filename}, {fmtDate(dupJob.created_at)}). Importing again creates a second set of price records.
              <label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />Import it again anyway</label>
            </div>
          )}
        </Card>
      )}

      {step === 2 && file && (
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-base font-semibold text-slate-900">File preview</h2>
            <Field label="Header row (the row containing column names)">
              <Select value={options.headerRow} onChange={(e) => { const o = { ...options, headerRow: Number(e.target.value) }; setOptions(o); applyMapping(file, o, preset) }}>
                {file.grid.slice(0, 15).map((r, i) => <option key={i} value={i + 1}>Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}</option>)}
              </Select>
            </Field>
            {sideBySide.status === 'detected' && (
              <div className="mt-3 rounded-md border border-[#1A73E8]/30 bg-[#E8F0FE] p-3.5 text-sm text-[#202124]">
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
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950">
                <div className="font-semibold">Please verify column mapping</div>
                <p className="mt-0.5 text-xs">{sideBySide.reason}</p>
              </div>
            )}
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-600"><tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{file.grid.slice(options.headerRow, options.headerRow + 8).map((r, i) => <tr key={i} className="hover:bg-slate-50/60">{headers.map((_, c) => <td key={c} className="whitespace-nowrap px-3 py-1.5 text-slate-700">{r[c]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-slate-600">
              {detectColumns(headers, file.grid.slice(options.headerRow, options.headerRow + 50)).map((c) => c.numericShare > 0.8 && <Badge key={c.header} tone="blue">{c.header}: numeric</Badge>)}
            </div>
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Map columns</h2>
              <p className="mt-0.5 text-xs text-slate-600">Only <b>Product Name / Item Name</b> and <b>Offer Rate / Price</b> are required. Common headers like <code>ITEM NAME</code> and <code>OFFER RATE</code> are detected automatically.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {REQUIRED_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} (${f.hint})`} hint={mapping[f.key] ? `Sample: ${file.grid[options.headerRow]?.[headers.indexOf(mapping[f.key]!)] ?? ''}` : undefined}>
                  <Select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                    <option value="">— select column —</option>
                    {headers.map((h) => <option key={h}>{h}</option>)}
                  </Select>
                </Field>
              ))}
            </div>

            <div className="border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setShowAdditionalCols(!showAdditionalCols)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 text-left text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100"
              >
                <span>
                  Additional columns <span className="font-normal text-slate-500">(optional: Discount, Scheme / Bonus, Notes, etc.)</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-[#5F6368]">
                  {mappedOptionalCount > 0 && <Badge tone="blue">{mappedOptionalCount} mapped</Badge>}
                  {showAdditionalCols ? <IconChevronDown className="h-4 w-4" /> : <IconChevronRight className="h-4 w-4" />}
                </span>
              </button>

              {showAdditionalCols && (
                <div className="mt-3 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ADDITIONAL_FIELDS.map((f) => (
                      <Field key={f.key} label={`${f.label}${f.hint ? ` (${f.hint})` : ''}`} hint={mapping[f.key] ? `Sample: ${file.grid[options.headerRow]?.[headers.indexOf(mapping[f.key]!)] ?? ''}` : undefined}>
                        <Select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}>
                          <option value="">— not in file —</option>
                          {headers.map((h) => <option key={h}>{h}</option>)}
                        </Select>
                      </Field>
                    ))}
                  </div>
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <h3 className="text-sm font-bold text-slate-800">Discount &amp; scheme options</h3>
                    <Field label="A plain number in the Discount column means" hint="e.g. “2” = 2% or Rs 2. Text such as “2%” or “Rs. 20” is always read as written.">
                      <Select value={options.discountMode} onChange={(e) => setOptions({ ...options, discountMode: e.target.value as ImportOptions['discountMode'] })}><option value="percent">Percent</option><option value="flat">Flat Rs per unit</option></Select>
                    </Field>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={options.priceIsNet} onChange={(e) => setOptions({ ...options, priceIsNet: e.target.checked })} /><span>The Rate column is <b>already net</b> of the discount (do not apply the discount again)</span></label>
                    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={options.combine} onChange={(e) => setOptions({ ...options, combine: e.target.checked })} /><span>This shop's percent discount, flat discount and bonus schemes <b>stack</b> (otherwise offers with several kinds are flagged for review and not ranked)</span></label>
                    <Field label="Prices include tax?"><Select value={options.taxIncluded} onChange={(e) => setOptions({ ...options, taxIncluded: e.target.value as ImportOptions['taxIncluded'] })}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></Select></Field>
                  </div>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 pt-1 text-sm"><input type="checkbox" checked={savePreset} onChange={(e) => setSavePreset(e.target.checked)} />Remember this mapping for {shop?.name}</label>
          </Card>
        </div>
      )}

      {step === 3 && built && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Valid rows" value={built.stats.valid} /><Stat label="Need scheme review" value={built.stats.review} tone={built.stats.review ? 'amber' : undefined} />
            <Stat label="Invalid rows" value={built.stats.invalid} tone={built.stats.invalid ? 'amber' : undefined} /><Stat label="Duplicate rows" value={built.stats.duplicate} />
            <Stat label="Missing price" value={built.stats.missingPrice} /><Stat label="Missing title" value={built.stats.missingTitle} /><Stat label="Bad numbers" value={built.stats.badNumbers} /><Stat label="Empty rows ignored" value={built.stats.empty} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select className="!w-auto" value={vFilter} onChange={(e) => { setVFilter(e.target.value as typeof vFilter); setVPage(0) }}>
              <option value="problems">Rows with problems</option><option value="all">All rows</option><option value="invalid">Invalid</option><option value="duplicate">Duplicates</option><option value="review">Scheme review</option><option value="valid">Valid</option>
            </Select>
            <Button variant="secondary" onClick={() => download(`import-errors-${file?.filename ?? 'file'}.csv`, toCsv(toMatrix(errorReportRows(built.rows) as never, Object.keys(errorReportRows(built.rows)[0] ?? { 'Source row': 1 }).map((k) => ({ key: k, header: k })))), 'text/csv;charset=utf-8')} disabled={!errorReportRows(built.rows).length}>Download error report</Button>
          </div>
          <div className="space-y-2">
            {vRows.slice(vPage * 20, vPage * 20 + 20).map((r) => (
              <Card key={r.rowNumber} className="!p-3">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">Row {r.rowNumber}</span><b>{r.title || '(no title)'}</b>
                  <Badge tone={r.kind === 'valid' ? 'green' : r.kind === 'invalid' ? 'red' : 'amber'}>{r.kind}</Badge></div>
                <div className="text-sm text-slate-600">Rate {rs(r.price)} {r.schemeText ? `· ${r.schemeText}` : ''} → effective {r.cost.effective != null && r.cost.status !== 'invalid' ? rs(r.cost.effective) : '—'}</div>
                {[...r.errors, ...r.warnings].map((m, i) => <div key={i} className={`text-sm ${r.errors.includes(m) ? 'text-red-700' : 'text-amber-800'}`}>• {m}</div>)}
              </Card>
            ))}
            {vRows.length === 0 && <Card>No rows in this view.</Card>}
          </div>
          <Pagination page={vPage} pages={Math.ceil(vRows.length / 20)} onPage={setVPage} />
          <p className="text-sm text-slate-600">Invalid and duplicate rows will be skipped (and kept in the import record). Rows needing scheme review are imported but never ranked as best price until corrected.</p>
        </div>
      )}

      {step === 4 && (
        !index || matches.size === 0 ? <div className="p-8 text-center text-slate-600">Matching products…</div> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Exact" value={counts.exact} /><Stat label="High confidence" value={counts.high} /><Stat label="Needs review" value={counts.needs_review} tone={counts.needs_review ? 'amber' : undefined} />
              <Stat label="Conflicting" value={counts.conflicting} tone={counts.conflicting ? 'amber' : undefined} /><Stat label="New products" value={counts.unmatched} />
            </div>
            <p className="text-sm text-slate-600">Products are matched by normalized product name while keeping different strengths, formulations or quantities separate. Uncertain rows are never merged silently: confirm, pick another product, create a new one, or decide later in <b>Match review</b>.</p>
            <Select className="!w-auto" value={mFilter} onChange={(e) => { setMFilter(e.target.value as typeof mFilter); setMPage(0) }}><option value="attention">Needs my attention</option><option value="all">All importable rows</option></Select>
            {mRows.length === 0 && <Card>Nothing needs your attention. Everything is either matched or will become a new product.</Card>}
            {mRows.slice(mPage * 15, mPage * 15 + 15).map((r) => {
              const m = matches.get(r.rowNumber)!
              const sugg = m.match.productId ?? m.match.candidates[0]?.productId ?? null
              const sel = m.choice.action === 'use' ? m.choice.productId : sugg
              const existing: Product | undefined = sel ? productMap.get(sel) : undefined
              return (
                <Card key={r.rowNumber} className={m.match.confidence === 'conflicting' ? 'border-red-300' : ''}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[#5F6368]">Row {r.rowNumber}</span><b className="font-medium text-[#202124]">{r.title}</b><Badge tone={m.match.confidence === 'exact' || m.match.confidence === 'high' ? 'blue' : m.match.confidence === 'conflicting' ? 'red' : m.match.confidence === 'needs_review' ? 'amber' : 'slate'}>
                      {{ exact: 'Exact match', high: 'High confidence', needs_review: 'Needs review', conflicting: 'Conflicting attributes', unmatched: 'Unmatched → new product' }[m.match.confidence]}</Badge>
                  </div>
                  <div className="text-sm text-slate-600">{m.match.reason} · Rate {rs(r.price)}</div>
                  <div className="my-2"><AttrTable imported={incomingView(r)} existing={existing ? productView(existing) : null} /></div>
                  {m.match.candidates.length > 1 && (
                    <Field label="Other possible products"><Select value={sel ?? ''} onChange={(e) => e.target.value && setChoice(r, { action: 'use', productId: e.target.value })}>
                      {m.match.candidates.map((c) => { const p = productMap.get(c.productId); const vl = variantLabel(p ?? {}); return <option key={c.productId} value={c.productId}>{p?.name}{vl ? ` (${vl})` : ''} — {c.reason}</option> })}
                    </Select></Field>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button small variant={m.choice.action === 'use' ? 'primary' : 'secondary'} disabled={!sel} onClick={() => sel && setChoice(r, { action: 'use', productId: sel })}>Confirm match</Button>
                    <Button small variant="secondary" onClick={() => setPicker(r)}>Select another product</Button>
                    <Button small variant={m.choice.action === 'new' ? 'primary' : 'secondary'} onClick={() => setChoice(r, { action: 'new' })}>Create new product</Button>
                    <Button small variant={m.choice.action === 'later' ? 'primary' : 'secondary'} onClick={() => setChoice(r, { action: 'later' })}>Mark unmatched (decide later)</Button>
                    <Button small variant={m.choice.action === 'skip' ? 'danger' : 'secondary'} onClick={() => setChoice(r, { action: 'skip' })}>Skip row</Button>
                    {existing && <Button small variant="ghost" onClick={() => reject(r, existing.id)}>Reject suggested match</Button>}
                    {existing && <WishlistToggle productId={existing.id} />}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Current choice: <b>{{ use: 'use existing product', new: 'create new product', later: 'import unresolved (not ranked)', skip: 'skip this row' }[m.choice.action]}</b></div>
                </Card>
              )
            })}
            <Pagination page={mPage} pages={Math.ceil(mRows.length / 15)} onPage={setMPage} />
          </div>
        )
      )}

      {step === 5 && built && (
        <Card className="space-y-3">
          <h2 className="font-bold">Ready to import</h2>
          {(() => { const p = buildCommitPayload(built.rows, matches, products); return (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Price records to save" value={p.summary.imported} /><Stat label="New products" value={p.summary.newProducts} /><Stat label="Unresolved matches" value={p.summary.needsReview} tone={p.summary.needsReview ? 'amber' : undefined} /><Stat label="Rows skipped" value={p.summary.skipped} /><Stat label="Rows with errors" value={p.summary.errors} />
            </div>) })()}
          <div className="text-sm text-slate-600">Shop <b>{shop?.name}</b> · survey date <b>{fmtDate(surveyDate)}</b> · file <b>{file?.filename}</b>. Saved in one transaction: if anything fails, nothing is saved.</div>
          {commitErr && <ErrorBox>Import failed and nothing was saved: {commitErr}</ErrorBox>}
          <Button onClick={commit} disabled={busy} className="w-full sm:w-auto">{busy ? 'Importing…' : 'Import now'}</Button>
        </Card>
      )}

      <div className="safe-bottom fixed inset-x-0 bottom-14 z-30 flex justify-between gap-2 border-t border-slate-200 bg-white p-2 md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
        <Button variant="secondary" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>← Back</Button>
        {step < 5 && <Button onClick={next}>Next →</Button>}
      </div>
      {addingShop && <ShopForm open onClose={() => setAddingShop(false)} onSaved={async (s) => { await reload(); if (s) setShopId(s.id) }} />}
      {picker && <ProductPicker open onClose={() => setPicker(null)} initialQuery={picker.incoming.normalizedName} onPick={(p) => { setChoice(picker, { action: 'use', productId: p.id }); setPicker(null) }} />}
      <span className="hidden">{settings.freshness_days}</span>
    </div>
  )
}
