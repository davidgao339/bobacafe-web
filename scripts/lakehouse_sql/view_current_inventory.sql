-- view_current_inventory — per store × ingredient current on-hand, view-prioritized.
-- Source of record recovered via SHOW CREATE TABLE 2026-11-15.
--
-- 2026-11-15 (LIVE): the pos_consumption CTE previously joined ONLY
-- recipe_type='retail', so finished goods (mochi/blini — sold-as markers live
-- as all-finished production rows) never depleted between audits (Моти
-- банан-шоколад id=172 at RSQ stayed at its Nov-12 audit count of 5 despite
-- 5 units sold Nov 13-14). The live join now accepts retail rows OR
-- all-finished production rows (sold_as), matched by product NAME.
--
-- product_id revision, 2026-11-15 — DEPLOYED.
-- This file switches the sale bridge to product_id and covers EVERY dim_product
-- product: bronze spelling → gold.dim_product (normalized key, active row
-- preferred) → fact_recipe_ingredients.product_id; (A) retail recipes by
-- product_id; (B) finished direct link — dim_ingredients.item_class='finished'
-- row with the same product_id depletes 1 шт per sale, ONLY when the product
-- has NO retail recipe (retail precedence); (C) recipes with NULL product_id
-- (POS pseudo-products) fall back to a normalized-name match, retail only.
-- Validated read-only vs live over 2026-11-01..15: all diffs are pure gains
-- (finished SKUs + case-drifted drink spellings), no losses, no double paths.
-- Deploy by running this file in Databricks.
CREATE OR REPLACE VIEW inventory_tabular.view_current_inventory (
  store_id,
  store_code,
  store_name,
  ingredient_id,
  ingredient_name,
  unit,
  is_hidden,
  is_warehouse_only,
  last_audit_id,
  last_audit_date,
  audit_quantity,
  net_movement_since_audit,
  pos_consumption_since_audit,
  po_receipts_since_audit,
  current_on_hand,
  current_on_hand_as_of_date,
  item_class,
  product_id)
WITH SCHEMA COMPENSATION
AS WITH latest_audit AS (
  SELECT c.store_id, c.ingredient_id, c.count_quantity, c.audit_id, c.audit_date, h.audit_timestamp,
         ROW_NUMBER() OVER (PARTITION BY c.store_id, c.ingredient_id
                            ORDER BY c.audit_date DESC, c.audit_id DESC) AS rn
  FROM workspace.inventory_tabular.fact_audit_counts c
  JOIN workspace.inventory_tabular.fact_audit_headers h ON h.audit_id = c.audit_id
  WHERE h.status != 'rejected'
),
baseline AS (
  SELECT store_id, ingredient_id, count_quantity, audit_id, audit_date,
         CAST(CASE WHEN audit_timestamp LIKE concat(audit_date, '%')
                   THEN audit_timestamp
                   ELSE concat(audit_date, 'T23:59:59') END AS TIMESTAMP) AS cut_ts
  FROM latest_audit WHERE rn = 1
),
finished_link AS (
  -- Path B universe: the SKU's own dim_ingredients row (item_class='finished')
  -- depletes 1 шт per sale; deduped to one row per product_id; retail recipes
  -- take precedence in pos_consumption below.
  SELECT z.ingredient_id, z.product_id FROM (
    SELECT i.ingredient_id, i.product_id,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.ingredient_id) AS rn
    FROM workspace.inventory_tabular.dim_ingredients i
    WHERE i.item_class = 'finished' AND i.product_id IS NOT NULL
  ) z WHERE rn = 1
),
dim_picked AS (
  SELECT product_id, nkey FROM (
    SELECT product_id,
           lower(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), 'ё', 'е')) AS nkey,
           ROW_NUMBER() OVER (
             PARTITION BY lower(replace(trim(regexp_replace(product_ru, '\\s+', ' ')), 'ё', 'е'))
             ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC) AS rn
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
  ) t WHERE rn = 1
),
product_map AS (
  SELECT DISTINCT t.product, dp.product_id
  FROM (SELECT DISTINCT product FROM workspace.default.transactions
        WHERE NOT COALESCE(is_return, FALSE) AND qty > 0) t
  JOIN dim_picked dp
    ON dp.nkey = lower(replace(trim(regexp_replace(t.product, '\\s+', ' ')), 'ё', 'е'))
),
sales_stream AS (
  SELECT t.datetime AS pos_ts, t.product, t.qty,
         CASE t.store_name
           WHEN 'НОВО КП' THEN 1 WHEN 'ГРИН ПАРК' THEN 2 WHEN 'БОН ПАССАЖ' THEN 3
           WHEN 'ЧЕРНОМОРСКИЙ' THEN 4 WHEN 'СОВЕТОВ' THEN 5 WHEN 'ГАЛЕРЕЯ' THEN 6
           WHEN 'ОЗМОЛЛ' THEN 10 WHEN 'КИОСК' THEN 13 WHEN 'АНАПА' THEN 11 WHEN 'ГЕЛЕНДЖИК' THEN 12
         END AS store_id
  FROM workspace.default.transactions t
  -- Business rule: a returned drink still consumed its syrup. Count gross sales only.
  WHERE NOT COALESCE(t.is_return, FALSE)
    AND t.qty > 0
),
pos_consumption AS (
  -- Path A: retail recipes joined by product_id (identity, not spelling).
  SELECT s.store_id, r.ingredient_id, s.pos_ts,
         SUM(s.qty * r.amount_per_serving) AS consumed_qty
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.product_id = pm.product_id AND r.recipe_type = 'retail'
  WHERE s.store_id IS NOT NULL
  GROUP BY s.store_id, r.ingredient_id, s.pos_ts
  UNION ALL
  -- Path B: finished direct link (1 шт per sale), retail-precedence guard.
  SELECT s.store_id, fl.ingredient_id, s.pos_ts,
         SUM(s.qty) AS consumed_qty
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN finished_link fl ON fl.product_id = pm.product_id
  WHERE s.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                    WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
  GROUP BY s.store_id, fl.ingredient_id, s.pos_ts
  UNION ALL
  -- Path C (fallback): recipes with NULL product_id (POS pseudo-products) by
  -- normalized spelling, retail type only.
  SELECT s.store_id, r.ingredient_id, s.pos_ts,
         SUM(s.qty * r.amount_per_serving) AS consumed_qty
  FROM sales_stream s
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.product_id IS NULL AND r.recipe_type = 'retail'
   AND lower(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), 'ё', 'е'))
       = lower(replace(trim(regexp_replace(s.product, '\\s+', ' ')), 'ё', 'е'))
  WHERE s.store_id IS NOT NULL
  GROUP BY s.store_id, r.ingredient_id, s.pos_ts
),
po_receipts AS (
  SELECT po.store_id, pol.ingredient_id,
         COALESCE(try_cast(po.received_at AS TIMESTAMP),
                  CAST(concat(po.received_date, 'T12:00:00') AS TIMESTAMP)) AS po_ts,
         COALESCE(pol.received_quantity, pol.ordered_quantity, 0) AS received_qty
  FROM workspace.inventory_tabular.fact_purchase_orders po
  JOIN workspace.inventory_tabular.fact_purchase_order_lines pol ON pol.po_id = po.po_id
  LEFT JOIN (SELECT DISTINCT po_id FROM workspace.inventory_tabular.fact_inventory_transactions
             WHERE po_id IS NOT NULL) tx ON tx.po_id = po.po_id
  WHERE po.status IN ('received', 'partially_received')
    AND tx.po_id IS NULL
    AND NOT (po.from_store_id IS NOT NULL AND po.to_store_id IS NOT NULL)
),
tx_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE
           WHEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END > b.cut_ts
           THEN t.quantity END), 0) AS net_movement_since_audit,
         MAX(CASE
           WHEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END > b.cut_ts
           THEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END
           END) AS last_tx_ts
  FROM baseline b
  LEFT JOIN workspace.inventory_tabular.fact_inventory_transactions t
    ON t.store_id = b.store_id AND t.ingredient_id = b.ingredient_id
  LEFT JOIN workspace.inventory_tabular.fact_purchase_orders po ON po.po_id = t.po_id
  GROUP BY b.store_id, b.ingredient_id
),
pos_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE WHEN p.pos_ts > b.cut_ts THEN p.consumed_qty END), 0) AS pos_consumption_since_audit,
         MAX(CASE WHEN p.pos_ts > b.cut_ts THEN p.pos_ts END) AS last_pos_ts
  FROM baseline b
  LEFT JOIN pos_consumption p
    ON p.store_id = b.store_id AND p.ingredient_id = b.ingredient_id
  GROUP BY b.store_id, b.ingredient_id
),
po_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE WHEN pr.po_ts > b.cut_ts THEN pr.received_qty END), 0) AS po_receipts_since_audit,
         MAX(CASE WHEN pr.po_ts > b.cut_ts THEN pr.po_ts END) AS last_po_ts
  FROM baseline b
  LEFT JOIN po_receipts pr
    ON pr.store_id = b.store_id AND pr.ingredient_id = b.ingredient_id
  GROUP BY b.store_id, b.ingredient_id
)
SELECT
  b.store_id,
  s.store_code,
  s.store_name,
  b.ingredient_id,
  i.ingredient_name,
  i.unit,
  i.is_hidden,
  i.is_warehouse_only,
  b.audit_id AS last_audit_id,
  b.audit_date AS last_audit_date,
  b.count_quantity AS audit_quantity,
  tx.net_movement_since_audit,
  pos.pos_consumption_since_audit,
  po.po_receipts_since_audit,
  b.count_quantity + tx.net_movement_since_audit - pos.pos_consumption_since_audit + po.po_receipts_since_audit AS current_on_hand,
  CAST(COALESCE(GREATEST(tx.last_tx_ts, pos.last_pos_ts, po.last_po_ts), CAST(b.audit_date AS TIMESTAMP)) AS DATE) AS current_on_hand_as_of_date,
  i.item_class AS item_class,
  i.product_id AS product_id
FROM baseline b
JOIN workspace.inventory_tabular.dim_stores s ON s.store_id = b.store_id
JOIN workspace.inventory_tabular.dim_ingredients i ON i.ingredient_id = b.ingredient_id
JOIN tx_movements tx ON tx.store_id = b.store_id AND tx.ingredient_id = b.ingredient_id
JOIN pos_movements pos ON pos.store_id = b.store_id AND pos.ingredient_id = b.ingredient_id
JOIN po_movements po ON po.store_id = b.store_id AND po.ingredient_id = b.ingredient_id
-- Only active stores belong in "current" inventory; closed stores' closing stock stays in the base tables
WHERE s.is_active
