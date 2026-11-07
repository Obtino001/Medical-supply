-- STEP 4: VERIFY after cleanup. Read-only (only a session-local helper function in pg_temp is created).
-- Run it BEFORE using the app again: the first import/login-driven write legitimately makes audit_events non-empty.
-- Every row must show pass = true; the last row is the overall verdict.
--
-- "Sequence" rows read last_value AND is_called straight from the sequence (no nextval, so nothing is consumed):
-- last_value = 1 with is_called = false means the next generated number is exactly 1.

create or replace function pg_temp.fp(q text) returns text language plpgsql as $fp$
declare r text;
begin
  execute 'select md5(coalesce(string_agg(j::text, chr(10) order by j::text), '''')) from (select to_jsonb(t) as j from (' || q || ') t) s' into r;
  return r;
end $fp$;

create or replace function pg_temp.cnt(rel text) returns bigint language plpgsql as $c$
declare r bigint;
begin execute format('select count(*) from public.%I', rel) into r; return r; end $c$;

create or replace function pg_temp.seq(s text) returns text language plpgsql as $sq$
declare r text;
begin execute format('select last_value::text || '','' || is_called::text from %s', s) into r; return r; end $sq$;

with cur_trg as (
  select n.nspname::text as schema_name, c.relname::text as table_name, t.tgname::text as trigger_name, t.tgenabled::text as enabled
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','auth')
),
checks as (
  -- 1. business tables empty
  select 10 + o as ord, 'empty: ' || t as chk, '0' as expected, pg_temp.cnt(t)::text as actual
  from unnest(array['shops','surveys','import_jobs','import_rows','import_mapping_presets','products','price_records',
                    'wishlist_items','match_decisions','match_rejections','product_aliases','product_identifiers',
                    'opportunity_status','audit_events']) with ordinality as u(t, o)
  union all
  select 30, 'pending match reviews', '0',
         (select count(*) from public.price_records where match_status in ('needs_review','unmatched','conflicting'))::text
  -- 2. accounts / workspace unchanged (content fingerprint vs the verified backup manifest)
  union all select 40, 'workspace unchanged (incl. settings)',            m.fingerprint, pg_temp.fp('select * from public.workspaces')        from backup_20261103._manifest m where m.source = 'workspaces'
  union all select 41, 'workspace_members unchanged (roles)',             m.fingerprint, pg_temp.fp('select * from public.workspace_members') from backup_20261103._manifest m where m.source = 'workspace_members'
  union all select 42, 'auth.users unchanged (id, email)',                m.fingerprint, pg_temp.fp('select id, email from auth.users')       from backup_20261103._manifest m where m.source = 'auth.users(id,email)'
  union all select 43, 'saved_views untouched',                           m.fingerprint, pg_temp.fp('select * from public.saved_views')       from backup_20261103._manifest m where m.source = 'saved_views'
  union all select 44, 'export_profiles untouched',                       m.fingerprint, pg_temp.fp('select * from public.export_profiles')   from backup_20261103._manifest m where m.source = 'export_profiles'
  union all select 45,
         'members present: ' || coalesce((select string_agg(role || ':' || coalesce(email, '?'), ', ' order by role, email) from public.workspace_members), 'none'),
         (select m.row_count::text from backup_20261103._manifest m where m.source = 'workspace_members'),
         (select count(*) from public.workspace_members)::text
  -- 3. audit triggers (and all other triggers) in their original enabled/disabled state
  union all select 50, 'triggers differing from the recorded originals', '0',
         ((select count(*) from (select schema_name, table_name, trigger_name, enabled from cur_trg
                                  except select schema_name, table_name, trigger_name, enabled from backup_20261103._triggers) a)
        + (select count(*) from (select schema_name, table_name, trigger_name, enabled from backup_20261103._triggers
                                  except select schema_name, table_name, trigger_name, enabled from cur_trg) b))::text
  -- 4. sequence state: last_value + is_called, read without consuming a value
  union all
  select 60 + row_number() over (order by s.table_name, s.column_name)::int,
         'sequence ' || s.table_name || '.' || s.column_name || ' (last_value,is_called)',
         case when (s.table_name, s.column_name) in (('shops','shop_no'), ('surveys','survey_no'), ('products','product_no'))
              then '1,false' else s.last_value::text || ',' || s.is_called::text end,
         pg_temp.seq(s.sequence_name)
  from backup_20261103._sequences s
  -- 5. the backup itself is still intact
  union all
  select 90, 'backup tables still match their manifest (18 tables)', '18',
         (select count(*) from backup_20261103._manifest m
           where m.source not like 'auth.%'
             and pg_temp.fp('select * from backup_20261103.' || quote_ident(m.source)) = m.fingerprint)::text
)
select ord, chk as "check", expected, actual, (expected = actual) as pass from checks
union all
select 100, 'OVERALL: ' || case when bool_and(expected = actual) then 'ALL CHECKS PASSED' else 'FAILED' end, null, null, bool_and(expected = actual)
from checks
order by 1;
