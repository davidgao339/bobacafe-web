-- view_inventory_events_last_audit — event feed behind the Daily ledger tab
-- and view_current_inventory.
--
-- One row per movement/audit event for each store × ingredient, cut off at
-- the PAIR's second-to-last audit (rn=2) — or rn=1 if only one audit exists.
-- Emits both the anchor audit (rn=2, baseline count) AND the latest audit
-- (rn=1, the actual audit being inspected/adjusted), plus all PO receipts,
-- transfers, POS sales, and inventory transactions in between.
--
-- Single source of truth for the event stream:
--   - view_ledger_daily groups these exact rows into day aggregates + ending_balance
--   - stores-tabular Ledger.jsx renders details_json directly from view_ledger_daily
--
-- Depletion Contract:
--   pos CTE mirrors view_pos_sales_resolved:
--     Path A: retail recipes by product_id
--     Path B: finished direct link 1:1
--     Path B_PKG: dynamic serving packaging attached to finished goods (packaging_ingredient_id)
--     Path C: NULL-pid retail recipes matched by normalized spelling
--     Path D: fallback recipe match by normalized name
CREATE OR REPLACE VIEW inventory_tabular.view_inventory_events_last_audit (
  store_id,
  store_code,
  store_name,
  is_active,
  ingredient_id,
  ingredient_name,
  unit,
  source,
  event_ts,
  date,
  qty_change,
  audit_count,
  audit_id,
  po_id,
  product,
  qty_units,
  order_number,
  transaction_type)
WITH SCHEMA COMPENSATION
AS WITH latest_audit AS (
  SELECT c.store_id, c.ingredient_id, c.audit_id, c.audit_date, c.count_quantity,
         CAST(CASE WHEN h.audit_timestamp LIKE concat(c.audit_date, '%')
                   THEN h.audit_timestamp
                   ELSE concat(c.audit_date, 'T23:59:59') END AS TIMESTAMP) AS cut_ts
  FROM workspace.inventory_tabular.fact_audit_counts c
  JOIN workspace.inventory_tabular.fact_audit_headers h ON h.audit_id = c.audit_id
  WHERE h.status != 'rejected'
),
anchor AS (
  SELECT store_id, ingredient_id, audit_id, count_quantity AS audit_count, cut_ts AS event_ts,
         ROW_NUMBER() OVER (PARTITION BY store_id, ingredient_id ORDER BY audit_date DESC, audit_id DESC) AS rn
  FROM latest_audit
),
anchor_last AS (
  SELECT store_id, ingredient_id, audit_id, audit_count, event_ts
  FROM anchor WHERE rn = 1
),
anchor_picked AS (
  SELECT store_id, ingredient_id, audit_id, audit_count, event_ts
  FROM anchor WHERE rn = 2
  UNION ALL
  SELECT a1.store_id, a1.ingredient_id, a1.audit_id, a1.audit_count, a1.event_ts
  FROM anchor a1
  WHERE a1.rn = 1
    AND NOT EXISTS (SELECT 1 FROM anchor a2
                    WHERE a2.store_id = a1.store_id
                      AND a2.ingredient_id = a1.ingredient_id
                      AND a2.rn = 2)
),
finished_link AS (
  SELECT z.ingredient_id, z.product_id, z.packaging_ingredient_id FROM (
    SELECT i.ingredient_id, i.product_id, i.packaging_ingredient_id,
           ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.ingredient_id) AS rn
    FROM workspace.inventory_tabular.dim_ingredients i
    WHERE i.item_class = 'finished' AND i.product_id IS NOT NULL
  ) z WHERE rn = 1
),
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
  FROM (SELECT DISTINCT product FROM workspace.default.transactions
        WHERE NOT COALESCE(is_return, FALSE) AND qty > 0) t
  JOIN dim_picked dp
    ON dp.nkey = lower(replace(replace(trim(regexp_replace(t.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
),
sales_stream AS (
  SELECT t.datetime AS pos_ts, t.product, t.qty, t.order_number, t.transaction_type,
         CASE t.store_name
           WHEN 'НОВО КП' THEN 1 WHEN 'ГРИН ПАРК' THEN 2 WHEN 'БОН ПАССАЖ' THEN 3
           WHEN 'ЧЕРНОМОРСКИЙ' THEN 4 WHEN 'СОВЕТОВ' THEN 5 WHEN 'ГАЛЕРЕЯ' THEN 6
           WHEN 'ОЗМОЛЛ' THEN 10 WHEN 'КИОСК' THEN 13 WHEN 'АНАПА' THEN 11 WHEN 'ГЕЛЕНДЖИК' THEN 12
         END AS store_id
  FROM workspace.default.transactions t
  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0
),
pos AS (
  -- Path A: retail recipes joined by product_id
  SELECT s.store_id, r.ingredient_id, s.pos_ts AS event_ts,
         -(s.qty * r.amount_per_serving) AS qty_change,
         pm.dim_name AS product, s.qty AS qty_units, s.order_number, s.transaction_type
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.product_id = pm.product_id AND r.recipe_type = 'retail'
  WHERE s.store_id IS NOT NULL
  UNION ALL
  -- Path B: finished direct link 1:1
  SELECT s.store_id, fl.ingredient_id, s.pos_ts AS event_ts,
         -s.qty AS qty_change,
         pm.dim_name AS product, s.qty AS qty_units, s.order_number, s.transaction_type
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN finished_link fl ON fl.product_id = pm.product_id
  WHERE s.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                    WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
  UNION ALL
  -- Path B_PKG: dynamic serving packaging attached to finished goods
  SELECT s.store_id, fl.packaging_ingredient_id AS ingredient_id, s.pos_ts AS event_ts,
         -s.qty AS qty_change,
         pm.dim_name AS product, s.qty AS qty_units, s.order_number, s.transaction_type
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN finished_link fl ON fl.product_id = pm.product_id
  WHERE s.store_id IS NOT NULL
    AND fl.packaging_ingredient_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                    WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
  UNION ALL
  -- Path C: NULL-pid retail recipes matched by normalized spelling
  SELECT s.store_id, r.ingredient_id, s.pos_ts AS event_ts,
         -(s.qty * r.amount_per_serving) AS qty_change,
         s.product, s.qty AS qty_units, s.order_number, s.transaction_type
  FROM sales_stream s
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.product_id IS NULL AND r.recipe_type = 'retail'
   AND lower(replace(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
       = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
  WHERE s.store_id IS NOT NULL
  UNION ALL
  -- Path D: Fallback recipe match by normalized name
  SELECT s.store_id, r.ingredient_id, s.pos_ts AS event_ts,
         -(s.qty * r.amount_per_serving) AS qty_change,
         pm.dim_name AS product, s.qty AS qty_units, s.order_number, s.transaction_type
  FROM sales_stream s
  JOIN product_map pm ON pm.product = s.product
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.recipe_type = 'retail'
   AND lower(replace(replace(trim(regexp_replace(r.recipe_product_name, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
       = lower(replace(replace(trim(regexp_replace(s.product, '\\s+', ' ')), '-', ' '), 'ё', 'е'))
  WHERE s.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workspace.inventory_tabular.fact_recipe_ingredients r2
                    WHERE r2.product_id = pm.product_id AND r2.recipe_type = 'retail')
    AND NOT EXISTS (SELECT 1 FROM finished_link fl2 WHERE fl2.product_id = pm.product_id)
),
receipts AS (
  SELECT po.store_id, pol.ingredient_id,
         COALESCE(try_cast(po.received_at AS TIMESTAMP), CAST(concat(po.received_date,'T12:00:00') AS TIMESTAMP)) AS event_ts,
         COALESCE(pol.received_quantity, pol.ordered_quantity, 0) AS qty_change,
         po.status AS transaction_type, po.po_id
  FROM workspace.inventory_tabular.fact_purchase_orders po
  JOIN workspace.inventory_tabular.fact_purchase_order_lines pol ON pol.po_id = po.po_id
  LEFT JOIN (SELECT DISTINCT po_id FROM workspace.inventory_tabular.fact_inventory_transactions WHERE po_id IS NOT NULL) tx ON tx.po_id = po.po_id
  WHERE po.status IN ('received','partially_received')
    AND tx.po_id IS NULL
    AND NOT (po.from_store_id IS NOT NULL AND po.to_store_id IS NOT NULL)
),
tx_all AS (
  SELECT t.store_id, t.ingredient_id,
         CASE WHEN po.from_store_id IS NOT NULL AND po.to_store_id IS NOT NULL THEN 'transfer' ELSE 'other' END AS kind,
         COALESCE(try_cast(po.received_at AS TIMESTAMP), CAST(concat(t.transaction_date,'T12:00:00') AS TIMESTAMP)) AS event_ts,
         t.quantity AS qty_change, t.transaction_type, t.po_id
  FROM workspace.inventory_tabular.fact_inventory_transactions t
  LEFT JOIN workspace.inventory_tabular.fact_purchase_orders po ON po.po_id = t.po_id
),
events AS (
  SELECT a.store_id, a.ingredient_id, a.event_ts, 'audit' AS source,
         CAST(NULL AS DOUBLE) AS qty_change, a.audit_count, a.audit_id,
         CAST(NULL AS STRING) AS po_id, CAST(NULL AS STRING) AS product,
         CAST(NULL AS DOUBLE) AS qty_units, CAST(NULL AS STRING) AS order_number, 'approved' AS transaction_type
  FROM anchor_picked a
  UNION ALL
  SELECT l.store_id, l.ingredient_id,
         CASE WHEN l.event_ts > a.event_ts THEN l.event_ts ELSE a.event_ts + INTERVAL 1 SECOND END AS event_ts,
         'audit' AS source,
         CAST(NULL AS DOUBLE) AS qty_change, l.audit_count, l.audit_id,
         CAST(NULL AS STRING) AS po_id, CAST(NULL AS STRING) AS product,
         CAST(NULL AS DOUBLE) AS qty_units, CAST(NULL AS STRING) AS order_number, 'approved' AS transaction_type
  FROM anchor_last l
  JOIN anchor_picked a ON a.store_id = l.store_id AND a.ingredient_id = l.ingredient_id AND a.audit_id != l.audit_id
  UNION ALL
  SELECT p.store_id, p.ingredient_id, p.event_ts, 'pos_sale', p.qty_change,
         CAST(NULL AS DOUBLE), CAST(NULL AS STRING), CAST(NULL AS STRING), p.product, p.qty_units, CAST(p.order_number AS STRING), p.transaction_type
  FROM pos p
  JOIN anchor_picked a ON a.store_id = p.store_id AND a.ingredient_id = p.ingredient_id AND p.event_ts > a.event_ts
  UNION ALL
  SELECT r.store_id, r.ingredient_id, r.event_ts, 'po_receipt', r.qty_change,
         CAST(NULL AS DOUBLE), CAST(NULL AS STRING), r.po_id, CAST(NULL AS STRING), CAST(NULL AS DOUBLE), CAST(NULL AS STRING), r.transaction_type
  FROM receipts r
  JOIN anchor_picked a ON a.store_id = r.store_id AND a.ingredient_id = r.ingredient_id AND r.event_ts > a.event_ts
  UNION ALL
  SELECT x.store_id, x.ingredient_id, x.event_ts,
         CASE WHEN x.kind = 'transfer' AND x.qty_change < 0 THEN 'transfer_out'
              WHEN x.kind = 'transfer' THEN 'transfer_in'
              ELSE 'inventory_tx' END,
         x.qty_change, CAST(NULL AS DOUBLE), CAST(NULL AS STRING), x.po_id,
         CAST(NULL AS STRING), CAST(NULL AS DOUBLE), CAST(NULL AS STRING), x.transaction_type
  FROM tx_all x
  JOIN anchor_picked a ON a.store_id = x.store_id AND a.ingredient_id = x.ingredient_id AND x.event_ts > a.event_ts
)
SELECT
  s.store_id, s.store_code, s.store_name, s.is_active,
  e.ingredient_id, i.ingredient_name, i.unit,
  e.source, e.event_ts, CAST(e.event_ts AS DATE) AS date,
  e.qty_change, e.audit_count, e.audit_id,
  e.po_id, e.product, e.qty_units, e.order_number, e.transaction_type
FROM events e
JOIN workspace.inventory_tabular.dim_stores s ON s.store_id = e.store_id
JOIN workspace.inventory_tabular.dim_ingredients i ON i.ingredient_id = e.ingredient_id;
