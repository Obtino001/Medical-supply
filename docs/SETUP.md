# Setup, deployment and hosting

## 1. Create the Supabase project (≈10 min)

1. Create a project at supabase.com (pick the region closest to Pakistan, e.g. Mumbai / Singapore).
2. **SQL Editor → New query**: paste and run, in order:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_wishlist_rejections.sql`
3. **Authentication → Providers → Email**: keep Email enabled, **turn OFF "Allow new users to sign up"** (also called *Enable sign ups*). This is what stops strangers creating accounts. Under *Confirm email*, either leave it on and use "Auto confirm" below, or turn it off.
4. **Create the two accounts** (Authentication → Users → *Add user → Create new user*, tick *Auto Confirm User*):
   - **You first**: the first account created becomes **Admin** of the one shared workspace.
   - **Your partner second**: automatically joins the same workspace as **Partner**.
   - A third account is rejected by the database (workspace cap = 2).
   Each person has their own email + password. Nobody shares a password.
5. **Settings → API**: copy the *Project URL* and the *anon public* key.
   **Never** copy the `service_role` key into this app, Vercel variables, or any `VITE_*` variable.

## 2. Run locally

```bash
npm install
cp .env.example .env      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
npm test                  # unit tests (52)
npm run build             # type-check + production build into dist/
```

## 3. Deploy the frontend

**Vercel** (or Netlify / Cloudflare Pages):
1. Push the repo to GitHub, import it in Vercel (framework preset: Vite, build `npm run build`, output `dist`).
2. Add the two environment variables from `.env.example` (Production + Preview).
3. Deploy. `vercel.json` already rewrites all routes to `index.html`.
4. In Supabase → Authentication → URL Configuration, set *Site URL* to your deployed URL.
5. Open the URL on Android Chrome → menu → **Install app**.

## 4. Which hosting plan for a commercial business?

- **Vercel Hobby (free) is for non-commercial / personal use only.** Your wholesale business is commercial, so use **Vercel Pro** (about US$20 per user per month at time of writing; check current pricing) if you host on Vercel.
- **Cheaper alternatives that are fine technically:** *Cloudflare Pages* (free tier allows commercial use), *Netlify* (check current terms), or any static host / a VPS with nginx. The app is a static site: `dist/` can be served from anywhere.
- **Supabase:** the free plan works technically, but projects pause after a week of inactivity and have **no automatic backups**. For real business data use **Supabase Pro** (about US$25/month) which includes daily backups. Verify current terms and prices on their pricing pages before deciding.
- Whatever you choose, also use the in-app **Export → Full backup** weekly.

## 5. Backups and restore

- Export center → *Download full backup (.xlsx)*: all shops, surveys, products, prices, wishlist, saved matches.
- Supabase Pro: daily automatic backups + point-in-time recovery add-on.
- Restoring from the xlsx is manual (it's a safety copy for reading / re-import), not a one-click restore.

## 6. Security model (summary)

- Every table has Row Level Security. Only members of the workspace can read or write; the check is in the database, not the UI.
- Admin-only in the database: editing shops, editing/archiving price records, deleting most records, changing member roles, workspace settings.
- Partner can: add shops, import, correct matches (via safe database functions), manage wishlist, notes, exports.
- Wishlist entries and rejected matches can be removed by either partner; removing them never deletes products or price history.
- Audit trail (`audit_events`) records who changed shops, surveys, products, prices, imports, wishlist, export profiles.
- Simultaneous edits: edits on shops, products, wishlist items and surveys are rejected with a clear message if the other partner changed the same record first (optimistic check on `updated_at`); the screen then refreshes.

## 7. Replace the placeholder icons

`public/icon-192.png`, `public/icon-512.png` and `public/icon.svg` are placeholders. Replace with your own square PNGs of the same names/sizes; no code change needed.
