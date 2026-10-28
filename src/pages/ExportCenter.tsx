import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { IconArrowDown, IconArrowUp, IconClose } from '../components/icons'
import { ProductPicker } from '../components/Match'
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useData } from '../lib/data'
import { buildExportRows, DEFAULT_COLUMN_KEYS, download, EXPORT_COLUMNS, GENERIC_PROFILE, sanitizeCell, toCsv, toMatrix, toXlsxBuffer, type Dataset, type ExportProfile } from '../lib/exporter'
import { fetchAll, supabase } from '../lib/supabase'

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'products', label: 'All products (with best offer)' },
  { key: 'selected', label: 'Selected products (with best offer)' },
  { key: 'best', label: 'Best prices only' },
  { key: 'offers', label: 'All offers for selected products (or all products if none selected)' },
  { key: 'shop', label: "Selected shop's price list (latest)" },
  { key: 'latest', label: 'Latest price records (all shops)' },
  { key: 'new', label: 'New or updated prices (recent)' },
  { key: 'grouped', label: 'Products grouped by title' },
  { key: 'review', label: 'Products / records requiring review' },
]

interface SavedProfile extends ExportProfile { id: string }

export default function ExportCenter() {
  const { products, shops, shopMap, current, review, settings, selected, setSelected, productMap } = useData()
  const { email } = useAuth()
  const toast = useToast()
  const [ds, setDs] = useState<Dataset>('best')
  const [shopId, setShopId] = useState('')
  const [since, setSince] = useState(7)
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [profile, setProfile] = useState<ExportProfile>(GENERIC_PROFILE)
  const [profileId, setProfileId] = useState('')
  const [picking, setPicking] = useState(false)
  const [name, setName] = useState('')
  const [erp, setErp] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('export_profiles').select('id,name,is_erp,columns').order('created_at').then((r) => {
      setProfiles(((r.data ?? []) as { id: string; name: string; is_erp: boolean; columns: ExportProfile['columns'] }[]).map((p) => ({ id: p.id, name: p.name, isErp: p.is_erp, columns: p.columns })))
    })
  }, [])

  const rows = useMemo(
    () => buildExportRows(ds, { products, shops: shopMap, current, review, opt: { freshnessDays: settings.freshness_days, excludeStale: false }, selectedIds: selected, shopId, sinceDays: since }),
    [ds, products, shopMap, current, review, settings, selected, shopId, since],
  )
  const cols = profile.columns
  const matrix = useMemo(() => toMatrix(rows, cols), [rows, cols])
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
  const base = `price-intelligence-${ds}-${stamp}`

  const move = (i: number, d: -1 | 1) => {
    const c = [...cols]; const j = i + d
    if (j < 0 || j >= c.length) return
    ;[c[i], c[j]] = [c[j], c[i]]
    setProfile({ ...profile, columns: c })
  }
  const toggle = (key: string) => {
    const has = cols.some((c) => c.key === key)
    const c = has ? cols.filter((x) => x.key !== key) : [...cols, { key, header: EXPORT_COLUMNS.find((x) => x.key === key)!.header }]
    setProfile({ ...profile, columns: c })
  }
  const saveProfile = async () => {
    if (!name.trim()) return toast('err', 'Give the profile a name.')
    const { data, error } = await supabase.from('export_profiles').insert({ name: name.trim(), is_erp: erp, columns: cols }).select('id,name,is_erp,columns').single()
    if (error) return toast('err', error.message)
    setProfiles([...profiles, { id: data.id, name: data.name, isErp: data.is_erp, columns: data.columns }])
    setProfileId(data.id); setProfile({ name: data.name, isErp: data.is_erp, columns: data.columns }); setName(''); toast('ok', 'Export profile saved for both partners')
  }
  const out = (kind: 'csv' | 'xlsx') => {
    if (rows.length === 0) return toast('err', 'Nothing to export for this selection.')
    const info = [['Exported at', new Date().toISOString()], ['Exported by', email ?? ''], ['Dataset', DATASETS.find((d) => d.key === ds)?.label ?? ds], ['Profile', profile.name], ['ERP-verified profile', profile.isErp ? 'yes' : 'no (generic export)'], ['Rows', rows.length]]
    if (kind === 'csv') download(`${base}.csv`, toCsv(matrix), 'text/csv;charset=utf-8')
    else download(`${base}.xlsx`, toXlsxBuffer(matrix, { sheet: 'Export', info }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    toast('ok', `Exported ${rows.length} rows`)
  }
  const backup = async () => {
    setBusy(true)
    try {
      const wb = XLSX.utils.book_new()
      for (const t of ['shops', 'surveys', 'products', 'price_records', 'wishlist_items', 'match_decisions', 'match_rejections', 'import_jobs', 'product_aliases', 'product_identifiers']) {
        const data = await fetchAll<Record<string, unknown>>((a, b) => supabase.from(t).select('*').range(a, b))
        const flat = data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : sanitizeCell(v as string)])))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), t.slice(0, 31))
      }
      download(`price-intelligence-FULL-BACKUP-${stamp}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast('ok', 'Backup downloaded')
    } catch (e) { toast('err', (e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Export center"
        subtitle="Export compared prices, supplier catalogs, or a full workspace backup in CSV or Excel (.xlsx) format."
      />
      <Card className="space-y-3">
        <Field label="What to export"><Select value={ds} onChange={(e) => setDs(e.target.value as Dataset)}>{DATASETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select></Field>
        {ds === 'shop' && <Field label="Shop"><Select value={shopId} onChange={(e) => setShopId(e.target.value)}><option value="">Select a shop…</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        {ds === 'new' && <Field label="Prices added in the last (days)"><Input type="number" min={1} value={since} onChange={(e) => setSince(Math.max(1, Number(e.target.value) || 1))} /></Field>}
        {(ds === 'selected' || ds === 'offers') && (
          <div className="text-sm">
            <b>{selected.size}</b> product{selected.size === 1 ? '' : 's'} selected. Select with the checkboxes in Product master / Compare, or
            <Button variant="ghost" small onClick={() => setPicking(true)}>add products here</Button>
            {selected.size > 0 && <Button variant="ghost" small onClick={() => setSelected(new Set())}>Clear</Button>}
            {selected.size > 0 && <div className="mt-1 flex flex-wrap gap-1">{[...selected].slice(0, 12).map((id) => <Badge key={id}>{productMap.get(id)?.name ?? id}</Badge>)}{selected.size > 12 && <Badge>+{selected.size - 12} more</Badge>}</div>}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">Columns &amp; format</h2>
          {profile.isErp ? <Badge tone="green">Profile marked ERP-compatible by you</Badge> : <Badge tone="amber">Generic export: not verified against your ERP</Badge>}
        </div>
        <Field label="Export profile">
          <Select value={profileId} onChange={(e) => { setProfileId(e.target.value); const p = profiles.find((x) => x.id === e.target.value); setProfile(p ?? GENERIC_PROFILE) }}>
            <option value="">Generic export (default columns)</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isErp ? ' (ERP)' : ''}</option>)}
          </Select>
        </Field>
        <div className="space-y-1">
          {cols.map((c, i) => (
            <div key={c.key} className="flex items-center gap-1.5">
              <Button variant="secondary" small onClick={() => move(i, -1)} aria-label="Move up"><IconArrowUp size={14} /></Button>
              <Button variant="secondary" small onClick={() => move(i, 1)} aria-label="Move down"><IconArrowDown size={14} /></Button>
              <Input className="!min-h-9" value={c.header} onChange={(e) => setProfile({ ...profile, columns: cols.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)) })} aria-label={`Header for ${c.key}`} />
              <span className="hidden w-40 shrink-0 text-xs text-[#5F6368] sm:block">{EXPORT_COLUMNS.find((x) => x.key === c.key)?.label}</span>
              <Button variant="ghost" small onClick={() => toggle(c.key)} aria-label="Remove column"><IconClose size={14} /></Button>
            </div>
          ))}
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-[#1A73E8] hover:text-[#1557B0]">Add columns</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">{EXPORT_COLUMNS.filter((c) => !cols.some((x) => x.key === c.key)).map((c) => <label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={false} onChange={() => toggle(c.key)} />{c.label}</label>)}</div>
        </details>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Save these columns as a profile" className="min-w-48 flex-1"><Input placeholder="e.g. Django ERP product import" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={erp} onChange={(e) => setErp(e.target.checked)} />I confirmed this matches my ERP's import format</label>
          <Button variant="secondary" onClick={saveProfile}>Save profile</Button>
        </div>
        <Button variant="ghost" small onClick={() => setProfile({ ...GENERIC_PROFILE, columns: DEFAULT_COLUMN_KEYS.map((k) => ({ key: k, header: EXPORT_COLUMNS.find((c) => c.key === k)!.header })) })}>Reset to default columns</Button>
      </Card>

      <Card>
        <h2 className="mb-2 font-bold">Preview ({rows.length} rows)</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-100"><tr>{matrix[0]?.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left">{String(h)}</th>)}</tr></thead>
            <tbody>{matrix.slice(1, 11).map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{v === null ? '' : String(v)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="mt-2 text-sm text-slate-600">Nothing matches this selection.</div>}
        <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => out('csv')} disabled={rows.length === 0}>Download CSV (UTF-8)</Button><Button variant="secondary" onClick={() => out('xlsx')} disabled={rows.length === 0}>Download Excel (.xlsx)</Button></div>
        <p className="mt-2 text-xs text-slate-500">Text starting with = + - @ is prefixed with an apostrophe so spreadsheets cannot run it as a formula. CSV has a UTF-8 byte-order mark so Excel shows Urdu / special characters correctly.</p>
      </Card>

      <Card>
        <h2 className="font-bold">Full backup</h2>
        <p className="mb-2 text-sm text-slate-600">Downloads every shop, survey, product, price record, wishlist entry and saved match as one Excel workbook. Do this regularly. Supabase also keeps its own database backups (see docs/SETUP.md).</p>
        <Button variant="secondary" onClick={backup} disabled={busy}>{busy ? 'Preparing backup…' : 'Download full backup (.xlsx)'}</Button>
      </Card>
      {picking && <ProductPicker open onClose={() => setPicking(false)} title="Add to selection" onPick={(p) => { setSelected(new Set([...selected, p.id])); toast('ok', `Added ${p.name}`) }} />}
    </div>
  )
}
