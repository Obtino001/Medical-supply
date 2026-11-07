-- STEP 2b: JSON EXPORT of the 18 tables (data only). Read-only. Run on its own, AFTER cleanup_02_backup.sql.
--
-- The SQL Editor truncates large result grids, so the data is split into chunks of 200 rows (one grid row per chunk)
-- and the LAST grid row is a manifest. If the manifest row is missing from your download, the result was truncated.
--   * Run, then use the result grid's "Download CSV" (or copy as JSON).
--   * Check the file with:  node supabase/maintenance/verify_json_export.mjs path/to/export.csv
--     It confirms every chunk is present, every JSON cell parses, and the per-table row counts match the manifest.
-- For large tables (tens of thousands of rows) prefer `supabase db dump --data-only` / pg_dump (see EXECUTION_GUIDE.md).
--
-- Columns: table_name | chunk_no | chunk_total | rows_in_chunk | table_rows | data (JSON array of row objects)

with src as (
            select 'audit_events' as t, to_jsonb(x) as j from public.audit_events x
  union all select 'export_profiles', to_jsonb(x) from public.export_profiles x
  union all select 'import_jobs', to_jsonb(x) from public.import_jobs x
  union all select 'import_mapping_presets', to_jsonb(x) from public.import_mapping_presets x
  union all select 'import_rows', to_jsonb(x) from public.import_rows x
  union all select 'match_decisions', to_jsonb(x) from public.match_decisions x
  union all select 'match_rejections', to_jsonb(x) from public.match_rejections x
  union all select 'opportunity_status', to_jsonb(x) from public.opportunity_status x
  union all select 'price_records', to_jsonb(x) from public.price_records x
  union all select 'product_aliases', to_jsonb(x) from public.product_aliases x
  union all select 'product_identifiers', to_jsonb(x) from public.product_identifiers x
  union all select 'products', to_jsonb(x) from public.products x
  union all select 'saved_views', to_jsonb(x) from public.saved_views x
  union all select 'shops', to_jsonb(x) from public.shops x
  union all select 'surveys', to_jsonb(x) from public.surveys x
  union all select 'wishlist_items', to_jsonb(x) from public.wishlist_items x
  union all select 'workspace_members', to_jsonb(x) from public.workspace_members x
  union all select 'workspaces', to_jsonb(x) from public.workspaces x
),
numbered as (
  select t, j, row_number() over (partition by t order by j::text) - 1 as rn, count(*) over (partition by t) as table_rows from src
),
chunks as (
  select t as table_name, (rn / 200)::int as chunk_no, count(*)::int as rows_in_chunk, max(table_rows)::int as table_rows,
         jsonb_agg(j order by rn) as data
  from numbered group by t, (rn / 200)
),
total as (select count(*)::int as n from chunks)
select * from (
select table_name, chunk_no, (select n from total) as chunk_total, rows_in_chunk, table_rows, data::text as data
from chunks
union all
-- manifest row, always last: one JSON object with every table's row count and the total chunk count
select '_manifest', 0, (select n from total), 0, 0,
       jsonb_build_object(
         'total_chunks', (select n from total),
         'exported_at', now(),
         'tables', (select jsonb_object_agg(v.t, (select count(*) from src s where s.t = v.t)) from (values
            ('audit_events'),('export_profiles'),('import_jobs'),('import_mapping_presets'),('import_rows'),('match_decisions'),
            ('match_rejections'),('opportunity_status'),('price_records'),('product_aliases'),('product_identifiers'),('products'),
            ('saved_views'),('shops'),('surveys'),('wishlist_items'),('workspace_members'),('workspaces')) v(t))
       )::text
) e
order by (table_name = '_manifest'), table_name, chunk_no;
