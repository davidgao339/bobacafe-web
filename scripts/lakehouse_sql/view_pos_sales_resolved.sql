-- view_pos_sales_resolved — the POS sale bridge as a standalone lakehouse primitive.
-- One row per bronze sale line × affected ingredient: WHICH ingredient each sold
-- unit depletes and HOW MUCH (consumed_qty, positive = depletion).
--
-- Consumers: view_stock_stats (7d consumption + variance window), and any
-- future consumer that previously looped bronze sales × retail recipes in JS.
-- Replaces the stores-tabular app's name-based salesRecipes loop, which
-- silently dropped case-drifted POS spellings ('Райский Лимонад' vs
-- 'Райский лимонад') — this bridge resolves identity via product_id.
--
-- Resolution Paths:
--   Path A: retail recipes by product_id (drinks/composites);
--   Path B: finished direct link — dim_ingredients.item_class='finished' row
--           with the same product_id depletes 1 шт per sale, only when the
--           product has NO retail recipe (retail precedence);
--   Path B_PKG: dynamic serving packaging attached to finished goods
--               (e.g., Подложка для корн-дога, packaging_ingredient_id in dim_ingredients);
--   Path C: NULL-pid retail recipes (POS pseudo-products 'Списание - …') by
--           normalized spelling;
--   Path D: fallback recipe match by normalized name if dim_picked active product_id
--           does not have a recipe attached directly.
--
-- Normalization Key (nkey):
--   Lowercased, whitespace-collapsed, ё->е, and hyphen-removed (- -> ' ')
--   to ensure resilient matching across POS menu entry drift (e.g. 'Айс-матча' vs 'Айс матча').
CREATE OR REPLACE VIEW inventory_tabular.view_pos_sales_resolved (
  store_id,
  event_ts,
  date,
  ingredient_id,
  product,
  qty_units,
  consumed_qty,
  order_number)
WITH SCHEMA COMPENSATION
AS WITH sales_stream AS (
  SELECT t.datetime AS event_ts, CAST(t.date AS DATE) AS date, t.product, t.qty, t.order_number,
         CASE t.store_name
           WHEN 'НОВО КП' THEN 1 WHEN 'ГРИН ПАРК' THEN 2 WHEN 'БОН ПАССАЖ' THEN 3
           WHEN 'ЧЕРНОМОРСКИЙ' THEN 4 WHEN 'СОВЕТОВ' THEN 5 WHEN 'ГАЛЕРЕЯ' THEN 6
           WHEN 'ОЗМОЛЛ' THEN 10 WHEN 'КИОСК' THEN 13 WHEN 'АНАПА' THEN 11 WHEN 'ГЕЛЕНДЖИК' THEN 12
         END AS store_id
  FROM workspace.default.transactions t
  -- Business rule: a returned drink still consumed its syrup. Count gross sales only.
  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0
),
-- norm: case-, ё-, hyphen- and whitespace-insensitive spelling key
dim_picked AS (
  SELECT product_id, product_ru AS dim_name, nkey FROM (
    SELECT product_id, product_ru,
           lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey,
           ROW_NUMBER() OVER (
             PARTITION BY lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
             ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC) AS rn
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
  ) t WHERE rn = 1
),
product_map AS (
  SELECT DISTINCT t.product, dp.product_id, dp.dim_name
  FROM (SELECT DISTINCT product FROM sales_stream) t
  JOIN dim_picked dp
    ON dp.nkey = lower(replace(replace(trim(regexp_replace(t.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
),
finished_link AS (
  -- One stock-keeping dim_ingredients row per product_id (deduped); used only
  -- when the product has no retail recipe (retail precedence below).
  SELECT z.ingredient_id, z.product_id, z.packaging_ingredient_id FROM (
    SELECT i.ingredient_id, i.product_id, i.packaging_ingredient_id,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.ingredient_id) AS rn
    FROM workspace.inventory_tabular.dim_ingredients i
    WHERE i.item_class = 'finished' AND i.product_id IS NOT NULL
  ) z WHERE rn = 1
)
-- Path A: Retail recipes by matched product_id
SELECT s.store_id, s.event_ts, s.date,
       r.ingredient_id, pm.dim_name AS product,
       s.qty AS qty_units, (s.qty * r.amount_per_serving) AS consumed_qty, s.order_number
FROM sales_stream s
JOIN product_map pm ON pm.product = s.product
JOIN workspace.inventory_tabular.fact_recipe_ingredients r
  ON r.product_id = pm.product_id AND r.recipe_type = 'retail'
WHERE s.store_id IS NOT NULL
UNION ALL
-- Path B: Finished good 1:1 depletion (only when no retail recipe exists)
SELECT s.store_id, s.event_ts, s.date,
       fl.ingredient_id, pm.dim_name AS product,
       s.qty AS qty_units, s.qty AS consumed_qty, s.order_number
FROM sales_stream s
JOIN product_map pm ON pm.product = s.product
JOIN finished_link fl ON fl.product_id = pm.product_id
WHERE s.store_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                  WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
UNION ALL
-- Path B_PKG: Finished good serving packaging (e.g. Подложка для корн-дога)
SELECT s.store_id, s.event_ts, s.date,
       fl.packaging_ingredient_id AS ingredient_id, pm.dim_name AS product,
       s.qty AS qty_units, s.qty AS consumed_qty, s.order_number
FROM sales_stream s
JOIN product_map pm ON pm.product = s.product
JOIN finished_link fl ON fl.product_id = pm.product_id
WHERE s.store_id IS NOT NULL
  AND fl.packaging_ingredient_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                  WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
UNION ALL
-- Path C: NULL-pid retail recipes (pseudo-products) matched by normalized name
SELECT s.store_id, s.event_ts, s.date,
       r.ingredient_id, s.product,
       s.qty AS qty_units, (s.qty * r.amount_per_serving) AS consumed_qty, s.order_number
FROM sales_stream s
JOIN workspace.inventory_tabular.fact_recipe_ingredients r
  ON r.product_id IS NULL AND r.recipe_type = 'retail'
 AND lower(replace(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
     = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
WHERE s.store_id IS NOT NULL
UNION ALL
-- Path D: Fallback recipe match by normalized name if PID has no recipe and is not finished
SELECT s.store_id, s.event_ts, s.date,
       r.ingredient_id, pm.dim_name AS product,
       s.qty AS qty_units, (s.qty * r.amount_per_serving) AS consumed_qty, s.order_number
FROM sales_stream s
JOIN product_map pm ON pm.product = s.product
JOIN workspace.inventory_tabular.fact_recipe_ingredients r
  ON r.recipe_type = 'retail'
 AND lower(replace(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
     = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
WHERE s.store_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                  WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
  AND NOT EXISTS (SELECT 1 FROM finished_link fl2 WHERE fl2.product_id = pm.product_id);
