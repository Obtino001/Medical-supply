// Checks a CSV downloaded from cleanup_02b_export_json.sql for truncation or corruption.
//   node supabase/maintenance/verify_json_export.mjs path/to/export.csv
// Confirms: the manifest row is present (it is always the last row, so a truncated result lacks it), every chunk of
// every table is present exactly once, every JSON cell parses and holds the stated number of rows, and each table's
// total equals the manifest. Exit code 0 = export is complete; 1 = do NOT rely on it.
import fs from 'node:fs'
import Papa from 'papaparse'

const file = process.argv[2]
if (!file) { console.error('usage: node verify_json_export.mjs export.csv'); process.exit(2) }

const parsed = Papa.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true })
const problems = []
const bad = (m) => problems.push(m)

const rows = parsed.data
for (const col of ['table_name', 'chunk_no', 'chunk_total', 'rows_in_chunk', 'table_rows', 'data']) {
  if (!parsed.meta.fields?.includes(col)) bad(`missing column "${col}"`)
}
if (parsed.errors.length) bad(`CSV parse errors: ${parsed.errors.slice(0, 3).map((e) => e.message).join('; ')}`)

const manifestRows = rows.filter((r) => r.table_name === '_manifest')
let manifest = null
if (manifestRows.length !== 1) bad(`expected exactly 1 _manifest row, found ${manifestRows.length} (export truncated?)`)
else {
  try { manifest = JSON.parse(manifestRows[0].data) } catch { bad('_manifest JSON is not valid') }
}

const perTable = new Map()
const seen = new Set()
let chunkCount = 0
for (const r of rows) {
  if (r.table_name === '_manifest') continue
  chunkCount++
  const key = `${r.table_name}#${r.chunk_no}`
  if (seen.has(key)) bad(`duplicate chunk ${key}`)
  seen.add(key)
  let arr
  try { arr = JSON.parse(r.data) } catch { bad(`${key}: data is not valid JSON (cell truncated?)`); continue }
  if (!Array.isArray(arr) || arr.length !== Number(r.rows_in_chunk)) bad(`${key}: holds ${Array.isArray(arr) ? arr.length : '?'} rows, expected ${r.rows_in_chunk}`)
  const t = perTable.get(r.table_name) ?? { rows: 0, chunks: new Set(), tableRows: Number(r.table_rows) }
  t.rows += Array.isArray(arr) ? arr.length : 0
  t.chunks.add(Number(r.chunk_no))
  perTable.set(r.table_name, t)
}

if (manifest) {
  if (manifest.total_chunks !== chunkCount) bad(`manifest says ${manifest.total_chunks} chunks, file has ${chunkCount}`)
  for (const [table, expected] of Object.entries(manifest.tables ?? {})) {
    const t = perTable.get(table)
    const got = t?.rows ?? 0
    if (got !== expected) bad(`${table}: ${got} rows in file, manifest says ${expected}`)
    const needChunks = Math.ceil(expected / 200)
    for (let i = 0; i < needChunks; i++) if (!t?.chunks.has(i)) bad(`${table}: chunk ${i} missing`)
  }
  for (const table of perTable.keys()) if (!(table in (manifest.tables ?? {}))) bad(`${table}: present in file but not in manifest`)
}

if (problems.length) {
  console.error('EXPORT NOT VERIFIED:\n - ' + problems.join('\n - '))
  process.exit(1)
}
const total = [...perTable.values()].reduce((a, t) => a + t.rows, 0)
console.log(`EXPORT VERIFIED: ${perTable.size} non-empty tables, ${total} rows, ${chunkCount} chunks, manifest present.`)
console.log(Object.entries(manifest.tables).map(([k, v]) => `  ${k}: ${v}`).join('\n'))
