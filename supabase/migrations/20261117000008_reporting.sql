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
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_permission('finance.view');
  return query select o.id, o.order_number, o.customer_name, o.customer_whatsapp, o.status, o.total, o.amount_verified, o.balance_due, o.created_at
    from public.orders o where o.status not in ('cancelled', 'expired') and o.balance_due > 0 and o.amount_verified > 0
    order by o.status = 'delivered' desc, o.created_at;
end $$;
