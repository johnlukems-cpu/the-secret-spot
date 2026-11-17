/**
 * Business scenarios from the build brief (TEST 1–15), executed against the
 * real migrations on PostgreSQL. Each test uses its own products so tests
 * stay independent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiPool, as, anon, createUser, inv, locationId, makeProduct, makeSupplier, order, placeOrder,
  service, setRate, submitPayment, superPool, verify, type Actor,
} from "./helpers";

let finance: Actor;
let delivery: Actor;
let purchasing: Actor;
let admin: Actor;

beforeAll(async () => {
  finance = await createUser(["finance_manager"]);
  delivery = await createUser(["delivery_manager"]);
  purchasing = await createUser(["purchasing_manager"]);
  admin = await createUser(["admin"]);
});

afterAll(async () => {
  await apiPool.end();
  await superPool.end();
});

async function deliveryFor(orderId: string) {
  const r = await superPool.query("select * from public.deliveries where order_id = $1 order by created_at desc limit 1", [orderId]);
  return r.rows[0];
}

describe("TEST 1 – in-stock purchase with deposit", () => {
  it("reserves stock, computes deposit server-side and confirms after verification", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 5 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 2 }]);
    expect(Number(o.total)).toBe(2000);
    expect(Number(o.deposit_required)).toBe(1000); // 50% seeded default
    expect(await inv(p.variantId)).toEqual({ physical: 5, reserved: 2, available: 3 });

    const pay = await submitPayment(o, 1000);
    expect((await order(o.order_id)).payment_status).toBe("proof_submitted");
    await verify(finance, pay.payment_id, true, "Seen on bank statement");

    const after = await order(o.order_id);
    expect(after.payment_status).toBe("deposit_verified");
    expect(after.status).toBe("ready_for_delivery"); // all lines reserved
    expect(Number(after.balance_due)).toBe(1000);
    // reservation no longer expires once the deposit is verified
    const res = await superPool.query("select expires_at from public.stock_reservations where order_id = $1", [o.order_id]);
    expect(res.rows.every((r) => r.expires_at === null)).toBe(true);
    expect(await deliveryFor(o.order_id)).toBeTruthy();
  });

  it("ignores any client-supplied price fields", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 2 });
    const zone = (await superPool.query("select id from public.delivery_zones where name='Paramaribo'")).rows[0].id;
    const r = await as(service, (c) =>
      c.query("select public.create_order($1) r", [{
        items: [{ variant_id: p.variantId, quantity: 1, unit_price: 1 }], total: 1, deposit_required: 0,
        zone_id: zone, address: "x", customer: { full_name: "A", whatsapp: "+5978000000" },
      }]),
    );
    expect(Number(r.rows[0].r.total)).toBe(1000);
  });
});

describe("TEST 2 – pre-order purchase with deposit", () => {
  it("uses the pre-order deposit percentage and a product override", async () => {
    const p = await makeProduct({ salesType: "preorder", price: 1200, depositPct: 60 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    expect(Number(o.deposit_required)).toBe(720);
    const pay = await submitPayment(o, 720);
    await verify(finance, pay.payment_id);
    const after = await order(o.order_id);
    expect(after.status).toBe("confirmed");
    expect(after.payment_status).toBe("deposit_verified");
    const item = (await superPool.query("select * from public.order_items where order_id = $1", [o.order_id])).rows[0];
    expect(item.fulfilment_status).toBe("awaiting_purchase");
    expect(item.estimated_ready_from).not.toBeNull();
  });

  it("separates ready and pre-order lines in a mixed cart", async () => {
    const r = await makeProduct({ salesType: "ready", price: 500, stock: 3 });
    const pr = await makeProduct({ salesType: "preorder", price: 800 });
    const o = await placeOrder([{ variantId: r.variantId, quantity: 1 }, { variantId: pr.variantId, quantity: 1 }]);
    const row = await order(o.order_id);
    expect(Number(row.ready_subtotal)).toBe(500);
    expect(Number(row.preorder_subtotal)).toBe(800);
    expect(row.has_ready && row.has_preorder).toBe(true);
    expect(Number(row.deposit_required)).toBe(650);
  });

  it("refuses coming-soon products", async () => {
    const p = await makeProduct({ salesType: "coming_soon" });
    await expect(placeOrder([{ variantId: p.variantId, quantity: 1 }])).rejects.toThrow(/cart_invalid/);
  });
});

describe("TEST 3 – invalid payment proof is rejected", () => {
  it("requires a reason, records history and does not change balances", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 2 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    const pay = await submitPayment(o, 500, "FAKE");
    await expect(verify(finance, pay.payment_id, false, null)).rejects.toThrow(/rejection_reason_required/);
    await verify(finance, pay.payment_id, false, "Transfer not found on bank statement");
    const after = await order(o.order_id);
    expect(after.payment_status).toBe("rejected");
    expect(after.status).toBe("awaiting_deposit");
    expect(Number(after.amount_verified)).toBe(0);
    const ev = await superPool.query("select event from public.payment_events where payment_id = $1 order by id", [pay.payment_id]);
    expect(ev.rows.map((r) => r.event)).toEqual(["submitted", "rejected"]);
    await expect(superPool.query("delete from public.payment_events where payment_id = $1", [pay.payment_id])).rejects.toThrow(/append-only/);
  });
});

describe("TEST 4 – confirming a real bank payment", () => {
  it("only staff with payments.verify can approve; amount can be corrected to what arrived", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 2 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    const pay = await submitPayment(o, 500);
    await expect(verify(delivery, pay.payment_id)).rejects.toThrow(/permission denied/);
    const customer = await createUser([]);
    await expect(verify(customer, pay.payment_id)).rejects.toThrow(/permission denied/);
    await as(finance, (c) => c.query("select public.mark_payment_under_verification($1)", [pay.payment_id]));
    expect((await order(o.order_id)).payment_status).toBe("under_verification");
    await verify(finance, pay.payment_id, true, "Partial amount arrived", 400);
    const after = await order(o.order_id);
    expect(Number(after.amount_verified)).toBe(400);
    expect(after.payment_status).toBe("partially_paid");
    expect(after.status).toBe("awaiting_deposit"); // deposit (500) not yet met
    await expect(verify(finance, pay.payment_id)).rejects.toThrow(/invalid_payment_state/);
  });
});

describe("TEST 5 & 7 – fulfilment and final payment at delivery", () => {
  it("deducts stock only on delivery and completes once fully paid", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 4 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 2 }]);
    const pay = await submitPayment(o, 1000);
    await verify(finance, pay.payment_id);
    expect(await inv(p.variantId)).toEqual({ physical: 4, reserved: 2, available: 2 });

    const d = await deliveryFor(o.order_id);
    await as(delivery, (c) => c.query("select public.update_delivery_status($1, 'assigned', null, current_date, $2)", [d.id, (delivery as { id: string }).id]));
    await as(delivery, (c) => c.query("select public.update_delivery_status($1, 'out_for_delivery')", [d.id]));
    // TEST 7: balance collected in cash at the door
    const rec = await as(delivery, (c) => c.query("select public.record_payment($1, 1000, 'cash', null, $2) r", [o.order_id, d.id]));
    expect(rec.rows[0].r.receipt_number).toMatch(/^RCT-/);
    expect((await order(o.order_id)).payment_status).toBe("fully_paid");
    await as(delivery, (c) => c.query("select public.update_delivery_status($1, 'delivered')", [d.id]));

    // TEST 5: stock leaves inventory on fulfilment
    expect(await inv(p.variantId)).toEqual({ physical: 2, reserved: 0, available: 2 });
    const after = await order(o.order_id);
    expect(after.status).toBe("completed");
    expect(Number(after.balance_due)).toBe(0);
    const mv = await superPool.query("select quantity, unit_cost from public.inventory_movements where variant_id = $1 and movement_type = 'sale'", [p.variantId]);
    expect(mv.rows[0].quantity).toBe(-2);
    expect(Number(mv.rows[0].unit_cost)).toBe(400);
  });

  it("supports multiple partial payments and refuses over-payment", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 1 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    const pay = await submitPayment(o, 500);
    await verify(finance, pay.payment_id);
    await as(delivery, (c) => c.query("select public.record_payment($1, 200, 'cash')", [o.order_id]));
    expect((await order(o.order_id)).payment_status).toBe("partially_paid");
    await expect(as(delivery, (c) => c.query("select public.record_payment($1, 400, 'cash')", [o.order_id]))).rejects.toThrow(/invalid_amount/);
    // bank transfer recorded at delivery still needs verification
    const bt = await as(delivery, (c) => c.query("select public.record_payment($1, 300, 'bank_transfer', 'REF-9') r", [o.order_id]));
    expect(bt.rows[0].r.verified).toBe(false);
    expect(Number((await order(o.order_id)).amount_verified)).toBe(700);
    await verify(finance, bt.rows[0].r.payment_id);
    expect((await order(o.order_id)).payment_status).toBe("fully_paid");
  });

  it("delivered with outstanding balance becomes a receivable, then completes on payment", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 1 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    await verify(finance, (await submitPayment(o, 500)).payment_id);
    const d = await deliveryFor(o.order_id);
    await as(delivery, (c) => c.query("select public.update_delivery_status($1, 'delivered')", [d.id]));
    expect((await order(o.order_id)).status).toBe("delivered");
    await as(delivery, (c) => c.query("select public.record_payment($1, 500, 'cash', null, $2)", [o.order_id, d.id]));
    expect((await order(o.order_id)).status).toBe("completed");
  });
});

describe("TEST 6 – two customers race for the last item", () => {
  it("exactly one checkout succeeds", async () => {
    const p = await makeProduct({ salesType: "ready", price: 900, stock: 1 });
    const results = await Promise.allSettled([
      placeOrder([{ variantId: p.variantId, quantity: 1 }]),
      placeOrder([{ variantId: p.variantId, quantity: 1 }]),
      placeOrder([{ variantId: p.variantId, quantity: 1 }]),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect(String(f.reason)).toMatch(/insufficient_stock|cart_invalid/);
    expect(await inv(p.variantId)).toEqual({ physical: 1, reserved: 1, available: 0 });
  });

  it("never lets stock go negative", async () => {
    const p = await makeProduct({ salesType: "ready", stock: 1 });
    await expect(superPool.query("update public.inventory set physical_qty = -1 where variant_id = $1", [p.variantId])).rejects.toThrow(/check/);
    const inventory = await createUser(["inventory_manager"]);
    await expect(as(inventory, async (c) => c.query("select public.adjust_inventory($1, $2, 'remove', 5, 'test')", [p.variantId, await locationId()])))
      .rejects.toThrow(/check|below_reserved/);
  });
});

describe("TEST 8–10, 14 – purchasing, shipments and landed cost", () => {
  it("runs the full pre-order import flow with partial arrival and cost allocation", async () => {
    await setRate("CNY", "SRD", 5);
    const supplier = await makeSupplier("Guangzhou Test Co");
    const a = await makeProduct({ salesType: "preorder", price: 1500, supplierId: supplier, supplierCost: 100 });
    const b = await makeProduct({ salesType: "preorder", price: 1000, supplierId: supplier, supplierCost: 60 });

    // three orders: two paid, one unpaid (must NOT be purchased)
    const o1 = await placeOrder([{ variantId: a.variantId, quantity: 2 }]);
    const o2 = await placeOrder([{ variantId: a.variantId, quantity: 1 }, { variantId: b.variantId, quantity: 3 }]);
    const o3 = await placeOrder([{ variantId: b.variantId, quantity: 5 }]);
    await verify(finance, (await submitPayment(o1, Number(o1.deposit_required))).payment_id);
    await verify(finance, (await submitPayment(o2, Number(o2.deposit_required))).payment_id);

    // TEST 8: weekly report includes all eligible, deposit-verified pre-orders only
    const report = await as(purchasing, (c) => c.query("select * from public.purchasing_report() where supplier_id = $1", [supplier]));
    const units = Object.fromEntries(report.rows.map((r) => [r.variant_id, r.total_units]));
    expect(units[a.variantId]).toBe(3);
    expect(units[b.variantId]).toBe(3); // o3 is unpaid
    expect(Number(report.rows.find((r) => r.variant_id === a.variantId).total_supplier_cost)).toBe(300);

    // Batch -> never double-batched
    const batch = (await as(purchasing, (c) => c.query("select public.create_purchase_batch($1) id", [supplier]))).rows[0].id;
    await expect(as(purchasing, (c) => c.query("select public.create_purchase_batch($1) id", [supplier]))).rejects.toThrow(/no_eligible_preorders/);
    const anyItem = (await superPool.query("select order_item_id, variant_id from public.purchase_batch_items where batch_id = $1 limit 1", [batch])).rows[0];
    const otherBatch = (await superPool.query("insert into public.purchase_batches (batch_number, week_start) values ('PB-X-' || gen_random_uuid(), current_date) returning id")).rows[0].id;
    await expect(superPool.query("insert into public.purchase_batch_items (batch_id, order_item_id, variant_id, quantity) values ($1, $2, $3, 1)",
      [otherBatch, anyItem.order_item_id, anyItem.variant_id])).rejects.toThrow(/already batched/);

    const po = (await as(purchasing, (c) => c.query("select public.create_po_from_batch($1) id", [batch]))).rows[0].id;
    await as(purchasing, (c) => c.query("select public.set_purchase_order_status($1, 'ordered')", [po]));
    expect((await superPool.query("select distinct fulfilment_status from public.order_items where order_id = $1", [o1.order_id])).rows[0].fulfilment_status).toBe("purchased");

    // TEST 9: one shipment, products from multiple purchase orders
    const sup2 = await makeSupplier("Yiwu Test Co");
    const c = await makeProduct({ salesType: "preorder", price: 800, supplierId: sup2, supplierCost: 40 });
    const o4 = await placeOrder([{ variantId: c.variantId, quantity: 2 }]);
    await verify(finance, (await submitPayment(o4, Number(o4.deposit_required))).payment_id);
    const batch2 = (await as(purchasing, (cl) => cl.query("select public.create_purchase_batch($1) id", [sup2]))).rows[0].id;
    const po2 = (await as(purchasing, (cl) => cl.query("select public.create_po_from_batch($1) id", [batch2]))).rows[0].id;
    await as(purchasing, (cl) => cl.query("select public.set_purchase_order_status($1, 'ordered')", [po2]));

    const shipment = (await superPool.query("insert into public.shipments (shipment_number, shipping_method, departure_date) values ('SHP-T-' || gen_random_uuid(), 'air', '2026-02-01') returning id")).rows[0].id;
    const poItems = (await superPool.query(
      "select poi.id, poi.variant_id, poi.quantity from public.purchase_order_items poi where purchase_order_id in ($1, $2)", [po, po2])).rows;
    const weights: Record<string, number> = { [a.variantId]: 1.0, [b.variantId]: 0.5, [c.variantId]: 0.25 };
    for (const it of poItems) {
      // a: ship all 3; b and c: ship all
      await superPool.query(
        "insert into public.shipment_items (shipment_id, purchase_order_item_id, variant_id, quantity_shipped, weight_kg) values ($1,$2,$3,$4,$5)",
        [shipment, it.id, it.variant_id, it.quantity, weights[it.variant_id] * it.quantity]);
    }
    // cannot over-ship a PO line
    await expect(superPool.query("insert into public.shipment_items (shipment_id, purchase_order_item_id, variant_id, quantity_shipped) values ($1,$2,$3,1)",
      [shipment, poItems[0].id, poItems[0].variant_id])).rejects.toThrow(/over-shipped/);

    await as(purchasing, (cl) => cl.query("select public.set_shipment_status($1, 'shipped')", [shipment]));
    expect((await order(o1.order_id)).status).toBe("in_transit");

    // TEST 10: actual costs allocated by value. goods value: a 3*100*5=1500, b 3*60*5=900, c 2*40*5=400 -> 2800
    await superPool.query("insert into public.import_costs (shipment_id, cost_type, amount, currency, exchange_rate) values ($1,'shipping',700,'SRD',1),($1,'customs_duty',140,'SRD',1)", [shipment]);
    await superPool.query("insert into public.import_costs (shipment_id, cost_type, amount, currency, exchange_rate, is_estimate) values ($1,'other',9999,'SRD',1,true)", [shipment]);
    const alloc = await as(purchasing, (cl) => cl.query("select public.allocate_shipment_costs($1, 'value') r", [shipment]));
    expect(alloc.rows[0].r.uses_actual_costs).toBe(true);
    expect(Number(alloc.rows[0].r.total_cost_srd)).toBe(840);
    const lines = (await superPool.query("select variant_id, goods_value_srd, allocated_cost_srd, landed_unit_cost_srd from public.shipment_items where shipment_id = $1", [shipment])).rows;
    const byV = Object.fromEntries(lines.map((l) => [l.variant_id, l]));
    expect(Number(byV[a.variantId].allocated_cost_srd)).toBe(450); // 1500/2800*840
    expect(Number(byV[b.variantId].allocated_cost_srd)).toBe(270);
    expect(Number(byV[c.variantId].allocated_cost_srd)).toBe(120);
    expect(lines.reduce((s, l) => s + Number(l.allocated_cost_srd), 0)).toBe(840);
    expect(Number(byV[a.variantId].landed_unit_cost_srd)).toBe(650); // (1500+450)/3

    // weight allocation alternative: a 3kg, b 1.5kg, c 0.5kg = 5kg
    await as(purchasing, (cl) => cl.query("select public.allocate_shipment_costs($1, 'weight')", [shipment]));
    const w = Object.fromEntries((await superPool.query("select variant_id, allocated_cost_srd from public.shipment_items where shipment_id = $1", [shipment])).rows.map((l) => [l.variant_id, Number(l.allocated_cost_srd)]));
    expect(w[a.variantId]).toBe(504);
    expect(w[b.variantId]).toBe(252);
    expect(w[c.variantId]).toBe(84);
    await as(purchasing, (cl) => cl.query("select public.allocate_shipment_costs($1, 'value')", [shipment]));

    // TEST 14: partial arrival – only 2 of 3 units of product a arrive (1 damaged), b arrives fully
    const si = (await superPool.query("select id, variant_id from public.shipment_items where shipment_id = $1", [shipment])).rows;
    const siA = si.find((x) => x.variant_id === a.variantId).id;
    const siB = si.find((x) => x.variant_id === b.variantId).id;
    await as(purchasing, (cl) => cl.query("select public.receive_shipment($1, $2)", [shipment, JSON.stringify([
      { shipment_item_id: siA, received: 2, damaged: 1 },
      { shipment_item_id: siB, received: 3 },
    ])]));
    expect(await inv(a.variantId)).toEqual({ physical: 2, reserved: 2, available: 0 });
    expect(await inv(b.variantId)).toEqual({ physical: 3, reserved: 3, available: 0 });
    expect(await inv(c.variantId)).toEqual({ physical: 0, reserved: 0, available: 0 });
    // FIFO: o1 (2 units of a) is complete, o2 still misses 1 unit of a
    expect((await order(o1.order_id)).status).toBe("ready_for_delivery");
    expect((await order(o2.order_id)).status).toBe("in_transit");
    const o1item = (await superPool.query("select qty_allocated, unit_cost_actual from public.order_items where order_id = $1", [o1.order_id])).rows[0];
    expect(o1item.qty_allocated).toBe(2);
    expect(Number(o1item.unit_cost_actual)).toBe(650);
    expect((await superPool.query("select status from public.shipments where id = $1", [shipment])).rows[0].status).toBe("arrived");
    // Original estimate and actual landed cost are stored separately
    const actualCalcs = await superPool.query("select count(*)::int n from public.cost_calculations where shipment_id = $1 and not is_estimate", [shipment]);
    expect(actualCalcs.rows[0].n).toBeGreaterThan(0);
  });

  it("refuses to value a shipment without a configured exchange rate", async () => {
    await expect(as(service, (c) => c.query("select public.get_exchange_rate('USD', 'CNY')"))).rejects.toThrow(/No exchange rate/);
  });
});

describe("TEST 11 & 12 – access control", () => {
  it("a customer cannot read another customer's order", async () => {
    const alice = await createUser([]);
    const bob = await createUser([]);
    const p = await makeProduct({ salesType: "ready", stock: 2 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }], { user_id: (alice as { id: string }).id });
    const mine = await as(alice, (c) => c.query("select id from public.orders where id = $1", [o.order_id]));
    expect(mine.rowCount).toBe(1);
    const theirs = await as(bob, (c) => c.query("select id from public.orders where id = $1", [o.order_id]));
    expect(theirs.rowCount).toBe(0);
    const items = await as(bob, (c) => c.query("select id from public.order_items where order_id = $1", [o.order_id]));
    expect(items.rowCount).toBe(0);
    const viaAnon = await as(anon, (c) => c.query("select id from public.orders"));
    expect(viaAnon.rowCount).toBe(0);
    // tracking needs the token or matching WhatsApp digits
    await expect(as(bob, (c) => c.query("select public.track_order($1, 'wrong-token')", [o.order_number]))).rejects.toThrow(/order_not_found/);
    await expect(as(anon, (c) => c.query("select public.track_order($1, null, '+597 0000000')", [o.order_number]))).rejects.toThrow(/order_not_found/);
    const ok = await as(anon, (c) => c.query("select public.track_order($1, $2) r", [o.order_number, o.access_token]));
    expect(ok.rows[0].r.order.order_number).toBe(o.order_number);
    const byPhone = await as(anon, (c) => c.query("select public.track_order($1, null, '8123456') r", [o.order_number]));
    expect(byPhone.rows[0].r.order.order_number).toBe(o.order_number);
  });

  it("unauthorized staff cannot change financial settings or bank details", async () => {
    const inventoryMgr = await createUser(["inventory_manager"]);
    const upd = await as(inventoryMgr, (c) => c.query("update public.business_settings set value = '10' where key = 'deposit_ready_pct'"));
    expect(upd.rowCount).toBe(0);
    await expect(as(inventoryMgr, (c) => c.query("insert into public.bank_accounts (bank_name, account_holder, account_number) values ('X','Y','Z')")))
      .rejects.toThrow(/row-level security/);
    await expect(as(inventoryMgr, (c) => c.query("select public.financial_summary(current_date - 30, current_date)"))).rejects.toThrow(/permission denied/);
    // an admin may change settings; it is audited
    const ok = await as(admin, (c) => c.query("update public.business_settings set value = '50' where key = 'deposit_ready_pct'"));
    expect(ok.rowCount).toBe(1);
    const audit = await superPool.query("select count(*)::int n from public.audit_logs where entity_type = 'business_settings' and entity_id = 'deposit_ready_pct'");
    expect(audit.rows[0].n).toBeGreaterThan(0);
    // admin cannot read bank accounts (settings.bank), finance can
    const bankAdmin = await as(admin, (c) => c.query("select * from public.bank_accounts"));
    expect(bankAdmin.rowCount).toBe(0);
    await as(finance, (c) => c.query("insert into public.bank_accounts (bank_name, account_holder, account_number, show_at_checkout) values ('Testbank','The Secret Spot','000-TEST', true)"));
    const pub = await as(anon, (c) => c.query("select public.checkout_bank_instructions() r"));
    expect(pub.rows[0].r[0].bank_name).toBe("Testbank");
    const raw = await as(anon, (c) => c.query("select * from public.bank_accounts"));
    expect(raw.rowCount).toBe(0);
  });

  it("anonymous users cannot see supplier pricing or call internal functions", async () => {
    const r = await as(anon, (c) => c.query("select * from public.supplier_products"));
    expect(r.rowCount).toBe(0);
    await expect(as(anon, (c) => c.query("select public.create_order('{}'::jsonb)"))).rejects.toThrow(/permission denied/);
    await expect(as(anon, (c) => c.query("select public._fulfil_order_stock(gen_random_uuid())"))).rejects.toThrow(/permission denied/);
    const inv2 = await as(anon, (c) => c.query("select * from public.inventory"));
    expect(inv2.rowCount).toBe(0);
    const stock = await as(anon, (c) => c.query("select * from public.variant_stock limit 1"));
    expect(Object.keys(stock.rows[0])).toEqual(["variant_id", "product_id", "available_qty"]);
  });

  it("only a super admin can grant admin roles", async () => {
    const victim = await createUser([]);
    await expect(as(admin, (c) => c.query("select public.assign_role($1, 'super_admin')", [(victim as { id: string }).id]))).rejects.toThrow(/super administrator/);
    await as(admin, (c) => c.query("select public.assign_role($1, 'delivery_manager')", [(victim as { id: string }).id]));
    await expect(as(victim, (c) => c.query("select public.assign_role($1, 'admin')", [(victim as { id: string }).id]))).rejects.toThrow(/permission denied/);
  });
});

describe("TEST 13 – cancellation releases reservations", () => {
  it("customer cancels an unpaid order with the guest token", async () => {
    const p = await makeProduct({ salesType: "ready", stock: 2 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 2 }]);
    expect((await inv(p.variantId)).available).toBe(0);
    await expect(as(anon, (c) => c.query("select public.cancel_order($1, 'changed mind', 'bad')", [o.order_id]))).rejects.toThrow(/order_not_found/);
    await as(anon, (c) => c.query("select public.cancel_order($1, 'changed mind', $2)", [o.order_id, o.access_token]));
    expect(await inv(p.variantId)).toEqual({ physical: 2, reserved: 0, available: 2 });
    expect((await order(o.order_id)).status).toBe("cancelled");
  });

  it("customers cannot cancel once a payment is verified (staff decision, no automatic refund)", async () => {
    const p = await makeProduct({ salesType: "ready", stock: 1, price: 1000 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    await verify(finance, (await submitPayment(o, 500)).payment_id);
    await expect(as(anon, (c) => c.query("select public.cancel_order($1, 'x', $2)", [o.order_id, o.access_token]))).rejects.toThrow(/cancellation_requires_staff/);
    await as(admin, (c) => c.query("select public.cancel_order($1, 'Customer request – refund per policy')", [o.order_id]));
    const after = await order(o.order_id);
    expect(after.status).toBe("cancelled");
    expect(Number(after.amount_verified)).toBe(500); // funds still held until finance records a refund
    await as(finance, (c) => c.query("select public.record_refund($1, 500, 'Refund per cancellation policy')", [o.order_id]));
    expect((await order(o.order_id)).payment_status).toBe("refunded");
    expect((await inv(p.variantId)).available).toBe(1);
  });
});

describe("TEST 15 – expired quotation / unpaid order", () => {
  it("expires the order, releases stock and blocks late payment submission", async () => {
    const p = await makeProduct({ salesType: "ready", stock: 1 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    await superPool.query("update public.orders set payment_deadline = now() - interval '1 minute', quote_valid_until = now() - interval '1 minute' where id = $1", [o.order_id]);
    await superPool.query("update public.stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [o.order_id]);
    await superPool.query("update public.quotations set valid_until = now() - interval '1 minute' where order_id = $1", [o.order_id]);
    await expect(as(anon, (c) => c.query("select public.run_expiry_jobs()"))).rejects.toThrow(/permission denied/);
    const r = await as(service, (c) => c.query("select public.run_expiry_jobs() r"));
    expect(r.rows[0].r.expired_orders).toBeGreaterThanOrEqual(1);
    expect((await order(o.order_id)).status).toBe("expired");
    expect((await superPool.query("select status from public.quotations where order_id = $1", [o.order_id])).rows[0].status).toBe("expired");
    expect(await inv(p.variantId)).toEqual({ physical: 1, reserved: 0, available: 1 });
    await expect(submitPayment(o, 100)).rejects.toThrow(/order_not_payable/);
  });

  it("does not expire an order whose payment proof is awaiting verification", async () => {
    const p = await makeProduct({ salesType: "ready", stock: 1 });
    const o = await placeOrder([{ variantId: p.variantId, quantity: 1 }]);
    await submitPayment(o, 100);
    await superPool.query("update public.orders set payment_deadline = now() - interval '1 minute' where id = $1", [o.order_id]);
    await as(service, (c) => c.query("select public.run_expiry_jobs()"));
    expect((await order(o.order_id)).status).toBe("payment_review");
    expect((await inv(p.variantId)).reserved).toBe(1);
  });
});

describe("Promotions & delivery pricing", () => {
  it("applies percentage promo codes, free-delivery thresholds and usage limits", async () => {
    const p = await makeProduct({ salesType: "ready", price: 1000, stock: 5 });
    await superPool.query("update public.delivery_zones set fee = 75, free_threshold = 3000 where name = 'Paramaribo'");
    await superPool.query("insert into public.promotions (code, name, discount_type, discount_value, usage_limit) values ('TEST10', 'Test', 'percentage', 10, 1)");
    const o = await placeOrder([{ variantId: p.variantId, quantity: 2 }], { promo_code: "test10" });
    const row = await order(o.order_id);
    expect(Number(row.discount_total)).toBe(200);
    expect(Number(row.delivery_fee)).toBe(75);
    expect(Number(row.total)).toBe(1875);
    expect(Number(row.deposit_required)).toBe(900); // 50% of discounted lines; delivery excluded by default
    await expect(placeOrder([{ variantId: p.variantId, quantity: 1 }], { promo_code: "TEST10" })).rejects.toThrow(/cart_invalid/);
    const free = await placeOrder([{ variantId: p.variantId, quantity: 3 }]);
    expect(Number((await order(free.order_id)).delivery_fee)).toBe(0);
    await superPool.query("update public.delivery_zones set fee = 0, free_threshold = null where name = 'Paramaribo'");
  });
});

describe("Reporting uses real records", () => {
  it("dashboard and financial summary compute from data", async () => {
    const stats = await as(admin, (c) => c.query("select public.dashboard_stats() r"));
    expect(Number(stats.rows[0].r.total_orders)).toBeGreaterThan(0);
    const fin = await as(finance, (c) => c.query("select public.financial_summary(current_date - 1, current_date) r"));
    const f = fin.rows[0].r;
    expect(Number(f.gross_sales)).toBeGreaterThan(0);
    expect(Number(f.cost_of_goods_sold)).toBeGreaterThan(0);
    expect(Number(f.gross_profit)).toBeCloseTo(Number(f.gross_sales) - Number(f.cost_of_goods_sold), 2);
    await expect(as(delivery, (c) => c.query("select public.dashboard_stats()"))).rejects.toThrow(/permission denied/);
  });
});
