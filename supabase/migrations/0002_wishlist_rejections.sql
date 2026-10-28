-- Wishlist, rejected matches, 'conflicting' match status, undo for mappings.

alter table public.price_records drop constraint if exists price_records_match_status_check;
alter table public.price_records add constraint price_records_match_status_check
  check (match_status in ('exact','high','needs_review','unmatched','manual','conflicting'));

-- A human said "this supplier row is NOT that product". Never offered/accepted automatically again.
create table if not exists public.match_rejections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  source_key text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  unique (workspace_id, shop_id, source_key, product_id)
);

-- Shared wishlist / priority products. Removing an item never touches products or price_records.
create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'active' check (status in ('active','needs_fresh_price','checked')),
  notes text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  unique (workspace_id, product_id)
);

do $$
declare t text;
begin
  foreach t in array array['match_rejections','wishlist_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$I', t);
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_ins on public.%1$I', t);
    execute format('create policy %1$s_ins on public.%1$I for insert to authenticated with check (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_upd on public.%1$I', t);
    execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
    -- both partners may remove wishlist entries / undo rejections (data records stay intact)
    execute format('drop policy if exists %1$s_del on public.%1$I', t);
    execute format('create policy %1$s_del on public.%1$I for delete to authenticated using (public.is_member(workspace_id))', t);
  end loop;
end $$;

drop trigger if exists touch_wishlist_items on public.wishlist_items;
create trigger touch_wishlist_items before update on public.wishlist_items for each row execute function public.touch_row();
drop trigger if exists audit_wishlist_items on public.wishlist_items;
create trigger audit_wishlist_items after insert or update or delete on public.wishlist_items for each row execute function public.audit_row();

-- Partners may undo a saved mapping (the generic policy only lets admins delete decisions).
create or replace function public.undo_match_decision(p_decision uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid := public.current_ws(); d match_decisions%rowtype;
begin
  select * into d from match_decisions where id = p_decision and workspace_id = ws;
  if not found then raise exception 'Decision not found'; end if;
  delete from match_decisions where id = p_decision;
  insert into audit_events(workspace_id, table_name, row_id, action, detail)
    values (ws, 'match_decisions', p_decision, 'undo', to_jsonb(d));
end $$;

-- Reject a suggested match: remember it, and keep the record unresolved for review.
create or replace function public.reject_match(p_record uuid, p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rec price_records%rowtype; ws uuid := public.current_ws(); key text;
begin
  select * into rec from price_records where id = p_record and workspace_id = ws;
  if not found then raise exception 'Price record not found'; end if;
  key := case when rec.original_code is not null and length(trim(rec.original_code)) > 0
              then 'code:' || lower(trim(rec.original_code))
              else 'title:' || regexp_replace(lower(trim(rec.original_title)), '\s+', ' ', 'g') end;
  insert into match_rejections(workspace_id, shop_id, source_key, product_id)
    values (ws, rec.shop_id, key, p_product) on conflict do nothing;
  delete from match_decisions where workspace_id = ws and shop_id = rec.shop_id and source_key = key and product_id = p_product;
  update price_records set
    match_candidates = (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(coalesce(match_candidates, '[]'::jsonb)) c where c->>'productId' <> p_product::text),
    product_id = case when product_id = p_product then null else product_id end,
    match_status = case when product_id = p_product then 'unmatched' else match_status end
  where id = p_record;
  insert into audit_events(workspace_id, table_name, row_id, action, detail)
    values (ws, 'price_records', p_record, 'reject_match', jsonb_build_object('product', p_product));
end $$;

-- Confirming a match overrides an earlier rejection of the same pair.
create or replace function public.rematch_price_record(p_record uuid, p_product uuid, p_save_decision boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare rec price_records%rowtype; ws uuid := public.current_ws(); key text;
begin
  select * into rec from price_records where id = p_record and workspace_id = ws;
  if not found then raise exception 'Price record not found'; end if;
  if p_product is not null and not exists (select 1 from products where id = p_product and workspace_id = ws) then
    raise exception 'Product not found';
  end if;
  update price_records set product_id = p_product,
    match_status = case when p_product is null then 'unmatched' else 'manual' end,
    match_candidates = null
  where id = p_record;
  key := case when rec.original_code is not null and length(trim(rec.original_code)) > 0
              then 'code:' || lower(trim(rec.original_code))
              else 'title:' || regexp_replace(lower(trim(rec.original_title)), '\s+', ' ', 'g') end;
  if p_product is not null and p_save_decision then
    delete from match_rejections where workspace_id = ws and shop_id = rec.shop_id and source_key = key and product_id = p_product;
    insert into match_decisions(workspace_id, shop_id, source_key, product_id)
      values (ws, rec.shop_id, key, p_product)
      on conflict (workspace_id, shop_id, source_key) do update set product_id = excluded.product_id;
    insert into product_aliases(workspace_id, product_id, shop_id, title)
      values (ws, p_product, rec.shop_id, rec.original_title) on conflict do nothing;
  end if;
  insert into audit_events(workspace_id, table_name, row_id, action, detail)
    values (ws, 'price_records', p_record, 'rematch', jsonb_build_object('from', rec.product_id, 'to', p_product));
end $$;

grant execute on function public.undo_match_decision(uuid) to authenticated;
grant execute on function public.reject_match(uuid, uuid) to authenticated;
grant execute on function public.rematch_price_record(uuid, uuid, boolean) to authenticated;

-- commit_import must also reject a 'conflicting' status being dropped to unmatched; mapping is unchanged
-- (statuses other than exact/high/manual are stored as sent).
