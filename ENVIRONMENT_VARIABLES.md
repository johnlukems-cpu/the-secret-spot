# Environment variables

| Variable | Scope | Required | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | yes | Canonical URL, e.g. `https://thesecretspot.sr` (SEO, auth redirects, sitemap) |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | Supabase anon key (safe in browser; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | yes | Service role key. Used only in server code (`lib/supabase/admin.ts`, `server-only`). Never expose. |
| `CRON_SECRET` | **server** | yes | Bearer token for `/api/cron/maintenance` (Vercel sends it automatically) |
| `IP_HASH_SALT` | **server** | recommended | Salt for hashing IPs in rate limiting |
| `RESEND_API_KEY` | **server** | optional | E-mail sending. Without it, e-mails are logged as "not configured". |
| `EMAIL_FROM` | **server** | with Resend | Verified sender, e.g. `THE SECRET GIRL <info@domain>` |
| `WHATSAPP_ACCESS_TOKEN` | **server** | optional | Meta WhatsApp Cloud API permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | **server** | optional | WhatsApp sender phone number ID |
| `WHATSAPP_API_VERSION` | server | optional | Graph API version (default `v21.0`) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | public | optional | Google Analytics, loaded only after consent |
| `NEXT_PUBLIC_META_PIXEL_ID` | public | optional | Meta Pixel, loaded only after consent |

Test-only: `DB_SUPERUSER_URL`, `TEST_DB_NAME`, `E2E_BASE_URL`, `E2E_LIVE`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`.

Rules: never commit `.env*` files (`.gitignore` covers them); never prefix secrets with `NEXT_PUBLIC_`; rotate the service-role key if it is ever exposed.
