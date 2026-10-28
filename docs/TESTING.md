# Testing

## Automated (run with `npm test`) — 52 tests, all logic-level, no network

`src/lib/core.test.ts` covers: title/unit normalization (100g = 100 GM = 100 Gram; 100mg ≠ 100g ≠ 100ml; 50g ≠ 100g; pack sizes; natural sort), discount/scheme maths (percent, flat, X+Y bonus, no double counting on net prices, stacking only when confirmed, invalid/missing), matching (codes, barcode vs description conflicts, formatting/case/spaces, strengths/pack sizes/manufacturers, ambiguity, saved decisions reused, **rejected pairs never re-suggested**, policy), the import pipeline (CSV, XLSX, missing headers, bad numbers, duplicates, missing title/price, mapping suggestions, repeat import creates no new products, PDF/image rejection), comparison (lowest *effective* cost, ties, unrankable offers, freshness, per-gram, history, opportunities) and export (selected, best-only, column order, Unicode, quotes/newlines, BOM, formula neutralising, XLSX round trip).

## NOT automated / NOT yet run (need your Supabase project and real devices)

| Item | How to verify |
|---|---|
| Database schema, RLS, `commit_import` | Run both migrations; then run `supabase/tests/two_user_test.sql` in the SQL editor (rolls back automatically). It has **not** been executed by me: no Postgres was available. |
| Login, sessions, two real accounts | Manual, see checklist. |
| Real-time sync | Not implemented: the other partner's changes appear after **Refresh** (or when the tab regains focus after 20 s). |
| Android layout, install as PWA | Manual on your phone. Layout was written mobile-first but **not tested in a browser**. |
| Large files | Parsing runs on the main thread; a 20k-row sheet may freeze the phone for a few seconds. Untested at scale. |

## Mapping of the 15 acceptance tests

| # | Requirement | Covered by |
|---|---|---|
| 1–2 | A imports, B sees it | Single shared database + RLS; **verify manually** and via `two_user_test.sql` |
| 3–4 | A confirms match, B sees mapping | `match_decisions` shared table; `two_user_test.sql`; manual |
| 5–6 | B adds wishlist, A sees it | `wishlist_items` shared; `two_user_test.sql`; manual |
| 7 | Same best price for both | Deterministic function of shared rows (unit test "both users compute the same result") |
| 8 | 50g not merged with 100g | unit tests |
| 9 | Different strengths separate | unit tests |
| 10 | Conflicting manufacturer / identifiers flagged | unit tests (`needs_review`, `conflicting`) |
| 11 | Confirmed mapping reused | unit test |
| 12 | Rejected mapping not reintroduced | unit test + `reject_match` in DB |
| 13 | History across surveys | unit test + product detail page; manual |
| 14 | Removing wishlist keeps product + history | DB: wishlist delete touches only `wishlist_items`; `two_user_test.sql` |
| 15 | Two devices, one workspace | manual |

## Checklist before visiting the market (≈20 min, do it tonight)

1. Create the Supabase project, run both migrations, disable sign-ups, create both accounts (docs/SETUP.md).
2. Run `supabase/tests/two_user_test.sql` — expect `NOTICE: ALL CHECKS PASSED`.
3. Deploy (or `npm run dev` and use your PC's address on the same Wi-Fi) and open it on your **Android phone**. Install it to the home screen.
4. Sign in as yourself. Add a shop "Test Shop A".
5. Import `docs/samples/test-shop-a.csv` (dummy data, not real prices). Check the mapping step suggests columns, validation shows 1 bad-price row and 1 duplicate, the matching step shows the "Panadol" row needing review.
6. Import `docs/samples/test-shop-b.xlsx-style` file `test-shop-b.csv` for "Test Shop B" (different header names). Matching should link the 100g rows to Shop A's products and keep 50g separate.
7. Compare: confirm the cheaper effective cost is green with BEST PRICE, and a "10+1" offer is calculated as price × 10 ÷ 11.
8. Star a product to the wishlist; sign in as your partner on another device; confirm they see the shops, products, prices, wishlist; have them reject/confirm one match and refresh on yours.
9. Export best prices to CSV and open it in Excel; confirm columns and Urdu/Unicode text look right.
10. Delete the dummy shops' data? There is no "delete import" button: ask the admin to archive "Test Shop A/B" (price records can be archived by the admin from the database/Supabase table editor) or create a fresh Supabase project for production data.
11. Check the app on bad mobile data: it needs internet and shows an error banner when it can't load. It does not work offline.
