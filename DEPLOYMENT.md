# Deployment

## 1. Supabase (production)
1. Create a project at supabase.com (choose the region closest to Suriname, e.g. `us-east-1`).
2. Apply the database. **Without CLI:** open SQL Editor and run, in order, the files in `supabase/setup/`:
   `01_schema.sql` → `02_configuration.sql` → (optional) `03_demo_products_optional.sql`.
   **With CLI:** `supabase link --project-ref <ref>` then `supabase db push` (and run `02_configuration.sql`).
   The setup files are generated from `supabase/migrations` with `python3 scripts/build-setup-sql.py`; regenerate after changing a migration.
3. Archive the `[DEMO]` products before going live (Admin → Producten).
4. Auth → URL configuration: Site URL `https://<your-domain>`, redirect URL `https://<your-domain>/auth/callback`. Configure SMTP (Auth → SMTP) so confirmation and invitation e-mails come from your domain.
5. Storage: the buckets `product-images`, `payment-proofs` and `documents` are created by migration 07. Check that they exist.
6. Create your account on the website, then run `supabase/setup/04_make_me_super_admin.sql` with your e-mail.

## 2. Vercel
1. Import the Git repository. Framework: Next.js. Node 20+.
2. Add the environment variables from [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) (Production + Preview).
3. Deploy. `vercel.json` registers the cron job `/api/cron/maintenance` every 15 minutes. **Vercel Hobby only allows daily cron jobs**: on Hobby, either upgrade or schedule it in Supabase instead:
   ```sql
   -- Supabase: enable pg_cron + pg_net extensions first
   select cron.schedule('tss-maintenance', '*/15 * * * *', $$ select public.run_expiry_jobs(); $$);
   ```
   (pg_cron runs as `postgres`, which `run_expiry_jobs` accepts. Notification dispatch then runs after each customer/staff action and via the admin "Wachtrij nu versturen" button.)
4. Add your domain and update `NEXT_PUBLIC_SITE_URL` and the Supabase redirect URLs.

## 3. Backups
* Supabase Pro includes daily backups; enable **Point-in-Time Recovery** for financial data.
* Additionally schedule a weekly logical dump stored outside Supabase:
  `pg_dump "$DATABASE_URL" --format=custom --file=tss-$(date +%F).dump`
* Payment proofs live in Storage; include the bucket in your backup routine (e.g. `supabase storage` CLI or S3-compatible sync).
* Test a restore at least once per quarter.

## 4. Go-live checklist (owner input required)
- [ ] Bank account(s) in Admin → Bankgegevens, marked *show at checkout*
- [ ] Deposit percentages, payment deadline, quote validity (Admin → Bedrijfsinstellingen)
- [ ] Cancellation & refund policy text (reviewed for consumer law)
- [ ] Delivery fees per district / free-delivery thresholds
- [ ] Store WhatsApp number, e-mail, social links
- [ ] Exchange rates (CNY/USD/EUR → SRD) with source and date
- [ ] Pricing defaults: customs/import tax percentages as they actually apply
- [ ] Suppliers and supplier prices
- [ ] Real products and photos; archive the `[DEMO]` products
- [ ] Privacy text (Admin → Website content → page `privacy`)
- [ ] Resend API key + verified sending domain; WhatsApp Business API (Meta app, phone number ID, approved templates)
- [ ] Staff accounts with the right roles
- [ ] Run `E2E_LIVE=1 npm run test:e2e` against staging
