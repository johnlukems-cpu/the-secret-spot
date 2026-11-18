-- =====================================================================
-- STEP 1 – Database schema, business logic & security (run once)
-- Generated from supabase/migrations + seed.sql by scripts/build-setup-sql.py.
-- Paste the whole file into Supabase → SQL Editor → Run.
-- =====================================================================

-- >>> 20261117000001_foundation.sql
-- =====================================================================
-- THE SECRET SPOT – Migration 1: foundation
-- Extensions, enums, helper functions, RBAC tables, audit log.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'super_admin', 'admin', 'finance_manager', 'inventory_manager',
  'order_manager', 'purchasing_manager', 'delivery_manager', 'customer'
);

create type public.currency_code as enum ('SRD', 'EUR', 'USD', 'CNY');

create type public.sales_type as enum ('ready', 'preorder', 'coming_soon');

create type public.product_status as enum ('draft', 'active', 'archived');

create type public.order_status as enum (
  'awaiting_deposit',     -- order placed, waiting for deposit
  'payment_review',       -- proof submitted / under verification
  'confirmed',            -- deposit verified
  'purchasing',           -- pre-order items being purchased
  'in_transit',           -- pre-order items shipped
  'ready_for_delivery',   -- all items available in Suriname
  'out_for_delivery',
  'delivered',            -- handed to customer (balance may still be due)
  'completed',            -- delivered & fully paid
  'cancelled',
  'expired'
);

create type public.payment_status as enum (
  'awaiting_deposit', 'proof_submitted', 'under_verification', 'deposit_verified',
  'partially_paid', 'fully_paid', 'rejected', 'refunded'
);

-- Status of a single payment record (a transfer / cash receipt)
create type public.payment_record_status as enum ('submitted', 'under_verification', 'verified', 'rejected', 'refunded');

create type public.payment_method as enum ('bank_transfer', 'cash', 'card_terminal', 'mobile_transfer', 'other');

create type public.payment_kind as enum ('deposit', 'balance', 'other');

create type public.movement_type as enum (
  'stock_in', 'sale', 'reservation', 'reservation_release', 'adjustment_add',
  'adjustment_remove', 'damaged', 'returned', 'transfer_out', 'transfer_in',
  'shipment_receipt', 'correction'
);

create type public.reservation_status as enum ('active', 'converted', 'released', 'expired');

create type public.purchase_status as enum (
  'draft', 'ordered', 'supplier_confirmed', 'partially_received', 'received', 'cancelled'
);

create type public.batch_status as enum ('open', 'purchasing', 'purchased', 'closed', 'cancelled');

create type public.shipment_status as enum (
  'preparing', 'purchased', 'supplier_processing', 'ready_for_shipment', 'shipped',
  'in_transit', 'customs_clearance', 'arrived', 'received', 'closed'
);

create type public.allocation_method as enum ('value', 'weight', 'volume', 'units', 'manual');

create type public.delivery_status as enum (
  'awaiting_preparation', 'ready_for_delivery', 'assigned', 'out_for_delivery',
  'delivered', 'failed', 'rescheduled'
);

create type public.quotation_status as enum ('active', 'accepted', 'expired', 'cancelled');

create type public.notification_channel as enum ('email', 'whatsapp', 'internal');

create type public.notification_status as enum ('queued', 'sent', 'failed', 'skipped_not_configured');

create type public.refund_status as enum ('requested', 'approved', 'paid', 'rejected');

create type public.return_status as enum ('requested', 'approved', 'received', 'rejected', 'closed');

-- ---------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles & RBAC
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  email text,
  locale text not null default 'nl',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index idx_user_roles_user on public.user_roles(user_id);

create table public.permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role public.app_role not null,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role, permission_code)
);

-- Role helpers. SECURITY DEFINER so they can be used inside RLS policies
-- without recursive policy evaluation on user_roles.
create or replace function public.has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role);
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role <> 'customer');
$$;

create or replace function public.has_permission(_code text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and (ur.role = 'super_admin'
           or exists (select 1 from public.role_permissions rp
                      where rp.role = ur.role and rp.permission_code = _code))
  );
$$;

-- JWT role of the current request ('anon', 'authenticated', 'service_role')
create or replace function public.jwt_role()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
$$;

-- True for trusted server-side callers: the service role (Next.js server code
-- using SUPABASE_SERVICE_ROLE_KEY) or a direct database session (migrations, cron).
create or replace function public.is_trusted_caller()
returns boolean language sql stable as $$
  select public.jwt_role() = 'service_role'
      or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'));
$$;

-- Raise unless the current user holds the permission.
create or replace function public.require_permission(_code text)
returns void language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if public.is_trusted_caller() then
    return;
  end if;
  if not public.has_permission(_code) then
    raise exception 'permission denied: %', _code using errcode = '42501';
  end if;
end $$;

-- New auth user -> profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer')
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  note text
);
create index idx_audit_entity on public.audit_logs(entity_type, entity_id);
create index idx_audit_time on public.audit_logs(occurred_at desc);

create or replace function public.prevent_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create trigger trg_audit_immutable before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();

create or replace function public.write_audit(
  _action text, _entity_type text, _entity_id text,
  _old jsonb default null, _new jsonb default null, _note text default null)
returns void language sql security definer set search_path = public, extensions as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data, note)
  values (auth.uid(), _action, _entity_type, _entity_id, _old, _new, _note);
$$;

-- Generic row-change audit trigger for sensitive tables
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, null),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Business settings (key/value, typed via jsonb) + document sequences
-- ---------------------------------------------------------------------
create table public.business_settings (
  key text primary key,
  value jsonb not null,
  description text,
  is_public boolean not null default false,   -- readable by anonymous visitors
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create trigger trg_business_settings_audit after insert or update or delete on public.business_settings
  for each row execute function public.audit_row_change();

-- audit_row_change expects an "id" column; business_settings uses "key".
create or replace function public.audit_settings_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), 'business_settings',
          case when tg_op = 'DELETE' then old.key else new.key end,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
drop trigger trg_business_settings_audit on public.business_settings;
create trigger trg_business_settings_audit after insert or update or delete on public.business_settings
  for each row execute function public.audit_settings_change();

create or replace function public.setting_numeric(_key text, _default numeric)
returns numeric language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select (value #>> '{}')::numeric from public.business_settings where key = _key), _default);
$$;

create table public.document_sequences (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

-- e.g. next_document_number('TSS') -> TSS-2026-000123
create or replace function public.next_document_number(_prefix text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  _year int := extract(year from now())::int;
  _val int;
begin
  insert into public.document_sequences (prefix, year, last_value) values (_prefix, _year, 1)
  on conflict (prefix, year) do update set last_value = public.document_sequences.last_value + 1
  returning last_value into _val;
  return _prefix || '-' || _year || '-' || lpad(_val::text, 6, '0');
end $$;


-- >>> 20261117000002_catalog_inventory.sql
-- =====================================================================
-- Migration 2: customers, catalogue, inventory, carts
-- =====================================================================

-- ---------------------------------------------------------------------
-- Customers (guest or registered)
-- ---------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  whatsapp text not null,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_customers_whatsapp on public.customers(whatsapp);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Delivery zones (needed by addresses)
-- ---------------------------------------------------------------------
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.delivery_zones(id) on delete set null, -- sub-areas
  fee numeric(12,2) not null default 0 check (fee >= 0),
  promo_fee numeric(12,2) check (promo_fee is null or promo_fee >= 0),
  promo_ends_at timestamptz,
  free_threshold numeric(12,2) check (free_threshold is null or free_threshold >= 0),
  currency public.currency_code not null default 'SRD',
  estimated_days text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, parent_id)
);
create trigger trg_zones_updated before update on public.delivery_zones
  for each row execute function public.set_updated_at();

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text,
  zone_id uuid references public.delivery_zones(id),
  address_line text not null,
  instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_addresses_customer on public.customer_addresses(customer_id);
create trigger trg_addresses_updated before update on public.customer_addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null,
  name_en text,
  slug text not null unique,
  description text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_categories_parent on public.categories(parent_id);
create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text unique,                       -- internal supplier ID
  name text not null,
  contact_person text,
  email text,
  phone text,                             -- WhatsApp / telephone
  website text,
  platform text,                          -- e.g. 1688, Alibaba, Taobao, direct
  country text not null default 'China',
  currency public.currency_code not null default 'CNY',
  payment_terms text,
  shipping_method text,
  rating smallint check (rating between 1 and 5),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  slug text not null unique,
  title text not null,
  title_en text,
  description text,
  description_en text,
  category_id uuid references public.categories(id) on delete set null,
  brand text,
  sales_type public.sales_type not null default 'ready',
  status public.product_status not null default 'draft',
  base_price numeric(12,2) not null check (base_price >= 0),     -- SRD selling price
  promo_price numeric(12,2) check (promo_price is null or promo_price >= 0),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  currency public.currency_code not null default 'SRD',
  deposit_percentage numeric(5,2) check (deposit_percentage is null or deposit_percentage between 0 and 100),
  estimated_delivery_text text,           -- e.g. "3–5 werkdagen" or "4–6 weken"
  preorder_lead_days_min int check (preorder_lead_days_min is null or preorder_lead_days_min >= 0),
  preorder_lead_days_max int check (preorder_lead_days_max is null or preorder_lead_days_max >= 0),
  size_guide text,
  specifications jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  is_featured boolean not null default false,
  is_new_arrival boolean not null default false,
  is_best_seller boolean not null default false,
  weight_kg numeric(10,3),
  volume_m3 numeric(12,6),
  default_supplier_id uuid references public.suppliers(id) on delete set null,
  seo_title text,
  seo_description text,
  popularity_score int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_products_category on public.products(category_id);
create index idx_products_status on public.products(status, sales_type) where deleted_at is null;
create index idx_products_search on public.products using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(brand,'')));
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();
create trigger trg_products_audit after update of base_price, promo_price, status, sales_type, deposit_percentage on public.products
  for each row execute function public.audit_row_change();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null,
  storage_path text,
  alt text,
  color text,                             -- optional: image belongs to a colour
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index idx_product_images_product on public.product_images(product_id, sort_order);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  size text,
  color text,
  color_hex text,
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (product_id, size, color)
);
create index idx_variants_product on public.product_variants(product_id);
create trigger trg_variants_updated before update on public.product_variants
  for each row execute function public.set_updated_at();

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade,
  supplier_sku text,
  supplier_url text,
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  currency public.currency_code not null,
  min_order_qty int not null default 1,
  lead_time_days int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_supplier_products_supplier on public.supplier_products(supplier_id);
create index idx_supplier_products_variant on public.supplier_products(variant_id);
-- Supplier pricing is confidential: it lives only here (staff-only RLS),
-- never on the publicly readable product/variant tables.
create trigger trg_supplier_products_updated before update on public.supplier_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------
create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  location_id uuid not null references public.storage_locations(id) on delete restrict,
  physical_qty int not null default 0,
  reserved_qty int not null default 0,
  damaged_qty int not null default 0,
  returned_qty int not null default 0,
  available_qty int generated always as (physical_qty - reserved_qty) stored,
  low_stock_threshold int not null default 2,
  unit_cost numeric(14,4),                -- weighted average landed cost (SRD)
  updated_at timestamptz not null default now(),
  unique (variant_id, location_id),
  constraint inventory_physical_nonneg check (physical_qty >= 0),
  constraint inventory_reserved_nonneg check (reserved_qty >= 0),
  constraint inventory_reserved_le_physical check (reserved_qty <= physical_qty),
  constraint inventory_damaged_nonneg check (damaged_qty >= 0),
  constraint inventory_returned_nonneg check (returned_qty >= 0)
);
create index idx_inventory_variant on public.inventory(variant_id);
create trigger trg_inventory_updated before update on public.inventory
  for each row execute function public.set_updated_at();

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  location_id uuid not null references public.storage_locations(id),
  movement_type public.movement_type not null,
  quantity int not null,                  -- signed change to physical qty (0 for pure reservation moves)
  reserved_change int not null default 0, -- signed change to reserved qty
  reason text not null,
  reference_type text,
  reference_id uuid,
  unit_cost numeric(14,4),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index idx_movements_variant on public.inventory_movements(variant_id, created_at desc);
create trigger trg_movements_immutable before update or delete on public.inventory_movements
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------
-- Carts (server-persisted carts for logged-in customers; guests use a
-- client-side cart that is re-priced server-side at checkout)
-- ---------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
create trigger trg_carts_updated before update on public.carts
  for each row execute function public.set_updated_at();

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  quantity int not null check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);


-- >>> 20261117000003_orders_payments.sql
-- =====================================================================
-- Migration 3: promotions, orders, quotations, payments, reservations,
-- returns & refunds
-- =====================================================================

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique,                      -- null = automatic promotion (not used at checkout)
  name text not null,
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed', 'free_delivery')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  min_order_amount numeric(12,2) not null default 0,
  category_id uuid references public.categories(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int,
  used_count int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_pct_le_100 check (discount_type <> 'percentage' or discount_value <= 100)
);
create trigger trg_promotions_updated before update on public.promotions
  for each row execute function public.set_updated_at();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id),
  user_id uuid references auth.users(id) on delete set null,
  status public.order_status not null default 'awaiting_deposit',
  payment_status public.payment_status not null default 'awaiting_deposit',
  -- customer & delivery snapshot
  customer_name text not null,
  customer_whatsapp text not null,
  customer_email text,
  zone_id uuid references public.delivery_zones(id),
  district text not null,
  delivery_address text not null,
  delivery_instructions text,
  -- money (all SRD)
  currency public.currency_code not null default 'SRD',
  ready_subtotal numeric(12,2) not null default 0,
  preorder_subtotal numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null,
  discount_total numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  deposit_ready_pct numeric(5,2) not null,
  deposit_preorder_pct numeric(5,2) not null,
  deposit_required numeric(12,2) not null,
  amount_verified numeric(12,2) not null default 0,
  amount_refunded numeric(12,2) not null default 0,
  balance_due numeric(12,2) generated always as (total - amount_verified + amount_refunded) stored,
  promotion_id uuid references public.promotions(id),
  promo_code text,
  has_preorder boolean not null default false,
  has_ready boolean not null default false,
  payment_deadline timestamptz,
  quote_valid_until timestamptz,
  access_token_hash text not null,        -- sha256 of the guest access token
  customer_note text,
  internal_note text,
  confirmed_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_amounts_nonneg check (subtotal >= 0 and total >= 0 and deposit_required >= 0 and amount_verified >= 0),
  constraint orders_deposit_le_total check (deposit_required <= total)
);
create index idx_orders_customer on public.orders(customer_id);
create index idx_orders_user on public.orders(user_id);
create index idx_orders_status on public.orders(status);
create index idx_orders_payment_status on public.orders(payment_status);
create index idx_orders_created on public.orders(created_at desc);
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();
create trigger trg_orders_audit after update of status, payment_status, total, amount_verified, amount_refunded on public.orders
  for each row execute function public.audit_row_change();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  sku text not null,
  title text not null,
  size text,
  color text,
  sales_type public.sales_type not null check (sales_type in ('ready', 'preorder')),
  quantity int not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_discount numeric(12,2) not null default 0,
  line_total numeric(12,2) not null,
  deposit_pct numeric(5,2) not null,
  deposit_amount numeric(12,2) not null,
  estimated_ready_from date,
  estimated_ready_to date,
  fulfilment_status text not null default 'pending' check (fulfilment_status in
    ('pending', 'reserved', 'awaiting_purchase', 'purchased', 'in_transit', 'received', 'allocated', 'delivered', 'cancelled')),
  qty_allocated int not null default 0 check (qty_allocated >= 0),  -- pre-order units received & allocated
  unit_cost_estimate numeric(14,4),   -- SRD landed cost estimate
  unit_cost_actual numeric(14,4),     -- SRD landed cost after reconciliation
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_alloc_le_qty check (qty_allocated <= quantity)
);
create index idx_order_items_order on public.order_items(order_id);
create index idx_order_items_variant on public.order_items(variant_id);
create index idx_order_items_preorder on public.order_items(sales_type, fulfilment_status);
create trigger trg_order_items_updated before update on public.order_items
  for each row execute function public.set_updated_at();

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  location_id uuid not null references public.storage_locations(id),
  quantity int not null check (quantity > 0),
  status public.reservation_status not null default 'active',
  expires_at timestamptz,            -- null = held until fulfilment (deposit verified)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_reservations_active on public.stock_reservations(status, expires_at) where status = 'active';
create index idx_reservations_order on public.stock_reservations(order_id);
create trigger trg_reservations_updated before update on public.stock_reservations
  for each row execute function public.set_updated_at();

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.quotation_status not null default 'active',
  total numeric(12,2) not null,
  deposit_required numeric(12,2) not null,
  currency public.currency_code not null default 'SRD',
  valid_until timestamptz not null,
  snapshot jsonb not null,           -- frozen copy of lines & terms at issue time
  issued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_quotations_order on public.quotations(order_id);
create trigger trg_quotations_updated before update on public.quotations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Bank accounts (private: never exposed directly to anon)
-- ---------------------------------------------------------------------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_holder text not null,
  account_number text not null,
  currency public.currency_code not null default 'SRD',
  instructions text,
  reference_format text not null default '{order_number}',
  show_at_checkout boolean not null default false,   -- explicit approval to display
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_bank_updated before update on public.bank_accounts
  for each row execute function public.set_updated_at();
create trigger trg_bank_audit after insert or update or delete on public.bank_accounts
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique,
  order_id uuid not null references public.orders(id),
  kind public.payment_kind not null default 'deposit',
  method public.payment_method not null default 'bank_transfer',
  amount numeric(12,2) not null check (amount > 0),
  currency public.currency_code not null default 'SRD',
  reference text,
  payer_name text,
  transaction_date date,
  status public.payment_record_status not null default 'submitted',
  source text not null default 'customer' check (source in ('customer', 'admin', 'delivery')),
  submitted_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  bank_account_id uuid references public.bank_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_order on public.payments(order_id);
create index idx_payments_status on public.payments(status);
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- Immutable payment history
create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id),
  order_id uuid not null references public.orders(id),
  event text not null,
  from_status public.payment_record_status,
  to_status public.payment_record_status,
  amount numeric(12,2),
  note text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index idx_payment_events_payment on public.payment_events(payment_id);
create trigger trg_payment_events_immutable before update or delete on public.payment_events
  for each row execute function public.prevent_mutation();

create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes int check (size_bytes is null or size_bytes <= 10485760),
  uploaded_at timestamptz not null default now()
);
create index idx_payment_proofs_payment on public.payment_proofs(payment_id);

-- Which order a verified payment is credited to (supports one transfer
-- covering several orders in future; currently 1:1)
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  order_id uuid not null references public.orders(id),
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index idx_payment_alloc_order on public.payment_allocations(order_id);
create trigger trg_payment_alloc_immutable before update or delete on public.payment_allocations
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------
-- Returns & refunds
-- ---------------------------------------------------------------------
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  order_item_id uuid references public.order_items(id),
  quantity int not null check (quantity > 0),
  reason text not null,
  condition text,                    -- resellable / damaged
  status public.return_status not null default 'requested',
  restocked boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_returns_updated before update on public.returns
  for each row execute function public.set_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  payment_id uuid references public.payments(id),
  return_id uuid references public.returns(id),
  amount numeric(12,2) not null check (amount > 0),
  currency public.currency_code not null default 'SRD',
  reason text not null,
  method public.payment_method not null default 'bank_transfer',
  reference text,
  status public.refund_status not null default 'requested',
  approved_by uuid,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_refunds_updated before update on public.refunds
  for each row execute function public.set_updated_at();
create trigger trg_refunds_audit after insert or update on public.refunds
  for each row execute function public.audit_row_change();


-- >>> 20261117000004_purchasing_import.sql
-- =====================================================================
-- Migration 4: pricing, exchange rates, purchasing, shipments
-- =====================================================================

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency public.currency_code not null,
  to_currency public.currency_code not null,
  rate numeric(18,8) not null check (rate > 0),     -- 1 from = rate * to
  effective_date date not null,
  source text,                                        -- e.g. "CBvS koers", "bank", "manual"
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (from_currency, to_currency, effective_date),
  check (from_currency <> to_currency)
);
create index idx_exchange_rates_lookup on public.exchange_rates(from_currency, to_currency, effective_date desc);
create trigger trg_exchange_rates_audit after insert or update or delete on public.exchange_rates
  for each row execute function public.audit_row_change();

-- Rate lookup. Never assumes a rate: raises when none is configured.
-- Tries a direct rate, then the inverse of the reverse rate.
create or replace function public.get_exchange_rate(_from public.currency_code, _to public.currency_code, _on date default current_date)
returns numeric language plpgsql stable security definer set search_path = public, extensions as $$
declare _r numeric;
begin
  if _from = _to then return 1; end if;
  select rate into _r from public.exchange_rates
   where from_currency = _from and to_currency = _to and effective_date <= _on
   order by effective_date desc limit 1;
  if _r is not null then return _r; end if;
  select 1 / rate into _r from public.exchange_rates
   where from_currency = _to and to_currency = _from and effective_date <= _on
   order by effective_date desc limit 1;
  if _r is null then
    raise exception 'No exchange rate configured for % -> % on %', _from, _to, _on using errcode = 'P0002';
  end if;
  return round(_r, 8);
end $$;

create table public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  target_margin_pct numeric(5,2) not null default 40 check (target_margin_pct >= 0 and target_margin_pct < 100),
  customs_duty_pct numeric(5,2) not null default 0 check (customs_duty_pct >= 0),
  import_tax_pct numeric(5,2) not null default 0 check (import_tax_pct >= 0),
  shipping_per_kg_srd numeric(12,2),
  clearance_per_unit_srd numeric(12,2) not null default 0,
  local_transport_per_unit_srd numeric(12,2) not null default 0,
  packaging_per_unit_srd numeric(12,2) not null default 0,
  rounding_step numeric(8,2) not null default 5,   -- round selling price up to this step
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_pricing_settings_default on public.pricing_settings(is_default) where is_default;
create trigger trg_pricing_settings_updated before update on public.pricing_settings
  for each row execute function public.set_updated_at();

create table public.cost_calculations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  shipment_id uuid,                  -- set when this is an actual (reconciled) calculation
  is_estimate boolean not null default true,
  allocation_mode public.allocation_method not null default 'units',
  quantity int not null default 1 check (quantity > 0),
  supplier_price numeric(14,4) not null check (supplier_price >= 0),
  supplier_currency public.currency_code not null,
  exchange_rate numeric(18,8) not null check (exchange_rate > 0),
  exchange_rate_id uuid references public.exchange_rates(id),
  converted_price_srd numeric(14,4) not null,
  shipping_srd numeric(14,4) not null default 0,
  customs_srd numeric(14,4) not null default 0,
  import_tax_srd numeric(14,4) not null default 0,
  clearance_srd numeric(14,4) not null default 0,
  local_transport_srd numeric(14,4) not null default 0,
  packaging_srd numeric(14,4) not null default 0,
  other_srd numeric(14,4) not null default 0,
  landed_cost_srd numeric(14,4) not null,       -- per unit
  target_margin_pct numeric(5,2) not null,
  recommended_price_srd numeric(12,2) not null,
  override_price_srd numeric(12,2),
  final_price_srd numeric(12,2) not null,
  promo_discount_pct numeric(5,2) not null default 0,
  expected_profit_srd numeric(14,4) not null,
  actual_margin_pct numeric(7,2) not null,
  markup_pct numeric(9,2) not null,
  inputs jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index idx_cost_calc_product on public.cost_calculations(product_id, created_at desc);

-- ---------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------
create table public.purchase_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  week_start date not null,
  purchasing_date date,
  supplier_id uuid references public.suppliers(id),
  status public.batch_status not null default 'open',
  expected_cost numeric(14,2) not null default 0,
  actual_cost numeric(14,2),
  currency public.currency_code not null default 'CNY',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_batches_updated before update on public.purchase_batches
  for each row execute function public.set_updated_at();

create table public.purchase_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.purchase_batches(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  variant_id uuid not null references public.product_variants(id),
  quantity int not null check (quantity > 0),
  unit_cost numeric(14,4),
  created_at timestamptz not null default now(),
  unique (batch_id, order_item_id)
);
create index idx_batch_items_order_item on public.purchase_batch_items(order_item_id);

-- A customer order item must never be batched twice for the same quantity.
create or replace function public.check_batch_item_quantity() returns trigger
language plpgsql as $$
declare _ordered int; _batched int;
begin
  select quantity into _ordered from public.order_items where id = new.order_item_id for update;
  select coalesce(sum(bi.quantity), 0) into _batched
    from public.purchase_batch_items bi
    join public.purchase_batches b on b.id = bi.batch_id
   where bi.order_item_id = new.order_item_id
     and b.status <> 'cancelled'
     and bi.id <> new.id;
  if _batched + new.quantity > _ordered then
    raise exception 'Order item % already batched (% of % units)', new.order_item_id, _batched, _ordered
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_batch_item_qty before insert or update on public.purchase_batch_items
  for each row execute function public.check_batch_item_quantity();

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers(id),
  batch_id uuid references public.purchase_batches(id),
  status public.purchase_status not null default 'draft',
  currency public.currency_code not null,
  order_date date,
  expected_ship_date date,
  supplier_reference text,
  supplier_invoice_ref text,
  supplier_invoice_amount numeric(14,2),
  supplier_confirmed_at timestamptz,
  shipping_estimate numeric(14,2) not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_po_supplier on public.purchase_orders(supplier_id);
create trigger trg_po_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create trigger trg_po_audit after update of status, supplier_invoice_amount on public.purchase_orders
  for each row execute function public.audit_row_change();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  description text,
  quantity int not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),   -- supplier currency
  line_total numeric(14,4) generated always as (quantity * unit_cost) stored,
  qty_received int not null default 0 check (qty_received >= 0),
  is_preorder boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint poi_received_le_qty check (qty_received <= quantity)
);
create index idx_poi_po on public.purchase_order_items(purchase_order_id);
create trigger trg_poi_updated before update on public.purchase_order_items
  for each row execute function public.set_updated_at();

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references public.purchase_orders(id),
  supplier_id uuid not null references public.suppliers(id),
  amount numeric(14,2) not null check (amount > 0),
  currency public.currency_code not null,
  exchange_rate numeric(18,8) not null check (exchange_rate > 0),   -- to SRD
  amount_srd numeric(14,2) generated always as (round(amount * exchange_rate, 2)) stored,
  paid_at date not null,
  method text,
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index idx_supplier_payments_po on public.supplier_payments(purchase_order_id);
create trigger trg_supplier_payments_audit after insert or update or delete on public.supplier_payments
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_number text not null unique,
  supplier_id uuid references public.suppliers(id),
  shipping_agent text,
  tracking_number text,
  shipping_method text,                 -- air / sea / courier
  status public.shipment_status not null default 'preparing',
  departure_date date,
  estimated_arrival date,
  actual_arrival date,
  total_weight_kg numeric(12,3),
  total_volume_m3 numeric(12,6),
  allocation_method public.allocation_method not null default 'value',
  costs_allocated_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_shipments_updated before update on public.shipments
  for each row execute function public.set_updated_at();
create trigger trg_shipments_audit after update of status on public.shipments
  for each row execute function public.audit_row_change();

alter table public.cost_calculations
  add constraint fk_cost_calc_shipment foreign key (shipment_id) references public.shipments(id) on delete set null;

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id),
  variant_id uuid not null references public.product_variants(id),
  quantity_shipped int not null check (quantity_shipped > 0),
  quantity_received int not null default 0 check (quantity_received >= 0),
  quantity_damaged int not null default 0 check (quantity_damaged >= 0),
  weight_kg numeric(12,3),
  volume_m3 numeric(12,6),
  goods_value_srd numeric(14,2),        -- purchase value converted to SRD
  manual_share numeric(9,6),            -- manual allocation fraction (0..1)
  allocated_cost_srd numeric(14,2),     -- share of shipment import costs
  landed_unit_cost_srd numeric(14,4),   -- (goods value + allocated cost) / quantity
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint si_received_le_shipped check (quantity_received + quantity_damaged <= quantity_shipped)
);
create index idx_shipment_items_shipment on public.shipment_items(shipment_id);
create index idx_shipment_items_poi on public.shipment_items(purchase_order_item_id);
create trigger trg_shipment_items_updated before update on public.shipment_items
  for each row execute function public.set_updated_at();

-- A PO line may be split across shipments, but never shipped beyond its quantity.
create or replace function public.check_shipment_item_quantity() returns trigger
language plpgsql as $$
declare _ordered int; _shipped int;
begin
  select quantity into _ordered from public.purchase_order_items where id = new.purchase_order_item_id for update;
  select coalesce(sum(quantity_shipped), 0) into _shipped from public.shipment_items
   where purchase_order_item_id = new.purchase_order_item_id and id <> new.id;
  if _shipped + new.quantity_shipped > _ordered then
    raise exception 'PO line % over-shipped (% + % > %)', new.purchase_order_item_id, _shipped, new.quantity_shipped, _ordered
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_shipment_item_qty before insert or update of quantity_shipped on public.shipment_items
  for each row execute function public.check_shipment_item_quantity();

create table public.import_costs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  cost_type text not null check (cost_type in ('shipping', 'customs_duty', 'import_tax', 'clearance', 'local_transport', 'packaging', 'other')),
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  currency public.currency_code not null,
  exchange_rate numeric(18,8) not null check (exchange_rate > 0),
  amount_srd numeric(14,2) generated always as (round(amount * exchange_rate, 2)) stored,
  is_estimate boolean not null default false,
  invoice_ref text,
  paid_at date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_import_costs_shipment on public.import_costs(shipment_id);
create trigger trg_import_costs_updated before update on public.import_costs
  for each row execute function public.set_updated_at();
create trigger trg_import_costs_audit after insert or update or delete on public.import_costs
  for each row execute function public.audit_row_change();


-- >>> 20261117000005_delivery_finance_content.sql
-- =====================================================================
-- Migration 5: deliveries, expenses, notifications, website content
-- =====================================================================

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_number text not null unique,
  order_id uuid not null references public.orders(id),
  zone_id uuid references public.delivery_zones(id),
  district text not null,
  address text not null,
  instructions text,
  customer_name text not null,
  customer_whatsapp text not null,
  assigned_to uuid references auth.users(id),
  scheduled_date date,
  status public.delivery_status not null default 'awaiting_preparation',
  attempt int not null default 1,
  delivered_at timestamptz,
  failure_reason text,
  delivery_cost_srd numeric(12,2) not null default 0,   -- internal cost (courier, fuel)
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_deliveries_order on public.deliveries(order_id);
create index idx_deliveries_status on public.deliveries(status, scheduled_date);
create index idx_deliveries_assignee on public.deliveries(assigned_to);
create trigger trg_deliveries_updated before update on public.deliveries
  for each row execute function public.set_updated_at();
create trigger trg_deliveries_audit after update of status, assigned_to on public.deliveries
  for each row execute function public.audit_row_change();

create table public.delivery_payments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id),
  payment_id uuid not null unique references public.payments(id),
  receipt_number text not null unique,
  collected_by uuid,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('operating', 'delivery', 'marketing', 'rent', 'salaries', 'packaging', 'bank_fees', 'software', 'import', 'other')),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency public.currency_code not null default 'SRD',
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  amount_srd numeric(14,2) generated always as (round(amount * exchange_rate, 2)) stored,
  expense_date date not null,
  shipment_id uuid references public.shipments(id),
  receipt_path text,
  vendor text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_expenses_date on public.expenses(expense_date);
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger trg_expenses_audit after insert or update or delete on public.expenses
  for each row execute function public.audit_row_change();

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  channel public.notification_channel not null,
  locale text not null default 'nl',
  subject text,
  body text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (event, channel, locale)
);
create trigger trg_templates_updated before update on public.notification_templates
  for each row execute function public.set_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  channel public.notification_channel not null,
  order_id uuid references public.orders(id) on delete set null,
  recipient text,
  subject text,
  body text not null,
  status public.notification_status not null default 'queued',
  error text,
  provider_message_id text,
  attempts int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_status on public.notifications(status, created_at);
create index idx_notifications_order on public.notifications(order_id);

-- Homepage / website content managed from the admin
create table public.site_content (
  id uuid primary key default gen_random_uuid(),
  block_type text not null check (block_type in ('announcement', 'hero', 'promo_banner', 'section', 'page')),
  key text,                              -- e.g. section key 'women', page slug 'over-ons'
  title text,
  subtitle text,
  body text,
  image_url text,
  link_url text,
  cta_label text,
  data jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_site_content_type on public.site_content(block_type, sort_order);
create trigger trg_site_content_updated before update on public.site_content
  for each row execute function public.set_updated_at();

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  consent_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  source text
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  order_number text,
  name text not null,
  contact text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now()
);

-- Simple fixed-window rate limiting for sensitive public endpoints
create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.check_rate_limit(_bucket text, _max int, _window_seconds int)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  _ws timestamptz := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  _hits int;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (_bucket, _ws, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into _hits;
  delete from public.rate_limits where window_start < now() - interval '1 day';
  return _hits <= _max;
end $$;


-- >>> 20261117000006_business_functions.sql
-- =====================================================================
-- Migration 6: business logic (transactional RPC functions)
--
-- All money/stock-changing operations live here so they execute inside a
-- single database transaction with row locks. The browser never supplies
-- prices or totals: they are always (re)computed from the database.
-- =====================================================================

alter table public.stock_reservations add column shipment_item_id uuid references public.shipment_items(id);

-- Rate lookup that returns null instead of raising (for reports)
create or replace function public.try_exchange_rate(_from public.currency_code, _to public.currency_code, _on date default current_date)
returns numeric language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return public.get_exchange_rate(_from, _to, _on);
exception when sqlstate 'P0002' then
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------
create or replace function public.effective_unit_price(_product public.products, _variant public.product_variants)
returns numeric language sql stable as $$
  select case
    when _variant.price_override is not null then _variant.price_override
    when _product.promo_price is not null
         and (_product.promo_starts_at is null or _product.promo_starts_at <= now())
         and (_product.promo_ends_at is null or _product.promo_ends_at > now())
      then _product.promo_price
    else _product.base_price
  end;
$$;

create or replace function public.variant_available_qty(_variant_id uuid)
returns int language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(available_qty), 0)::int from public.inventory where variant_id = _variant_id;
$$;

-- ---------------------------------------------------------------------
-- Notifications: render template & queue (dispatch happens in the app)
-- ---------------------------------------------------------------------
create or replace function public.render_template(_text text, _vars jsonb)
returns text language plpgsql immutable as $$
declare _k text; _v text; _out text := coalesce(_text, '');
begin
  for _k, _v in select key, value from jsonb_each_text(coalesce(_vars, '{}'::jsonb)) loop
    _out := replace(_out, '{' || _k || '}', coalesce(_v, ''));
  end loop;
  return _out;
end $$;

create or replace function public.enqueue_order_notification(_event text, _order_id uuid, _extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _t public.notification_templates;
  _vars jsonb;
  _recipient text;
begin
  select * into _o from public.orders where id = _order_id;
  if not found then return; end if;
  _vars := jsonb_build_object(
    'order_number', _o.order_number,
    'customer_name', _o.customer_name,
    'total', to_char(_o.total, 'FM999G999G990D00'),
    'deposit_required', to_char(_o.deposit_required, 'FM999G999G990D00'),
    'amount_paid', to_char(_o.amount_verified, 'FM999G999G990D00'),
    'balance_due', to_char(_o.balance_due, 'FM999G999G990D00'),
    'currency', _o.currency::text,
    'payment_deadline', coalesce(to_char(_o.payment_deadline at time zone 'America/Paramaribo', 'DD-MM-YYYY HH24:MI'), '')
  ) || coalesce(_extra, '{}'::jsonb);

  for _t in select * from public.notification_templates
             where event = _event and is_active and locale = 'nl' loop
    _recipient := case _t.channel when 'email' then _o.customer_email
                                  when 'whatsapp' then _o.customer_whatsapp
                                  else null end;
    if _t.channel <> 'internal' and (_recipient is null or _recipient = '') then
      continue;
    end if;
    insert into public.notifications (event, channel, order_id, recipient, subject, body)
    values (_event, _t.channel, _order_id, _recipient,
            public.render_template(_t.subject, _vars), public.render_template(_t.body, _vars));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- price_cart: authoritative cart calculation (no writes, no locks).
-- Input: {"items":[{"variant_id":uuid,"quantity":int}], "zone_id":uuid?, "promo_code":text?}
-- ---------------------------------------------------------------------
create or replace function public.price_cart(_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  _ready_pct numeric := public.setting_numeric('deposit_ready_pct', 50);
  _pre_pct numeric := public.setting_numeric('deposit_preorder_pct', 50);
  _min_dep numeric := public.setting_numeric('deposit_min_amount', 0);
  _dep_incl_delivery boolean := coalesce((select (value #>> '{}')::boolean from public.business_settings where key = 'deposit_includes_delivery'), false);
  _item jsonb;
  _p public.products;
  _v public.product_variants;
  _qty int;
  _unit numeric;
  _lines jsonb := '[]'::jsonb;
  _errors jsonb := '[]'::jsonb;
  _subtotal numeric := 0;
  _ready_sub numeric := 0;
  _pre_sub numeric := 0;
  _eligible_sub numeric := 0;
  _promo public.promotions;
  _promo_code text := nullif(trim(coalesce(_input->>'promo_code', '')), '');
  _promo_msg text;
  _discount numeric := 0;
  _zone public.delivery_zones;
  _delivery numeric := 0;
  _deposit numeric := 0;
  _line jsonb;
  _line_disc numeric;
  _disc_left numeric;
  _n int;
  _i int := 0;
  _final_lines jsonb := '[]'::jsonb;
  _pct numeric;
  _line_total numeric;
  _avail int;
  _total numeric;
  _seen uuid[] := '{}';
  _cat_ids uuid[];
begin
  if jsonb_typeof(_input->'items') <> 'array' or jsonb_array_length(_input->'items') = 0 then
    raise exception 'Cart is empty' using errcode = '22023';
  end if;
  if jsonb_array_length(_input->'items') > 50 then
    raise exception 'Too many cart lines' using errcode = '22023';
  end if;

  for _item in select * from jsonb_array_elements(_input->'items') loop
    _qty := (_item->>'quantity')::int;
    if _qty is null or _qty < 1 or _qty > 99 then
      raise exception 'Invalid quantity' using errcode = '22023';
    end if;
    select * into _v from public.product_variants where id = (_item->>'variant_id')::uuid and deleted_at is null;
    if not found or not _v.is_active then
      _errors := _errors || jsonb_build_object('variant_id', _item->>'variant_id', 'code', 'unavailable');
      continue;
    end if;
    if _v.id = any(_seen) then
      raise exception 'Duplicate cart line for variant %', _v.id using errcode = '22023';
    end if;
    _seen := _seen || _v.id;
    select * into _p from public.products where id = _v.product_id and deleted_at is null;
    if not found or _p.status <> 'active' or _p.sales_type = 'coming_soon' then
      _errors := _errors || jsonb_build_object('variant_id', _v.id, 'code', 'not_for_sale');
      continue;
    end if;
    _unit := public.effective_unit_price(_p, _v);
    _avail := public.variant_available_qty(_v.id);
    if _p.sales_type = 'ready' and _avail < _qty then
      _errors := _errors || jsonb_build_object('variant_id', _v.id, 'code', 'insufficient_stock', 'available', _avail);
    end if;
    _line_total := round(_unit * _qty, 2);
    _subtotal := _subtotal + _line_total;
    if _p.sales_type = 'ready' then _ready_sub := _ready_sub + _line_total; else _pre_sub := _pre_sub + _line_total; end if;
    _lines := _lines || jsonb_build_object(
      'product_id', _p.id, 'variant_id', _v.id, 'sku', _v.sku, 'title', _p.title, 'slug', _p.slug,
      'size', _v.size, 'color', _v.color, 'sales_type', _p.sales_type, 'quantity', _qty,
      'unit_price', _unit, 'gross_total', _line_total, 'category_id', _p.category_id,
      'product_deposit_pct', _p.deposit_percentage, 'available', _avail,
      'lead_min', _p.preorder_lead_days_min, 'lead_max', _p.preorder_lead_days_max,
      'estimated_delivery_text', _p.estimated_delivery_text);
  end loop;

  -- Promotion
  if _promo_code is not null then
    select * into _promo from public.promotions
     where upper(code) = upper(_promo_code) and is_active
       and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
       and (usage_limit is null or used_count < usage_limit);
    if not found then
      _promo_msg := 'invalid_promo_code';
    elsif _subtotal < _promo.min_order_amount then
      _promo_msg := 'promo_min_order_not_met';
      _promo := null;
    end if;
  end if;

  -- Eligible subtotal for the promotion (category-limited promotions include sub-categories)
  if _promo.id is not null then
    if _promo.category_id is not null then
      with recursive tree as (
        select id from public.categories where id = _promo.category_id
        union all select c.id from public.categories c join tree t on c.parent_id = t.id)
      select array_agg(id) into _cat_ids from tree;
    end if;
    select coalesce(sum((l->>'gross_total')::numeric), 0) into _eligible_sub
      from jsonb_array_elements(_lines) l
     where _cat_ids is null or (l->>'category_id')::uuid = any(_cat_ids);
    if _promo.discount_type = 'percentage' then
      _discount := round(_eligible_sub * _promo.discount_value / 100, 2);
    elsif _promo.discount_type = 'fixed' then
      _discount := least(_promo.discount_value, _eligible_sub);
    end if;
  end if;

  -- Distribute discount over eligible lines (remainder on the last eligible line)
  _disc_left := _discount;
  select count(*) into _n from jsonb_array_elements(_lines) l
   where _cat_ids is null or (l->>'category_id')::uuid = any(_cat_ids);
  for _line in select * from jsonb_array_elements(_lines) loop
    _line_disc := 0;
    if _discount > 0 and (_cat_ids is null or (_line->>'category_id')::uuid = any(_cat_ids)) then
      _i := _i + 1;
      if _i = _n then _line_disc := _disc_left;
      else _line_disc := round(_discount * (_line->>'gross_total')::numeric / nullif(_eligible_sub, 0), 2);
      end if;
      _disc_left := _disc_left - _line_disc;
    end if;
    _line_total := (_line->>'gross_total')::numeric - _line_disc;
    _pct := case when _line->>'sales_type' = 'preorder'
                 then coalesce((_line->>'product_deposit_pct')::numeric, _pre_pct)
                 else _ready_pct end;
    _final_lines := _final_lines || (_line || jsonb_build_object(
      'line_discount', _line_disc, 'line_total', _line_total,
      'deposit_pct', _pct, 'deposit_amount', round(_line_total * _pct / 100, 2)));
    _deposit := _deposit + round(_line_total * _pct / 100, 2);
  end loop;

  -- Delivery fee
  if _input ? 'zone_id' and nullif(_input->>'zone_id', '') is not null then
    select * into _zone from public.delivery_zones where id = (_input->>'zone_id')::uuid and is_active;
    if not found then
      _errors := _errors || jsonb_build_object('code', 'invalid_zone');
    else
      _delivery := case when _zone.promo_fee is not null and (_zone.promo_ends_at is null or _zone.promo_ends_at > now())
                        then _zone.promo_fee else _zone.fee end;
      if _zone.free_threshold is not null and (_subtotal - _discount) >= _zone.free_threshold then
        _delivery := 0;
      end if;
      if _promo.id is not null and _promo.discount_type = 'free_delivery' then
        _delivery := 0;
      end if;
    end if;
  end if;

  _total := _subtotal - _discount + _delivery;
  if _dep_incl_delivery and _delivery > 0 then
    _deposit := _deposit + round(_delivery * greatest(_ready_pct, _pre_pct) / 100, 2);
  end if;
  if _deposit < _min_dep then _deposit := _min_dep; end if;
  if _deposit > _total then _deposit := _total; end if;

  return jsonb_build_object(
    'lines', _final_lines,
    'errors', _errors,
    'currency', 'SRD',
    'ready_subtotal', _ready_sub,
    'preorder_subtotal', _pre_sub,
    'subtotal', _subtotal,
    'discount_total', _discount,
    'promotion_id', _promo.id,
    'promo_code', case when _promo.id is not null then _promo.code end,
    'promo_message', _promo_msg,
    'delivery_fee', _delivery,
    'zone_name', _zone.name,
    'total', _total,
    'deposit_ready_pct', _ready_pct,
    'deposit_preorder_pct', _pre_pct,
    'deposit_required', _deposit,
    'balance_after_deposit', _total - _deposit
  );
end $$;

-- ---------------------------------------------------------------------
-- Internal: reserve stock for a ready-stock order line under row locks.
-- ---------------------------------------------------------------------
create or replace function public._reserve_stock(_order_id uuid, _order_item_id uuid, _variant_id uuid, _qty int,
                                                 _expires timestamptz, _shipment_item_id uuid default null,
                                                 _location_id uuid default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _inv record;
  _left int := _qty;
  _take int;
begin
  for _inv in
    select i.* from public.inventory i join public.storage_locations l on l.id = i.location_id
     where i.variant_id = _variant_id and (_location_id is null or i.location_id = _location_id)
     order by (i.location_id = _location_id) desc nulls last, l.is_default desc, i.available_qty desc
     for update of i
  loop
    exit when _left = 0;
    _take := least(_left, _inv.physical_qty - _inv.reserved_qty);
    if _take > 0 then
      update public.inventory set reserved_qty = reserved_qty + _take where id = _inv.id;
      insert into public.stock_reservations (order_id, order_item_id, variant_id, location_id, quantity, expires_at, shipment_item_id)
      values (_order_id, _order_item_id, _variant_id, _inv.location_id, _take, _expires, _shipment_item_id);
      insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reserved_change, reason, reference_type, reference_id, actor_id)
      values (_variant_id, _inv.location_id, 'reservation', 0, _take, 'Reserved for order', 'order', _order_id, auth.uid());
      _left := _left - _take;
    end if;
  end loop;
  if _left > 0 then
    raise exception 'insufficient_stock: variant % short by %', _variant_id, _left using errcode = 'P0001';
  end if;
end $$;

create or replace function public._release_reservation(_res public.stock_reservations, _new_status public.reservation_status, _reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.inventory set reserved_qty = reserved_qty - _res.quantity
   where variant_id = _res.variant_id and location_id = _res.location_id;
  update public.stock_reservations set status = _new_status where id = _res.id;
  insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reserved_change, reason, reference_type, reference_id, actor_id)
  values (_res.variant_id, _res.location_id, 'reservation_release', 0, -_res.quantity, _reason, 'order', _res.order_id, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- create_order: checkout. Re-prices the cart, reserves ready stock with
-- row locks, creates order, items, quotation and queues notifications.
-- Returns order id/number and a one-time guest access token.
-- ---------------------------------------------------------------------
create or replace function public.create_order(_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _calc jsonb;
  _line jsonb;
  _cust jsonb := _input->'customer';
  _user_id uuid := auth.uid();
  _customer_id uuid;
  _zone public.delivery_zones;
  _order_id uuid;
  _order_number text;
  _token text := encode(gen_random_bytes(24), 'hex');
  _deadline timestamptz := now() + make_interval(hours => public.setting_numeric('payment_deadline_hours', 48)::int);
  _quote_valid timestamptz := now() + make_interval(hours => public.setting_numeric('quote_validity_hours', 72)::int);
  _item_id uuid;
  _quote_number text;
  _has_pre boolean;
  _has_ready boolean;
  _purchase_day date;
begin
  if public.is_trusted_caller() and _input ? 'user_id' and nullif(_input->>'user_id', '') is not null then
    _user_id := (_input->>'user_id')::uuid;   -- server passes the authenticated user id
  end if;

  if coalesce(trim(_cust->>'full_name'), '') = '' or length(_cust->>'full_name') > 120 then
    raise exception 'Full name is required' using errcode = '22023';
  end if;
  if coalesce(_cust->>'whatsapp', '') !~ '^\+?[0-9 ]{7,20}$' then
    raise exception 'A valid WhatsApp number is required' using errcode = '22023';
  end if;
  if coalesce(trim(_input->>'address'), '') = '' then
    raise exception 'Delivery address is required' using errcode = '22023';
  end if;
  select * into _zone from public.delivery_zones where id = nullif(_input->>'zone_id', '')::uuid and is_active;
  if not found then raise exception 'Invalid delivery district' using errcode = '22023'; end if;

  _calc := public.price_cart(_input);
  if jsonb_array_length(_calc->'errors') > 0 then
    raise exception 'cart_invalid: %', (_calc->'errors')::text using errcode = 'P0001';
  end if;
  if nullif(_input->>'promo_code', '') is not null and _calc->>'promotion_id' is null then
    raise exception 'cart_invalid: %', coalesce(_calc->>'promo_message', 'invalid_promo_code') using errcode = 'P0001';
  end if;

  -- Customer record
  if _user_id is not null then
    select id into _customer_id from public.customers where user_id = _user_id;
    if _customer_id is null then
      insert into public.customers (user_id, full_name, whatsapp, email)
      values (_user_id, trim(_cust->>'full_name'), trim(_cust->>'whatsapp'), nullif(trim(_cust->>'email'), ''))
      returning id into _customer_id;
    end if;
  else
    select id into _customer_id from public.customers
     where user_id is null and whatsapp = trim(_cust->>'whatsapp') and deleted_at is null
     order by created_at limit 1;
    if _customer_id is null then
      insert into public.customers (full_name, whatsapp, email)
      values (trim(_cust->>'full_name'), trim(_cust->>'whatsapp'), nullif(trim(_cust->>'email'), ''))
      returning id into _customer_id;
    end if;
  end if;

  select bool_or(l->>'sales_type' = 'preorder'), bool_or(l->>'sales_type' = 'ready')
    into _has_pre, _has_ready from jsonb_array_elements(_calc->'lines') l;

  _order_number := public.next_document_number('TSS');
  insert into public.orders (
    order_number, customer_id, user_id, customer_name, customer_whatsapp, customer_email,
    zone_id, district, delivery_address, delivery_instructions,
    ready_subtotal, preorder_subtotal, subtotal, discount_total, delivery_fee, total,
    deposit_ready_pct, deposit_preorder_pct, deposit_required,
    promotion_id, promo_code, has_preorder, has_ready, payment_deadline, quote_valid_until,
    access_token_hash, customer_note)
  values (
    _order_number, _customer_id, _user_id, trim(_cust->>'full_name'), trim(_cust->>'whatsapp'), nullif(trim(_cust->>'email'), ''),
    _zone.id, _zone.name, trim(_input->>'address'), nullif(trim(_input->>'instructions'), ''),
    (_calc->>'ready_subtotal')::numeric, (_calc->>'preorder_subtotal')::numeric, (_calc->>'subtotal')::numeric,
    (_calc->>'discount_total')::numeric, (_calc->>'delivery_fee')::numeric, (_calc->>'total')::numeric,
    (_calc->>'deposit_ready_pct')::numeric, (_calc->>'deposit_preorder_pct')::numeric, (_calc->>'deposit_required')::numeric,
    nullif(_calc->>'promotion_id', '')::uuid, _calc->>'promo_code', coalesce(_has_pre, false), coalesce(_has_ready, false),
    _deadline, _quote_valid, encode(digest(_token, 'sha256'), 'hex'), nullif(trim(_input->>'note'), ''))
  returning id into _order_id;

  -- Estimated purchasing date for pre-orders: next configured weekday
  _purchase_day := current_date + ((7 + public.setting_numeric('purchasing_weekday', 1)::int - extract(isodow from current_date)::int) % 7);

  for _line in select * from jsonb_array_elements(_calc->'lines') loop
    insert into public.order_items (
      order_id, product_id, variant_id, sku, title, size, color, sales_type, quantity,
      unit_price, line_discount, line_total, deposit_pct, deposit_amount,
      estimated_ready_from, estimated_ready_to, fulfilment_status, unit_cost_estimate)
    values (
      _order_id, (_line->>'product_id')::uuid, (_line->>'variant_id')::uuid, _line->>'sku', _line->>'title',
      _line->>'size', _line->>'color', (_line->>'sales_type')::public.sales_type, (_line->>'quantity')::int,
      (_line->>'unit_price')::numeric, (_line->>'line_discount')::numeric, (_line->>'line_total')::numeric,
      (_line->>'deposit_pct')::numeric, (_line->>'deposit_amount')::numeric,
      case when _line->>'sales_type' = 'preorder' and _line->>'lead_min' is not null then _purchase_day + (_line->>'lead_min')::int end,
      case when _line->>'sales_type' = 'preorder' and _line->>'lead_max' is not null then _purchase_day + (_line->>'lead_max')::int end,
      case when _line->>'sales_type' = 'ready' then 'reserved' else 'pending' end,
      public.latest_estimated_unit_cost((_line->>'variant_id')::uuid))
    returning id into _item_id;

    if _line->>'sales_type' = 'ready' then
      perform public._reserve_stock(_order_id, _item_id, (_line->>'variant_id')::uuid, (_line->>'quantity')::int, _deadline);
    end if;
  end loop;

  if _calc->>'promotion_id' is not null then
    update public.promotions set used_count = used_count + 1
     where id = (_calc->>'promotion_id')::uuid and (usage_limit is null or used_count < usage_limit);
    if not found then raise exception 'cart_invalid: promo_usage_limit_reached' using errcode = 'P0001'; end if;
  end if;

  _quote_number := public.next_document_number('QT');
  insert into public.quotations (quote_number, order_id, total, deposit_required, valid_until, snapshot)
  values (_quote_number, _order_id, (_calc->>'total')::numeric, (_calc->>'deposit_required')::numeric, _quote_valid,
          _calc || jsonb_build_object('terms', (select value from public.business_settings where key = 'cancellation_policy')));

  perform public.enqueue_order_notification('order_created', _order_id);
  perform public.enqueue_order_notification('payment_instructions', _order_id);
  perform public.write_audit('create', 'orders', _order_id::text, null,
                             jsonb_build_object('order_number', _order_number, 'total', _calc->>'total'));

  return jsonb_build_object('order_id', _order_id, 'order_number', _order_number,
                            'access_token', _token, 'quote_number', _quote_number,
                            'total', (_calc->>'total')::numeric, 'deposit_required', (_calc->>'deposit_required')::numeric);
end $$;

-- Latest known landed unit cost (actual reconciled cost preferred over estimates)
create or replace function public.latest_estimated_unit_cost(_variant_id uuid)
returns numeric language sql stable security definer set search_path = public, extensions as $$
  select landed_cost_srd from public.cost_calculations
   where variant_id = _variant_id order by is_estimate asc, created_at desc limit 1;
$$;

-- ---------------------------------------------------------------------
-- Order access check (customer owns it or presents the guest token)
-- ---------------------------------------------------------------------
create or replace function public._order_access(_order_number text, _token text)
returns public.orders language plpgsql stable security definer set search_path = public, extensions as $$
declare _o public.orders;
begin
  select * into _o from public.orders where order_number = upper(trim(_order_number));
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if (auth.uid() is not null and _o.user_id = auth.uid())
     or (_token is not null and _o.access_token_hash = encode(digest(_token, 'sha256'), 'hex'))
     or public.is_trusted_caller()
     or public.has_permission('orders.view') then
    return _o;
  end if;
  raise exception 'order_not_found' using errcode = 'P0002';   -- do not leak existence
end $$;

-- Guest order tracking. Verifies either the access token or the WhatsApp number
-- (last 7 digits) belonging to the order.
create or replace function public.track_order(_order_number text, _token text default null, _whatsapp text default null)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _digits text := right(regexp_replace(coalesce(_whatsapp, ''), '\D', '', 'g'), 7);
begin
  begin
    _o := public._order_access(_order_number, _token);
  exception when sqlstate 'P0002' then
    select * into _o from public.orders where order_number = upper(trim(_order_number));
    if not found or length(_digits) < 7
       or right(regexp_replace(_o.customer_whatsapp, '\D', '', 'g'), 7) <> _digits then
      raise exception 'order_not_found' using errcode = 'P0002';
    end if;
  end;
  return jsonb_build_object(
    'order', jsonb_build_object(
      'order_number', _o.order_number, 'status', _o.status, 'payment_status', _o.payment_status,
      'customer_name', _o.customer_name, 'district', _o.district, 'delivery_address', _o.delivery_address,
      'subtotal', _o.subtotal, 'discount_total', _o.discount_total, 'delivery_fee', _o.delivery_fee,
      'total', _o.total, 'deposit_required', _o.deposit_required, 'amount_verified', _o.amount_verified,
      'balance_due', _o.balance_due, 'payment_deadline', _o.payment_deadline, 'quote_valid_until', _o.quote_valid_until,
      'has_preorder', _o.has_preorder, 'has_ready', _o.has_ready, 'created_at', _o.created_at, 'currency', _o.currency),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'sku', sku, 'size', size, 'color', color, 'sales_type', sales_type, 'quantity', quantity,
        'unit_price', unit_price, 'line_total', line_total, 'deposit_amount', deposit_amount,
        'fulfilment_status', fulfilment_status, 'estimated_ready_from', estimated_ready_from,
        'estimated_ready_to', estimated_ready_to) order by sales_type, created_at), '[]'::jsonb)
        from public.order_items where order_id = _o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'payment_number', payment_number, 'kind', kind, 'amount', amount, 'status', status,
        'reference', reference, 'created_at', created_at, 'rejection_reason', rejection_reason) order by created_at), '[]'::jsonb)
        from public.payments where order_id = _o.id),
    'quotation', (select jsonb_build_object('quote_number', quote_number, 'status', status, 'valid_until', valid_until)
        from public.quotations where order_id = _o.id order by issued_at desc limit 1),
    'delivery', (select jsonb_build_object('status', status, 'scheduled_date', scheduled_date, 'delivered_at', delivered_at)
        from public.deliveries where order_id = _o.id order by created_at desc limit 1)
  );
end $$;

-- Approved bank instructions for checkout (never the full table).
create or replace function public.checkout_bank_instructions()
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'bank_name', bank_name, 'account_holder', account_holder, 'account_number', account_number,
    'currency', currency, 'instructions', instructions, 'reference_format', reference_format) order by sort_order), '[]'::jsonb)
  from public.bank_accounts where is_active and show_at_checkout;
$$;

-- ---------------------------------------------------------------------
-- Recalculate order payment state from verified allocations.
-- ---------------------------------------------------------------------
create or replace function public._refresh_order_payment(_order_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _verified numeric;
  _refunded numeric;
  _pending int;
  _new_ps public.payment_status;
  _has_balance_payment boolean;
begin
  select * into _o from public.orders where id = _order_id for update;
  select coalesce(sum(pa.amount), 0) into _verified
    from public.payment_allocations pa join public.payments p on p.id = pa.payment_id
   where pa.order_id = _order_id and p.status in ('verified', 'refunded');
  select coalesce(sum(amount), 0) into _refunded from public.refunds where order_id = _order_id and status = 'paid';
  select count(*) into _pending from public.payments where order_id = _order_id and status in ('submitted', 'under_verification');
  select exists(select 1 from public.payments where order_id = _order_id and status = 'verified' and kind = 'balance')
    into _has_balance_payment;

  _new_ps := case
    when _refunded > 0 and _refunded >= _verified and _verified > 0 then 'refunded'
    when _verified >= _o.total and _o.total > 0 then 'fully_paid'
    when _verified >= _o.deposit_required and _verified > 0 and not _has_balance_payment then 'deposit_verified'
    when _verified > 0 then 'partially_paid'
    when exists(select 1 from public.payments where order_id = _order_id and status = 'under_verification') then 'under_verification'
    when _pending > 0 then 'proof_submitted'
    when exists(select 1 from public.payments where order_id = _order_id and status = 'rejected') then 'rejected'
    else 'awaiting_deposit' end;

  update public.orders set amount_verified = _verified, amount_refunded = _refunded, payment_status = _new_ps
   where id = _order_id;

  -- Order status transitions driven by payment
  if _o.status in ('awaiting_deposit', 'payment_review') then
    if _verified >= _o.deposit_required and _verified > 0 then
      update public.orders set status = 'confirmed', confirmed_at = now() where id = _order_id;
      -- reservations are now held until fulfilment
      update public.stock_reservations set expires_at = null where order_id = _order_id and status = 'active';
      update public.order_items set fulfilment_status = 'awaiting_purchase'
       where order_id = _order_id and sales_type = 'preorder' and fulfilment_status = 'pending';
      update public.quotations set status = 'accepted' where order_id = _order_id and status = 'active';
      perform public.enqueue_order_notification('order_confirmed', _order_id);
      perform public._refresh_order_readiness(_order_id);
    elsif _pending > 0 then
      update public.orders set status = 'payment_review' where id = _order_id;
    else
      update public.orders set status = 'awaiting_deposit' where id = _order_id;
    end if;
  elsif _o.status = 'delivered' and _verified - _refunded >= _o.total then
    update public.orders set status = 'completed', completed_at = now() where id = _order_id;
    perform public.enqueue_order_notification('order_completed', _order_id);
  end if;
end $$;

-- When every line is physically reserved/allocated, the order is ready for delivery.
create or replace function public._refresh_order_readiness(_order_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _not_ready int;
begin
  select * into _o from public.orders where id = _order_id for update;
  if _o.status not in ('confirmed', 'purchasing', 'in_transit') then return; end if;
  select count(*) into _not_ready from public.order_items oi
   where oi.order_id = _order_id and oi.fulfilment_status <> 'cancelled'
     and coalesce((select sum(quantity) from public.stock_reservations r
                    where r.order_item_id = oi.id and r.status = 'active'), 0) < oi.quantity;
  if _not_ready = 0 then
    update public.orders set status = 'ready_for_delivery' where id = _order_id;
    if not exists (select 1 from public.deliveries where order_id = _order_id and status not in ('failed', 'delivered')) then
      insert into public.deliveries (delivery_number, order_id, zone_id, district, address, instructions, customer_name, customer_whatsapp)
      values (public.next_document_number('DLV'), _order_id, _o.zone_id, _o.district, _o.delivery_address,
              _o.delivery_instructions, _o.customer_name, _o.customer_whatsapp);
    end if;
    perform public.enqueue_order_notification('ready_for_delivery', _order_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Customer payment submission (reference + optional proof file path)
-- ---------------------------------------------------------------------
create or replace function public.submit_payment(_order_number text, _token text, _amount numeric, _reference text,
                                                 _payer_name text default null, _transaction_date date default null,
                                                 _proof jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _pay_id uuid;
  _pay_no text;
  _grace int := public.setting_numeric('verification_grace_hours', 72)::int;
begin
  _o := public._order_access(_order_number, _token);
  if _o.status in ('cancelled', 'expired', 'completed') then
    raise exception 'order_not_payable: order is %', _o.status using errcode = 'P0001';
  end if;
  if _amount is null or _amount <= 0 or _amount > _o.balance_due then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if coalesce(trim(_reference), '') = '' or length(_reference) > 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;
  if (select count(*) from public.payments where order_id = _o.id and status in ('submitted', 'under_verification')) >= 5 then
    raise exception 'too_many_pending_payments' using errcode = 'P0001';
  end if;

  _pay_no := public.next_document_number('PAY');
  insert into public.payments (payment_number, order_id, kind, method, amount, reference, payer_name, transaction_date, status, source, submitted_by)
  values (_pay_no, _o.id, (case when _o.amount_verified >= _o.deposit_required then 'balance' else 'deposit' end)::public.payment_kind,
          'bank_transfer', round(_amount, 2), trim(_reference), nullif(trim(_payer_name), ''), _transaction_date,
          'submitted', 'customer', auth.uid())
  returning id into _pay_id;

  if _proof is not null and nullif(_proof->>'storage_path', '') is not null then
    if (_proof->>'storage_path') not like 'orders/' || _o.id::text || '/%' then
      raise exception 'invalid_proof_path' using errcode = '22023';
    end if;
    insert into public.payment_proofs (payment_id, order_id, storage_path, file_name, mime_type, size_bytes)
    values (_pay_id, _o.id, _proof->>'storage_path', left(_proof->>'file_name', 200), _proof->>'mime_type', (_proof->>'size_bytes')::int);
  end if;

  insert into public.payment_events (payment_id, order_id, event, to_status, amount, actor_id, note)
  values (_pay_id, _o.id, 'submitted', 'submitted', round(_amount, 2), auth.uid(),
          case when _proof is not null then 'with proof' else 'reference only' end);

  -- Keep the stock reservation while the payment is being verified
  update public.stock_reservations set expires_at = greatest(expires_at, now() + make_interval(hours => _grace))
   where order_id = _o.id and status = 'active' and expires_at is not null;
  update public.orders set payment_deadline = greatest(payment_deadline, now() + make_interval(hours => _grace))
   where id = _o.id and status in ('awaiting_deposit', 'payment_review');

  perform public._refresh_order_payment(_o.id);
  perform public.enqueue_order_notification('payment_proof_received', _o.id);
  return jsonb_build_object('payment_id', _pay_id, 'payment_number', _pay_no);
end $$;

-- ---------------------------------------------------------------------
-- Staff: verification workflow
-- ---------------------------------------------------------------------
create or replace function public.mark_payment_under_verification(_payment_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _p public.payments;
begin
  perform public.require_permission('payments.verify');
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if _p.status <> 'submitted' then raise exception 'invalid_payment_state: %', _p.status using errcode = 'P0001'; end if;
  update public.payments set status = 'under_verification' where id = _payment_id;
  insert into public.payment_events (payment_id, order_id, event, from_status, to_status, amount, actor_id)
  values (_payment_id, _p.order_id, 'verification_started', _p.status, 'under_verification', _p.amount, auth.uid());
  perform public._refresh_order_payment(_p.order_id);
end $$;

-- Approve or reject after checking the actual bank statement.
-- _verified_amount lets finance correct the amount to what actually arrived.
create or replace function public.verify_payment(_payment_id uuid, _approve boolean, _note text default null,
                                                 _verified_amount numeric default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _p public.payments;
  _o public.orders;
  _amt numeric;
begin
  perform public.require_permission('payments.verify');
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if _p.status not in ('submitted', 'under_verification') then
    raise exception 'invalid_payment_state: %', _p.status using errcode = 'P0001';
  end if;
  select * into _o from public.orders where id = _p.order_id for update;

  if _approve then
    if _o.status in ('cancelled', 'expired') then
      raise exception 'order_not_payable: order is % – reactivate or refund instead', _o.status using errcode = 'P0001';
    end if;
    _amt := round(coalesce(_verified_amount, _p.amount), 2);
    if _amt <= 0 or _amt > _o.balance_due then
      raise exception 'invalid_amount: verified amount must be between 0 and the outstanding balance (%)', _o.balance_due using errcode = '22023';
    end if;
    update public.payments set status = 'verified', amount = _amt, verified_by = auth.uid(), verified_at = now(),
                               rejection_reason = null where id = _payment_id;
    insert into public.payment_allocations (payment_id, order_id, amount) values (_payment_id, _o.id, _amt);
    insert into public.payment_events (payment_id, order_id, event, from_status, to_status, amount, actor_id, note)
    values (_payment_id, _o.id, 'verified', _p.status, 'verified', _amt, auth.uid(),
            coalesce(_note, '') || case when _amt <> _p.amount then ' (amount corrected from ' || _p.amount || ')' else '' end);
    perform public._refresh_order_payment(_o.id);
    perform public.enqueue_order_notification('deposit_verified', _o.id, jsonb_build_object('payment_amount', _amt));
  else
    if coalesce(trim(_note), '') = '' then
      raise exception 'rejection_reason_required' using errcode = '22023';
    end if;
    update public.payments set status = 'rejected', verified_by = auth.uid(), verified_at = now(), rejection_reason = _note
     where id = _payment_id;
    insert into public.payment_events (payment_id, order_id, event, from_status, to_status, amount, actor_id, note)
    values (_payment_id, _o.id, 'rejected', _p.status, 'rejected', _p.amount, auth.uid(), _note);
    perform public._refresh_order_payment(_o.id);
    perform public.enqueue_order_notification('payment_rejected', _o.id, jsonb_build_object('reason', _note));
  end if;
end $$;

-- Staff-recorded payment (e.g. cash collected at delivery). Cash/card-terminal
-- receipts are verified on recording; bank transfers still require verification.
create or replace function public.record_payment(_order_id uuid, _amount numeric, _method public.payment_method,
                                                 _reference text default null, _delivery_id uuid default null,
                                                 _note text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _pay_id uuid;
  _pay_no text;
  _receipt text;
  _verified boolean := _method in ('cash', 'card_terminal');
begin
  perform public.require_permission('payments.record');
  select * into _o from public.orders where id = _order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if _o.status in ('cancelled', 'expired') then raise exception 'order_not_payable' using errcode = 'P0001'; end if;
  if _amount is null or _amount <= 0 or round(_amount, 2) > _o.balance_due then
    raise exception 'invalid_amount: must be between 0 and the outstanding balance (%)', _o.balance_due using errcode = '22023';
  end if;
  if _method <> 'cash' and coalesce(trim(_reference), '') = '' then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;

  _pay_no := public.next_document_number('PAY');
  insert into public.payments (payment_number, order_id, kind, method, amount, reference, status, source, submitted_by,
                               verified_by, verified_at)
  values (_pay_no, _o.id, (case when _o.amount_verified >= _o.deposit_required then 'balance' else 'deposit' end)::public.payment_kind,
          _method, round(_amount, 2), nullif(trim(_reference), ''),
          (case when _verified then 'verified' else 'submitted' end)::public.payment_record_status,
          case when _delivery_id is not null then 'delivery' else 'admin' end, auth.uid(),
          case when _verified then auth.uid() end, case when _verified then now() end)
  returning id into _pay_id;

  insert into public.payment_events (payment_id, order_id, event, to_status, amount, actor_id, note)
  values (_pay_id, _o.id, 'recorded', (case when _verified then 'verified' else 'submitted' end)::public.payment_record_status, round(_amount, 2), auth.uid(), _note);

  if _verified then
    insert into public.payment_allocations (payment_id, order_id, amount) values (_pay_id, _o.id, round(_amount, 2));
  end if;

  _receipt := public.next_document_number('RCT');
  if _delivery_id is not null then
    if not exists (select 1 from public.deliveries where id = _delivery_id and order_id = _o.id) then
      raise exception 'delivery_mismatch' using errcode = '22023';
    end if;
    insert into public.delivery_payments (delivery_id, payment_id, receipt_number, collected_by)
    values (_delivery_id, _pay_id, _receipt, auth.uid());
  end if;

  perform public._refresh_order_payment(_o.id);
  return jsonb_build_object('payment_id', _pay_id, 'payment_number', _pay_no, 'receipt_number', _receipt, 'verified', _verified);
end $$;

-- ---------------------------------------------------------------------
-- Cancellation (releases reservations; refunds are a separate decision)
-- ---------------------------------------------------------------------
create or replace function public.cancel_order(_order_id uuid, _reason text, _token text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _o public.orders;
  _res public.stock_reservations;
  _is_staff boolean := public.is_trusted_caller() or public.has_permission('orders.manage');
begin
  select * into _o from public.orders where id = _order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if not _is_staff then
    -- customers may cancel their own order only before any payment is verified
    perform public._order_access(_o.order_number, _token);
    if _o.amount_verified > 0 or _o.status not in ('awaiting_deposit', 'payment_review') then
      raise exception 'cancellation_requires_staff: contact The Secret Spot' using errcode = '42501';
    end if;
  end if;
  if _o.status in ('cancelled', 'completed', 'delivered', 'expired') then
    raise exception 'order_not_cancellable: %', _o.status using errcode = 'P0001';
  end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'cancel_reason_required' using errcode = '22023'; end if;
  if exists (select 1 from public.purchase_batch_items bi join public.purchase_batches b on b.id = bi.batch_id
               join public.order_items oi on oi.id = bi.order_item_id
              where oi.order_id = _order_id and b.status in ('purchasing', 'purchased', 'closed')) then
    raise exception 'order_already_purchased: handle via return/refund workflow' using errcode = 'P0001';
  end if;

  -- remove from still-open batches
  delete from public.purchase_batch_items bi using public.order_items oi, public.purchase_batches b
   where bi.order_item_id = oi.id and oi.order_id = _order_id and b.id = bi.batch_id and b.status = 'open';

  for _res in select * from public.stock_reservations where order_id = _order_id and status = 'active' for update loop
    perform public._release_reservation(_res, 'released', 'Order cancelled');
  end loop;

  update public.order_items set fulfilment_status = 'cancelled' where order_id = _order_id;
  update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = _reason where id = _order_id;
  update public.quotations set status = 'cancelled' where order_id = _order_id and status = 'active';
  update public.payments set status = 'rejected', rejection_reason = 'Order cancelled'
   where order_id = _order_id and status in ('submitted', 'under_verification');
  update public.deliveries set status = 'failed', failure_reason = 'Order cancelled'
   where order_id = _order_id and status not in ('delivered', 'failed');
  perform public.write_audit('cancel', 'orders', _order_id::text, null, null, _reason);
end $$;

-- ---------------------------------------------------------------------
-- Expiry job: releases unpaid reservations, expires orders & quotations.
-- Run every 15 minutes (Vercel cron -> /api/cron/maintenance or pg_cron).
-- ---------------------------------------------------------------------
create or replace function public.run_expiry_jobs()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _res public.stock_reservations;
  _released int := 0;
  _expired_orders int := 0;
  _expired_quotes int := 0;
begin
  perform public.require_permission('orders.manage');
  for _res in select * from public.stock_reservations
               where status = 'active' and expires_at is not null and expires_at < now()
               for update skip locked loop
    perform public._release_reservation(_res, 'expired', 'Payment deadline passed');
    _released := _released + 1;
  end loop;

  with exp as (
    update public.orders o set status = 'expired', cancelled_at = now(), cancel_reason = 'Payment deadline passed'
     where o.status = 'awaiting_deposit' and o.amount_verified = 0 and o.payment_deadline < now()
       and not exists (select 1 from public.payments p where p.order_id = o.id and p.status in ('submitted', 'under_verification'))
    returning o.id)
  select count(*) into _expired_orders from exp;

  update public.order_items oi set fulfilment_status = 'cancelled'
    from public.orders o where o.id = oi.order_id and o.status = 'expired' and oi.fulfilment_status <> 'cancelled';

  with q as (
    update public.quotations set status = 'expired' where status = 'active' and valid_until < now() returning id)
  select count(*) into _expired_quotes from q;

  return jsonb_build_object('released_reservations', _released, 'expired_orders', _expired_orders, 'expired_quotations', _expired_quotes);
end $$;

-- ---------------------------------------------------------------------
-- Inventory adjustments
-- kinds: add | remove | damaged | returned | correction (sets absolute physical qty)
-- ---------------------------------------------------------------------
create or replace function public.adjust_inventory(_variant_id uuid, _location_id uuid, _kind text, _qty int, _reason text,
                                                   _unit_cost numeric default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  _inv public.inventory;
  _delta int;
  _mt public.movement_type;
begin
  perform public.require_permission('inventory.manage');
  if coalesce(trim(_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if _qty is null or _qty < 0 or (_kind <> 'correction' and _qty = 0) then raise exception 'invalid_quantity' using errcode = '22023'; end if;

  insert into public.inventory (variant_id, location_id) values (_variant_id, _location_id)
  on conflict (variant_id, location_id) do nothing;
  select * into _inv from public.inventory where variant_id = _variant_id and location_id = _location_id for update;

  case _kind
    when 'add' then _delta := _qty; _mt := 'adjustment_add';
    when 'remove' then _delta := -_qty; _mt := 'adjustment_remove';
    when 'damaged' then _delta := -_qty; _mt := 'damaged';
    when 'returned' then _delta := _qty; _mt := 'returned';
    when 'correction' then _delta := _qty - _inv.physical_qty; _mt := 'correction';
    else raise exception 'invalid_adjustment_kind' using errcode = '22023';
  end case;

  if _inv.physical_qty + _delta < _inv.reserved_qty then
    raise exception 'adjustment_below_reserved: % reserved units cannot be removed', _inv.reserved_qty using errcode = 'P0001';
  end if;

  update public.inventory set
    physical_qty = physical_qty + _delta,
    damaged_qty = damaged_qty + case when _kind = 'damaged' then _qty else 0 end,
    returned_qty = returned_qty + case when _kind = 'returned' then _qty else 0 end,
    unit_cost = case when _delta > 0 and _unit_cost is not null
                     then round((coalesce(unit_cost, _unit_cost) * physical_qty + _unit_cost * _delta) / nullif(physical_qty + _delta, 0), 4)
                     else unit_cost end
   where id = _inv.id;

  insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reason, reference_type, unit_cost, actor_id)
  values (_variant_id, _location_id, _mt, _delta, _reason, 'adjustment', _unit_cost, auth.uid());
end $$;

create or replace function public.transfer_stock(_variant_id uuid, _from uuid, _to uuid, _qty int, _reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _src public.inventory;
begin
  perform public.require_permission('inventory.manage');
  if _from = _to or _qty is null or _qty <= 0 then raise exception 'invalid_transfer' using errcode = '22023'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  select * into _src from public.inventory where variant_id = _variant_id and location_id = _from for update;
  if not found or _src.available_qty < _qty then raise exception 'insufficient_stock' using errcode = 'P0001'; end if;
  insert into public.inventory (variant_id, location_id, unit_cost) values (_variant_id, _to, _src.unit_cost)
  on conflict (variant_id, location_id) do nothing;
  update public.inventory set physical_qty = physical_qty - _qty where id = _src.id;
  update public.inventory set physical_qty = physical_qty + _qty, unit_cost = coalesce(unit_cost, _src.unit_cost)
   where variant_id = _variant_id and location_id = _to;
  insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reason, reference_type, actor_id)
  values (_variant_id, _from, 'transfer_out', -_qty, _reason, 'transfer', auth.uid()),
         (_variant_id, _to, 'transfer_in', _qty, _reason, 'transfer', auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- Purchasing: weekly report of eligible, deposit-verified pre-order units
-- that are not yet in an active purchasing batch.
-- ---------------------------------------------------------------------
create or replace function public.purchasing_report()
returns table (
  supplier_id uuid, supplier_name text, product_id uuid, product_title text, variant_id uuid, sku text,
  size text, color text, total_units int, supplier_unit_cost numeric, supplier_currency public.currency_code,
  total_supplier_cost numeric, order_count int, order_item_ids uuid[])
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public.require_permission('purchasing.manage');
  return query
  with eligible as (
    select oi.id, oi.order_id, oi.variant_id, oi.product_id,
           oi.quantity - coalesce((select sum(bi.quantity) from public.purchase_batch_items bi
                                    join public.purchase_batches b on b.id = bi.batch_id
                                   where bi.order_item_id = oi.id and b.status <> 'cancelled'), 0) as open_qty
      from public.order_items oi join public.orders o on o.id = oi.order_id
     where oi.sales_type = 'preorder'
       and oi.fulfilment_status = 'awaiting_purchase'
       and o.status in ('confirmed', 'purchasing')
       and o.amount_verified >= o.deposit_required)
  select s.id, s.name, p.id, p.title, v.id, v.sku, v.size, v.color,
         sum(e.open_qty)::int,
         sp.unit_cost,
         coalesce(sp.currency, s.currency),
         round(sum(e.open_qty) * coalesce(sp.unit_cost, 0), 2),
         count(distinct e.order_id)::int,
         array_agg(e.id)
    from eligible e
    join public.product_variants v on v.id = e.variant_id
    join public.products p on p.id = e.product_id
    left join public.suppliers s on s.id = p.default_supplier_id
    left join lateral (select x.unit_cost, x.currency from public.supplier_products x
                        where x.supplier_id = s.id and (x.variant_id = v.id or (x.variant_id is null and x.product_id = p.id))
                        order by (x.variant_id is not null) desc, x.updated_at desc limit 1) sp on true
   where e.open_qty > 0
   group by s.id, s.name, p.id, p.title, v.id, v.sku, v.size, v.color, sp.unit_cost, sp.currency, s.currency
   order by s.name nulls last, p.title, v.sku;
end $$;

-- Create a batch for one supplier containing all its eligible open units.
create or replace function public.create_purchase_batch(_supplier_id uuid, _week_start date default null, _notes text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  _batch_id uuid;
  _r record;
  _added int := 0;
  _supplier public.suppliers;
begin
  perform public.require_permission('purchasing.manage');
  select * into _supplier from public.suppliers where id = _supplier_id;
  if not found then raise exception 'supplier_not_found' using errcode = 'P0002'; end if;
  insert into public.purchase_batches (batch_number, week_start, supplier_id, currency, notes, created_by)
  values (public.next_document_number('PB'), coalesce(_week_start, date_trunc('week', current_date)::date), _supplier_id,
          _supplier.currency, _notes, auth.uid())
  returning id into _batch_id;

  for _r in
    select oi.id, oi.variant_id, oi.product_id, oi.quantity,
           oi.quantity - coalesce((select sum(bi.quantity) from public.purchase_batch_items bi
                                    join public.purchase_batches b on b.id = bi.batch_id
                                   where bi.order_item_id = oi.id and b.status <> 'cancelled'), 0) as open_qty
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.products p on p.id = oi.product_id
     where oi.sales_type = 'preorder' and oi.fulfilment_status = 'awaiting_purchase'
       and o.status in ('confirmed', 'purchasing') and o.amount_verified >= o.deposit_required
       and p.default_supplier_id = _supplier_id
     order by o.confirmed_at
     for update of oi
  loop
    if _r.open_qty > 0 then
      insert into public.purchase_batch_items (batch_id, order_item_id, variant_id, quantity, unit_cost)
      values (_batch_id, _r.id, _r.variant_id, _r.open_qty,
              (select unit_cost from public.supplier_products sp
                where sp.supplier_id = _supplier_id
                  and (sp.variant_id = _r.variant_id or (sp.variant_id is null and sp.product_id = _r.product_id))
                order by (sp.variant_id is not null) desc, updated_at desc limit 1));
      _added := _added + 1;
    end if;
  end loop;

  if _added = 0 then
    raise exception 'no_eligible_preorders for this supplier' using errcode = 'P0001';
  end if;

  update public.purchase_batches set expected_cost =
    (select coalesce(round(sum(quantity * coalesce(unit_cost, 0)), 2), 0) from public.purchase_batch_items where batch_id = _batch_id)
   where id = _batch_id;
  update public.orders o set status = 'purchasing'
   where o.status = 'confirmed' and exists (select 1 from public.order_items oi join public.purchase_batch_items bi on bi.order_item_id = oi.id
                                             where oi.order_id = o.id and bi.batch_id = _batch_id);
  perform public.write_audit('create', 'purchase_batches', _batch_id::text, null, jsonb_build_object('lines', _added));
  return _batch_id;
end $$;

-- Generate a draft purchase order from a batch (lines grouped by variant)
create or replace function public.create_po_from_batch(_batch_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare _b public.purchase_batches; _po uuid;
begin
  perform public.require_permission('purchasing.manage');
  select * into _b from public.purchase_batches where id = _batch_id for update;
  if not found then raise exception 'batch_not_found' using errcode = 'P0002'; end if;
  if _b.status not in ('open', 'purchasing') then raise exception 'batch_not_open' using errcode = 'P0001'; end if;
  if exists (select 1 from public.purchase_orders where batch_id = _batch_id and status <> 'cancelled') then
    raise exception 'batch_already_has_po' using errcode = 'P0001';
  end if;
  insert into public.purchase_orders (po_number, supplier_id, batch_id, currency, order_date, created_by)
  values (public.next_document_number('PO'), _b.supplier_id, _batch_id, _b.currency, current_date, auth.uid())
  returning id into _po;
  insert into public.purchase_order_items (purchase_order_id, variant_id, description, quantity, unit_cost, is_preorder)
  select _po, bi.variant_id, max(p.title || ' / ' || coalesce(v.size, '-') || ' / ' || coalesce(v.color, '-')),
         sum(bi.quantity), coalesce(max(bi.unit_cost), 0), true
    from public.purchase_batch_items bi
    join public.product_variants v on v.id = bi.variant_id
    join public.products p on p.id = v.product_id
   where bi.batch_id = _batch_id group by bi.variant_id;
  update public.purchase_batches set status = 'purchasing', purchasing_date = coalesce(purchasing_date, current_date) where id = _batch_id;
  return _po;
end $$;

-- PO status changes ripple to batch & customer order items
create or replace function public.set_purchase_order_status(_po_id uuid, _status public.purchase_status)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _po public.purchase_orders;
begin
  perform public.require_permission('purchasing.manage');
  select * into _po from public.purchase_orders where id = _po_id for update;
  if not found then raise exception 'po_not_found' using errcode = 'P0002'; end if;
  update public.purchase_orders set status = _status,
         supplier_confirmed_at = case when _status = 'supplier_confirmed' then now() else supplier_confirmed_at end,
         order_date = case when _status = 'ordered' then coalesce(order_date, current_date) else order_date end
   where id = _po_id;
  if _status in ('ordered', 'supplier_confirmed') and _po.batch_id is not null then
    update public.purchase_batches set status = 'purchased' where id = _po.batch_id and status in ('open', 'purchasing');
    update public.order_items oi set fulfilment_status = 'purchased'
      from public.purchase_batch_items bi
     where bi.order_item_id = oi.id and bi.batch_id = _po.batch_id and oi.fulfilment_status = 'awaiting_purchase';
    perform public.enqueue_order_notification('supplier_order_placed', o.id)
       from public.orders o
      where exists (select 1 from public.order_items oi join public.purchase_batch_items bi on bi.order_item_id = oi.id
                     where oi.order_id = o.id and bi.batch_id = _po.batch_id);
  elsif _status = 'cancelled' and _po.batch_id is not null then
    update public.purchase_batches set status = 'open' where id = _po.batch_id and status in ('purchasing', 'purchased');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------
create or replace function public.set_shipment_status(_shipment_id uuid, _status public.shipment_status)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _s public.shipments;
begin
  perform public.require_permission('shipments.manage');
  select * into _s from public.shipments where id = _shipment_id for update;
  if not found then raise exception 'shipment_not_found' using errcode = 'P0002'; end if;
  update public.shipments set status = _status,
    departure_date = case when _status = 'shipped' then coalesce(departure_date, current_date) else departure_date end,
    actual_arrival = case when _status = 'arrived' then coalesce(actual_arrival, current_date) else actual_arrival end
   where id = _shipment_id;

  if _status in ('shipped', 'in_transit', 'customs_clearance', 'arrived') then
    -- pre-order lines in the purchase orders of this shipment are now in transit
    with affected as (
      select distinct oi.id, oi.order_id from public.shipment_items si
        join public.purchase_order_items poi on poi.id = si.purchase_order_item_id
        join public.purchase_orders po on po.id = poi.purchase_order_id
        join public.purchase_batch_items bi on bi.batch_id = po.batch_id and bi.variant_id = poi.variant_id
        join public.order_items oi on oi.id = bi.order_item_id
       where si.shipment_id = _shipment_id and oi.fulfilment_status in ('purchased', 'awaiting_purchase'))
    update public.order_items oi set fulfilment_status = 'in_transit' from affected a where a.id = oi.id;
    update public.orders o set status = 'in_transit'
     where o.status in ('confirmed', 'purchasing')
       and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.fulfilment_status = 'in_transit');
    if _status = 'shipped' then
      perform public.enqueue_order_notification('shipment_dispatched', o.id) from public.orders o
       where exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.fulfilment_status = 'in_transit')
         and o.status = 'in_transit';
    elsif _status = 'arrived' then
      perform public.enqueue_order_notification('shipment_arrived', o.id) from public.orders o
       where exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.fulfilment_status = 'in_transit')
         and o.status = 'in_transit';
    end if;
  end if;
end $$;

-- Goods value (SRD) for shipment lines, using the rate on the departure date.
create or replace function public._shipment_goods_value(_shipment_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _s public.shipments;
begin
  select * into _s from public.shipments where id = _shipment_id;
  update public.shipment_items si
     set goods_value_srd = round(si.quantity_shipped * poi.unit_cost *
                                 public.get_exchange_rate(po.currency, 'SRD', coalesce(_s.departure_date, current_date)), 2)
    from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
   where poi.id = si.purchase_order_item_id and si.shipment_id = _shipment_id;
end $$;

-- Allocate shipment import costs to lines by value/weight/volume/units/manual.
-- Uses actual (non-estimate) costs when any exist, else estimates.
create or replace function public.allocate_shipment_costs(_shipment_id uuid, _method public.allocation_method default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _s public.shipments;
  _m public.allocation_method;
  _total_cost numeric;
  _uses_actual boolean;
  _basis_total numeric;
  _allocated numeric := 0;
  _r record;
  _share numeric;
  _last_id uuid;
  _rate_delta numeric;
begin
  perform public.require_permission('shipments.manage');
  select * into _s from public.shipments where id = _shipment_id for update;
  if not found then raise exception 'shipment_not_found' using errcode = 'P0002'; end if;
  _m := coalesce(_method, _s.allocation_method);
  if not exists (select 1 from public.shipment_items where shipment_id = _shipment_id) then
    raise exception 'shipment_has_no_items' using errcode = 'P0001';
  end if;

  perform public._shipment_goods_value(_shipment_id);

  select exists (select 1 from public.import_costs where shipment_id = _shipment_id and not is_estimate) into _uses_actual;
  select coalesce(sum(amount_srd), 0) into _total_cost from public.import_costs
   where shipment_id = _shipment_id and is_estimate = not _uses_actual;

  select coalesce(sum(case _m when 'value' then goods_value_srd when 'weight' then weight_kg
                               when 'volume' then volume_m3 when 'units' then quantity_shipped
                               when 'manual' then manual_share end), 0)
    into _basis_total from public.shipment_items where shipment_id = _shipment_id;
  if _basis_total <= 0 then
    raise exception 'allocation_basis_missing: every line needs a % value', _m using errcode = 'P0001';
  end if;
  if _m = 'manual' and abs(_basis_total - 1) > 0.0001 then
    raise exception 'manual_shares_must_sum_to_1 (currently %)', _basis_total using errcode = 'P0001';
  end if;

  for _r in select si.*, (case _m when 'value' then goods_value_srd when 'weight' then weight_kg
                                  when 'volume' then volume_m3 when 'units' then quantity_shipped
                                  when 'manual' then manual_share end) as basis
              from public.shipment_items si where shipment_id = _shipment_id
             order by basis asc, id loop
    _share := round(_total_cost * coalesce(_r.basis, 0) / _basis_total, 2);
    update public.shipment_items set allocated_cost_srd = _share where id = _r.id;
    _allocated := _allocated + _share;
    _last_id := _r.id;
  end loop;
  -- rounding remainder goes to the line with the largest basis
  update public.shipment_items set allocated_cost_srd = allocated_cost_srd + (_total_cost - _allocated) where id = _last_id;

  for _r in select si.*, round((coalesce(si.goods_value_srd, 0) + coalesce(si.allocated_cost_srd, 0)) / si.quantity_shipped, 4) as new_unit,
                   si.landed_unit_cost_srd as old_unit
              from public.shipment_items si where shipment_id = _shipment_id loop
    update public.shipment_items set landed_unit_cost_srd = _r.new_unit where id = _r.id;

    -- Units already received carry the old cost basis: adjust inventory valuation.
    if _r.quantity_received > 0 and _r.old_unit is not null and _r.old_unit <> _r.new_unit then
      _rate_delta := _r.new_unit - _r.old_unit;
      update public.inventory i set unit_cost = round(
               (coalesce(i.unit_cost, 0) * i.physical_qty + _rate_delta * least(_r.quantity_received, i.physical_qty))
               / nullif(i.physical_qty, 0), 4)
       where i.variant_id = _r.variant_id and i.physical_qty > 0;
    end if;
    update public.order_items oi set unit_cost_actual = _r.new_unit
      from public.stock_reservations sr
     where sr.order_item_id = oi.id and sr.shipment_item_id = _r.id;

    insert into public.cost_calculations (product_id, variant_id, shipment_id, is_estimate, allocation_mode, quantity,
       supplier_price, supplier_currency, exchange_rate, converted_price_srd, shipping_srd, landed_cost_srd,
       target_margin_pct, recommended_price_srd, final_price_srd, expected_profit_srd, actual_margin_pct, markup_pct, inputs, created_by)
    select v.product_id, v.id, _shipment_id, false, _m, _r.quantity_shipped,
           poi.unit_cost, po.currency, public.get_exchange_rate(po.currency, 'SRD', coalesce(_s.departure_date, current_date)),
           round(coalesce(_r.goods_value_srd, 0) / _r.quantity_shipped, 4),
           round(coalesce(_r.allocated_cost_srd, 0) / _r.quantity_shipped, 4),
           _r.new_unit, 0, 0, public.effective_unit_price(p, v),
           public.effective_unit_price(p, v) - _r.new_unit,
           case when public.effective_unit_price(p, v) > 0
                then round((public.effective_unit_price(p, v) - _r.new_unit) / public.effective_unit_price(p, v) * 100, 2) else 0 end,
           case when _r.new_unit > 0 then round((public.effective_unit_price(p, v) - _r.new_unit) / _r.new_unit * 100, 2) else 0 end,
           jsonb_build_object('source', 'shipment_allocation', 'uses_actual_costs', _uses_actual),
           auth.uid()
      from public.product_variants v join public.products p on p.id = v.product_id
      join public.purchase_order_items poi on poi.id = _r.purchase_order_item_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
     where v.id = _r.variant_id;
  end loop;

  update public.shipments set allocation_method = _m, costs_allocated_at = now() where id = _shipment_id;
  perform public.write_audit('allocate_costs', 'shipments', _shipment_id::text, null,
                             jsonb_build_object('method', _m, 'total_cost_srd', _total_cost, 'uses_actual', _uses_actual));
  return jsonb_build_object('method', _m, 'total_cost_srd', _total_cost, 'uses_actual_costs', _uses_actual);
end $$;

-- Receive (part of) a shipment. Only received units enter stock; they are
-- allocated first-in-first-out to waiting pre-order customers.
-- _lines: [{"shipment_item_id":uuid,"received":int,"damaged":int}]
create or replace function public.receive_shipment(_shipment_id uuid, _lines jsonb, _location_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  _s public.shipments;
  _l jsonb;
  _si public.shipment_items;
  _recv int;
  _dmg int;
  _loc uuid := _location_id;
  _unit numeric;
  _oi record;
  _alloc int;
  _left int;
  _orders uuid[] := '{}';
  _o uuid;
  _total_alloc int := 0;
begin
  perform public.require_permission('shipments.manage');
  select * into _s from public.shipments where id = _shipment_id for update;
  if not found then raise exception 'shipment_not_found' using errcode = 'P0002'; end if;
  if _s.status = 'closed' then raise exception 'shipment_closed' using errcode = 'P0001'; end if;
  if _loc is null then select id into _loc from public.storage_locations where is_default and is_active limit 1; end if;
  if _loc is null then raise exception 'no_storage_location' using errcode = 'P0001'; end if;

  perform public._shipment_goods_value(_shipment_id);

  for _l in select * from jsonb_array_elements(_lines) loop
    _recv := coalesce((_l->>'received')::int, 0);
    _dmg := coalesce((_l->>'damaged')::int, 0);
    if _recv < 0 or _dmg < 0 then raise exception 'invalid_quantity' using errcode = '22023'; end if;
    continue when _recv = 0 and _dmg = 0;
    select * into _si from public.shipment_items where id = (_l->>'shipment_item_id')::uuid and shipment_id = _shipment_id for update;
    if not found then raise exception 'shipment_item_not_found' using errcode = 'P0002'; end if;
    if _si.quantity_received + _si.quantity_damaged + _recv + _dmg > _si.quantity_shipped then
      raise exception 'receipt_exceeds_shipped for %', _si.id using errcode = '23514';
    end if;

    _unit := coalesce(_si.landed_unit_cost_srd, round(coalesce(_si.goods_value_srd, 0) / _si.quantity_shipped, 4));
    update public.shipment_items set quantity_received = quantity_received + _recv, quantity_damaged = quantity_damaged + _dmg,
                                     landed_unit_cost_srd = coalesce(landed_unit_cost_srd, _unit)
     where id = _si.id;
    update public.purchase_order_items set qty_received = qty_received + _recv + _dmg where id = _si.purchase_order_item_id;

    if _recv > 0 then
      insert into public.inventory (variant_id, location_id) values (_si.variant_id, _loc)
      on conflict (variant_id, location_id) do nothing;
      update public.inventory set
        unit_cost = round((coalesce(unit_cost, _unit) * physical_qty + _unit * _recv) / (physical_qty + _recv), 4),
        physical_qty = physical_qty + _recv
       where variant_id = _si.variant_id and location_id = _loc;
      insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reason, reference_type, reference_id, unit_cost, actor_id)
      values (_si.variant_id, _loc, 'shipment_receipt', _recv, 'Shipment ' || _s.shipment_number, 'shipment', _shipment_id, _unit, auth.uid());

      -- FIFO allocation to waiting pre-order customers of this variant
      _left := _recv;
      for _oi in
        select oi.id, oi.order_id, oi.quantity,
               oi.quantity - coalesce((select sum(quantity) from public.stock_reservations r
                                        where r.order_item_id = oi.id and r.status in ('active', 'converted')), 0) as missing
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where oi.variant_id = _si.variant_id and oi.sales_type = 'preorder'
           and oi.fulfilment_status in ('purchased', 'in_transit', 'awaiting_purchase', 'received')
           and o.status in ('confirmed', 'purchasing', 'in_transit')
         order by o.confirmed_at nulls last, o.created_at
         for update of oi
      loop
        exit when _left = 0;
        continue when _oi.missing <= 0;
        _alloc := least(_left, _oi.missing);
        perform public._reserve_stock(_oi.order_id, _oi.id, _si.variant_id, _alloc, null, _si.id, _loc);
        update public.order_items set qty_allocated = qty_allocated + _alloc,
               fulfilment_status = case when qty_allocated + _alloc >= quantity then 'allocated' else 'received' end,
               unit_cost_actual = coalesce(unit_cost_actual, _unit)
         where id = _oi.id;
        _left := _left - _alloc;
        _total_alloc := _total_alloc + _alloc;
        _orders := array_append(_orders, _oi.order_id);
      end loop;
    end if;

    if _dmg > 0 then
      insert into public.inventory (variant_id, location_id) values (_si.variant_id, _loc)
      on conflict (variant_id, location_id) do nothing;
      update public.inventory set damaged_qty = damaged_qty + _dmg where variant_id = _si.variant_id and location_id = _loc;
      insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reason, reference_type, reference_id, actor_id)
      values (_si.variant_id, _loc, 'damaged', 0, 'Damaged on arrival – shipment ' || _s.shipment_number, 'shipment', _shipment_id, auth.uid());
    end if;
  end loop;

  -- Shipment and PO statuses
  update public.shipments set
    status = case when not exists (select 1 from public.shipment_items where shipment_id = _shipment_id
                                    and quantity_received + quantity_damaged < quantity_shipped)
                  then 'received'::public.shipment_status else 'arrived'::public.shipment_status end,
    actual_arrival = coalesce(actual_arrival, current_date)
   where id = _shipment_id;
  update public.purchase_orders po set status = case
      when not exists (select 1 from public.purchase_order_items where purchase_order_id = po.id and qty_received < quantity) then 'received'::public.purchase_status
      else 'partially_received'::public.purchase_status end
   where po.id in (select poi.purchase_order_id from public.shipment_items si
                    join public.purchase_order_items poi on poi.id = si.purchase_order_item_id
                   where si.shipment_id = _shipment_id);

  foreach _o in array coalesce((select array_agg(distinct x) from unnest(_orders) x), '{}'::uuid[]) loop
    perform public._refresh_order_readiness(_o);
  end loop;

  return jsonb_build_object('allocated_units', _total_alloc, 'orders_updated', coalesce(array_length(_orders, 1), 0));
end $$;

-- ---------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------
-- Converts reservations into sales (stock leaves the building).
create or replace function public._fulfil_order_stock(_order_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _res public.stock_reservations; _cost numeric;
begin
  for _res in select * from public.stock_reservations where order_id = _order_id and status = 'active' for update loop
    select coalesce(oi.unit_cost_actual, i.unit_cost) into _cost
      from public.order_items oi, public.inventory i
     where oi.id = _res.order_item_id and i.variant_id = _res.variant_id and i.location_id = _res.location_id;
    update public.inventory set physical_qty = physical_qty - _res.quantity, reserved_qty = reserved_qty - _res.quantity
     where variant_id = _res.variant_id and location_id = _res.location_id;
    update public.stock_reservations set status = 'converted' where id = _res.id;
    insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reserved_change, reason, reference_type, reference_id, unit_cost, actor_id)
    values (_res.variant_id, _res.location_id, 'sale', -_res.quantity, -_res.quantity, 'Delivered to customer', 'order', _order_id, _cost, auth.uid());
    update public.order_items set unit_cost_actual = coalesce(unit_cost_actual, _cost) where id = _res.order_item_id;
  end loop;
  update public.order_items set fulfilment_status = 'delivered' where order_id = _order_id and fulfilment_status <> 'cancelled';
  update public.products p set popularity_score = popularity_score + x.q
    from (select product_id, sum(quantity)::int q from public.order_items where order_id = _order_id group by product_id) x
   where p.id = x.product_id;
end $$;

create or replace function public.update_delivery_status(_delivery_id uuid, _status public.delivery_status,
                                                         _note text default null, _scheduled date default null,
                                                         _assigned_to uuid default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare _d public.deliveries; _o public.orders;
begin
  perform public.require_permission('deliveries.manage');
  select * into _d from public.deliveries where id = _delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode = 'P0002'; end if;
  select * into _o from public.orders where id = _d.order_id for update;
  if _d.status = 'delivered' then raise exception 'delivery_already_completed' using errcode = 'P0001'; end if;

  if _status = 'delivered' then
    if _o.status not in ('ready_for_delivery', 'out_for_delivery') then
      raise exception 'order_not_ready_for_delivery: %', _o.status using errcode = 'P0001';
    end if;
    perform public._fulfil_order_stock(_o.id);
    update public.orders set status = case when balance_due <= 0 then 'completed'::public.order_status else 'delivered'::public.order_status end,
                             delivered_at = now(),
                             completed_at = case when balance_due <= 0 then now() end
     where id = _o.id;
    if (select balance_due from public.orders where id = _o.id) <= 0 then
      perform public.enqueue_order_notification('order_completed', _o.id);
    else
      perform public.enqueue_order_notification('balance_reminder', _o.id);
    end if;
  elsif _status = 'out_for_delivery' then
    if _o.status <> 'ready_for_delivery' then
      raise exception 'order_not_ready_for_delivery: %', _o.status using errcode = 'P0001';
    end if;
    update public.orders set status = 'out_for_delivery' where id = _o.id;
  elsif _status in ('failed', 'rescheduled') then
    if coalesce(trim(_note), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
    if _o.status = 'out_for_delivery' then update public.orders set status = 'ready_for_delivery' where id = _o.id; end if;
  elsif _status = 'assigned' and coalesce(_assigned_to, _d.assigned_to) is null then
    raise exception 'assignee_required' using errcode = '22023';
  end if;

  update public.deliveries set status = _status,
         failure_reason = case when _status in ('failed', 'rescheduled') then _note else failure_reason end,
         notes = case when _status not in ('failed', 'rescheduled') and _note is not null then _note else notes end,
         scheduled_date = coalesce(_scheduled, scheduled_date),
         assigned_to = coalesce(_assigned_to, assigned_to),
         attempt = attempt + case when _status = 'rescheduled' then 1 else 0 end,
         delivered_at = case when _status = 'delivered' then now() else delivered_at end
   where id = _delivery_id;

  if _status = 'assigned' or (_scheduled is not null and _status in ('assigned', 'rescheduled', 'ready_for_delivery')) then
    perform public.enqueue_order_notification('delivery_scheduled', _o.id,
            jsonb_build_object('scheduled_date', coalesce(to_char(coalesce(_scheduled, _d.scheduled_date), 'DD-MM-YYYY'), '')));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Refunds (finance decision; never automatic)
-- ---------------------------------------------------------------------
create or replace function public.record_refund(_order_id uuid, _amount numeric, _reason text,
                                                _method public.payment_method default 'bank_transfer', _reference text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare _o public.orders; _id uuid;
begin
  perform public.require_permission('payments.refund');
  select * into _o from public.orders where id = _order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if _amount is null or _amount <= 0 or _amount > _o.amount_verified - _o.amount_refunded then
    raise exception 'invalid_amount: refund cannot exceed verified payments (%)', _o.amount_verified - _o.amount_refunded using errcode = '22023';
  end if;
  insert into public.refunds (order_id, amount, reason, method, reference, status, approved_by, paid_at, created_by)
  values (_order_id, round(_amount, 2), _reason, _method, _reference, 'paid', auth.uid(), now(), auth.uid())
  returning id into _id;
  perform public._refresh_order_payment(_order_id);
  return _id;
end $$;

-- ---------------------------------------------------------------------
-- Reporting
-- Revenue policy: product sales are recognised when the order is delivered.
-- Verified payments on undelivered orders are customer deposits (liability).
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public.require_permission('dashboard.view');
  return jsonb_build_object(
    'total_orders', (select count(*) from public.orders where status not in ('cancelled', 'expired')),
    'orders_awaiting_payment', (select count(*) from public.orders where status in ('awaiting_deposit', 'payment_review')),
    'payments_to_verify', (select count(*) from public.payments where status in ('submitted', 'under_verification')),
    'deposits_received', (select coalesce(sum(amount_verified - amount_refunded), 0) from public.orders
                           where status not in ('delivered', 'completed', 'cancelled', 'expired')),
    'outstanding_balances', (select coalesce(sum(balance_due), 0) from public.orders
                              where status not in ('cancelled', 'expired') and amount_verified > 0),
    'ready_stock_orders', (select count(*) from public.orders where has_ready and not has_preorder and status not in ('cancelled', 'expired', 'completed')),
    'preorders', (select count(*) from public.orders where has_preorder and status not in ('cancelled', 'expired', 'completed')),
    'weekly_sales', (select coalesce(sum(total), 0) from public.orders where delivered_at >= date_trunc('week', now())),
    'monthly_sales', (select coalesce(sum(total), 0) from public.orders where delivered_at >= date_trunc('month', now())),
    'weekly_orders_value', (select coalesce(sum(total), 0) from public.orders where created_at >= date_trunc('week', now()) and status not in ('cancelled', 'expired')),
    'inventory_value', (select coalesce(round(sum(physical_qty * coalesce(unit_cost, 0)), 2), 0) from public.inventory),
    'inventory_units', (select coalesce(sum(physical_qty), 0) from public.inventory),
    'low_stock', (select count(*) from public.inventory i join public.product_variants v on v.id = i.variant_id
                   join public.products p on p.id = v.product_id
                  where p.sales_type = 'ready' and p.status = 'active' and i.available_qty <= i.low_stock_threshold),
    'pending_purchases', (select coalesce(sum(oi.quantity - oi.qty_allocated), 0) from public.order_items oi
                           join public.orders o on o.id = oi.order_id
                          where oi.sales_type = 'preorder' and oi.fulfilment_status = 'awaiting_purchase'
                            and o.status in ('confirmed', 'purchasing')),
    'active_shipments', (select count(*) from public.shipments where status not in ('received', 'closed')),
    'awaiting_delivery', (select count(*) from public.deliveries where status not in ('delivered', 'failed'))
  );
end $$;

create or replace function public.financial_summary(_from date, _to date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  _start timestamptz := _from::timestamptz;
  _end timestamptz := (_to + 1)::timestamptz;
  _gross numeric; _ready numeric; _pre numeric; _delivery_income numeric; _discounts numeric;
  _cogs numeric; _ship numeric; _import numeric; _delivery_cost numeric; _opex numeric;
  _refunds numeric; _supplier_paid numeric; _cash_in numeric;
begin
  perform public.require_permission('finance.view');
  select coalesce(sum(subtotal - discount_total), 0), coalesce(sum(delivery_fee), 0), coalesce(sum(discount_total), 0)
    into _gross, _delivery_income, _discounts
    from public.orders where delivered_at >= _start and delivered_at < _end;
  select coalesce(sum(case when oi.sales_type = 'ready' then oi.line_total end), 0),
         coalesce(sum(case when oi.sales_type = 'preorder' then oi.line_total end), 0)
    into _ready, _pre
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where o.delivered_at >= _start and o.delivered_at < _end and oi.fulfilment_status <> 'cancelled';
  select coalesce(round(sum(-quantity * coalesce(unit_cost, 0)), 2), 0) into _cogs
    from public.inventory_movements where movement_type = 'sale' and created_at >= _start and created_at < _end;
  select coalesce(sum(case when cost_type = 'shipping' then amount_srd end), 0),
         coalesce(sum(case when cost_type <> 'shipping' then amount_srd end), 0)
    into _ship, _import from public.import_costs ic join public.shipments s on s.id = ic.shipment_id
   where not ic.is_estimate and coalesce(s.actual_arrival, ic.created_at::date) between _from and _to;
  select coalesce(sum(case when category = 'delivery' then amount_srd end), 0),
         coalesce(sum(case when category not in ('delivery', 'import') then amount_srd end), 0)
    into _delivery_cost, _opex from public.expenses where deleted_at is null and expense_date between _from and _to;
  _delivery_cost := _delivery_cost + (select coalesce(sum(delivery_cost_srd), 0) from public.deliveries
                                       where delivered_at >= _start and delivered_at < _end);
  select coalesce(sum(amount), 0) into _refunds from public.refunds where status = 'paid' and paid_at >= _start and paid_at < _end;
  select coalesce(sum(amount_srd), 0) into _supplier_paid from public.supplier_payments where paid_at between _from and _to;
  select coalesce(sum(p.amount), 0) into _cash_in from public.payments p
   where p.status in ('verified', 'refunded') and p.verified_at >= _start and p.verified_at < _end;

  return jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to),
    'gross_sales', _gross,
    'ready_stock_sales', _ready,
    'preorder_sales', _pre,
    'discounts', _discounts,
    'delivery_income', _delivery_income,
    'cost_of_goods_sold', _cogs,
    'gross_profit', _gross - _cogs,
    'gross_margin_pct', case when _gross > 0 then round((_gross - _cogs) / _gross * 100, 2) else 0 end,
    'shipping_costs', _ship,
    'import_charges', _import,
    'delivery_expenses', _delivery_cost,
    'operating_expenses', _opex,
    'refunds', _refunds,
    'net_operating_result', _gross + _delivery_income - _cogs - _delivery_cost - _opex - _refunds,
    'customer_deposits_held', (select coalesce(sum(amount_verified - amount_refunded), 0) from public.orders
                                where delivered_at is null and status not in ('cancelled', 'expired')),
    'customer_receivables', (select coalesce(sum(balance_due), 0) from public.orders where status = 'delivered'),
    'cancelled_orders_holding_funds', (select coalesce(sum(amount_verified - amount_refunded), 0) from public.orders
                                        where status in ('cancelled', 'expired') and amount_verified > amount_refunded),
    'supplier_payments', _supplier_paid,
    'supplier_balances', (select coalesce(sum(x.owed), 0) from (
        select greatest(coalesce(po.supplier_invoice_amount, (select sum(line_total) from public.purchase_order_items where purchase_order_id = po.id), 0)
               * coalesce(public.try_exchange_rate(po.currency, 'SRD'), 0)
               - coalesce((select sum(amount_srd) from public.supplier_payments sp where sp.purchase_order_id = po.id), 0), 0) as owed
          from public.purchase_orders po where po.status not in ('draft', 'cancelled')) x),
    'inventory_valuation', (select coalesce(round(sum(physical_qty * coalesce(unit_cost, 0)), 2), 0) from public.inventory),
    'cash_in', _cash_in,
    'cash_out', _supplier_paid + _refunds + _opex + _delivery_cost +
                (select coalesce(sum(amount_srd), 0) from public.import_costs where not is_estimate and paid_at between _from and _to)
  );
end $$;


-- >>> 20261117000007_security.sql
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
returns void language plpgsql security definer set search_path = public, extensions as $$
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
returns text[] language sql stable security definer set search_path = public, extensions as $$
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
returns boolean language sql stable security definer set search_path = public, extensions as $$
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


-- >>> 20261117000008_reporting.sql
-- =====================================================================
-- Migration 8: analytics & admin helper views/functions
-- All figures are computed from real records. Revenue = delivered orders.
-- =====================================================================

-- Views run with the caller's permissions (RLS applies).
create view public.customer_overview with (security_invoker = true) as
  select c.id, c.full_name, c.whatsapp, c.email, c.user_id, c.created_at,
         count(o.id) filter (where o.status not in ('cancelled', 'expired')) as order_count,
         coalesce(sum(o.total) filter (where o.status in ('delivered', 'completed')), 0) as lifetime_value,
         coalesce(sum(o.balance_due) filter (where o.status not in ('cancelled', 'expired') and o.amount_verified > 0), 0) as open_balance,
         max(o.created_at) as last_order_at
    from public.customers c left join public.orders o on o.customer_id = c.id
   where c.deleted_at is null
   group by c.id;

create view public.inventory_overview with (security_invoker = true) as
  select i.id, i.variant_id, i.location_id, l.name as location_name, v.sku, v.size, v.color,
         p.id as product_id, p.title, p.sales_type, p.status as product_status,
         i.physical_qty, i.reserved_qty, i.available_qty, i.damaged_qty, i.returned_qty,
         i.low_stock_threshold, i.unit_cost, (i.available_qty <= i.low_stock_threshold) as is_low
    from public.inventory i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    join public.storage_locations l on l.id = i.location_id
   where v.deleted_at is null and p.deleted_at is null;

create or replace function public.report_data(_from date, _to date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  _start timestamptz := _from::timestamptz;
  _end timestamptz := (_to + 1)::timestamptz;
begin
  perform public.require_permission('reports.view');
  return jsonb_build_object(
    'sales_by_day', (select coalesce(jsonb_agg(x order by x.day), '[]') from (
        select to_char(d::date, 'YYYY-MM-DD') as day,
               coalesce((select sum(total) from public.orders where delivered_at::date = d::date), 0) as revenue,
               coalesce((select count(*) from public.orders where created_at::date = d::date and status not in ('cancelled','expired')), 0) as orders,
               coalesce((select sum(total) from public.orders where created_at::date = d::date and status not in ('cancelled','expired')), 0) as order_value
          from generate_series(_from, _to, interval '1 day') d) x),
    'sales_by_month', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
        select to_char(date_trunc('month', delivered_at), 'YYYY-MM') as month, sum(total) as revenue, count(*) as orders
          from public.orders where delivered_at >= _start - interval '11 months' and delivered_at < _end
         group by 1) x),
    'sales_by_category', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]') from (
        select coalesce(pc.name, c.name, 'Zonder categorie') as category, sum(oi.line_total) as revenue, sum(oi.quantity) as units
          from public.order_items oi join public.orders o on o.id = oi.order_id
          join public.products p on p.id = oi.product_id
          left join public.categories c on c.id = p.category_id
          left join public.categories pc on pc.id = c.parent_id
         where o.delivered_at >= _start and o.delivered_at < _end and oi.fulfilment_status <> 'cancelled'
         group by 1) x),
    'sales_by_product', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]') from (
        select oi.product_id, max(oi.title) as title, sum(oi.quantity) as units, sum(oi.line_total) as revenue,
               sum(oi.quantity * coalesce(oi.unit_cost_actual, oi.unit_cost_estimate, 0)) as cost,
               sum(oi.line_total) - sum(oi.quantity * coalesce(oi.unit_cost_actual, oi.unit_cost_estimate, 0)) as profit,
               bool_and(coalesce(oi.unit_cost_actual, oi.unit_cost_estimate) is not null) as cost_known
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.delivered_at >= _start and o.delivered_at < _end and oi.fulfilment_status <> 'cancelled'
         group by oi.product_id limit 50) x),
    'ready_vs_preorder', (select coalesce(jsonb_agg(x), '[]') from (
        select oi.sales_type, sum(oi.line_total) as revenue, sum(oi.quantity) as units, count(distinct oi.order_id) as orders
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.created_at >= _start and o.created_at < _end and o.status not in ('cancelled','expired')
         group by 1) x),
    'popular_sizes', (select coalesce(jsonb_agg(x order by x.units desc), '[]') from (
        select coalesce(size, '–') as size, sum(quantity) as units from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.created_at >= _start and o.created_at < _end and o.status not in ('cancelled','expired') group by 1 limit 20) x),
    'popular_colors', (select coalesce(jsonb_agg(x order by x.units desc), '[]') from (
        select coalesce(color, '–') as color, sum(quantity) as units from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.created_at >= _start and o.created_at < _end and o.status not in ('cancelled','expired') group by 1 limit 20) x),
    'inventory_turnover', (select jsonb_build_object(
        'units_sold', coalesce((select -sum(quantity) from public.inventory_movements where movement_type = 'sale' and created_at >= _start and created_at < _end), 0),
        'cogs', coalesce((select -sum(quantity * coalesce(unit_cost, 0)) from public.inventory_movements where movement_type = 'sale' and created_at >= _start and created_at < _end), 0),
        'current_units', (select coalesce(sum(physical_qty), 0) from public.inventory),
        'current_value', (select coalesce(sum(physical_qty * coalesce(unit_cost, 0)), 0) from public.inventory))),
    'slow_moving', (select coalesce(jsonb_agg(x order by x.days_since_sale desc nulls first), '[]') from (
        select v.sku, p.title, sum(i.physical_qty) as on_hand,
               (select max(m.created_at) from public.inventory_movements m where m.variant_id = v.id and m.movement_type = 'sale') as last_sale,
               extract(day from now() - coalesce((select max(m.created_at) from public.inventory_movements m where m.variant_id = v.id and m.movement_type = 'sale'), min(p.published_at)))::int as days_since_sale
          from public.inventory i join public.product_variants v on v.id = i.variant_id join public.products p on p.id = v.product_id
         where i.physical_qty > 0 group by v.id, v.sku, p.title
        having coalesce((select max(m.created_at) from public.inventory_movements m where m.variant_id = v.id and m.movement_type = 'sale'), '-infinity') < now() - interval '30 days'
         limit 50) x),
    'supplier_performance', (select coalesce(jsonb_agg(x), '[]') from (
        select s.name, count(distinct po.id) as purchase_orders,
               coalesce(sum(poi.quantity), 0) as units_ordered, coalesce(sum(poi.qty_received), 0) as units_received,
               coalesce(sum(si.quantity_damaged), 0) as units_damaged,
               round(avg(extract(epoch from (po.supplier_confirmed_at - po.created_at)) / 86400)::numeric, 1) as avg_days_to_confirm
          from public.suppliers s join public.purchase_orders po on po.supplier_id = s.id and po.status <> 'cancelled'
          left join public.purchase_order_items poi on poi.purchase_order_id = po.id
          left join public.shipment_items si on si.purchase_order_item_id = poi.id
         where po.created_at < _end group by s.name) x),
    'shipment_costs', (select coalesce(jsonb_agg(x order by x.departure_date desc nulls last), '[]') from (
        select sh.shipment_number, sh.status, sh.departure_date, sh.actual_arrival,
               coalesce((select sum(goods_value_srd) from public.shipment_items where shipment_id = sh.id), 0) as goods_value,
               coalesce((select sum(amount_srd) from public.import_costs where shipment_id = sh.id and not is_estimate), 0) as actual_costs,
               coalesce((select sum(amount_srd) from public.import_costs where shipment_id = sh.id and is_estimate), 0) as estimated_costs,
               coalesce((select sum(si.quantity_received * coalesce(public.effective_unit_price(p, v), 0))
                           from public.shipment_items si join public.product_variants v on v.id = si.variant_id
                           join public.products p on p.id = v.product_id where si.shipment_id = sh.id), 0) as retail_value_received
          from public.shipments sh where sh.created_at < _end limit 50) x),
    'delivery_performance', (select jsonb_build_object(
        'delivered', count(*) filter (where status = 'delivered'),
        'failed', count(*) filter (where status = 'failed'),
        'rescheduled', count(*) filter (where attempt > 1),
        'avg_hours_ready_to_delivered', round(avg(extract(epoch from delivered_at - created_at) / 3600) filter (where status = 'delivered')::numeric, 1))
        from public.deliveries where created_at >= _start and created_at < _end),
    'customer_retention', (select jsonb_build_object(
        'customers_with_orders', count(*),
        'repeat_customers', count(*) filter (where n > 1),
        'repeat_rate_pct', case when count(*) > 0 then round(100.0 * count(*) filter (where n > 1) / count(*), 1) else 0 end)
        from (select customer_id, count(*) n from public.orders where status not in ('cancelled','expired') and created_at < _end group by customer_id) c)
  );
end $$;

create or replace function public.outstanding_balances()
returns table (order_id uuid, order_number text, customer_name text, customer_whatsapp text, status public.order_status,
               total numeric, amount_verified numeric, balance_due numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public.require_permission('finance.view');
  return query select o.id, o.order_number, o.customer_name, o.customer_whatsapp, o.status, o.total, o.amount_verified, o.balance_due, o.created_at
    from public.orders o where o.status not in ('cancelled', 'expired') and o.balance_due > 0 and o.amount_verified > 0
    order by o.status = 'delivered' desc, o.created_at;
end $$;

-- Document number for manually created purchase orders
create or replace function public.next_po_number()
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.require_permission('purchasing.manage');
  return public.next_document_number('PO');
end $$;

-- Minimal staff directory (names + roles) for assignment dropdowns
create or replace function public.staff_directory()
returns table (user_id uuid, full_name text, email text, roles public.app_role[])
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public.is_staff() and not public.is_trusted_caller() then
    raise exception 'permission denied: staff only' using errcode = '42501';
  end if;
  return query
    select ur.user_id, p.full_name, p.email, array_agg(ur.role order by ur.role)
      from public.user_roles ur left join public.profiles p on p.id = ur.user_id
     where ur.role <> 'customer'
     group by ur.user_id, p.full_name, p.email;
end $$;

-- Delivery staff may read the payments they collected (for receipts)
create policy payments_delivery_select on public.payments for select
  using (public.has_permission('deliveries.view')
         and exists (select 1 from public.delivery_payments dp where dp.payment_id = payments.id));


-- >>> 20261117000009_explicit_grants.sql
-- =====================================================================
-- Migration 9: explicit API grants
-- Works whether or not the Supabase project "automatically exposes new
-- tables". Access is still decided by Row Level Security (enabled on every
-- table in migration 07) and by the permission checks inside functions.
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Internal tables: no direct API access at all (only via functions)
revoke all on public.rate_limits, public.document_sequences from anon, authenticated;

-- Anonymous visitors never write directly; checkout, payments and newsletter go through the server.
revoke insert, update, delete on all tables in schema public from anon;
