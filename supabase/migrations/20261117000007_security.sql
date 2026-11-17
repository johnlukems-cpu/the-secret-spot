-- =====================================================================
-- Migration 7: permissions, role mapping, Row Level Security, grants,
-- public views and storage buckets.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permission catalogue
-- ---------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('dashboard.view', 'View admin dashboard statistics'),
  ('products.manage', 'Create and edit products, variants and images'),
  ('categories.manage', 'Manage categories'),
  ('inventory.manage', 'Adjust and transfer stock'),
  ('orders.view', 'View orders'),
  ('orders.manage', 'Edit/cancel orders and run order maintenance'),
  ('quotations.manage', 'Manage quotations'),
  ('payments.view', 'View payments and proofs'),
  ('payments.verify', 'Approve or reject customer payments'),
  ('payments.record', 'Record payments received (e.g. at delivery)'),
  ('payments.refund', 'Record refunds'),
  ('customers.view', 'View customers'),
  ('customers.manage', 'Edit customers'),
  ('preorders.manage', 'Manage pre-orders'),
  ('suppliers.manage', 'Manage suppliers'),
  ('supplier_costs.view', 'View confidential supplier pricing'),
  ('purchasing.manage', 'Purchasing batches and purchase orders'),
  ('shipments.manage', 'Shipments, receiving and import cost allocation'),
  ('deliveries.view', 'View deliveries'),
  ('deliveries.manage', 'Update deliveries'),
  ('pricing.manage', 'Pricing calculator and exchange rates'),
  ('expenses.manage', 'Record expenses'),
  ('finance.view', 'View financial reports'),
  ('reports.view', 'View sales and inventory analytics'),
  ('promotions.manage', 'Manage promotions'),
  ('content.manage', 'Manage website content, reviews and newsletter'),
  ('notifications.manage', 'Manage notification templates and queue'),
  ('users.manage', 'Manage staff users and roles'),
  ('settings.manage', 'Manage business settings and delivery zones'),
  ('settings.bank', 'Manage bank account details'),
  ('audit.view', 'View audit logs');

-- admin: everything except bank details (super_admin implicitly has all)
insert into public.role_permissions (role, permission_code)
select 'admin', code from public.permissions where code not in ('settings.bank');

insert into public.role_permissions (role, permission_code)
select 'finance_manager', unnest(array['dashboard.view','finance.view','reports.view','payments.view','payments.verify',
  'payments.record','payments.refund','orders.view','customers.view','expenses.manage','settings.bank',
  'supplier_costs.view','pricing.manage','deliveries.view','audit.view']);

insert into public.role_permissions (role, permission_code)
select 'inventory_manager', unnest(array['dashboard.view','products.manage','categories.manage','inventory.manage',
  'orders.view','shipments.manage','reports.view']);

insert into public.role_permissions (role, permission_code)
select 'order_manager', unnest(array['dashboard.view','orders.view','orders.manage','quotations.manage','customers.view',
  'customers.manage','payments.view','preorders.manage','deliveries.view','deliveries.manage','notifications.manage']);

insert into public.role_permissions (role, permission_code)
select 'purchasing_manager', unnest(array['dashboard.view','suppliers.manage','supplier_costs.view','purchasing.manage',
  'shipments.manage','pricing.manage','orders.view','preorders.manage','reports.view']);

insert into public.role_permissions (role, permission_code)
select 'delivery_manager', unnest(array['deliveries.view','deliveries.manage','payments.record']);

-- Role assignment with escalation guard
create or replace function public.assign_role(_user_id uuid, _role public.app_role, _grant boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('users.manage');
  if _role in ('super_admin', 'admin') and not (public.is_trusted_caller() or public.has_role('super_admin')) then
    raise exception 'only a super administrator can grant or revoke %', _role using errcode = '42501';
  end if;
  if not _grant and _user_id = auth.uid() and _role = 'super_admin' then
    raise exception 'you cannot revoke your own super administrator role' using errcode = '42501';
  end if;
  if _grant then
    insert into public.user_roles (user_id, role, granted_by) values (_user_id, _role, auth.uid()) on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;
  perform public.write_audit(case when _grant then 'grant_role' else 'revoke_role' end, 'user_roles', _user_id::text,
                             null, jsonb_build_object('role', _role));
end $$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.code), '{}') from public.permissions p
   where public.has_permission(p.code);
$$;

-- ---------------------------------------------------------------------
-- Public views (deliberately exposed, no confidential columns)
-- ---------------------------------------------------------------------
create view public.variant_stock as
  select v.id as variant_id, v.product_id, greatest(coalesce(sum(i.available_qty), 0), 0)::int as available_qty
    from public.product_variants v left join public.inventory i on i.variant_id = v.id
   where v.deleted_at is null
   group by v.id, v.product_id;

-- ---------------------------------------------------------------------
-- Function execution grants: internal helpers are not callable via API.
-- ---------------------------------------------------------------------
revoke execute on function public._reserve_stock(uuid, uuid, uuid, int, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._release_reservation(public.stock_reservations, public.reservation_status, text) from public, anon, authenticated;
revoke execute on function public._refresh_order_payment(uuid) from public, anon, authenticated;
revoke execute on function public._refresh_order_readiness(uuid) from public, anon, authenticated;
revoke execute on function public._fulfil_order_stock(uuid) from public, anon, authenticated;
revoke execute on function public._shipment_goods_value(uuid) from public, anon, authenticated;
revoke execute on function public._order_access(text, text) from public, anon, authenticated;
revoke execute on function public.enqueue_order_notification(text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.write_audit(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.next_document_number(text) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
-- Checkout and payment submission go through the Next.js server (rate limited,
-- validated, file upload handled there) using the service role.
revoke execute on function public.create_order(jsonb) from public, anon, authenticated;
revoke execute on function public.submit_payment(text, text, numeric, text, text, date, jsonb) from public, anon, authenticated;
revoke execute on function public.run_expiry_jobs() from public, anon;
grant execute on function public._reserve_stock(uuid, uuid, uuid, int, timestamptz, uuid, uuid) to service_role;
grant execute on function public._release_reservation(public.stock_reservations, public.reservation_status, text) to service_role;
grant execute on function public._refresh_order_payment(uuid) to service_role;
grant execute on function public._refresh_order_readiness(uuid) to service_role;
grant execute on function public._fulfil_order_stock(uuid) to service_role;
grant execute on function public._shipment_goods_value(uuid) to service_role;
grant execute on function public._order_access(text, text) to service_role;
grant execute on function public.enqueue_order_notification(text, uuid, jsonb) to service_role;
grant execute on function public.write_audit(text, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.next_document_number(text) to service_role;
grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.create_order(jsonb) to service_role;
grant execute on function public.submit_payment(text, text, numeric, text, text, date, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_roles','permissions','role_permissions','audit_logs','business_settings','document_sequences',
    'customers','delivery_zones','customer_addresses','categories','suppliers','products','product_images',
    'product_variants','supplier_products','storage_locations','inventory','inventory_movements','carts','cart_items',
    'promotions','orders','order_items','stock_reservations','quotations','bank_accounts','payments','payment_events',
    'payment_proofs','payment_allocations','returns','refunds','exchange_rates','pricing_settings','cost_calculations',
    'purchase_batches','purchase_batch_items','purchase_orders','purchase_order_items','supplier_payments','shipments',
    'shipment_items','import_costs','deliveries','delivery_payments','expenses','notification_templates','notifications',
    'site_content','reviews','newsletter_subscribers','support_messages','rate_limits']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- helper: "own order" check
create or replace function public.owns_order(_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders where id = _order_id and user_id = auth.uid() and auth.uid() is not null);
$$;

-- profiles
create policy profiles_self_select on public.profiles for select using (id = auth.uid() or public.has_permission('customers.view') or public.has_permission('users.manage'));
create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- RBAC tables
create policy user_roles_select on public.user_roles for select using (user_id = auth.uid() or public.has_permission('users.manage'));
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- audit (read-only; inserts happen in security definer functions)
create policy audit_select on public.audit_logs for select using (public.has_permission('audit.view'));

-- settings
create policy settings_public_select on public.business_settings for select using (is_public or public.has_permission('settings.manage'));
create policy settings_manage on public.business_settings for all using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- customers
create policy customers_select on public.customers for select using (user_id = auth.uid() or public.has_permission('customers.view'));
create policy customers_update_self on public.customers for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy customers_manage on public.customers for all using (public.has_permission('customers.manage')) with check (public.has_permission('customers.manage'));

create policy addresses_own on public.customer_addresses for all
  using (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.customers c where c.id = customer_id and c.user_id = auth.uid()));
create policy addresses_staff on public.customer_addresses for select using (public.has_permission('customers.view'));

-- zones
create policy zones_public on public.delivery_zones for select using (is_active or public.is_staff());
create policy zones_manage on public.delivery_zones for all using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

-- catalogue
create policy categories_public on public.categories for select using ((is_active and deleted_at is null) or public.is_staff());
create policy categories_manage on public.categories for all using (public.has_permission('categories.manage')) with check (public.has_permission('categories.manage'));

create policy products_public on public.products for select
  using ((status = 'active' and deleted_at is null) or public.has_permission('products.manage') or public.has_permission('orders.view') or public.has_permission('purchasing.manage') or public.has_permission('inventory.manage'));
create policy products_manage on public.products for all using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy product_images_public on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'active' and p.deleted_at is null) or public.is_staff());
create policy product_images_manage on public.product_images for all using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

create policy variants_public on public.product_variants for select
  using ((deleted_at is null and exists (select 1 from public.products p where p.id = product_id and p.status = 'active' and p.deleted_at is null)) or public.is_staff());
create policy variants_manage on public.product_variants for all using (public.has_permission('products.manage')) with check (public.has_permission('products.manage'));

-- suppliers & supplier pricing (confidential)
create policy suppliers_select on public.suppliers for select using (public.has_permission('suppliers.manage') or public.has_permission('purchasing.manage') or public.has_permission('supplier_costs.view'));
create policy suppliers_manage on public.suppliers for all using (public.has_permission('suppliers.manage')) with check (public.has_permission('suppliers.manage'));
create policy supplier_products_select on public.supplier_products for select using (public.has_permission('supplier_costs.view'));
create policy supplier_products_manage on public.supplier_products for all using (public.has_permission('suppliers.manage') or public.has_permission('purchasing.manage')) with check (public.has_permission('suppliers.manage') or public.has_permission('purchasing.manage'));

-- inventory (contains cost data -> staff only; public uses variant_stock view)
create policy locations_select on public.storage_locations for select using (public.is_staff());
create policy locations_manage on public.storage_locations for all using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));
create policy inventory_select on public.inventory for select using (public.has_permission('inventory.manage') or public.has_permission('products.manage') or public.has_permission('orders.view') or public.has_permission('finance.view'));
create policy inventory_threshold_update on public.inventory for update using (public.has_permission('inventory.manage')) with check (public.has_permission('inventory.manage'));
create policy movements_select on public.inventory_movements for select using (public.has_permission('inventory.manage') or public.has_permission('finance.view'));
create policy reservations_select on public.stock_reservations for select using (public.has_permission('inventory.manage') or public.has_permission('orders.view'));

-- carts
create policy carts_own on public.carts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cart_items_own on public.cart_items for all
  using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid()));

-- promotions (codes are not publicly listable)
create policy promotions_staff on public.promotions for select using (public.has_permission('promotions.manage') or public.has_permission('orders.view'));
create policy promotions_manage on public.promotions for all using (public.has_permission('promotions.manage')) with check (public.has_permission('promotions.manage'));

-- orders & children: customers read their own; staff by permission; writes via functions
create policy orders_select on public.orders for select using ((user_id = auth.uid() and auth.uid() is not null) or public.has_permission('orders.view') or public.has_permission('finance.view'));
create policy orders_staff_update on public.orders for update using (public.has_permission('orders.manage')) with check (public.has_permission('orders.manage'));
create policy order_items_select on public.order_items for select using (public.owns_order(order_id) or public.has_permission('orders.view') or public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy quotations_select on public.quotations for select using (public.owns_order(order_id) or public.has_permission('orders.view'));
create policy quotations_manage on public.quotations for update using (public.has_permission('quotations.manage')) with check (public.has_permission('quotations.manage'));

-- bank accounts: finance / settings.bank only (checkout uses checkout_bank_instructions())
create policy bank_select on public.bank_accounts for select using (public.has_permission('settings.bank'));
create policy bank_manage on public.bank_accounts for all using (public.has_permission('settings.bank')) with check (public.has_permission('settings.bank'));

-- payments (no direct writes; all changes via verify/record functions)
create policy payments_select on public.payments for select using (public.owns_order(order_id) or public.has_permission('payments.view') or public.has_permission('finance.view'));
create policy payment_events_select on public.payment_events for select using (public.has_permission('payments.view') or public.has_permission('finance.view') or public.has_permission('audit.view'));
create policy payment_proofs_select on public.payment_proofs for select using (public.owns_order(order_id) or public.has_permission('payments.view'));
create policy payment_alloc_select on public.payment_allocations for select using (public.has_permission('payments.view') or public.has_permission('finance.view'));

-- returns / refunds
create policy returns_select on public.returns for select using (public.owns_order(order_id) or public.has_permission('orders.view'));
create policy returns_manage on public.returns for all using (public.has_permission('orders.manage')) with check (public.has_permission('orders.manage'));
create policy refunds_select on public.refunds for select using (public.owns_order(order_id) or public.has_permission('payments.view') or public.has_permission('finance.view'));

-- pricing
create policy rates_select on public.exchange_rates for select using (public.has_permission('pricing.manage') or public.has_permission('finance.view') or public.has_permission('purchasing.manage'));
create policy rates_manage on public.exchange_rates for all using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));
create policy pricing_settings_select on public.pricing_settings for select using (public.has_permission('pricing.manage') or public.has_permission('finance.view'));
create policy pricing_settings_manage on public.pricing_settings for all using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'));
create policy cost_calc_select on public.cost_calculations for select using (public.has_permission('pricing.manage') or public.has_permission('finance.view') or public.has_permission('supplier_costs.view'));
create policy cost_calc_insert on public.cost_calculations for insert with check (public.has_permission('pricing.manage'));

-- purchasing
create policy batches_select on public.purchase_batches for select using (public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy batches_update on public.purchase_batches for update using (public.has_permission('purchasing.manage')) with check (public.has_permission('purchasing.manage'));
create policy batch_items_select on public.purchase_batch_items for select using (public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy po_select on public.purchase_orders for select using (public.has_permission('purchasing.manage') or public.has_permission('finance.view') or public.has_permission('shipments.manage'));
create policy po_manage on public.purchase_orders for all using (public.has_permission('purchasing.manage')) with check (public.has_permission('purchasing.manage'));
create policy poi_select on public.purchase_order_items for select using (public.has_permission('purchasing.manage') or public.has_permission('finance.view') or public.has_permission('shipments.manage'));
create policy poi_manage on public.purchase_order_items for all using (public.has_permission('purchasing.manage')) with check (public.has_permission('purchasing.manage'));
create policy supplier_payments_select on public.supplier_payments for select using (public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy supplier_payments_insert on public.supplier_payments for insert with check (public.has_permission('purchasing.manage') or public.has_permission('payments.refund'));

-- shipments
create policy shipments_select on public.shipments for select using (public.has_permission('shipments.manage') or public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy shipments_manage on public.shipments for all using (public.has_permission('shipments.manage')) with check (public.has_permission('shipments.manage'));
create policy shipment_items_select on public.shipment_items for select using (public.has_permission('shipments.manage') or public.has_permission('purchasing.manage') or public.has_permission('finance.view'));
create policy shipment_items_manage on public.shipment_items for all using (public.has_permission('shipments.manage')) with check (public.has_permission('shipments.manage'));
create policy import_costs_select on public.import_costs for select using (public.has_permission('shipments.manage') or public.has_permission('finance.view'));
create policy import_costs_manage on public.import_costs for all using (public.has_permission('shipments.manage')) with check (public.has_permission('shipments.manage'));

-- deliveries
create policy deliveries_select on public.deliveries for select using (public.owns_order(order_id) or public.has_permission('deliveries.view') or public.has_permission('orders.view'));
create policy deliveries_update on public.deliveries for update using (public.has_permission('deliveries.manage')) with check (public.has_permission('deliveries.manage'));
create policy delivery_payments_select on public.delivery_payments for select using (public.has_permission('deliveries.view') or public.has_permission('payments.view'));

-- expenses
create policy expenses_select on public.expenses for select using (public.has_permission('expenses.manage') or public.has_permission('finance.view'));
create policy expenses_manage on public.expenses for all using (public.has_permission('expenses.manage')) with check (public.has_permission('expenses.manage'));

-- notifications
create policy templates_select on public.notification_templates for select using (public.is_staff());
create policy templates_manage on public.notification_templates for all using (public.has_permission('notifications.manage')) with check (public.has_permission('notifications.manage'));
create policy notifications_select on public.notifications for select using (public.has_permission('notifications.manage') or public.has_permission('orders.view'));

-- content
create policy content_public on public.site_content for select
  using ((is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or public.has_permission('content.manage'));
create policy content_manage on public.site_content for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));
create policy reviews_public on public.reviews for select using (is_published or public.has_permission('content.manage'));
create policy reviews_manage on public.reviews for all using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'));
create policy newsletter_staff on public.newsletter_subscribers for select using (public.has_permission('content.manage'));
create policy support_select on public.support_messages for select using (user_id = auth.uid() or public.has_permission('customers.view'));
create policy support_update on public.support_messages for update using (public.has_permission('customers.manage')) with check (public.has_permission('customers.manage'));
-- rate_limits, document_sequences: no policies => no API access.

-- ---------------------------------------------------------------------
-- Storage buckets & policies (Supabase only)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif']),
      ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
      ('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png'])
    on conflict (id) do nothing;

    execute $p$create policy "product images public read" on storage.objects for select using (bucket_id = 'product-images')$p$;
    execute $p$create policy "product images staff write" on storage.objects for insert with check (bucket_id = 'product-images' and public.has_permission('products.manage'))$p$;
    execute $p$create policy "product images staff update" on storage.objects for update using (bucket_id = 'product-images' and public.has_permission('products.manage'))$p$;
    execute $p$create policy "product images staff delete" on storage.objects for delete using (bucket_id = 'product-images' and public.has_permission('products.manage'))$p$;
    -- payment proofs are uploaded by the server (service role) after order-token verification
    execute $p$create policy "payment proofs staff read" on storage.objects for select using (bucket_id = 'payment-proofs' and public.has_permission('payments.view'))$p$;
    execute $p$create policy "documents staff read" on storage.objects for select using (bucket_id = 'documents' and public.is_staff())$p$;
    execute $p$create policy "documents staff write" on storage.objects for insert with check (bucket_id = 'documents' and public.is_staff())$p$;
  end if;
end $$;
