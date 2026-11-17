# Business rules & accounting definitions

## Sales types
* **Ready-to-order**: stock in Suriname. Stock is reserved at checkout; buying more than is available is impossible.
* **Pre-order**: bought from suppliers after the deposit is verified. Delivery dates are always shown as **estimates** (purchasing day + product lead-time range).
* **Coming soon**: visible but not purchasable.
* Products with zero available stock are never shown as available.

## Checkout & deposit
* Prices, discounts, delivery fee, deposit and balance are calculated **only** in `price_cart` / `create_order`.
* Deposit per line = line total after discount × deposit %. Ready-stock lines use `deposit_ready_pct`; pre-order lines use the product's own % if set, else `deposit_preorder_pct`.
* The delivery fee is excluded from the deposit base unless `deposit_includes_delivery = true`.
* Deposit = max(sum of line deposits, `deposit_min_amount`), capped at the order total.
* Balance due = total − verified payments + refunds.
* Mixed carts are allowed. Ready and pre-order lines are listed separately with their own timelines. The order is delivered as a whole once all lines are available (partial deliveries are not supported in this version).
* Discounts: percentage or fixed (spread proportionally over eligible lines, with the rounding remainder on the last line) or free delivery. Usage limits are enforced under a lock.
* Free delivery applies when the discounted subtotal ≥ the zone's threshold. A zone promo fee applies until its end date.

## Payment verification
1. Customer transfers and submits a reference (optionally with proof). Order → *payment_review*; the stock reservation is extended by `verification_grace_hours`.
2. Finance checks the **real bank statement**, then approves (the amount can be corrected to what actually arrived) or rejects with a reason.
3. Only verified payments change balances. When verified ≥ deposit, the order is *confirmed*, reservations stop expiring and pre-order lines become eligible for purchasing.
4. Cash and card-terminal payments recorded by staff count as verified at recording. Bank transfers recorded at delivery still need verification.
5. Every state change is written to `payment_events` (append-only) and `audit_logs`.

## Expiry
Unpaid orders without pending proofs expire after `payment_deadline_hours`; reservations are released. Quotations expire after `quote_validity_hours`. Late payments on expired or cancelled orders cannot be verified; staff must refund or create a new order.

## Cancellation & refunds
Customers may cancel their own order only before any payment is verified. Afterwards only staff can cancel, and purchased pre-order lines cannot be cancelled (use the return/refund workflow). **Refunds are never automatic and deposits are never automatically forfeited**: finance records refunds according to the published cancellation policy and applicable consumer law.

## Purchasing & import
* The weekly report shows confirmed, deposit-verified pre-order units not yet in an active batch, grouped by supplier/product/SKU/size/colour.
* A batch holds one supplier's open units. An order line can never be batched twice for the same quantity (enforced by a trigger).
* PO status *ordered* marks lines as purchased and notifies customers.
* Received units are added to stock and allocated **first-confirmed-first-served** to waiting pre-order customers. Only received units become available; damaged units are tracked separately.

## Landed cost
* Goods value = PO unit cost × quantity × exchange rate on the departure date (no rate configured = error; rates are never assumed).
* Import costs use **actual invoices** when any exist, otherwise estimates. They are allocated by value, weight, volume, units or manual share; the rounding remainder goes to the largest line so totals reconcile exactly.
* Landed unit cost = (goods value + allocated cost) ÷ shipped quantity.
* Estimates (pricing calculator) and actuals (per shipment) are stored separately in `cost_calculations`. Re-allocating after receipt revalues the remaining stock.
* Selling price = landed cost ÷ (1 − target margin). **Margin** = profit ÷ price; **markup** = profit ÷ cost.

## Inventory
Available = physical − reserved. Every change creates an `inventory_movements` row with a reason, user and timestamp. Stock leaves inventory only on delivery (reservation → sale). Adjustments below the reserved quantity are refused.

## Accounting definitions (operational, not statutory)
* **Revenue** is recognised when an order is **delivered** (`delivered_at`), net of discounts. Delivery fees are reported separately.
* **Customer deposits** on undelivered orders are a liability, not revenue.
* **Receivables** = balance due on delivered orders.
* **COGS** = Σ sale movements × unit cost (actual landed cost when known, otherwise the weighted average inventory cost).
* **Gross profit** = revenue − COGS. **Net operating result** = revenue + delivery income − COGS − delivery costs − operating expenses − refunds.
* Shipping and import charges are part of landed cost and therefore of COGS. They are shown for information and not deducted twice.
* **Supplier balances** = PO invoice (or line total) × current rate − supplier payments.
* Profit is never calculated as "bank deposits minus supplier payments".
* This is a management tool and doesn't replace bookkeeping or tax filings.
