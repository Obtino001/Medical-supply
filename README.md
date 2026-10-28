# Wholesale Price Intelligence

Mobile-first market price comparison for a medical wholesale business: import supplier price lists (CSV / Excel), match products carefully, compute effective costs (discounts and bonus schemes), highlight the best price, keep a shared wishlist, and export to CSV / Excel for a separate ERP.

React + Vite + TypeScript + Tailwind, Supabase (Postgres + Auth + Row Level Security).

- Setup, deployment, hosting plans, backups: [docs/SETUP.md](docs/SETUP.md)
- Tests, what is and isn't verified, pre-market checklist: [docs/TESTING.md](docs/TESTING.md)
- Dummy price lists for trying the flow: `docs/samples/`

Quick start: `npm install`, copy `.env.example` to `.env`, run the two SQL files in `supabase/migrations/` in Supabase, `npm run dev`.
