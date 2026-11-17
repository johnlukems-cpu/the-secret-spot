# Testing

| Suite | Command | Needs | Count |
|---|---|---|---|
| Unit (pricing engine, allocation, formatting) | `npm run test:unit` | nothing | 12 |
| Database integration (business scenarios, RLS, authorisation) | `npm run test:db` | PostgreSQL 15+ superuser | 31 |
| E2E: responsive (iPhone/Android/tablet/desktop), security headers, protected APIs | `npm run test:e2e` | running app | 44 |
| E2E: live checkout & admin flows | `E2E_LIVE=1 npm run test:e2e` | app connected to seeded Supabase + admin login | 6 (skipped otherwise) |

## Database tests
`tests/db/global-setup.ts` recreates database `tss_test`, applies `scripts/supabase-shim.sql` (Supabase-compatible `auth` schema and `anon`/`authenticated`/`service_role`/`authenticator` roles), all migrations and the seed. Tests connect as `authenticator` and switch role and JWT claims per request, exactly like PostgREST, so RLS and grants are really exercised.

```bash
DB_SUPERUSER_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

## Brief scenarios → tests
| # | Scenario | Test |
|---|---|---|
| 1 | In-stock purchase with deposit | business-scenarios › TEST 1 (+ ignores client prices) |
| 2 | Pre-order with deposit | TEST 2 (+ mixed cart, coming-soon refused) |
| 3 | Reject invalid proof | TEST 3 |
| 4 | Confirm real bank payment | TEST 4 (permissions, amount correction) |
| 5 | Stock decreases on fulfilment | TEST 5 & 7 |
| 6 | Race for the last item | TEST 6 (3 concurrent checkouts, 1 succeeds) |
| 7 | Balance paid at delivery | TEST 5 & 7 (+ partial payments, receivable) |
| 8 | Weekly report includes eligible pre-orders | TEST 8–10, 14 |
| 9 | Shipment with multiple POs | TEST 8–10, 14 |
| 10 | Import cost allocation | TEST 8–10, 14 (value & weight) |
| 11 | Access to another customer's order | TEST 11 & 12 |
| 12 | Unauthorised staff & financial settings | TEST 11 & 12 |
| 13 | Cancellation releases reservation | TEST 13 |
| 14 | Partial shipment arrival | TEST 8–10, 14 |
| 15 | Expired quotation | TEST 15 |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit + DB tests against a Postgres service, build and the no-backend E2E suite.
