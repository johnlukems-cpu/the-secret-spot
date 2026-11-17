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
returns boolean language plpgsql security definer set search_path = public as $$
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
