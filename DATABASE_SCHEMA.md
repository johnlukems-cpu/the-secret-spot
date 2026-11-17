# Database schema

Source of truth: `supabase/migrations/*.sql` (applied in order). All primary keys are UUIDs (append-only logs use bigint identity). Money is `numeric(12,2)` in SRD; foreign-currency costs are `numeric(14,4)`; exchange rates are `numeric(18,8)`. Every monetary table has an explicit `currency` column. Floats are never used.

| Migration | Contents |
|---|---|
| 01 foundation | enums, `profiles`, `user_roles`, `permissions`, `role_permissions`, `audit_logs` (append-only), `business_settings`, `document_sequences`, role helpers |
| 02 catalog_inventory | `customers`, `delivery_zones`, `customer_addresses`, `categories`, `suppliers`, `products`, `product_images`, `product_variants`, `supplier_products`, `storage_locations`, `inventory`, `inventory_movements` (append-only), `carts`, `cart_items` |
| 03 orders_payments | `promotions`, `orders`, `order_items`, `stock_reservations`, `quotations`, `bank_accounts`, `payments`, `payment_events` (append-only), `payment_proofs`, `payment_allocations` (append-only), `returns`, `refunds` |
| 04 purchasing_import | `exchange_rates`, `pricing_settings`, `cost_calculations`, `purchase_batches`, `purchase_batch_items`, `purchase_orders`, `purchase_order_items`, `supplier_payments`, `shipments`, `shipment_items`, `import_costs` |
| 05 delivery_finance_content | `deliveries`, `delivery_payments`, `expenses`, `notification_templates`, `notifications`, `site_content`, `reviews`, `newsletter_subscribers`, `support_messages`, `rate_limits` |
| 06 business_functions | transactional RPCs (see below) |
| 07 security | permission catalogue, role mapping, RLS on every table, function grants, `variant_stock` public view, storage buckets/policies |
| 08 reporting | `customer_overview` / `inventory_overview` (security-invoker views), `report_data`, `outstanding_balances`, `staff_directory`, `next_po_number` |

## Important invariants (enforced in the database)

* `inventory.available_qty` is generated as `physical_qty − reserved_qty`. CHECK constraints: physical ≥ 0, reserved ≥ 0, reserved ≤ physical, so stock can never go negative.
* `orders.balance_due` is generated as `total − amount_verified + amount_refunded`; `deposit_required ≤ total`.
* `amount_verified` is recomputed only from `payment_allocations` of verified payments.
* `purchase_batch_items`: a trigger prevents batching more units of an order line than were ordered (across all non-cancelled batches).
* `shipment_items`: a trigger prevents shipping more than the PO line quantity (a PO can be split across shipments, and one shipment can hold lines from many POs).
* `shipment_items`: received + damaged ≤ shipped.
* Append-only tables reject UPDATE and DELETE via a trigger.

## Main functions

| Function | Purpose | Permission |
|---|---|---|
| `price_cart(jsonb)` | Authoritative pricing, discount, delivery and deposit | public |
| `create_order(jsonb)` | Checkout: re-price, lock & reserve stock, order + quotation + notifications | service role only |
| `track_order(number, token, whatsapp)` | Guest/owner order view | token, phone or owner |
| `submit_payment(…)` | Customer payment reference/proof | service role (after access check) |
| `mark_payment_under_verification`, `verify_payment` | Finance verification | payments.verify |
| `record_payment` | Cash/bank at delivery; receipts | payments.record |
| `record_refund` | Refunds (never automatic) | payments.refund |
| `cancel_order` | Releases reservations, removes from open batches | customer (unpaid, own) / orders.manage |
| `run_expiry_jobs` | Expire orders/quotes, release stock | orders.manage / cron |
| `adjust_inventory`, `transfer_stock` | Stock corrections with reason | inventory.manage |
| `purchasing_report`, `create_purchase_batch`, `create_po_from_batch`, `set_purchase_order_status` | Weekly purchasing | purchasing.manage |
| `set_shipment_status`, `allocate_shipment_costs`, `receive_shipment` | Import chain | shipments.manage |
| `update_delivery_status` | Delivery workflow; fulfilment deducts stock | deliveries.manage |
| `dashboard_stats`, `financial_summary`, `report_data` | Reporting | dashboard.view / finance.view / reports.view |

## Storage buckets

* `product-images`: public read; write requires products.manage.
* `payment-proofs`: private. Uploads go through the server (service role) after token verification; staff read via signed URLs (10 min).
* `documents`: private, staff only.
