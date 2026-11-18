# THE SECRET GIRL — YOUR STYLE. YOUR SECRET.

E-commerce and retail-management platform for an online family-fashion and import business in Suriname. It covers the storefront, checkout with bank-transfer deposits, manual payment verification, ready-stock inventory, pre-orders, purchasing from Chinese suppliers, shipment tracking, landed-cost allocation, nationwide delivery and financial reporting.

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS · shadcn-style UI · Supabase (PostgreSQL, Auth, Storage, RLS) · Vercel.

## Quick start (local)

```bash
npm install
cp .env.example .env.local      # fill in Supabase keys
supabase start                  # local Supabase (Docker) – applies migrations + seed
npm run dev                     # http://localhost:3000
```

Make yourself super administrator after registering (SQL editor):

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'you@example.com';
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript strict / ESLint |
| `npm test` | Unit tests + database tests (needs PostgreSQL, see TESTING.md) |
| `npm run test:e2e` | Playwright (needs a running app) |

## Project layout

```
src/app/(store)        Customer website (Dutch): home, catalogue, product, cart, checkout, order tracking, account
src/app/admin          Admin dashboard (22 modules)
src/app/api            PDFs, CSV exports, cron
src/lib                Supabase clients, auth/permissions, pricing engine, PDF, notifications, validation
supabase/migrations    Database schema, business functions, RLS (source of truth)
supabase/seed.sql      Configuration defaults + [DEMO] products
tests/unit|db|e2e      Vitest unit, PostgreSQL integration, Playwright
```

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [DATABASE_SCHEMA](DATABASE_SCHEMA.md) · [BUSINESS_RULES](BUSINESS_RULES.md) · [DEPLOYMENT](DEPLOYMENT.md) · [ENVIRONMENT_VARIABLES](ENVIRONMENT_VARIABLES.md) · [TESTING](TESTING.md) · [ADMIN_GUIDE](ADMIN_GUIDE.md) · [SECURITY](SECURITY.md)

## What the owner must still provide

See **Go-live checklist** in [DEPLOYMENT.md](DEPLOYMENT.md): Supabase project, bank account details, deposit percentages, cancellation policy, delivery fees, exchange rates, real products/photos, e-mail and WhatsApp API credentials, legal texts.
