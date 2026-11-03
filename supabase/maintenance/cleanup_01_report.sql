-- STEP 1 of the clean-slate procedure: READ-ONLY report. Changes nothing.
-- Run in Supabase -> SQL Editor (runs as the postgres owner, so RLS does not hide rows).
-- Deliberately NOT inside supabase/migrations so `supabase db push` never executes it.
--
-- Run query A first, then query B, and send me both result tables.

-- ===================================================================== A. summary
with ws as (select id from public.workspaces)
select * from (
  -- ---- must stay untouched
  select 10 as ord, 'KEEP  workspaces'            as item, (select count(*) from public.workspaces)::bigint as n
  union all select 11, 'KEEP  workspace_members (both partners)', count(*) from public.workspace_members
  union all select 12, 'KEEP  auth.users', count(*) from auth.users
  -- ---- business data that the cleanup would delete
  union all select 20, 'DELETE shops',                    count(*) from public.shops
  union all select 21, 'DELETE import_jobs (price lists)', count(*) from public.import_jobs
  union all select 22, 'DELETE import_rows (raw rows)',   count(*) from public.import_rows
  union all select 23, 'DELETE surveys',                  count(*) from public.surveys
  union all select 24, 'DELETE products',                 count(*) from public.products
  union all select 25, 'DELETE price_records (offers)',   count(*) from public.price_records
  union all select 26, 'DELETE match_decisions',          count(*) from public.match_decisions
  union all select 27, 'DELETE match_rejections',         count(*) from public.match_rejections
  union all select 28, 'DELETE product_aliases',          count(*) from public.product_aliases
  union all select 29, 'DELETE product_identifiers',      count(*) from public.product_identifiers
  union all select 30, 'DELETE wishlist_items',           count(*) from public.wishlist_items
  union all select 31, 'DELETE opportunity_status',       count(*) from public.opportunity_status
  union all select 32, 'DELETE import_mapping_presets (per-shop)', count(*) from public.import_mapping_presets
  union all select 33, 'DELETE audit_events (activity feed)',      count(*) from public.audit_events
  -- ---- pending review (will be gone with the price records)
  union all select 40, 'info  price_records needing match review',
         count(*) from public.price_records where match_status in ('needs_review','unmatched','conflicting') and archived = false
  -- ---- cannot be classified with confidence: you decide
  union all select 50, 'ASK   saved_views (your saved filters; kept by default)', count(*) from public.saved_views
  union all select 51, 'ASK   export_profiles (kept by default)',                 count(*) from public.export_profiles
  union all select 52, 'ASK   products with NO price record (maybe added by hand)',
         count(*) from public.products p where not exists (select 1 from public.price_records r where r.product_id = p.id)
  union all select 53, 'ASK   price_records not created by an import (entered by hand)',
         count(*) from public.price_records where import_job_id is null
  union all select 54, 'ASK   archived products',      count(*) from public.products where archived
  union all select 55, 'ASK   archived shops',         count(*) from public.shops where status = 'archived'
  -- ---- safety checks
  union all select 60, 'check workspaces (expected exactly 1)', count(*) from public.workspaces
  union all select 61, 'check rows in business tables outside the single workspace',
         (select count(*) from public.shops where workspace_id not in (select id from ws))
       + (select count(*) from public.products where workspace_id not in (select id from ws))
       + (select count(*) from public.price_records where workspace_id not in (select id from ws))
) t order by ord;

-- ===================================================================== B. detail
-- B1: per supplier
select s.shop_no, s.name, s.status,
       (select count(*) from public.surveys v where v.shop_id = s.id)       as surveys,
       (select count(*) from public.import_jobs j where j.shop_id = s.id)   as imports,
       (select count(*) from public.price_records r where r.shop_id = s.id) as price_records,
       (select string_agg(distinct j.filename, ', ') from public.import_jobs j where j.shop_id = s.id) as files
from public.shops s order by s.shop_no;

-- B2: activity-feed rows by table (audit_events)
select table_name, action, count(*) from public.audit_events group by 1, 2 order by 1, 2;

-- B3: who is in the workspace (these rows are NOT touched)
select m.role, m.email, m.display_name, w.name as workspace, w.max_members, w.settings
from public.workspace_members m join public.workspaces w on w.id = m.workspace_id;
