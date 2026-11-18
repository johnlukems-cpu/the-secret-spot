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
