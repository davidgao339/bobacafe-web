-- view_inventory_events_last_audit — event feed behind the Daily ledger tab
-- (stores-tabular + warehouse-tabular `fetchLedgerEvents`).
--
-- 2026-11-11: cutoff moved from the LAST audit to the SECOND-LAST audit that
-- counted a store×ingredient, so the ledger covers the whole previous audit
-- interval INCLUDING the last audit row — its adjustment (counted vs running)
-- is how loss/shrinkage becomes visible on the day it was caught.
--   • Baseline anchor = rn=2 (second-most-recent approved audit counting the
--     ingredient); falls back to rn=1 when the ingredient has only one audit.
--   • The rn=1 (last) audit is emitted as a source='audit' row when it is not
--     the anchor, so the ledger renders the counted qty + adjustment.
-- Balances (view_current_inventory / view_store_stock / view_whs_stock) are
-- unaffected: they keep anchoring on the LAST audit (rn=1).
-- Original (rn=1 cutoff) definition recovered via SHOW CREATE TABLE before this
-- change (kept in scratch/, gitignored; redeploy by editing in Databricks).
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
anchor_picked AS (
  SELECT store_id, ingredient_id, audit_id, audit_count, event_ts
  FROM (
    SELECT store_id, ingredient_id, audit_id, audit_count, event_ts, rn,
           CASE WHEN COUNT(*) OVER (PARTITION BY store_id, ingredient_id) >= 2 THEN 2 ELSE 1 END AS pick_rn
    FROM anchor
  ) t
  WHERE rn = pick_rn
),
anchor_last AS (
  SELECT store_id, ingredient_id, audit_id, audit_count, event_ts FROM anchor WHERE rn = 1
),
pos AS (
  SELECT m.store_id, r.ingredient_id, m.pos_ts AS event_ts,
         -(m.qty * r.amount_per_serving) AS qty_change,
         m.product, m.qty AS qty_units, m.order_number, m.transaction_type
  FROM (
    SELECT t.datetime AS pos_ts, t.product, t.qty, t.order_number, t.transaction_type,
           CASE t.store_name
             WHEN 'НОВО КП' THEN 1 WHEN 'ГРИН ПАРК' THEN 2 WHEN 'БОН ПАССАЖ' THEN 3
             WHEN 'ЧЕРНОМОРСКИЙ' THEN 4 WHEN 'СОВЕТОВ' THEN 5 WHEN 'ГАЛЕРЕЯ' THEN 6
             WHEN 'ОЗМОЛЛ' THEN 10 WHEN 'КИОСК' THEN 13 WHEN 'АНАПА' THEN 11 WHEN 'ГЕЛЕНДЖИК' THEN 12
           END AS store_id
    FROM workspace.default.transactions t
    WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0
  ) m
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.recipe_product_name = m.product AND r.recipe_type = 'retail'
  WHERE m.store_id IS NOT NULL
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
         -- The last audit must always land in the stream AFTER the baseline
         -- anchor. Legacy migrated audits can share audit_date with rewritten
         -- header timestamps (fallback cut_ts date T23:59:59), tying rn=1 and
         -- rn=2 on the same ts — a strict `> anchor` join would drop the last
         -- audit row and the ledger would never reset to its count. Bump by 1s
         -- only when tied (movements use `> anchor`, so the window is unchanged).
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
JOIN workspace.inventory_tabular.dim_ingredients i ON i.ingredient_id = e.ingredient_id
