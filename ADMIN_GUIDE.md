# Admin guide (beheerdershandleiding)

Log in and go to **/admin**. You only see the modules your role allows.

## Daily routine
1. **Betalingen** (payments): open the verification queue. For each payment, check your bank app/statement for the transfer (amount, reference = order number). Click *Goedkeuren* (adjust the amount if a different amount arrived) or *Afwijzen* with a reason. The customer is notified.
2. **Bestellingen** (orders): follow up on orders waiting for payment; *Verlopen betalingen verwerken* expires unpaid orders (this also runs automatically).
3. **Leveringen** (deliveries): orders whose items are all available appear here automatically. Assign a driver and a date, set *Onderweg* (out for delivery), record the payment at the door (cash = verified immediately, receipt PDF available), then *Geleverd* (delivered). Stock is deducted at this point.

## Weekly purchasing (pre-orders)
1. **Inkooprapport**: shows all paid pre-order units not yet purchased, per supplier. Export CSV if needed.
2. *Inkoopbatch aanmaken* (create batch) per supplier, then *Inkooporder genereren* (generate PO) and download the PO PDF for the supplier.
3. After ordering, set the PO to *Besteld* (ordered); customers are notified. Record the supplier invoice and supplier payments (with the actual exchange rate).

## Shipments
1. **Zendingen** → new shipment → add PO lines (a shipment can contain several POs; a PO can be split).
2. Update the status (*Verzonden* → *Onderweg* → *Douane* → *Aangekomen*). Customers get updates.
3. Add import costs (freight, duties, tax, clearance…); mark them as *schatting* until the invoice arrives. Choose an allocation method and click *Kosten toerekenen*. Repeat when the real invoices arrive.
4. *Ontvangst verwerken*: enter received and damaged units. Only received units enter stock and are assigned to waiting customers (first confirmed, first served).

## Products & pricing
* **Prijscalculator**: enter the supplier price, currency, rate and costs to get landed cost, the recommended price (target margin), margin vs markup and profit. *Opslaan & prijs toepassen* updates the product.
* **Producten**: create the product (type: ready / pre-order / coming soon), then add variants (size/colour), photos (JPG/PNG/WEBP ≤ 5 MB) and flags (featured/new/best seller) that drive the homepage.
* **Voorraad**: add stock, write off damaged items, process returns, run counts (correction), move stock between locations. A reason is always required.

## Settings
* **Bedrijfsinstellingen**: deposit percentages, payment deadline, quote validity, cancellation policy, contact details, delivery zones and fees, pricing defaults. Nothing is hard-coded. Existing orders keep their amounts.
* **Bankgegevens** (finance/super admin only): accounts shown to customers.
* **Website content**: announcement bar, hero, promo banners, info pages, reviews, newsletter export.
* **Notificaties**: edit e-mail/WhatsApp texts; see what was sent, failed or not configured.
* **Gebruikers & rechten**: invite staff and toggle roles.

## Reports
* **Financieel overzicht**: revenue (recognised at delivery), COGS, gross profit, expenses, net result, customer deposits held, receivables, supplier balances, inventory value, cash flow; CSV.
* **Rapportages**: sales by day/month/category/product, ready vs pre-order, sizes/colours, turnover, slow movers, supplier & shipment performance, delivery performance, retention; CSV per table and PDF.
* **Audit log**: who changed what, when.
