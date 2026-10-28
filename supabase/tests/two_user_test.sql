-- Two-user behaviour test. Run in the Supabase SQL editor AFTER both migrations.
-- It creates two throwaway auth users in a fresh transaction and ROLLS BACK at the end (nothing is kept).
-- NOTE: written without access to a Postgres instance; I could not execute it. Expect to fix small typos on first run.
-- IMPORTANT: run it on an EMPTY project (no workspace yet) because the first user becomes admin.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '', now(), now(), now(), '{}', '{}'),
 ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '', now(), now(), now(), '{}', '{}');

do $$
declare ws uuid; shop uuid; prod uuid; cnt int; ok boolean;
begin
  select count(*) into cnt from workspace_members;
  assert cnt = 2, 'both users should be members of one workspace';
  assert (select role from workspace_members where email = 'a@test.local') = 'admin', 'first user is admin';
  assert (select role from workspace_members where email = 'b@test.local') = 'partner', 'second user is partner';

  -- third account must be refused
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local', '', now(), now(), '{}', '{}');
    assert false, 'third user should have been rejected';
  exception when raise_exception then
    if sqlerrm like 'third user%' then raise; end if;
  end;

  -- A (admin) creates a shop and a product
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  insert into shops(name) values ('Shop One') returning id into shop;
  insert into products(name, normalized_name, weight_value, weight_unit, identity_key) values ('Zincol 100g', 'zincol', 100, 'g', 'zincol|||100|g|||') returning id into prod;

  -- B (partner) sees the same shop and product
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  assert (select count(*) from shops) = 1, 'B sees A''s shop';
  assert (select count(*) from products) = 1, 'B sees A''s product';

  -- B adds to wishlist, A sees it
  insert into wishlist_items(product_id, priority) values (prod, 'high');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  assert (select count(*) from wishlist_items) = 1, 'A sees B''s wishlist entry';

  -- partner may not edit shops or delete products (admin-only), admin may
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  update shops set name = 'Hacked';
  assert (select name from shops) = 'Shop One', 'partner cannot edit shops';
  delete from products;
  assert (select count(*) from products) = 1, 'partner cannot delete products';

  -- removing the wishlist entry keeps the product
  delete from wishlist_items;
  assert (select count(*) from wishlist_items) = 0, 'wishlist entry removed';
  assert (select count(*) from products) = 1, 'product survives wishlist removal';

  -- an anonymous visitor sees nothing
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform count(*) from shops;
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
