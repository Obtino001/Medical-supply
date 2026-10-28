-- Safe, non-destructive performance indexes for scaling to 100+ suppliers and 100,000+ price records.
-- Optimizes current_offers DISTINCT ON (product_id, shop_id) and best-price lookups.

create index if not exists price_records_current_offers_idx
  on public.price_records (workspace_id, product_id, shop_id, observed_on desc, created_at desc)
  where archived = false and product_id is not null;

create index if not exists price_records_valid_history_idx
  on public.price_records (workspace_id, observed_on desc)
  where archived = false and product_id is not null and scheme_status = 'ok' and effective_cost is not null;

create index if not exists products_active_ws_no_idx
  on public.products (workspace_id, product_no)
  where archived = false;
