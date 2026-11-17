import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const base = process.env.DB_SUPERUSER_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbName = process.env.TEST_DB_NAME ?? "tss_test";
const superUrl = base.replace(/\/[^/]*$/, `/${dbName}`);
const u = new URL(superUrl);
// API-like connection: logs in as "authenticator" and switches role per request, like PostgREST.
const apiUrl = `postgres://authenticator:authenticator@${u.host}/${dbName}`;

export const superPool = new Pool({ connectionString: superUrl, max: 4 });
export const apiPool = new Pool({ connectionString: apiUrl, max: 8 });

export type Actor =
  | { kind: "anon" }
  | { kind: "service" }
  | { kind: "user"; id: string };

/** Run fn inside a transaction as the given API actor; commits on success. */
export async function as<T>(actor: Actor, fn: (c: PoolClient) => Promise<T>, opts: { rollback?: boolean } = {}): Promise<T> {
  const c = await apiPool.connect();
  try {
    await c.query("begin");
    const role = actor.kind === "anon" ? "anon" : actor.kind === "service" ? "service_role" : "authenticated";
    const claims = actor.kind === "user" ? { sub: actor.id, role } : { role };
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await fn(c);
    await c.query(opts.rollback ? "rollback" : "commit");
    return res;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const service: Actor = { kind: "service" };
export const anon: Actor = { kind: "anon" };

export async function createUser(roles: string[] = [], email?: string): Promise<Actor & { id: string }> {
  const id = randomUUID();
  await superPool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id, email ?? `${id}@example.test`, { full_name: "Test User" },
  ]);
  for (const r of roles) {
    await superPool.query("insert into public.user_roles (user_id, role) values ($1, $2) on conflict do nothing", [id, r]);
  }
  return { kind: "user", id };
}

export async function zoneId(name = "Paramaribo"): Promise<string> {
  const r = await superPool.query("select id from public.delivery_zones where name = $1", [name]);
  return r.rows[0].id;
}

export async function locationId(): Promise<string> {
  const r = await superPool.query("select id from public.storage_locations where code = 'MAIN'");
  return r.rows[0].id;
}

let skuCounter = 0;
/** Creates an isolated active product with one variant (+ stock for ready items). */
export async function makeProduct(opts: {
  salesType?: "ready" | "preorder" | "coming_soon";
  price?: number;
  stock?: number;
  supplierId?: string | null;
  supplierCost?: number;
  depositPct?: number | null;
  categorySlug?: string;
} = {}) {
  skuCounter += 1;
  const sku = `T-${Date.now()}-${skuCounter}`;
  const cat = await superPool.query("select id from public.categories where slug = $1", [opts.categorySlug ?? "dames-jurken"]);
  const p = await superPool.query(
    `insert into public.products (sku, slug, title, sales_type, status, base_price, category_id, default_supplier_id,
                                  deposit_percentage, preorder_lead_days_min, preorder_lead_days_max)
     values ($1, lower($1), 'Test ' || $1, $2, 'active', $3, $4, $5, $6, 28, 42) returning id`,
    [sku, opts.salesType ?? "ready", opts.price ?? 1000, cat.rows[0].id, opts.supplierId ?? null, opts.depositPct ?? null],
  );
  const v = await superPool.query(
    "insert into public.product_variants (product_id, sku, size, color) values ($1, $2, 'M', 'Zwart') returning id",
    [p.rows[0].id, `${sku}-M`],
  );
  if ((opts.salesType ?? "ready") === "ready" && (opts.stock ?? 0) > 0) {
    await superPool.query(
      "insert into public.inventory (variant_id, location_id, physical_qty, unit_cost) values ($1, $2, $3, 400)",
      [v.rows[0].id, await locationId(), opts.stock],
    );
  }
  if (opts.supplierId && opts.supplierCost != null) {
    await superPool.query(
      "insert into public.supplier_products (supplier_id, product_id, variant_id, unit_cost, currency) values ($1, $2, $3, $4, 'CNY')",
      [opts.supplierId, p.rows[0].id, v.rows[0].id, opts.supplierCost],
    );
  }
  return { productId: p.rows[0].id as string, variantId: v.rows[0].id as string, sku };
}

export async function placeOrder(items: { variantId: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  const zone = await zoneId();
  return as(service, async (c) => {
    const r = await c.query("select public.create_order($1) as r", [
      {
        items: items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
        zone_id: zone,
        address: "Teststraat 1",
        customer: { full_name: "Test Klant", whatsapp: "+597 8123456", email: "klant@example.test" },
        ...extra,
      },
    ]);
    return r.rows[0].r as { order_id: string; order_number: string; access_token: string; total: string; deposit_required: string };
  });
}

export async function order(id: string) {
  const r = await superPool.query("select * from public.orders where id = $1", [id]);
  return r.rows[0];
}

export async function inv(variantId: string) {
  const r = await superPool.query(
    "select coalesce(sum(physical_qty),0)::int physical, coalesce(sum(reserved_qty),0)::int reserved, coalesce(sum(available_qty),0)::int available from public.inventory where variant_id = $1",
    [variantId],
  );
  return r.rows[0] as { physical: number; reserved: number; available: number };
}

export async function submitPayment(o: { order_number: string; access_token: string }, amount: number, reference = "BANKREF-1") {
  return as(service, async (c) => {
    const r = await c.query("select public.submit_payment($1, $2, $3, $4) as r", [o.order_number, o.access_token, amount, reference]);
    return r.rows[0].r as { payment_id: string; payment_number: string };
  });
}

export async function verify(actor: Actor, paymentId: string, approve = true, note: string | null = null, amount: number | null = null) {
  return as(actor, (c) => c.query("select public.verify_payment($1, $2, $3, $4)", [paymentId, approve, note, amount]));
}

export async function setRate(from: string, to: string, rate: number, date = "2026-01-01") {
  await superPool.query(
    "insert into public.exchange_rates (from_currency, to_currency, rate, effective_date, source) values ($1,$2,$3,$4,'test') on conflict (from_currency, to_currency, effective_date) do update set rate = excluded.rate",
    [from, to, rate, date],
  );
}

export async function makeSupplier(name = "Test Supplier") {
  const r = await superPool.query("insert into public.suppliers (name, currency) values ($1, 'CNY') returning id", [name]);
  return r.rows[0].id as string;
}
