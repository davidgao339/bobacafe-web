-- view_pos_sales_unmapped_dq — Data Quality monitoring view for POS inventory depletion contract.
-- Flags any POS product sold in the last 30 days that:
--   1. Fails to resolve to any ingredient depletion in view_pos_sales_resolved; AND
--   2. Is NOT marked as an operational zero-consumption modifier (is_modifier = TRUE in dim_product).
--
-- This view acts as an immediate alert for:
--   - New menu items added to POS without recipes or finished-goods mapping;
--   - Spelling/casing drift beyond standard normalization;
--   - Unmapped write-offs or promotional items.
CREATE OR REPLACE VIEW inventory_tabular.view_pos_sales_unmapped_dq (
  pos_product,
  matched_product_id,
  is_modifier,
  tx_count_30d,
  total_qty_30d,
  last_sold_date,
  sample_store)
WITH SCHEMA COMPENSATION
AS WITH recent_sales AS (
  SELECT 
    t.product AS pos_product,
    MAX(t.date) AS last_sold_date,
    MAX(t.store_name) AS sample_store,
    COUNT(*) AS tx_count_30d,
    SUM(t.qty) AS total_qty_30d,
    lower(replace(replace(trim(regexp_replace(t.product, '\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey
  FROM workspace.default.transactions t
  WHERE to_date(t.date) >= date_add(current_date(), -30)
    AND NOT COALESCE(t.is_return, FALSE) 
    AND t.qty > 0
  GROUP BY t.product, lower(replace(replace(trim(regexp_replace(t.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
),
dim_picked AS (
  SELECT product_id, product_ru, is_modifier, nkey FROM (
    SELECT product_id, product_ru, COALESCE(is_modifier, FALSE) AS is_modifier,
           lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey,
           ROW_NUMBER() OVER (
             PARTITION BY lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
             ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC) AS rn
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
  ) t WHERE rn = 1
),
resolved_products AS (
  SELECT DISTINCT pos_product FROM (
    SELECT s.product AS pos_product
    FROM (
      SELECT DISTINCT product
      FROM workspace.default.transactions
      WHERE to_date(date) >= date_add(current_date(), -30)
        AND NOT COALESCE(is_return, FALSE) AND qty > 0
    ) s
    JOIN (
      SELECT product_id,
             lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey
      FROM workspace.gold.dim_product
      WHERE product_ru IS NOT NULL
    ) dp ON dp.nkey = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
    JOIN workspace.inventory_tabular.fact_recipe_ingredients r
      ON r.product_id = dp.product_id AND r.recipe_type = 'retail'
    UNION
    SELECT s.product AS pos_product
    FROM (
      SELECT DISTINCT product
      FROM workspace.default.transactions
      WHERE to_date(date) >= date_add(current_date(), -30)
        AND NOT COALESCE(is_return, FALSE) AND qty > 0
    ) s
    JOIN (
      SELECT product_id,
             lower(replace(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey
      FROM workspace.gold.dim_product
      WHERE product_ru IS NOT NULL
    ) dp ON dp.nkey = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
    JOIN workspace.inventory_tabular.dim_ingredients fl
      ON fl.product_id = dp.product_id AND fl.item_class = 'finished'
    UNION
    SELECT s.product AS pos_product
    FROM (
      SELECT DISTINCT product
      FROM workspace.default.transactions
      WHERE to_date(date) >= date_add(current_date(), -30)
        AND NOT COALESCE(is_return, FALSE) AND qty > 0
    ) s
    JOIN workspace.inventory_tabular.fact_recipe_ingredients r
      ON r.product_id IS NULL AND r.recipe_type = 'retail'
     AND lower(replace(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
         = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
  )
)
SELECT 
  s.pos_product,
  dp.product_id AS matched_product_id,
  COALESCE(dp.is_modifier, FALSE) AS is_modifier,
  s.tx_count_30d,
  s.total_qty_30d,
  s.last_sold_date,
  s.sample_store
FROM recent_sales s
LEFT JOIN dim_picked dp ON dp.nkey = s.nkey
LEFT JOIN resolved_products rp ON rp.pos_product = s.pos_product
WHERE rp.pos_product IS NULL
  AND NOT COALESCE(dp.is_modifier, FALSE);
