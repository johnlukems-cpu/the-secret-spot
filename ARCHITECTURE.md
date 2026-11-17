# Architecture

## Overview

```
Browser ──► Next.js (Vercel)
             ├─ Server Components: read data with the *user's* Supabase session (RLS applies)
             ├─ Server Actions:    validate with Zod → call Postgres functions (RPC)
             ├─ Route handlers:    PDFs, CSV exports, cron
             └─ Middleware:        refreshes auth cookie, gates /admin and /account
                     │
                     ▼
            Supabase: PostgreSQL (+RLS) · Auth · Storage
```

### Key decision: business logic lives in the database

All money- and stock-changing operations are PL/pgSQL functions (`supabase/migrations/…06_business_functions.sql`), for example `create_order`, `verify_payment`, `record_payment`, `cancel_order`, `run_expiry_jobs`, `adjust_inventory`, `receive_shipment` and `allocate_shipment_costs`. Each one:

* runs in **one transaction** with **row locks** (`SELECT … FOR UPDATE`) on inventory and orders, which prevents overselling and double-batching;
* **recomputes prices** from product data, so the browser never supplies prices or totals;
* checks permissions itself (`require_permission`), so a bug in the UI cannot bypass authorisation;
* writes audit history (`audit_logs`, `payment_events`, `inventory_movements`; all append-only).

The Next.js layer validates input, handles files and renders UI.

### Supabase clients

| Client | Where | Used for |
|---|---|---|
| `lib/supabase/server.ts` | server | Everything done *as the user* (admin modules, account). RLS and DB permission checks apply. |
| `lib/supabase/admin.ts` (service role) | server only | Checkout (`create_order`), payment-proof upload, cron, staff invitations. Runs only after Zod validation, rate limiting and access checks. |
| `lib/supabase/client.ts` | browser | Not needed for data; available for future realtime features. |

### Roles & permissions

Eight roles (`app_role` enum) are mapped to about 30 permission codes in `role_permissions`. `has_permission()` is used in RLS policies and inside functions. The UI hides modules with the same codes (`lib/auth.ts`), but enforcement happens in the database.

### Internationalisation

All customer copy is Dutch. Database tables have `*_en` columns (categories, products) and `notification_templates.locale`, `profiles.locale`. Labels are centralised in `lib/labels.ts`. Adding English means adding a locale segment and translated label maps; the schema doesn't need to change.

### Notifications

DB functions queue rows in `notifications` (rendered from editable templates). `lib/notifications.ts` dispatches them after actions and on the cron job: e-mail via Resend, WhatsApp via the Meta Cloud API. Without credentials, messages are marked `skipped_not_configured`; the app never claims they were sent. WhatsApp click-to-chat links are the fallback.

### Scheduled jobs

`/api/cron/maintenance` (Vercel Cron, Bearer `CRON_SECRET`): expires unpaid orders and quotations, releases reservations, dispatches notifications.

### Documents

PDFs are generated server-side with `pdf-lib`: quotation/order summary, delivery receipt, purchase order and report. CSV exports are protected against formula injection.
