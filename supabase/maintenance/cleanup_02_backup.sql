-- STEP 2: DATA-ONLY BACKUP (in-database snapshot). Run in Supabase -> SQL Editor.
--
-- WHAT THIS IS
--   A data-only snapshot: a copy of every row of the 18 business/workspace tables, written to a NEW schema
--   (backup_20261103), plus a manifest of row counts and content fingerprints, the original trigger states
--   and the identity-sequence positions.
-- WHAT THIS IS NOT
--   It is NOT a full database backup. It does not contain the schema (DDL), functions, RLS policies, auth.users
--   or the auth schema, storage, or anything outside those 18 tables. It also lives in the SAME database, so it does
--   not protect you against losing the project. Take a real full backup first (see EXECUTION_GUIDE.md):
--   `supabase db dump` / `pg_dump`, or the dashboard's Database -> Backups.
--
-- SAFETY
--   * Never overwrites: if schema backup_20261103 already exists the script stops and leaves it untouched.
--   * Writes are blocked (SHARE locks, 10 s lock timeout) while copying, so the snapshot is consistent.
--   * One transaction: any error rolls back everything, including the new schema.
--   * Content is verified, not just counted: an MD5 fingerprint of every row (as JSON, order-independent) is
--     compared between each live table and its copy.
--   * Nothing in `public` is modified. The only objects created are in schema backup_20261103 (and one
--     session-local helper function in pg_temp that disappears when the session ends).
--
-- If you need a second backup later, replace backup_20261103 with a new name (all occurrences, in steps 2-4).
-- Remove a backup you no longer need with:  drop schema backup_20261103 cascade;
--
-- The final result grid must show status OK on every row and OVERALL = BACKUP VERIFIED.

begin;
set local lock_timeout = '10s';

-- Session-local helper: order-independent content fingerprint of any query's rows.
create or replace function pg_temp.fp(q text) returns text language plpgsql as $fp$
declare r text;
begin
  execute 'select md5(coalesce(string_agg(j::text, chr(10) order by j::text), '''')) from (select to_jsonb(t) as j from (' || q || ') t) s' into r;
  return r;
end $fp$;

do $do$
declare
  t text; lst text; seq text; r record; lv bigint; ic boolean; fp_live text; fp_copy text; n_live bigint; n_copy bigint;
  tables text[] := array[
    'audit_events','export_profiles','import_jobs','import_mapping_presets','import_rows','match_decisions',
    'match_rejections','opportunity_status','price_records','product_aliases','product_identifiers','products',
    'saved_views','shops','surveys','wishlist_items','workspace_members','workspaces'];
begin
  -- 1. never overwrite an existing backup
  if exists (select 1 from pg_namespace where nspname = 'backup_20261103') then
    raise exception 'Schema backup_20261103 already exists. It is an earlier backup and was NOT touched. Keep it. For another backup, change the schema name (every occurrence) in this file and in steps 3 and 4.';
  end if;

  -- 2. block writers while copying so the snapshot is consistent (alphabetical order, bounded wait)
  select string_agg(format('public.%I', x), ', ' order by x) into lst from unnest(tables) x;
  execute 'lock table ' || lst || ' in share mode';

  execute 'create schema backup_20261103';
  execute 'revoke all on schema backup_20261103 from public, anon, authenticated';

  execute 'create table backup_20261103._manifest (source text primary key, row_count bigint not null, fingerprint text not null, taken_at timestamptz not null default now())';

  -- 3. copy + verify content, table by table
  foreach t in array tables loop
    execute format('create table backup_20261103.%I as table public.%I', t, t);
    execute format('select count(*), pg_temp.fp(%L) from public.%I', 'select * from public.' || quote_ident(t), t) into n_live, fp_live;
    execute format('select count(*), pg_temp.fp(%L) from backup_20261103.%I', 'select * from backup_20261103.' || quote_ident(t), t) into n_copy, fp_copy;
    if n_live <> n_copy or fp_live is distinct from fp_copy then
      raise exception 'Backup of % does not match the live table (rows % vs %, fingerprint % vs %). Nothing was saved.', t, n_live, n_copy, fp_live, fp_copy;
    end if;
    execute format('insert into backup_20261103._manifest(source, row_count, fingerprint) values (%L, %s, %L)', t, n_live, fp_live);
  end loop;

  -- auth.users is not copied (credentials); only its identity (id, email) is fingerprinted so later steps can prove it is unchanged
  execute 'insert into backup_20261103._manifest(source, row_count, fingerprint) select ''auth.users(id,email)'', count(*), pg_temp.fp(''select id, email from auth.users'') from auth.users';

  -- 4. original trigger states (restored/verified by steps 3 and 4)
  execute $q$create table backup_20261103._triggers as
    select n.nspname::text as schema_name, c.relname::text as table_name, t.tgname::text as trigger_name,
           t.tgenabled::text as enabled, pn.nspname::text as function_schema, p.proname::text as function_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal and n.nspname in ('public', 'auth')$q$;

  -- 5. identity sequence positions (last_value + is_called), read without consuming a value
  execute 'create table backup_20261103._sequences (table_name text, column_name text, sequence_name text, last_value bigint, is_called boolean)';
  for r in select table_name, column_name from information_schema.columns
           where table_schema = 'public' and is_identity = 'YES' order by 1, 2 loop
    seq := pg_get_serial_sequence(format('public.%I', r.table_name), r.column_name);
    execute format('select last_value, is_called from %s', seq) into lv, ic;
    execute format('insert into backup_20261103._sequences values (%L, %L, %L, %s, %L)', r.table_name, r.column_name, seq, lv, ic);
  end loop;

  execute format('create table backup_20261103._meta as select now() as taken_at, current_user as taken_by, version() as server_version, %L::text as note',
                 'data-only snapshot of 18 tables; not a full database backup');
end $do$;

commit;

-- Result: live table vs backup copy, compared by content right now. Every row must be OK.
with r as (
  select m.source, m.row_count,
         m.fingerprint as manifest_fingerprint,
         case when m.source like 'auth.%' then null
              else pg_temp.fp('select * from backup_20261103.' || quote_ident(m.source)) end as backup_fingerprint,
         case when m.source like 'auth.%' then pg_temp.fp('select id, email from auth.users')
              else pg_temp.fp('select * from public.' || quote_ident(m.source)) end as live_fingerprint
  from backup_20261103._manifest m
),
res as (
  select 1 as ord, source, row_count, manifest_fingerprint, backup_fingerprint, live_fingerprint,
         case when live_fingerprint = manifest_fingerprint and (backup_fingerprint is null or backup_fingerprint = manifest_fingerprint)
              then 'OK' else 'MISMATCH' end as status
  from r
)
select ord, source, row_count, manifest_fingerprint, backup_fingerprint, live_fingerprint, status from res
union all
select 2, 'OVERALL', (select count(*) from res), null, null, null,
       case when bool_and(status = 'OK') then 'BACKUP VERIFIED' else 'BACKUP NOT VERIFIED' end
from res
order by 1, 2;
