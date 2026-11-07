# Clean-slate procedure: execution guide

Goal: remove only the test/business data from the shared workspace. Accounts, workspace, members/roles, settings,
schema, RLS policies, `saved_views` and `export_profiles` are never touched.

> Nothing here has been run against your Supabase project. The scripts were run against a disposable PostgreSQL
> (PGlite, see "What was and was not tested") and must be run by you in the Supabase SQL Editor.

## 0. Before you start

1. Tell your partner not to use the app until step 5 is done. (The scripts also block writers while they run, but a
   partner mid-import would make a script abort, which is safe but wastes a round.)
2. Take a **full** backup. The in-database snapshot in step 2 is data-only and lives in the same database, so it does
   not protect you if the project itself is lost. Pick one:
   - Supabase Dashboard -> Database -> Backups (daily backups exist on paid plans; Pro and above also offer point-in-time recovery).
   - CLI (needs `supabase login` + `supabase link`, or a connection string from Project Settings -> Database; that string contains your DB password, so keep it to yourself):
     - `supabase db dump -f full_schema.sql`
     - `supabase db dump --data-only -f full_data.sql` (add `--use-copy` for large tables)
   - `pg_dump "<connection string>" -Fc -f full_backup.dump`
3. Open Supabase -> SQL Editor. It runs as the `postgres` owner role, which the scripts need
   (they lock tables, pause triggers and restart counters).

## 1. Step 2: in-database data snapshot — `cleanup_02_backup.sql`

Paste the whole file, run it. Expected result grid: 19 rows with `status = OK` (18 tables + `auth.users(id,email)`) and a
last row `OVERALL = BACKUP VERIFIED`.

- It compares the **content** of every row (MD5 fingerprint of each row as JSON), not just row counts.
- It stops with "already exists" if `backup_20261103` exists, and leaves that earlier backup untouched.
  For a second backup, replace `backup_20261103` with a new name in steps 2, 3 and 4 (every occurrence).
- It is data-only: no schema, functions, policies, or `auth` data. `auth.users` is only fingerprinted (id, email).
- If it errors, nothing is created (one transaction). If the editor leaves the session in an aborted state, run `rollback;`.

## 2. Step 2b: JSON export — `cleanup_02b_export_json.sql`

Run it on its own, then use "Download CSV" in the result grid and save the file outside the database.

- The data is split into 200-row chunks and the last row is a manifest, so a truncated grid is detectable.
- Verify the downloaded file: `node supabase/maintenance/verify_json_export.mjs path/to/export.csv`.
  It must print `EXPORT VERIFIED`. If it prints `EXPORT NOT VERIFIED`, do not rely on that file; use `pg_dump` instead.
- With tens of thousands of price records the grid limit (about 1000 rows) can truncate the export; the verifier
  will say so. Use `supabase db dump --data-only` for that case.

## 3. Step 3: cleanup — `cleanup_03_execute.sql` (destructive)

Only after steps 0-2 passed. Paste the whole file and run it once.

What it checks before deleting anything (any failure raises an error and rolls everything back):

- exactly one workspace;
- the backup exists, every backup table still matches its manifest fingerprint, and every live table still equals the backup row for row;
- the exact approved counts: shops 2, import_jobs 2, import_rows 232, surveys 2, products 109, price_records 218,
  match_decisions 109, product_aliases 218, import_mapping_presets 2, audit_events 335, and 0 for wishlist_items,
  opportunity_status, match_rejections, product_identifiers;
- trigger states equal what step 2 recorded.

Then it:

- takes table locks (blocks concurrent imports/edits; waits at most 10 s, otherwise errors and rolls back);
- looks up the triggers that fire on DELETE for these tables in `pg_trigger` (no names are assumed) and refuses to
  continue if any of them is not `public.audit_row`; it pauses only those that are currently enabled;
- deletes in dependency order, restores every trigger to its exact original state (enabled / disabled / replica / always);
- restarts `shop_no`, `survey_no`, `product_no` at 1 (`last_value = 1, is_called = false`, so no value is consumed);
- re-checks all tables are empty, kept tables are byte-identical, triggers and other sequences are unchanged,
  and only then commits.

If it stops with an error, nothing was changed: read the message, run `rollback;` if the editor asks, and send it to me.
Typical safe aborts: "Count mismatch" (someone used the app, so the counts moved) or "Live table ... changed after the
backup" (re-run step 2 under a new schema name), "Unexpected DELETE trigger" (there is a trigger the migrations do not define).

The earlier version paused `audit_export_profiles` although `export_profiles` is never deleted from: that was a
mistake (a hard-coded trigger list). Triggers are now discovered from the catalog and only those on tables being
emptied are touched.

## 4. Step 4: verify — `cleanup_04_verify.sql`

Run it before anyone uses the app again (a first login-driven write legitimately makes `audit_events` non-empty).
Every row must be `pass = true` and the last row `OVERALL: ALL CHECKS PASSED`:

- all business tables are empty, no pending match reviews, no orphans (every dependent table is 0);
- workspace (with settings), workspace_members (roles), `auth.users`, `saved_views`, `export_profiles` match the verified backup;
- every trigger is in its original state;
- the three counters read `1,false` (`last_value`, `is_called`) straight from the sequences, so the next numbers are 1,
  and every other sequence is unchanged; the script never calls `nextval`;
- the backup schema is still intact.

## 5. After cleanup (in the app, with your login)

1. Sign in as each partner: both reach the same workspace; the dashboard shows empty states.
2. Add a shop; the first shop should be #1.
3. Import a small CSV/XLSX (e.g. `docs/samples/test-shop-a.csv`, `test-shop-b.csv`); products get created and matched,
   Compare shows offer ranking; delete test data again only if you want (ask me, do not reuse step 3: its counts are specific to today).
4. When satisfied, you may drop the snapshot: `drop schema backup_20261103 cascade;` (keep it for a few days, it is small).

## What was and was not tested

Tested (disposable PostgreSQL via PGlite, with the project's real migrations 0001-0003 and Supabase `auth` stubs;
run `npm i --no-save @electric-sql/pglite@0.3.14` then `node supabase/maintenance/tests/scripts.test.mjs` and
`node supabase/maintenance/tests/export.test.mjs`): backup verification and never-overwrite; refusal without a backup, after
live changes, after a tampered backup, on count mismatch and on an unknown DELETE trigger; full rollback of deletes,
trigger changes and counters on a mid-run failure; the happy path with original trigger states `D` / `A` / `R` preserved;
kept tables unchanged; counters at `1,false` and the next inserts getting number 1; the verifier detecting leftovers; the
JSON export and its truncation/corruption detection.

Not tested: concurrent writers (the lock statements run, but PGlite has a single connection, so real blocking was not
exercised); the Supabase SQL Editor itself (how it displays multi-statement results, and its role privileges); your actual
database (its real trigger list, ownership, extra objects). The scripts are written to abort rather than guess in those cases.
