import { makeDb, seed, run, sqlFile } from './harness.mjs'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(here, '../../../package.json'))
const Papa = require('papaparse')

const db = await makeDb(); await seed(db)
const r = await run(db, sqlFile('cleanup_02b_export_json.sql')); assert.ok(r.ok, r.error)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-test-'))
const verifier = path.join(here, '../verify_json_export.mjs')
const check = (name, data, expectOk) => {
  const f = `${dir}/${name}.csv`; fs.writeFileSync(f, Papa.unparse(data, { columns: ['table_name', 'chunk_no', 'chunk_total', 'rows_in_chunk', 'table_rows', 'data'] }))
  let ok = true, out = ''
  try { out = execFileSync('node', [verifier, f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { ok = false; out = String(e.stderr) }
  console.log(ok === expectOk ? 'PASS' : 'FAIL', name, ok ? out.split('\n')[0] : out.split('\n').slice(0, 3).join(' | '))
  if (ok !== expectOk) process.exitCode = 1
}
const rows = r.last.rows
assert.equal(rows.at(-1).table_name, '_manifest')
check('complete export', rows, true)
check('truncated: manifest row missing', rows.slice(0, -1), false)
check('truncated: a chunk lost', rows.filter((x) => !(x.table_name === 'import_rows' && x.chunk_no === 0)), false)
check('corrupted: JSON cell cut', rows.map((x) => (x.table_name === 'shops' ? { ...x, data: x.data.slice(0, 40) } : x)), false)
// multi-chunk case: >200 rows per table -> import_rows has 232 rows = 2 chunks
assert.equal(rows.filter((x) => x.table_name === 'import_rows').length, 2)
