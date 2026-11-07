// Disposable-database harness: PGlite (real PostgreSQL compiled to WASM) + minimal Supabase stubs + the project's real migrations.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

import { fileURLToPath } from 'node:url'
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\/]$/, '')
export const sqlFile = (n) => fs.readFileSync(`${REPO}/supabase/maintenance/${n}`, 'utf8')

export async function makeDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)
  for (const m of ['0001_schema.sql', '0002_wishlist_rejections.sql', '0003_performance_indexes.sql']) {
    let s = fs.readFileSync(`${REPO}/supabase/migrations/${m}`, 'utf8').replace(/create extension if not exists pgcrypto;/i, '')
    await db.exec(s)
  }
  return db
}

/** Two partners + representative business data with exactly the approved volumes (335 audit events, etc). */
export async function seed(db) {
  await db.exec(`
    insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','admin@test.local'), ('00000000-0000-0000-0000-0000000000b2','partner@test.local');
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', false);
    update public.workspaces set settings = '{"freshness_days":30}'::jsonb;
    insert into public.shops(name) values ('Super medical store'), ('Bhadur Fakheer Wholeseller');
    insert into public.surveys(shop_id) select id from public.shops;
    insert into public.import_jobs(survey_id, shop_id, filename, row_total, row_imported)
      select v.id, v.shop_id, 'file-' || v.survey_no || '.csv', 116, 109 from public.surveys v;
    insert into public.import_mapping_presets(shop_id, mapping) select id, '{"title":"ITEM NAME"}' from public.shops;
    insert into public.import_rows(import_job_id, row_number, raw, status)
      select j.id, g, jsonb_build_object('ITEM NAME','x'||g), 'imported' from public.import_jobs j, generate_series(1,116) g;
    insert into public.products(name, normalized_name, identity_key) select 'PRODUCT '||g, 'product '||g, 'k'||g from generate_series(1,109) g;
    insert into public.price_records(product_id, shop_id, survey_id, import_job_id, original_title, discount_pct, scheme_text, match_status, source_attrs)
      select p.id, j.shop_id, j.survey_id, j.id, p.name, 10 + (p.product_no % 20), '10% discount', 'exact', '{"offer_raw":"10%"}'::jsonb
      from public.products p cross join public.import_jobs j where not (j.filename = 'file-2.csv' and p.product_no > 109 - 0) ;
    insert into public.match_decisions(shop_id, source_key, product_id) select shop_id, 'title:'||lower(original_title), product_id from public.price_records where import_job_id = (select id from public.import_jobs order by filename limit 1);
    insert into public.product_aliases(product_id, shop_id, title) select product_id, shop_id, original_title from public.price_records;
    insert into public.saved_views(page, name, config) values ('compare','my view','{"q":""}');
    insert into public.export_profiles(name, columns) values ('profile', '[{"key":"a","header":"A"}]');
    delete from public.audit_events where table_name = 'export_profiles';  -- fixture: match the real report (335 events)
    -- wishlist add + remove = 2 audit events, 0 rows left
    insert into public.wishlist_items(product_id) select id from public.products limit 1;
    delete from public.wishlist_items;
  `)
}

export async function counts(db) {
  const t = ['shops','surveys','import_jobs','import_rows','import_mapping_presets','products','price_records','match_decisions','product_aliases','audit_events','wishlist_items','saved_views','export_profiles','workspaces','workspace_members']
  const out = {}
  for (const n of t) out[n] = Number((await db.query(`select count(*)::int c from public.${n}`)).rows[0].c)
  out['auth.users'] = Number((await db.query(`select count(*)::int c from auth.users`)).rows[0].c)
  return out
}

/** Run a script; on error issue ROLLBACK like the Supabase session ending, and return the error. */
export async function run(db, sql) {
  try { const r = await db.exec(sql); return { ok: true, last: r[r.length - 1] } }
  catch (e) { try { await db.exec('rollback') } catch {} ; return { ok: false, error: e.message } }
}
