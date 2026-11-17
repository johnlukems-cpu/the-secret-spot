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
