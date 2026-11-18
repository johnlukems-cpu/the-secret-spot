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
