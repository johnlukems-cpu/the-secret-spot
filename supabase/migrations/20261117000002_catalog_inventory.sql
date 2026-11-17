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
