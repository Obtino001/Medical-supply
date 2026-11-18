-- Feature 1, 2, 4: Product country_of_origin, persistent manufacturer_mappings,
-- race-safe commit_import & alias/mapping reuse, and workspace-shared company-wise Purchase Orders.
-- Non-destructive & idempotent. Safe to run on top of 0001-0003 migrations.

-- ---------------------------------------------------------------- 1. Products: country of origin
alter table public.products
  add column if not exists country_of_origin text;

create index if not exists products_country_idx
  on public.products (workspace_id, country_of_origin)
  where country_of_origin is not null and archived = false;

-- ---------------------------------------------------------------- 2. Saved product-to-manufacturer & origin mappings
create table if not exists public.manufacturer_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  pattern_key text not null check (length(trim(pattern_key)) > 0),
  raw_name text not null,
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  country_of_origin text,
  product_id uuid references public.products(id) on delete set null,
  confirmed_count int not null default 1 check (confirmed_count >= 1),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (workspace_id, pattern_key)
);

create index if not exists manufacturer_mappings_ws_idx
  on public.manufacturer_mappings (workspace_id, manufacturer);

-- ---------------------------------------------------------------- 3. Company-wise Purchase Orders & Draft Items
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  order_seq bigint generated always as identity,
  order_number text not null check (length(trim(order_number)) > 0),
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  title text,
  status text not null default 'draft' check (status in ('draft','finalized','ordered','cancelled')),
  order_date date not null default current_date,
  extra_discount_pct numeric(5,2) not null default 5 check (extra_discount_pct >= 0 and extra_discount_pct < 100),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (workspace_id, order_number)
);

create index if not exists purchase_orders_ws_idx
  on public.purchase_orders (workspace_id, status, order_date desc, updated_at desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  product_name text not null,
  variant_label text,
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  selected_shop_id uuid references public.shops(id) on delete set null,
  selected_shop_name text,
  lowest_price numeric(14,4) check (lowest_price is null or lowest_price >= 0),
  lowest_price_date date,
  target_price numeric(14,4) check (target_price is null or target_price >= 0),
  is_target_manual boolean not null default false,
  supplier_offers_snapshot jsonb not null default '[]'::jsonb,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (order_id, product_id)
);

create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items (order_id, sort_order, product_name);

-- Database-level guard: a company order must never mix products from an unrelated manufacturer or different workspace.
create or replace function public.enforce_po_item_company() returns trigger
language plpgsql set search_path = public as $$
declare po purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id = new.order_id;
  if not found then
    raise exception 'Purchase order not found';
  end if;
  if new.workspace_id is null then
    new.workspace_id := po.workspace_id;
  elsif new.workspace_id <> po.workspace_id then
    raise exception 'Workspace mismatch between purchase order and line item';
  end if;
  if lower(trim(new.manufacturer)) <> lower(trim(po.manufacturer)) then
    raise exception 'Order manufacturer mismatch: expected "%", got "%"', po.manufacturer, new.manufacturer;
  end if;
  return new;
end $$;

drop trigger if exists enforce_po_item_company_trg on public.purchase_order_items;
create trigger enforce_po_item_company_trg
  before insert or update on public.purchase_order_items
  for each row execute function public.enforce_po_item_company();

-- ---------------------------------------------------------------- 4. RLS & Workspace Policies (both authorized members access shared records)
do $$
declare t text;
begin
  foreach t in array array['manufacturer_mappings','purchase_orders','purchase_order_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$I', t);
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_ins on public.%1$I', t);
    execute format('create policy %1$s_ins on public.%1$I for insert to authenticated with check (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_upd on public.%1$I', t);
    execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_del on public.%1$I', t);
    execute format('create policy %1$s_del on public.%1$I for delete to authenticated using (public.is_member(workspace_id))', t);
  end loop;
end $$;

-- Extend audit_row label lookup cleanly for purchase orders / mappings without altering existing tables' behavior
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; o jsonb; d jsonb := '{}'::jsonb; k text; lbl text;
begin
  if tg_op = 'DELETE' then
    insert into audit_events(workspace_id, table_name, row_id, action, detail)
      values ((to_jsonb(old)->>'workspace_id')::uuid, tg_table_name, old.id, 'delete', jsonb_build_object('old', to_jsonb(old)));
    return old;
  end if;
  r := to_jsonb(new);
  lbl := coalesce(r->>'name', r->>'original_title', r->>'filename', r->>'order_number', r->>'product_name', r->>'raw_name', '');
  if tg_op = 'INSERT' then
    insert into audit_events(workspace_id, table_name, row_id, action, detail)
      values ((r->>'workspace_id')::uuid, tg_table_name, new.id, 'insert', jsonb_build_object('label', lbl));
  else
    o := to_jsonb(old);
    for k in select jsonb_object_keys(r) loop
      if k not in ('updated_at','updated_by') and r->k is distinct from o->k then
        d := d || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', r->k));
      end if;
    end loop;
    if d <> '{}'::jsonb then
      insert into audit_events(workspace_id, table_name, row_id, action, detail)
        values ((r->>'workspace_id')::uuid, tg_table_name, new.id, 'update', jsonb_build_object('label', lbl, 'changes', d));
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['manufacturer_mappings','purchase_orders','purchase_order_items'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_row()', t);
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 5. Upgraded atomic commit_import & rematch_price_record
create or replace function public.commit_import(
  p_job jsonb, p_rows jsonb, p_new_products jsonb, p_decisions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ws uuid := public.current_ws();
  v_job uuid; v_survey uuid := (p_job->>'survey_id')::uuid; v_shop uuid := (p_job->>'shop_id')::uuid;
  v_obs date;
  pmap jsonb := '{}'::jsonb; np jsonb; pid uuid;
  r jsonb; md jsonb; v_rowid uuid; v_prod uuid;
  n_imp int := 0; n_skip int := 0; n_err int := 0;
begin
  if ws is null then raise exception 'Not a workspace member'; end if;
  if v_survey is null then
    insert into surveys(workspace_id, shop_id, survey_date, notes)
    values (ws, v_shop, coalesce(nullif(p_job->>'survey_date','')::date, current_date), p_job->>'survey_notes')
    returning id, survey_date into v_survey, v_obs;
  else
    select survey_date into v_obs from surveys where id = v_survey and shop_id = v_shop and workspace_id = ws;
    if v_obs is null then raise exception 'Survey not found for this shop'; end if;
  end if;
  if not exists (select 1 from shops where id = v_shop and workspace_id = ws) then raise exception 'Shop not found'; end if;

  select count(*) filter (where e->>'status' = 'import'), count(*) filter (where e->>'status' = 'error'),
         count(*) filter (where e->>'status' not in ('import','error'))
    into n_imp, n_err, n_skip from jsonb_array_elements(p_rows) e;

  insert into import_jobs(workspace_id, survey_id, shop_id, filename, file_hash, file_size, mapping, options,
                          row_total, row_imported, row_skipped, row_errors)
  values (ws, v_survey, v_shop, p_job->>'filename', p_job->>'file_hash', nullif(p_job->>'file_size','')::bigint,
          p_job->'mapping', p_job->'options', jsonb_array_length(p_rows), n_imp, n_skip, n_err)
  returning id into v_job;

  -- Upsert new products safely on identity_key to prevent duplicate product creation under concurrent imports
  for np in select * from jsonb_array_elements(p_new_products) loop
    insert into products(workspace_id, name, normalized_name, brand, manufacturer, active_ingredient,
        strength_value, strength_unit, weight_value, weight_unit, pack_size, dosage_form, variant,
        barcode, mfr_code, country_of_origin, identity_key)
    values (ws, np->>'name', np->>'normalized_name', nullif(np->>'brand',''), nullif(np->>'manufacturer',''), nullif(np->>'active_ingredient',''),
        nullif(np->>'strength_value','')::numeric, nullif(np->>'strength_unit',''),
        nullif(np->>'weight_value','')::numeric, nullif(np->>'weight_unit',''),
        nullif(np->>'pack_size','')::int, nullif(np->>'dosage_form',''), nullif(np->>'variant',''),
        nullif(np->>'barcode',''), nullif(np->>'mfr_code',''), nullif(np->>'country_of_origin',''), nullif(np->>'identity_key',''))
    on conflict (workspace_id, identity_key) where identity_key is not null and archived = false
    do update set
      manufacturer = coalesce(products.manufacturer, excluded.manufacturer),
      country_of_origin = coalesce(products.country_of_origin, excluded.country_of_origin),
      brand = coalesce(products.brand, excluded.brand)
    returning id into pid;
    pmap := pmap || jsonb_build_object(np->>'temp_key', pid::text);
  end loop;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into import_rows(workspace_id, import_job_id, row_number, raw, status, error)
    values (ws, v_job, (r->>'row_number')::int, coalesce(r->'raw','{}'::jsonb),
            case r->>'status' when 'import' then 'imported' when 'error' then 'error' else 'skipped' end, r->>'error')
    returning id into v_rowid;

    if r->>'status' = 'import' then
      v_prod := coalesce(nullif(r->>'product_id','')::uuid, nullif(pmap->>(r->>'temp_key'),'')::uuid);
      insert into price_records(workspace_id, product_id, shop_id, survey_id, import_job_id, import_row_id, observed_on,
          original_title, original_code, base_price, mrp, discount_pct, flat_discount, scheme_text, bonus_buy, bonus_free,
          min_order_qty, pack_size, availability, expiry, valid_until, tax_included, price_is_net, combine_discounts,
          effective_cost, scheme_status, calc_notes, match_status, match_candidates, source_attrs, notes)
      values (ws, v_prod, v_shop, v_survey, v_job, v_rowid, v_obs,
          r->>'original_title', r->>'original_code', nullif(r->>'base_price','')::numeric, nullif(r->>'mrp','')::numeric,
          nullif(r->>'discount_pct','')::numeric, nullif(r->>'flat_discount','')::numeric, r->>'scheme_text',
          nullif(r->>'bonus_buy','')::numeric, nullif(r->>'bonus_free','')::numeric, nullif(r->>'min_order_qty','')::numeric,
          nullif(r->>'pack_size','')::int, r->>'availability', r->>'expiry', nullif(r->>'valid_until','')::date,
          nullif(r->>'tax_included','')::boolean, coalesce((r->>'price_is_net')::boolean, false),
          coalesce((r->>'combine_discounts')::boolean, false),
          nullif(r->>'effective_cost','')::numeric, coalesce(r->>'scheme_status','ok'), r->>'calc_notes',
          case when v_prod is null and r->>'match_status' in ('exact','high','manual') then 'unmatched' else coalesce(r->>'match_status','unmatched') end,
          r->'match_candidates', r->'source_attrs', r->>'notes');

      if v_prod is not null then
        insert into product_aliases(workspace_id, product_id, shop_id, title)
          values (ws, v_prod, v_shop, r->>'original_title') on conflict do nothing;
        if coalesce(r->>'original_code','') <> '' then
          insert into product_identifiers(workspace_id, product_id, kind, value, shop_id)
            values (ws, v_prod, 'supplier_code', r->>'original_code', v_shop) on conflict do nothing;
        end if;
        if coalesce(r->>'enrich_manufacturer','') <> '' or coalesce(r->>'enrich_country','') <> '' then
          update products
          set
            manufacturer = coalesce(manufacturer, nullif(r->>'enrich_manufacturer','')),
            country_of_origin = coalesce(country_of_origin, nullif(r->>'enrich_country',''))
          where id = v_prod and workspace_id = ws
            and ((manufacturer is null and coalesce(r->>'enrich_manufacturer','') <> '')
              or (country_of_origin is null and coalesce(r->>'enrich_country','') <> ''));
        end if;
        if coalesce((r->>'save_decision')::boolean, false) and coalesce(r->>'source_key','') <> '' then
          insert into match_decisions(workspace_id, shop_id, source_key, product_id)
            values (ws, v_shop, r->>'source_key', v_prod)
            on conflict (workspace_id, shop_id, source_key) do update set product_id = excluded.product_id;
        end if;
      end if;
    end if;
  end loop;

  -- Save confirmed product-to-manufacturer / origin mappings for automatic reuse on future imports
  for md in select * from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) loop
    v_prod := coalesce(nullif(md->>'product_id','')::uuid, nullif(pmap->>(md->>'temp_key'),'')::uuid);
    if coalesce(md->>'pattern_key','') <> '' and coalesce(md->>'manufacturer','') <> '' then
      insert into manufacturer_mappings(workspace_id, pattern_key, raw_name, manufacturer, country_of_origin, product_id)
      values (ws, md->>'pattern_key', coalesce(md->>'raw_name', md->>'pattern_key'), md->>'manufacturer', nullif(md->>'country_of_origin',''), v_prod)
      on conflict (workspace_id, pattern_key) do update set
        manufacturer = excluded.manufacturer,
        country_of_origin = coalesce(excluded.country_of_origin, manufacturer_mappings.country_of_origin),
        product_id = coalesce(excluded.product_id, manufacturer_mappings.product_id),
        confirmed_count = manufacturer_mappings.confirmed_count + 1;
    end if;
  end loop;

  return jsonb_build_object('import_job_id', v_job, 'survey_id', v_survey, 'imported', n_imp, 'skipped', n_skip, 'errors', n_err,
                            'new_products', jsonb_array_length(p_new_products));
end $$;

create or replace function public.rematch_price_record(p_record uuid, p_product uuid, p_save_decision boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  rec price_records%rowtype;
  prod products%rowtype;
  ws uuid := public.current_ws();
  key text;
  mfr text;
  ctry text;
begin
  select * into rec from price_records where id = p_record and workspace_id = ws;
  if not found then raise exception 'Price record not found'; end if;
  if p_product is not null then
    select * into prod from products where id = p_product and workspace_id = ws;
    if not found then raise exception 'Product not found'; end if;
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

    mfr := coalesce(nullif(prod.manufacturer,''), nullif(rec.source_attrs->>'manufacturer',''));
    ctry := coalesce(nullif(prod.country_of_origin,''), nullif(rec.source_attrs->>'country_of_origin',''));
    if mfr is not null then
      insert into manufacturer_mappings(workspace_id, pattern_key, raw_name, manufacturer, country_of_origin, product_id)
      values (ws, 'title:' || regexp_replace(lower(trim(rec.original_title)), '\s+', ' ', 'g'), rec.original_title, mfr, ctry, p_product)
      on conflict (workspace_id, pattern_key) do update set
        manufacturer = excluded.manufacturer,
        country_of_origin = coalesce(excluded.country_of_origin, manufacturer_mappings.country_of_origin),
        product_id = coalesce(excluded.product_id, manufacturer_mappings.product_id),
        confirmed_count = manufacturer_mappings.confirmed_count + 1;
    end if;
  end if;
  insert into audit_events(workspace_id, table_name, row_id, action, detail)
    values (ws, 'price_records', p_record, 'rematch', jsonb_build_object('from', rec.product_id, 'to', p_product));
end $$;

grant select, insert, update, delete on public.manufacturer_mappings to authenticated;
grant select, insert, update, delete on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_order_items to authenticated;
