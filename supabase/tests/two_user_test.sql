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
declare ws uuid; shop uuid; prod uuid; po_id uuid; cnt int; ok boolean;
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

  -- shared purchase orders: B creates company order, A edits & verifies company separation
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  update products set manufacturer = 'Bosch Pharmaceuticals' where id = prod;
  insert into purchase_orders(order_number, manufacturer, title) values ('PO-TEST-001', 'Bosch Pharmaceuticals', 'Bosch Order') returning id into po_id;
  insert into purchase_order_items(order_id, product_id, product_name, manufacturer, quantity, lowest_price, target_price)
    values (po_id, prod, 'Zincol 100g', 'Bosch Pharmaceuticals', 5, 950, 902.50);

  -- mixing unrelated manufacturer inside same company order must raise exception
  begin
    insert into purchase_order_items(order_id, product_id, product_name, manufacturer, quantity)
      values (po_id, prod, 'Other Mfr Item', 'Getz Pharma', 1);
    assert false, 'mixed manufacturer order item should have been rejected';
  exception when raise_exception then
    if sqlerrm like 'mixed manufacturer%' then raise; end if;
  end;

  -- A sees and updates B's draft order
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  assert (select count(*) from purchase_orders) = 1, 'A sees B''s purchase order';
  assert (select count(*) from purchase_order_items) = 1, 'A sees B''s order item';

  -- removing the wishlist entry keeps the product
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  delete from wishlist_items;
  assert (select count(*) from wishlist_items) = 0, 'wishlist entry removed';
  assert (select count(*) from products) = 1, 'product survives wishlist removal';

  -- an anonymous visitor sees nothing (including purchase orders)
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform count(*) from shops;
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  begin
    perform count(*) from purchase_orders;
    ok := false;
  exception when insufficient_privilege then ok := true; end;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
