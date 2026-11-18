-- =====================================================================
-- STEP 2 – Default settings, districts, categories, templates (run once)
-- Generated from supabase/migrations + seed.sql by scripts/build-setup-sql.py.
-- Paste the whole file into Supabase → SQL Editor → Run.
-- =====================================================================

-- =====================================================================
-- Seed data – configuration defaults + clearly-marked DEMO catalogue.
-- No real customers, suppliers, bank details or exchange rates.
-- Every value here is a starting point the owner must review in
-- Admin → Business Settings.
-- =====================================================================

-- Business settings (is_public = readable by the storefront)
insert into public.business_settings (key, value, description, is_public) values
  ('store_name', '"THE SECRET GIRL"', 'Store name', true),
  ('store_tagline', '"YOUR STYLE. YOUR SECRET."', 'Tagline', true),
  ('store_whatsapp', '""', 'WhatsApp number for click-to-chat (international format, e.g. 5978xxxxxx). Owner must set.', true),
  ('store_email', '""', 'Public contact email. Owner must set.', true),
  ('store_instagram', '""', 'Instagram profile URL', true),
  ('store_facebook', '""', 'Facebook page URL', true),
  ('store_tiktok', '""', 'TikTok profile URL', true),
  ('deposit_ready_pct', '50', 'Deposit percentage for ready-stock items (0-100). REVIEW BEFORE GO-LIVE.', true),
  ('deposit_preorder_pct', '50', 'Default deposit percentage for pre-order items (0-100). Products may override. REVIEW BEFORE GO-LIVE.', true),
  ('deposit_min_amount', '0', 'Minimum deposit amount in SRD', true),
  ('deposit_includes_delivery', 'false', 'Whether the delivery fee is included in the deposit base', true),
  ('payment_deadline_hours', '48', 'Hours a customer has to pay the deposit before the order expires and stock is released', true),
  ('quote_validity_hours', '72', 'Hours a quotation remains valid', true),
  ('verification_grace_hours', '72', 'Extra hours stock stays reserved after a customer submits payment proof', false),
  ('purchasing_weekday', '1', 'ISO weekday of the weekly purchasing run (1 = Monday)', true),
  ('cancellation_policy', '"Annuleringsvoorwaarden: nog niet vastgesteld door The Secret Girl. Neem contact op voor informatie."', 'Published cancellation & refund terms (shown on quotations and checkout). Owner must set.', true),
  ('payment_disclaimer', '"Uw bestelling wordt pas bevestigd nadat uw betaling door The Secret Girl is geverifieerd."', 'Payment disclaimer', true),
  ('low_stock_default', '2', 'Default low-stock threshold', false)
on conflict (key) do nothing;

-- Delivery zones: districts of Suriname. Fees are 0 until the owner sets them.
insert into public.delivery_zones (name, fee, estimated_days, sort_order) values
  ('Paramaribo', 0, '1–2 werkdagen', 1),
  ('Wanica', 0, '1–3 werkdagen', 2),
  ('Commewijne', 0, '2–4 werkdagen', 3),
  ('Para', 0, '2–4 werkdagen', 4),
  ('Saramacca', 0, '2–4 werkdagen', 5),
  ('Nickerie', 0, '3–5 werkdagen', 6),
  ('Coronie', 0, '3–5 werkdagen', 7),
  ('Marowijne', 0, '3–5 werkdagen', 8),
  ('Brokopondo', 0, '3–5 werkdagen', 9),
  ('Sipaliwini', 0, 'In overleg', 10)
on conflict do nothing;

insert into public.storage_locations (code, name, is_default) values ('MAIN', 'Hoofdopslag Paramaribo', true)
on conflict (code) do nothing;

insert into public.pricing_settings (name, target_margin_pct, rounding_step, is_default, notes)
values ('Standaard', 40, 5, true, 'Default margin – review. Customs and tax percentages must be set by the owner.')
on conflict (name) do nothing;

-- Categories
with top as (
  insert into public.categories (name, name_en, slug, sort_order) values
    ('Dames', 'Women', 'dames', 1),
    ('Heren', 'Men', 'heren', 2),
    ('Kids', 'Kids', 'kids', 3),
    ('Schoenen', 'Shoes', 'schoenen', 4),
    ('Accessoires', 'Accessories', 'accessoires', 5)
  on conflict (slug) do nothing
  returning id, slug)
insert into public.categories (parent_id, name, name_en, slug, sort_order)
select t.id, c.name, c.name_en, c.slug, c.ord from top t
join (values
  ('dames', 'Jurken', 'Dresses', 'dames-jurken', 1),
  ('dames', 'Tops', 'Tops', 'dames-tops', 2),
  ('dames', 'Jeans', 'Jeans', 'dames-jeans', 3),
  ('dames', 'Broeken', 'Trousers', 'dames-broeken', 4),
  ('dames', 'Rokken', 'Skirts', 'dames-rokken', 5),
  ('dames', 'Sets', 'Matching Sets', 'dames-sets', 6),
  ('dames', 'Sportkleding', 'Sportswear', 'dames-sport', 7),
  ('dames', 'Casual', 'Casual Wear', 'dames-casual', 8),
  ('heren', 'T-shirts', 'T-shirts', 'heren-tshirts', 1),
  ('heren', 'Polo''s', 'Polo Shirts', 'heren-polos', 2),
  ('heren', 'Jeans', 'Jeans', 'heren-jeans', 3),
  ('heren', 'Broeken', 'Trousers', 'heren-broeken', 4),
  ('heren', 'Overhemden', 'Shirts', 'heren-overhemden', 5),
  ('heren', 'Sets', 'Matching Sets', 'heren-sets', 6),
  ('heren', 'Sportkleding', 'Sportswear', 'heren-sport', 7),
  ('kids', 'Baby', 'Baby Clothing', 'kids-baby', 1),
  ('kids', 'Peuters', 'Toddler Clothing', 'kids-peuters', 2),
  ('kids', 'Jongens', 'Boys', 'kids-jongens', 3),
  ('kids', 'Meisjes', 'Girls', 'kids-meisjes', 4),
  ('kids', 'Kinderschoenen', 'Shoes', 'kids-schoenen', 5),
  ('kids', 'Kinderaccessoires', 'Children''s Accessories', 'kids-accessoires', 6),
  ('schoenen', 'Sneakers', 'Sneakers', 'schoenen-sneakers', 1),
  ('schoenen', 'Sandalen', 'Sandals', 'schoenen-sandalen', 2),
  ('schoenen', 'Casual schoenen', 'Casual Shoes', 'schoenen-casual', 3),
  ('schoenen', 'Kinderschoenen', 'Children''s Shoes', 'schoenen-kinderen', 4),
  ('accessoires', 'Handtassen', 'Handbags', 'acc-handtassen', 1),
  ('accessoires', 'Portemonnees', 'Wallets', 'acc-portemonnees', 2),
  ('accessoires', 'Horloges', 'Watches', 'acc-horloges', 3),
  ('accessoires', 'Zonnebrillen', 'Sunglasses', 'acc-zonnebrillen', 4),
  ('accessoires', 'Riemen', 'Belts', 'acc-riemen', 5),
  ('accessoires', 'Overige', 'Other Accessories', 'acc-overige', 6)
) as c(parent, name, name_en, slug, ord) on c.parent = t.slug
on conflict (slug) do nothing;

-- Notification templates (Dutch)
insert into public.notification_templates (event, channel, subject, body) values
  ('order_created', 'email', 'Uw bestelling {order_number} bij The Secret Girl', E'Beste {customer_name},\n\nBedankt voor uw bestelling {order_number}.\nTotaal: {currency} {total}\nVereiste aanbetaling: {currency} {deposit_required}\nBetaal uiterlijk {payment_deadline}.\n\nUw bestelling wordt pas bevestigd nadat uw betaling door The Secret Girl is geverifieerd.'),
  ('order_created', 'whatsapp', null, E'Hallo {customer_name}, bedankt voor uw bestelling {order_number} bij THE SECRET GIRL. Totaal {currency} {total}, aanbetaling {currency} {deposit_required}. Betaal vóór {payment_deadline}.'),
  ('quotation_created', 'email', 'Offerte voor bestelling {order_number}', E'Beste {customer_name},\n\nUw offerte voor bestelling {order_number} staat klaar. Totaal {currency} {total}.'),
  ('payment_instructions', 'email', 'Betaalinstructies {order_number}', E'Beste {customer_name},\n\nMaak {currency} {deposit_required} over en vermeld als omschrijving: {order_number}.\nNa uw overboeking kunt u uw betaalreferentie en betaalbewijs uploaden via de link in uw bestelbevestiging.'),
  ('payment_instructions', 'whatsapp', null, E'Betaalinstructies {order_number}: maak {currency} {deposit_required} over en vermeld {order_number} als omschrijving. Upload daarna uw betaalbewijs via de link in uw bevestiging.'),
  ('payment_proof_received', 'email', 'Betaalbewijs ontvangen – {order_number}', E'Beste {customer_name},\n\nWe hebben uw betaalgegevens voor {order_number} ontvangen. We controleren de betaling en laten het u weten.'),
  ('payment_proof_received', 'internal', 'Nieuw betaalbewijs', 'Betaalbewijs ontvangen voor {order_number} – controleer de bankafschriften.'),
  ('deposit_verified', 'email', 'Betaling geverifieerd – {order_number}', E'Beste {customer_name},\n\nUw betaling van {currency} {payment_amount} is geverifieerd. Openstaand saldo: {currency} {balance_due}.'),
  ('deposit_verified', 'whatsapp', null, 'Uw betaling voor {order_number} is geverifieerd. Openstaand saldo: {currency} {balance_due}.'),
  ('payment_rejected', 'email', 'Betaling niet goedgekeurd – {order_number}', E'Beste {customer_name},\n\nWe konden uw betaling voor {order_number} niet verifiëren. Reden: {reason}.\nNeem contact met ons op.'),
  ('payment_rejected', 'whatsapp', null, 'We konden uw betaling voor {order_number} niet verifiëren. Reden: {reason}. Neem contact met ons op.'),
  ('order_confirmed', 'email', 'Bestelling bevestigd – {order_number}', E'Beste {customer_name},\n\nUw bestelling {order_number} is bevestigd.'),
  ('order_confirmed', 'whatsapp', null, 'Uw bestelling {order_number} bij THE SECRET GIRL is bevestigd!'),
  ('supplier_order_placed', 'email', 'Uw pre-order is ingekocht – {order_number}', E'Beste {customer_name},\n\nDe artikelen van uw pre-order {order_number} zijn bij onze leverancier besteld. Alle leverdata zijn schattingen.'),
  ('shipment_dispatched', 'email', 'Uw pre-order is onderweg – {order_number}', E'Beste {customer_name},\n\nDe zending met artikelen van uw bestelling {order_number} is verzonden.'),
  ('shipment_arrived', 'email', 'Zending aangekomen in Suriname – {order_number}', E'Beste {customer_name},\n\nDe zending met uw artikelen is in Suriname aangekomen en wordt gecontroleerd.'),
  ('ready_for_delivery', 'email', 'Klaar voor levering – {order_number}', E'Beste {customer_name},\n\nUw bestelling {order_number} is klaar voor levering. Openstaand saldo bij levering: {currency} {balance_due}.'),
  ('ready_for_delivery', 'whatsapp', null, 'Uw bestelling {order_number} is klaar voor levering. Saldo bij levering: {currency} {balance_due}.'),
  ('delivery_scheduled', 'email', 'Levering ingepland – {order_number}', E'Beste {customer_name},\n\nUw levering is ingepland op {scheduled_date}. Openstaand saldo: {currency} {balance_due}.'),
  ('delivery_scheduled', 'whatsapp', null, 'Uw levering voor {order_number} is ingepland op {scheduled_date}. Saldo: {currency} {balance_due}.'),
  ('balance_reminder', 'email', 'Openstaand saldo – {order_number}', E'Beste {customer_name},\n\nEr staat nog {currency} {balance_due} open voor bestelling {order_number}.'),
  ('balance_reminder', 'whatsapp', null, 'Herinnering: er staat nog {currency} {balance_due} open voor bestelling {order_number}.'),
  ('order_completed', 'email', 'Bedankt! Bestelling {order_number} afgerond', E'Beste {customer_name},\n\nUw bestelling {order_number} is afgerond. Bedankt voor uw aankoop bij THE SECRET GIRL!'),
  ('order_completed', 'whatsapp', null, 'Bedankt voor uw aankoop bij THE SECRET GIRL! Bestelling {order_number} is afgerond.')
on conflict (event, channel, locale) do nothing;

-- Homepage content (editable in Admin → Website Content)
insert into public.site_content (block_type, key, title, subtitle, link_url, cta_label, sort_order) values
  ('announcement', null, 'Levering in heel Suriname · Ready-to-order én pre-order', null, '/collectie', null, 1),
  ('hero', 'main', 'YOUR STYLE. YOUR SECRET.', 'Mode voor het hele gezin – direct uit voorraad of op bestelling.', '/collectie', 'Shop de collectie', 1),
  ('promo_banner', 'preorder', 'Pre-order collectie', 'Bestel nu met aanbetaling, wij importeren voor u. Leverdata zijn schattingen.', '/collectie?type=preorder', 'Bekijk pre-orders', 1),
  ('promo_banner', 'ready', 'Direct leverbaar', 'Op voorraad in Suriname en snel bij u thuis.', '/collectie?type=ready', 'Shop ready-to-order', 2);

