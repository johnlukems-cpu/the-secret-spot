import { afterAll, describe, expect, it } from "vitest";
import { apiPool, as, anon, createUser, makeProduct, placeOrder, submitPayment, superPool, verify } from "./helpers";

afterAll(async () => {
  await apiPool.end();
  await superPool.end();
});

describe("reporting & staff helpers", () => {
  it("report_data and outstanding_balances require permissions", async () => {
    const reporter = await createUser(["inventory_manager"]); // has reports.view, not finance.view
    const r = await as(reporter, (c) => c.query("select public.report_data(current_date - 30, current_date) r"));
    expect(Array.isArray(r.rows[0].r.sales_by_day)).toBe(true);
    await expect(as(reporter, (c) => c.query("select * from public.outstanding_balances()"))).rejects.toThrow(/permission denied/);
    await expect(as(anon, (c) => c.query("select public.report_data(current_date - 30, current_date)"))).rejects.toThrow(/permission denied/);
  });

  it("staff_directory is staff-only", async () => {
    const customer = await createUser([]);
    await expect(as(customer, (c) => c.query("select * from public.staff_directory()"))).rejects.toThrow(/staff only/);
    const staff = await createUser(["delivery_manager"]);
    const r = await as(staff, (c) => c.query("select * from public.staff_directory()"));
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it("customer_overview respects RLS (security_invoker)", async () => {
    const customer = await createUser([]);
    const r = await as(customer, (c) => c.query("select * from public.customer_overview"));
    expect(r.rowCount).toBe(0);
  });

  it("delivery manager can read payments collected on deliveries only", async () => {
    const finance = await createUser(["finance_manager"]);
    const driver = await createUser(["delivery_manager"]);
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 1 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    const pay = await submitPayment(o, 500);
    await verify(finance, pay.payment_id);
    const d = (await superPool.query("select id from public.deliveries where order_id = $1", [o.order_id])).rows[0];
    const before = await as(driver, (c) => c.query("select id from public.payments where order_id = $1", [o.order_id]));
    expect(before.rowCount).toBe(0);
    await as(driver, (c) => c.query("select public.record_payment($1, 500, 'cash', null, $2)", [o.order_id, d.id]));
    const after = await as(driver, (c) => c.query("select id from public.payments where order_id = $1", [o.order_id]));
    expect(after.rowCount).toBe(1);
  });

  it("next_po_number requires purchasing rights", async () => {
    const buyer = await createUser(["purchasing_manager"]);
    const r = await as(buyer, (c) => c.query("select public.next_po_number() n"));
    expect(r.rows[0].n).toMatch(/^PO-\d{4}-\d{6}$/);
    const other = await createUser(["delivery_manager"]);
    await expect(as(other, (c) => c.query("select public.next_po_number()"))).rejects.toThrow(/permission denied/);
  });

  it("audit log and inventory movements are append-only", async () => {
    await expect(superPool.query("update public.audit_logs set note = 'x' where id = (select min(id) from public.audit_logs)")).rejects.toThrow(/append-only/);
    await expect(superPool.query("delete from public.inventory_movements where id = (select min(id) from public.inventory_movements)")).rejects.toThrow(/append-only/);
  });

  it("customers cannot write orders or payments directly", async () => {
    const u = await createUser([]);
    await expect(as(u, (c) => c.query("update public.orders set total = 1"))).resolves.toMatchObject({ rowCount: 0 });
    const anyOrder = (await superPool.query("select id from public.orders limit 1")).rows[0].id;
    await expect(as(u, (c) => c.query("insert into public.payments (payment_number, order_id, amount) values ('X', $1, 1)", [anyOrder]))).rejects.toThrow(/row-level security/);
    await expect(as(u, (c) => c.query("insert into public.orders (order_number, customer_id, customer_name, customer_whatsapp, district, delivery_address, subtotal, total, deposit_ready_pct, deposit_preorder_pct, deposit_required, access_token_hash) select 'X', id, 'x', 'x', 'x', 'x', 0, 0, 0, 0, 0, 'x' from (select gen_random_uuid() id) s"))).rejects.toThrow(/row-level security|foreign key/);
  });
});
