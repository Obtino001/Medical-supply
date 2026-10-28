-- Wholesale Price Intelligence: schema, RLS, import RPC.
-- Run once in Supabase -> SQL Editor (or `supabase db push`). Idempotent where practical.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- workspace + membership
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Business',
  max_members int not null default 2,           -- hard cap: blocks any 3rd account from joining
  settings jsonb not null default '{"freshness_days":15}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','partner')),
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create unique index if not exists workspace_members_user_idx on public.workspace_members(user_id);

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid())
$$;

create or replace function public.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.current_ws() returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from workspace_members where user_id = auth.uid() limit 1
$$;

-- First account created becomes admin of a new workspace; later accounts join as partner.
-- With public sign-ups DISABLED in Supabase, only the admin can create accounts (Auth -> Users -> Add/Invite).
-- The max_members cap is a second line of defence.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid; cnt int; cap int;
begin
  select id, max_members into ws, cap from workspaces order by created_at limit 1;
  if ws is null then
    insert into workspaces(name) values ('My Business') returning id into ws;
    insert into workspace_members(workspace_id, user_id, role, email) values (ws, new.id, 'admin', new.email);
  else
    select count(*) into cnt from workspace_members where workspace_id = ws;
    if cnt >= cap then
      raise exception 'Workspace member limit reached (%). Ask the admin to raise workspaces.max_members.', cap;
    end if;
    insert into workspace_members(workspace_id, user_id, role, email) values (ws, new.id, 'partner', new.email);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- core tables
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  shop_no bigint generated always as identity,
  name text not null check (length(trim(name)) > 0),
  owner_name text, phone text, address text, city text, notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists shops_ws_idx on public.shops(workspace_id, status);

create table if not exists public.surveys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  survey_no bigint generated always as identity,
  shop_id uuid not null references public.shops(id),
  survey_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists surveys_shop_idx on public.surveys(shop_id, survey_date desc);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  survey_id uuid not null references public.surveys(id),
  shop_id uuid not null references public.shops(id),
  filename text not null,
  file_hash text,
  file_size bigint,
  status text not null default 'committed' check (status in ('committed')),
  mapping jsonb, options jsonb,
  row_total int not null default 0, row_imported int not null default 0,
  row_skipped int not null default 0, row_errors int not null default 0,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists import_jobs_hash_idx on public.import_jobs(workspace_id, shop_id, file_hash);

create table if not exists public.import_mapping_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  mapping jsonb not null, options jsonb,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  unique (shop_id)
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  status text not null check (status in ('imported','skipped','error')),
  error text,
  unique (import_job_id, row_number)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_no bigint generated always as identity,
  name text not null check (length(trim(name)) > 0),
  normalized_name text not null,
  brand text, manufacturer text, active_ingredient text,
  strength_value numeric, strength_unit text,
  weight_value numeric, weight_unit text check (weight_unit is null or weight_unit in ('g','ml')),
  pack_size int check (pack_size is null or pack_size > 0),
  dosage_form text, variant text, barcode text, mfr_code text, notes text,
  identity_key text,
  archived boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists products_ws_idx on public.products(workspace_id, normalized_name);
create index if not exists products_barcode_idx on public.products(workspace_id, barcode) where barcode is not null;
create index if not exists products_mfr_idx on public.products(workspace_id, mfr_code) where mfr_code is not null;
create unique index if not exists products_identity_uidx on public.products(workspace_id, identity_key)
  where identity_key is not null and archived = false;

create table if not exists public.product_identifiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('barcode','mfr_code','supplier_code')),
  value text not null check (length(trim(value)) > 0),
  shop_id uuid references public.shops(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create unique index if not exists product_identifiers_uidx on public.product_identifiers
  (workspace_id, kind, value, coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(), created_by uuid default auth.uid()
);
create unique index if not exists product_aliases_uidx on public.product_aliases
  (product_id, title, coalesce(shop_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Saved human decisions: "this supplier's source key => this canonical product". Used on future imports.
create table if not exists public.match_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  source_key text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  unique (workspace_id, shop_id, source_key)
);

create table if not exists public.price_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  shop_id uuid not null references public.shops(id),
  survey_id uuid not null references public.surveys(id),
  import_job_id uuid references public.import_jobs(id) on delete set null,
  import_row_id uuid references public.import_rows(id) on delete set null,
  observed_on date not null default current_date,
  original_title text not null,
  original_code text,
  base_price numeric(14,4) check (base_price is null or base_price >= 0),
  mrp numeric(14,4) check (mrp is null or mrp >= 0),
  discount_pct numeric(7,3) check (discount_pct is null or (discount_pct >= 0 and discount_pct < 100)),
  flat_discount numeric(14,4) check (flat_discount is null or flat_discount >= 0),
  scheme_text text,
  bonus_buy numeric, bonus_free numeric,
  min_order_qty numeric,
  pack_size int,
  availability text,
  expiry text,
  valid_until date,
  tax_included boolean,
  price_is_net boolean not null default false,
  combine_discounts boolean not null default false,
  effective_cost numeric(14,4),
  scheme_status text not null default 'ok' check (scheme_status in ('ok','review','invalid','missing')),
  calc_notes text,
  match_status text not null default 'unmatched' check (match_status in ('exact','high','needs_review','unmatched','manual','conflicting')),
  match_candidates jsonb,
  source_attrs jsonb,                           -- brand / manufacturer / barcode / codes exactly as supplied
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);
create index if not exists price_records_product_idx on public.price_records(product_id, shop_id, observed_on desc);
create index if not exists price_records_shop_idx on public.price_records(shop_id, observed_on desc);
create index if not exists price_records_survey_idx on public.price_records(survey_id);
create index if not exists price_records_review_idx on public.price_records(workspace_id) where match_status in ('needs_review','unmatched') and archived = false;

create table if not exists public.opportunity_status (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  status text not null check (status in ('interesting','verify','contact','purchased','not_interested')),
  note text,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  unique (workspace_id, product_id)
);

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  page text not null,
  name text not null,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.export_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.current_ws() references public.workspaces(id) on delete cascade,
  name text not null,
  is_erp boolean not null default false,        -- true only when the user confirms it matches their ERP's import format
  columns jsonb not null,                       -- [{ "key": "...", "header": "..." }]
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  user_id uuid default auth.uid(),
  table_name text not null,
  row_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_ws_idx on public.audit_events(workspace_id, created_at desc);

-- ---------------------------------------------------------------- triggers: updated_at/by + audit
create or replace function public.touch_row() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb; o jsonb; d jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'DELETE' then
    insert into audit_events(workspace_id, table_name, row_id, action, detail)
      values ((to_jsonb(old)->>'workspace_id')::uuid, tg_table_name, old.id, 'delete', jsonb_build_object('old', to_jsonb(old)));
    return old;
  end if;
  r := to_jsonb(new);
  if tg_op = 'INSERT' then
    insert into audit_events(workspace_id, table_name, row_id, action, detail)
      values ((r->>'workspace_id')::uuid, tg_table_name, new.id, 'insert', jsonb_build_object('label', coalesce(r->>'name', r->>'original_title', r->>'filename', '')));
  else
    o := to_jsonb(old);
    for k in select jsonb_object_keys(r) loop
      if k not in ('updated_at','updated_by') and r->k is distinct from o->k then
        d := d || jsonb_build_object(k, jsonb_build_object('from', o->k, 'to', r->k));
      end if;
    end loop;
    if d <> '{}'::jsonb then
      insert into audit_events(workspace_id, table_name, row_id, action, detail)
        values ((r->>'workspace_id')::uuid, tg_table_name, new.id, 'update', jsonb_build_object('label', coalesce(r->>'name', r->>'original_title', ''), 'changes', d));
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['shops','surveys','import_jobs','import_mapping_presets','products','match_decisions','price_records','opportunity_status','export_profiles'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format('create trigger touch_%1$s before update on public.%1$s for each row execute function public.touch_row()', t);
  end loop;
  foreach t in array array['shops','surveys','import_jobs','products','price_records','export_profiles'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select to authenticated using (public.is_member(id));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

drop policy if exists wm_select on public.workspace_members;
create policy wm_select on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
drop policy if exists wm_update on public.workspace_members;
create policy wm_update on public.workspace_members for update to authenticated using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));
drop policy if exists wm_delete on public.workspace_members;
create policy wm_delete on public.workspace_members for delete to authenticated
  using (public.is_admin(workspace_id) and user_id <> auth.uid());

-- Generic workspace tables: members read + insert + update, only admins delete.
-- shops / price_records: updates are admin-only (partner may add and import, not edit existing).
do $$
declare t text;
begin
  foreach t in array array['shops','surveys','import_jobs','import_mapping_presets','import_rows','products',
                           'product_identifiers','product_aliases','match_decisions','price_records',
                           'opportunity_status','saved_views','export_profiles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$I', t);
    execute format('create policy %1$s_sel on public.%1$I for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_ins on public.%1$I', t);
    execute format('create policy %1$s_ins on public.%1$I for insert to authenticated with check (public.is_member(workspace_id))', t);
    execute format('drop policy if exists %1$s_del on public.%1$I', t);
    execute format('create policy %1$s_del on public.%1$I for delete to authenticated using (public.is_admin(workspace_id))', t);
    execute format('drop policy if exists %1$s_upd on public.%1$I', t);
    if t in ('shops','price_records') then
      execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id))', t);
    else
      execute format('create policy %1$s_upd on public.%1$I for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
    end if;
  end loop;
end $$;

-- Partners need to re-point a price record to another product (match review) without full edit rights.
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
  if p_product is not null and p_save_decision then
    key := case when rec.original_code is not null and length(trim(rec.original_code)) > 0
                then 'code:' || lower(trim(rec.original_code))
                else 'title:' || regexp_replace(lower(trim(rec.original_title)), '\s+', ' ', 'g') end;
    insert into match_decisions(workspace_id, shop_id, source_key, product_id)
      values (ws, rec.shop_id, key, p_product)
      on conflict (workspace_id, shop_id, source_key) do update set product_id = excluded.product_id;
    insert into product_aliases(workspace_id, product_id, shop_id, title)
      values (ws, p_product, rec.shop_id, rec.original_title) on conflict do nothing;
  end if;
  insert into audit_events(workspace_id, table_name, row_id, action, detail)
    values (ws, 'price_records', p_record, 'rematch', jsonb_build_object('from', rec.product_id, 'to', p_product));
end $$;

-- audit_events: members read + insert, nobody updates or deletes.
alter table public.audit_events enable row level security;
drop policy if exists audit_sel on public.audit_events;
create policy audit_sel on public.audit_events for select to authenticated using (public.is_member(workspace_id));

-- ---------------------------------------------------------------- views
create or replace view public.current_offers with (security_invoker = true) as
select distinct on (pr.product_id, pr.shop_id) pr.*
from public.price_records pr
where pr.archived = false and pr.product_id is not null
order by pr.product_id, pr.shop_id, pr.observed_on desc, pr.created_at desc;

-- ---------------------------------------------------------------- atomic import
-- Everything (job, rows, new products, price records, aliases, identifiers, saved decisions)
-- is written in ONE transaction: any error rolls the whole import back.
create or replace function public.commit_import(
  p_job jsonb, p_rows jsonb, p_new_products jsonb, p_decisions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ws uuid := public.current_ws();
  v_job uuid; v_survey uuid := (p_job->>'survey_id')::uuid; v_shop uuid := (p_job->>'shop_id')::uuid;
  v_obs date;
  pmap jsonb := '{}'::jsonb; np jsonb; pid uuid;
  r jsonb; v_rowid uuid; v_prod uuid;
  n_imp int := 0; n_skip int := 0; n_err int := 0;
begin
  if ws is null then raise exception 'Not a workspace member'; end if;
  if v_survey is null then
    -- the survey is created inside this transaction so an aborted import leaves nothing behind
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

  for np in select * from jsonb_array_elements(p_new_products) loop
    insert into products(workspace_id, name, normalized_name, brand, manufacturer, active_ingredient,
        strength_value, strength_unit, weight_value, weight_unit, pack_size, dosage_form, variant, barcode, mfr_code, identity_key)
    values (ws, np->>'name', np->>'normalized_name', np->>'brand', np->>'manufacturer', np->>'active_ingredient',
        nullif(np->>'strength_value','')::numeric, np->>'strength_unit',
        nullif(np->>'weight_value','')::numeric, np->>'weight_unit',
        nullif(np->>'pack_size','')::int, np->>'dosage_form', np->>'variant', np->>'barcode', np->>'mfr_code', np->>'identity_key')
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
        if coalesce((r->>'save_decision')::boolean, false) and coalesce(r->>'source_key','') <> '' then
          insert into match_decisions(workspace_id, shop_id, source_key, product_id)
            values (ws, v_shop, r->>'source_key', v_prod)
            on conflict (workspace_id, shop_id, source_key) do update set product_id = excluded.product_id;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('import_job_id', v_job, 'survey_id', v_survey, 'imported', n_imp, 'skipped', n_skip, 'errors', n_err,
                            'new_products', jsonb_array_length(p_new_products));
end $$;

grant execute on function public.commit_import(jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.rematch_price_record(uuid, uuid, boolean) to authenticated;
grant select on public.current_offers to authenticated;
