-- =====================================================================
-- STEP 3 (OPTIONAL) – 12 [DEMO] products for testing. Archive them before going live.
-- Generated from supabase/migrations + seed.sql by scripts/build-setup-sql.py.
-- Paste the whole file into Supabase → SQL Editor → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DEMO catalogue (marked [DEMO]). Delete or archive before going live.
-- ---------------------------------------------------------------------
do $$
declare
  _loc uuid := (select id from public.storage_locations where code = 'MAIN');
  _p uuid;
  _v uuid;
  _rec record;
  _size text;
  _i int := 0;
begin
  for _rec in select * from (values
    ('DEMO-W-001', 'Satijnen midi-jurk', 'dames-jurken', 'ready', 1450.00, null::numeric, array['S','M','L'], 'Champagne', '#D8C49A', true, true, false),
    ('DEMO-W-002', 'Linnen co-ord set', 'dames-sets', 'ready', 1650.00, 1395.00, array['S','M','L'], 'Crème', '#F3EDE2', true, false, true),
    ('DEMO-W-003', 'High-waist wide leg jeans', 'dames-jeans', 'preorder', 1200.00, null, array['26','28','30','32'], 'Indigo', '#2E3A59', false, true, false),
    ('DEMO-M-001', 'Piqué polo classic', 'heren-polos', 'ready', 850.00, null, array['M','L','XL'], 'Zwart', '#171A18', true, false, true),
    ('DEMO-M-002', 'Relaxed chino', 'heren-broeken', 'preorder', 1100.00, null, array['30','32','34','36'], 'Taupe', '#8A8175', false, true, false),
    ('DEMO-K-001', 'Katoenen baby set', 'kids-baby', 'ready', 650.00, null, array['0-3m','3-6m','6-12m'], 'Wit', '#FFFFFF', false, true, false),
    ('DEMO-K-002', 'Meisjes zomerjurk', 'kids-meisjes', 'preorder', 700.00, null, array['4j','6j','8j'], 'Roze', '#E8B4B8', false, false, false),
    ('DEMO-S-001', 'Minimal leather sneaker', 'schoenen-sneakers', 'ready', 1800.00, null, array['38','39','40','41','42'], 'Wit', '#FFFFFF', true, false, true),
    ('DEMO-S-002', 'Gevlochten sandaal', 'schoenen-sandalen', 'preorder', 950.00, null, array['37','38','39','40'], 'Cognac', '#9A5B2E', false, true, false),
    ('DEMO-A-001', 'Structured tote bag', 'acc-handtassen', 'ready', 1350.00, null, array[null]::text[], 'Zwart', '#171A18', true, true, true),
    ('DEMO-A-002', 'Gouden minimal horloge', 'acc-horloges', 'coming_soon', 2200.00, null, array[null]::text[], 'Goud', '#D8C49A', false, true, false),
    ('DEMO-A-003', 'Cat-eye zonnebril', 'acc-zonnebrillen', 'ready', 550.00, null, array[null]::text[], 'Schildpad', '#6B4F3A', false, false, false)
  ) as t(sku, title, cat, stype, price, promo, sizes, color, hex, featured, is_new, best)
  loop
    _i := _i + 1;
    insert into public.products (sku, slug, title, description, category_id, sales_type, status, base_price, promo_price,
                                 estimated_delivery_text, preorder_lead_days_min, preorder_lead_days_max, size_guide,
                                 specifications, is_featured, is_new_arrival, is_best_seller, published_at, weight_kg)
    values (_rec.sku, lower(_rec.sku) || '-' || regexp_replace(lower(_rec.title), '[^a-z0-9]+', '-', 'g'),
            '[DEMO] ' || _rec.title,
            'Demo-artikel om de winkel te testen. Vervang door echte productinformatie.',
            (select id from public.categories where slug = _rec.cat), _rec.stype::public.sales_type, 'active',
            _rec.price, _rec.promo,
            case when _rec.stype = 'preorder' then 'Geschatte levertijd 4–6 weken na inkoop' else '1–3 werkdagen' end,
            case when _rec.stype = 'preorder' then 28 end, case when _rec.stype = 'preorder' then 42 end,
            'Maattabel: vul in via Admin → Producten.',
            jsonb_build_object('Materiaal', 'Demo', 'Onderhoud', 'Demo'),
            _rec.featured, _rec.is_new, _rec.best, now() - make_interval(days => _i), 0.5)
    returning id into _p;
    insert into public.product_images (product_id, url, alt, sort_order)
    values (_p, '/demo/product-' || ((_i - 1) % 6 + 1) || '.svg', _rec.title, 0);
    foreach _size in array _rec.sizes loop
      insert into public.product_variants (product_id, sku, size, color, color_hex)
      values (_p, _rec.sku || coalesce('-' || _size, '') || '-' || upper(left(_rec.color, 3)), _size, _rec.color, _rec.hex)
      returning id into _v;
      if _rec.stype = 'ready' then
        insert into public.inventory (variant_id, location_id, physical_qty, low_stock_threshold)
        values (_v, _loc, 3 + (_i % 4), 1);
        insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, reason, reference_type)
        values (_v, _loc, 'stock_in', 3 + (_i % 4), 'Demo opening stock', 'seed');
      end if;
    end loop;
  end loop;
end $$;
