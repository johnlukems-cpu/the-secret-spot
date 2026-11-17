# Security

## Controls
* **Authentication:** Supabase Auth (e-mail + password, e-mail confirmation, password reset). Sessions are kept in httpOnly cookies via `@supabase/ssr`; middleware refreshes them.
* **Authorisation in the database:** RLS is enabled on **every** table. Policies use `has_permission()`. All state-changing business functions call `require_permission()`. Hiding UI is only cosmetic.
* **Privilege escalation:** only a super admin can grant `admin`/`super_admin` (`assign_role`).
* **Server-side pricing:** totals, discounts and deposits are computed in Postgres. Client-supplied prices are ignored (tested).
* **Guest order access:** random 192-bit token (stored as SHA-256 hash) or order number + last 7 phone digits. Lookups are rate limited. Unknown and unauthorised lookups return the same error.
* **Payment proofs:** server-side upload after access check. File type is verified by magic bytes (JPG/PNG/WEBP/PDF), max 10 MB, stored in a private bucket, and staff view them through 10-minute signed URLs.
* **Confidential data:** supplier prices live only in `supplier_products` (staff RLS). Inventory costs are not public (the public `variant_stock` view exposes availability only). Bank accounts are readable only with `settings.bank`; checkout gets approved fields through `checkout_bank_instructions()`.
* **Secrets:** the service-role key is imported only from `server-only` modules. `.env*` files are git-ignored.
* **Rate limiting** (Postgres, works across serverless instances): checkout, payment submission, tracking, login, registration, password reset, newsletter, contact.
* **Audit trail:** `audit_logs`, `payment_events`, `inventory_movements` and `payment_allocations` are append-only (enforced by triggers).
* **Headers:** HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. Admin and account pages are `noindex`.
* **Input validation:** Zod on every server action, plus CHECK constraints in the DB. CSV exports neutralise formula injection; content links must be relative or https.
* **Never stored:** bank login credentials, PINs, card data.
* **Tracking:** analytics load only after explicit consent.

## Reporting a vulnerability
E-mail the owner (see Business Settings) with details. Don't open a public issue.

## Known limitations / recommendations
* Add a Content-Security-Policy once the final analytics and image hosts are known.
* Enable Supabase MFA for staff accounts and leaked-password protection.
* Turn on Point-in-Time Recovery (see DEPLOYMENT.md).
* A DAST scan (e.g. HawkScan/ZAP) against staging is recommended before launch; it has not been run yet.
