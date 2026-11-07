import { makeDb, seed, counts, run, sqlFile } from './harness.mjs'
import assert from 'node:assert/strict'

const S2 = sqlFile('cleanup_02_backup.sql'), S3 = sqlFile('cleanup_03_execute.sql'), S4 = sqlFile('cleanup_04_verify.sql')
let pass = 0, fail = 0
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('PASS', name) }
  catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 8).join('\n    ')) }
}
const rows = async (db, q) => (await db.query(q)).rows
const trg = async (db) => (await rows(db, `select c.relname||'.'||t.tgname||'='||t.tgenabled::text as x from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal order by 1`)).map((r) => r.x).join(',')
const seqs = async (db) => rows(db, `select table_name||'.'||column_name c, pg_get_serial_sequence('public.'||table_name, column_name) s from information_schema.columns where table_schema='public' and is_identity='YES' order by 1`)
const seqState = async (db) => { const o = {}; for (const r of await seqs(db)) o[r.c] = (await rows(db, `select last_value::text||','||is_called::text v from ${r.s}`))[0].v; return o }
const fresh = async () => { const db = await makeDb(); await seed(db); return db }
const FP = (tbl) => `(select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) from public.${tbl} x)`
const keptFp = (db) => rows(db, `select ${FP('workspaces')} w, ${FP('workspace_members')} m, ${FP('saved_views')} v, ${FP('export_profiles')} e`)

await t('seed matches the approved report counts', async () => {
  const db = await fresh(); const c = await counts(db)
  assert.deepEqual([c.shops, c.import_jobs, c.import_rows, c.surveys, c.products, c.price_records, c.match_decisions, c.product_aliases, c.import_mapping_presets, c.audit_events],
    [2, 2, 232, 2, 109, 218, 109, 218, 2, 335])
})

await t('02 backup: verifies content, result grid says BACKUP VERIFIED', async () => {
  const db = await fresh(); const r = await run(db, S2); assert.ok(r.ok, r.error)
  const g = r.last.rows
  assert.equal(g.find((x) => x.source === 'OVERALL').status, 'BACKUP VERIFIED')
  assert.equal(g.filter((x) => x.status === 'OK').length, 19)
  assert.equal((await rows(db, `select count(*)::int c from backup_20261103.price_records`))[0].c, 218)
  assert.ok((await rows(db, `select count(*)::int c from backup_20261103._triggers`))[0].c > 10)
})

await t('02 backup never overwrites an existing backup (re-run fails, original untouched)', async () => {
  const db = await fresh(); await run(db, S2)
  const before = await rows(db, `select source, fingerprint, taken_at::text from backup_20261103._manifest order by 1`)
  await db.exec(`insert into public.shops(name) values ('late shop')`)
  const r = await run(db, S2); assert.equal(r.ok, false); assert.match(r.error, /already exists/)
  assert.deepEqual(await rows(db, `select source, fingerprint, taken_at::text from backup_20261103._manifest order by 1`), before)
})

await t('03 refuses without a backup; nothing changes', async () => {
  const db = await fresh(); const c0 = await counts(db), t0 = await trg(db)
  const r = await run(db, S3); assert.equal(r.ok, false); assert.match(r.error, /backup|schema|relation/i)
  assert.deepEqual(await counts(db), c0); assert.equal(await trg(db), t0)
})

await t('03 refuses when live data changed after the backup (content change, same row counts)', async () => {
  const db = await fresh(); assert.ok((await run(db, S2)).ok)
  await db.exec(`update public.price_records set discount_pct = 99 where id = (select id from public.price_records limit 1)`)
  const c0 = await counts(db); const r = await run(db, S3)
  assert.equal(r.ok, false); assert.match(r.error, /changed after the backup/); assert.deepEqual(await counts(db), c0)
})

await t('03 refuses when the BACKUP was tampered with (same row counts)', async () => {
  const db = await fresh(); assert.ok((await run(db, S2)).ok)
  await db.exec(`update backup_20261103.products set name = 'TAMPERED' where product_no = 5`)
  const c0 = await counts(db); const r = await run(db, S3)
  assert.equal(r.ok, false); assert.match(r.error, /no longer matches its manifest/); assert.deepEqual(await counts(db), c0)
})

await t('03 enforces the exact approved counts (backup consistent, but counts differ)', async () => {
  const db = await fresh(); await db.exec(`insert into public.shops(name) values ('extra shop')`)
  assert.ok((await run(db, S2)).ok); const c0 = await counts(db)
  const r = await run(db, S3); assert.equal(r.ok, false); assert.match(r.error, /Count mismatch on shops/); assert.deepEqual(await counts(db), c0)
})

await t('03 stops on an unknown DELETE trigger and rolls back', async () => {
  const db = await fresh()
  await db.exec(`create function public.zz_fn() returns trigger language plpgsql as $$ begin return old; end $$;
                 create trigger zz_trg after delete on public.products for each row execute function public.zz_fn();`)
  assert.ok((await run(db, S2)).ok); const c0 = await counts(db), t0 = await trg(db)
  const r = await run(db, S3); assert.equal(r.ok, false); assert.match(r.error, /Unexpected DELETE trigger/)
  assert.deepEqual(await counts(db), c0); assert.equal(await trg(db), t0)
})

await t('03 mid-run failure (FK from an unrelated table) rolls back deletes AND trigger changes', async () => {
  const db = await fresh()
  await db.exec(`create table public.zz_ref(id int primary key, shop_id uuid references public.shops(id)); insert into public.zz_ref select 1, id from public.shops limit 1;`)
  assert.ok((await run(db, S2)).ok); const c0 = await counts(db), t0 = await trg(db), q0 = await seqState(db)
  const r = await run(db, S3); assert.equal(r.ok, false); assert.match(r.error, /foreign key|violates/i)
  assert.deepEqual(await counts(db), c0); assert.equal(await trg(db), t0); assert.deepEqual(await seqState(db), q0)
})

await t('03 + 04 happy path: clean, kept data untouched, ORIGINAL trigger states preserved (disabled / always / replica)', async () => {
  const db = await fresh()
  await db.exec(`alter table public.wishlist_items disable trigger audit_wishlist_items;
                 alter table public.export_profiles disable trigger audit_export_profiles;
                 alter table public.shops enable always trigger audit_shops;
                 alter table public.surveys enable replica trigger audit_surveys;`)
  const t0 = await trg(db)
  assert.ok(t0.includes('audit_wishlist_items=D') && t0.includes('audit_shops=A') && t0.includes('audit_surveys=R'))
  assert.ok((await run(db, S2)).ok)
  const kept0 = await keptFp(db); const auditSeq0 = (await seqState(db))['audit_events.id']
  const r = await run(db, S3); assert.ok(r.ok, r.error); assert.equal(r.last.rows[0].status, 'CLEANUP COMMITTED')
  const c = await counts(db)
  for (const k of ['shops', 'surveys', 'import_jobs', 'import_rows', 'import_mapping_presets', 'products', 'price_records', 'match_decisions', 'product_aliases', 'audit_events', 'wishlist_items']) assert.equal(c[k], 0, k)
  assert.deepEqual([c.workspaces, c.workspace_members, c['auth.users'], c.saved_views, c.export_profiles], [1, 2, 2, 1, 1])
  assert.equal(await trg(db), t0, 'trigger states must equal the originals')
  assert.deepEqual(await keptFp(db), kept0)
  const q = await seqState(db)
  assert.equal(q['shops.shop_no'], '1,false'); assert.equal(q['surveys.survey_no'], '1,false'); assert.equal(q['products.product_no'], '1,false')
  assert.equal(q['audit_events.id'], auditSeq0)
  const v = await run(db, S4); assert.ok(v.ok, v.error)
  const g = v.last.rows
  const bad = g.filter((x) => x.pass !== true); assert.deepEqual(bad, [], JSON.stringify(bad))
  assert.match(g.at(-1).check, /ALL CHECKS PASSED/)
  // verification consumed nothing: the very next generated numbers are 1
  await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', false);
                 insert into public.shops(name) values ('first real shop'); insert into public.products(name, normalized_name) values ('p','p');`)
  assert.equal((await rows(db, `select shop_no::int n from public.shops`))[0].n, 1)
  assert.equal((await rows(db, `select product_no::int n from public.products`))[0].n, 1)
})

await t('04 verify reports FAILED before cleanup', async () => {
  const db = await fresh(); assert.ok((await run(db, S2)).ok)
  const v = await run(db, S4); assert.ok(v.ok, v.error); assert.match(v.last.rows.at(-1).check, /FAILED/)
})

await t('04 verify detects a trigger left disabled and a modified workspace', async () => {
  const db = await fresh(); assert.ok((await run(db, S2)).ok); assert.ok((await run(db, S3)).ok)
  await db.exec(`alter table public.shops disable trigger audit_shops; update public.workspaces set settings='{"freshness_days":99}'`)
  const v = await run(db, S4); const g = v.last.rows
  assert.match(g.at(-1).check, /FAILED/)
  assert.ok(g.filter((x) => x.pass !== true).length >= 2)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
