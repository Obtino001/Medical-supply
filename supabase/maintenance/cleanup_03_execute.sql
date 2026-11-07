-- STEP 3: CLEANUP. DESTRUCTIVE. Run only after step 2 printed OVERALL = BACKUP VERIFIED and you saved the
-- JSON export (2b) / a full dump (see EXECUTION_GUIDE.md).
--
-- ONE transaction. Every check below raises an exception on failure, which rolls the whole transaction back
-- (nothing deleted, nothing disabled). If you see any error: run `rollback;` and send me the message.
--
-- Deleted (exactly the approved counts): shops 2, import_jobs 2, import_rows 232, surveys 2, products 109,
--   price_records 218, match_decisions 109, product_aliases 218, import_mapping_presets 2, audit_events 335;
--   plus wishlist_items, opportunity_status, match_rejections, product_identifiers which must already be 0.
-- Untouched and fingerprint-verified before AND after: workspaces, workspace_members, saved_views, export_profiles,
--   auth.users (id, email). RLS policies, functions and the schema are never altered.
-- Only change besides the deletes: shop_no / survey_no / product_no identity counters restart at 1.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp.fp(q text) returns text language plpgsql as $fp$
declare r text;
begin
  execute 'select md5(coalesce(string_agg(j::text, chr(10) order by j::text), '''')) from (select to_jsonb(t) as j from (' || q || ') t) s' into r;
  return r;
end $fp$;

create or replace function pg_temp.seq(s text) returns text language plpgsql as $sq$
declare r text;
begin
  execute format('select last_value::text || '','' || is_called::text from %s', s) into r;
  return r;
end $sq$;

-- ------------------------------------------------------------------ 0. lock out concurrent writers
do $do$
declare lst text;
begin
  select string_agg(format('public.%I', x), ', ' order by x) into lst from unnest(array[
    'audit_events','import_jobs','import_mapping_presets','import_rows','match_decisions','match_rejections',
    'opportunity_status','price_records','product_aliases','product_identifiers','products','shops','surveys','wishlist_items']) x;
  -- no concurrent import/edit/read of the tables being emptied; fails fast (lock_timeout) instead of waiting forever
  execute 'lock table ' || lst || ' in access exclusive mode';
  -- the tables that must stay untouched: block writers so their before/after fingerprints are meaningful
  select string_agg(format('public.%I', x), ', ' order by x) into lst from unnest(array[
    'export_profiles','saved_views','workspace_members','workspaces']) x;
  execute 'lock table ' || lst || ' in share mode';
end $do$;

-- ------------------------------------------------------------------ 1. preconditions (any failure = rollback)
do $do$
declare
  t text; n bigint; mrow record; unknown text; drift text;
  expected constant jsonb := '{
    "shops":2, "import_jobs":2, "import_rows":232, "surveys":2, "products":109, "price_records":218,
    "match_decisions":109, "product_aliases":218, "import_mapping_presets":2, "audit_events":335,
    "wishlist_items":0, "opportunity_status":0, "match_rejections":0, "product_identifiers":0}';
begin
  if (select count(*) from public.workspaces) <> 1 then
    raise exception 'Expected exactly 1 workspace, found %', (select count(*) from public.workspaces);
  end if;

  -- the backup must exist, be complete, and still hold exactly what it held when verified
  if to_regclass('backup_20261103._manifest') is null then
    raise exception 'Backup manifest backup_20261103._manifest not found: run step 2 first.';
  end if;
  if (select count(*) from backup_20261103._manifest) <> 19 then
    raise exception 'Backup manifest is incomplete (expected 19 entries: 18 tables + auth.users).';
  end if;
  for mrow in select source, row_count, fingerprint from backup_20261103._manifest order by source loop
    if mrow.source like 'auth.%' then
      continue;
    end if;
    if to_regclass(format('backup_20261103.%I', mrow.source)) is null then
      raise exception 'Backup table backup_20261103.% is missing.', mrow.source;
    end if;
    -- (a) backup contents unchanged since verification
    if pg_temp.fp('select * from backup_20261103.' || quote_ident(mrow.source)) <> mrow.fingerprint then
      raise exception 'Backup table % no longer matches its manifest fingerprint. Re-run step 2 under a new schema name.', mrow.source;
    end if;
    -- (b) live data == backup, row for row (so the backup really is a copy of what is about to be deleted)
    if pg_temp.fp('select * from public.' || quote_ident(mrow.source)) <> mrow.fingerprint then
      raise exception 'Live table % changed after the backup was taken. Re-run step 2 under a new schema name.', mrow.source;
    end if;
  end loop;
  if pg_temp.fp('select id, email from auth.users') <> (select fingerprint from backup_20261103._manifest where source = 'auth.users(id,email)') then
    raise exception 'auth.users changed after the backup was taken. Aborted.';
  end if;

  -- exact approved deletion counts (live)
  for t in select jsonb_object_keys(expected) loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> (expected->>t)::bigint then
      raise exception 'Count mismatch on %: approved report says %, database has %. Aborted, nothing deleted.', t, expected->>t, n;
    end if;
  end loop;

  -- trigger state must equal what step 2 recorded (otherwise something changed in between: investigate, do not guess)
  select string_agg(x, '; ') into drift from (
    (select 'now ' || schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled
       from (select n.nspname::text as schema_name, c.relname::text as table_name, t2.tgname::text as trigger_name, t2.tgenabled::text as enabled
             from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid join pg_namespace n on n.oid = c.relnamespace
             where not t2.tgisinternal and n.nspname in ('public','auth')) cur
      except select 'now ' || schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled from backup_20261103._triggers)
    union all
    (select 'now ' || schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled from backup_20261103._triggers
      except
     select 'now ' || n.nspname || '.' || c.relname || '.' || t2.tgname || '=' || t2.tgenabled::text
       from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where not t2.tgisinternal and n.nspname in ('public','auth'))
  ) d(x);
  if drift is not null then
    raise exception 'Trigger states differ from the backup record (%). Aborted.', drift;
  end if;
end $do$;

-- ------------------------------------------------------------------ 2. discover the triggers that would fire on these deletes
-- Everything that fires on DELETE (tgtype bit 8) on the tables below is found in pg_trigger, not assumed by name.
create temp table _cleanup_trg on commit drop as
select c.oid::regclass::text as rel, t.tgname::text as trg, t.tgenabled::text as enabled,
       pn.nspname::text as fn_schema, p.proname::text as fn_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and c.relname = any (array['audit_events','import_jobs','import_mapping_presets','import_rows','match_decisions','match_rejections',
                             'opportunity_status','price_records','product_aliases','product_identifiers','products','shops','surveys','wishlist_items'])
  and (t.tgtype & 8) <> 0;

do $do$
declare r record; unknown text;
begin
  -- only the known audit writer may be paused; any other DELETE trigger means "stop and look"
  select string_agg(rel || '.' || trg || ' -> ' || fn_schema || '.' || fn_name, ', ') into unknown
  from _cleanup_trg where not (fn_schema = 'public' and fn_name = 'audit_row');
  if unknown is not null then
    raise exception 'Unexpected DELETE trigger(s) found: %. Not disabling or running anything. Aborted.', unknown;
  end if;
  -- pause only those that are currently enabled; ones already disabled stay as they are
  for r in select * from _cleanup_trg where enabled <> 'D' loop
    execute format('alter table %s disable trigger %I', r.rel, r.trg);
  end loop;
end $do$;

-- ------------------------------------------------------------------ 3. delete in dependency order
-- (price_records reference shops/surveys without cascade, so they go first; products last because most children cascade from it)
delete from public.wishlist_items;
delete from public.opportunity_status;
delete from public.match_rejections;
delete from public.match_decisions;
delete from public.product_aliases;
delete from public.product_identifiers;
delete from public.price_records;
delete from public.import_rows;
delete from public.import_jobs;
delete from public.import_mapping_presets;
delete from public.surveys;
delete from public.shops;
delete from public.products;
delete from public.audit_events;

-- ------------------------------------------------------------------ 4. restore each trigger to exactly its original state
do $do$
declare r record; act text;
begin
  for r in select * from _cleanup_trg loop
    act := case r.enabled when 'O' then 'enable' when 'R' then 'enable replica' when 'A' then 'enable always' else 'disable' end;
    execute format('alter table %s %s trigger %I', r.rel, act, r.trg);
  end loop;
end $do$;

-- ------------------------------------------------------------------ 5. numbering restarts at 1 (RESTART sets last_value=1, is_called=false: no value consumed)
alter table public.shops    alter column shop_no    restart with 1;
alter table public.surveys  alter column survey_no  restart with 1;
alter table public.products alter column product_no restart with 1;

-- ------------------------------------------------------------------ 6. post-conditions (any failure = rollback)
do $do$
declare t text; n bigint; r record; drift text; seq text;
begin
  foreach t in array array['audit_events','import_jobs','import_mapping_presets','import_rows','match_decisions','match_rejections',
      'opportunity_status','price_records','product_aliases','product_identifiers','products','shops','surveys','wishlist_items'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception '% still has % rows. Rolled back.', t, n; end if;
  end loop;

  -- kept data identical to the verified backup
  for r in select source, fingerprint from backup_20261103._manifest
           where source in ('workspaces','workspace_members','saved_views','export_profiles') loop
    if pg_temp.fp('select * from public.' || quote_ident(r.source)) <> r.fingerprint then
      raise exception '% was modified. Rolled back.', r.source;
    end if;
  end loop;
  if pg_temp.fp('select id, email from auth.users') <> (select fingerprint from backup_20261103._manifest where source = 'auth.users(id,email)') then
    raise exception 'auth.users was modified. Rolled back.';
  end if;

  -- trigger states exactly as recorded in step 2
  select string_agg(x, '; ') into drift from (
    (select schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled
       from (select n2.nspname::text as schema_name, c.relname::text as table_name, t2.tgname::text as trigger_name, t2.tgenabled::text as enabled
             from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid join pg_namespace n2 on n2.oid = c.relnamespace
             where not t2.tgisinternal and n2.nspname in ('public','auth')) cur
      except select schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled from backup_20261103._triggers)
    union all
    (select schema_name || '.' || table_name || '.' || trigger_name || '=' || enabled from backup_20261103._triggers
      except
     select n2.nspname || '.' || c.relname || '.' || t2.tgname || '=' || t2.tgenabled::text
       from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid join pg_namespace n2 on n2.oid = c.relnamespace
       where not t2.tgisinternal and n2.nspname in ('public','auth'))
  ) d(x);
  if drift is not null then raise exception 'Trigger states were not restored (%). Rolled back.', drift; end if;

  -- the three counters are at last_value=1, is_called=false (next value = 1); every other sequence is unchanged
  for r in select * from backup_20261103._sequences loop
    seq := r.sequence_name;
    if (r.table_name, r.column_name) in (('shops','shop_no'), ('surveys','survey_no'), ('products','product_no')) then
      if pg_temp.seq(seq) <> '1,false' then raise exception 'Sequence % is at %, expected 1,false. Rolled back.', seq, pg_temp.seq(seq); end if;
    elsif pg_temp.seq(seq) <> r.last_value::text || ',' || r.is_called::text then
      raise exception 'Sequence % changed unexpectedly (%). Rolled back.', seq, pg_temp.seq(seq);
    end if;
  end loop;
end $do$;

commit;

-- If you can read this result, the transaction committed. Now run cleanup_04_verify.sql.
select 'CLEANUP COMMITTED' as status,
       (select count(*) from public.shops) as shops, (select count(*) from public.products) as products,
       (select count(*) from public.price_records) as price_records, (select count(*) from public.audit_events) as audit_events,
       (select count(*) from public.workspace_members) as workspace_members, (select count(*) from auth.users) as auth_users;
