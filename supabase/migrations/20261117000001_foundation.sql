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
