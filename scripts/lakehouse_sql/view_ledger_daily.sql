-- view_ledger_daily — the Daily ledger at DAY grain, ready to render.
-- One row per store × ingredient × date since that pair's anchor audit
-- (rn=2, fallback rn=1 — same rule as view_inventory_events_last_audit,
-- which this view composes; single source of truth for the event stream).
--
-- Replaces ~120 lines of client-side day-bucketing / running-balance /
-- day-aggregation in stores-tabular Ledger.jsx, and lets the app fetch one
-- ingredient's rows instead of a whole store's event stream.
--
-- Semantics mirror Ledger.jsx exactly:
--   day_usage        = POS sales + production usage (negative production tx)
--   day_received     = PO receipts + transfer-in + adjustments (any sign)
--                      + production yield (positive production tx)
--   day_transfer_in  = transfer-in legs (also counted in day_received)
--   day_transfer_out = transfer-out legs (NOT in usage/received)
--   audit_adj        = counted − running balance at each audit that day
--                      (the anchor audit contributes 0)
--   ending_balance   = anchor_count + cumulative deltas through end of day
--   details_json     = event lines for the expandable day row, time-ordered:
--     {kind: sale|po|transfer-in|transfer-out|adjustment|
--            production-yield|production-usage|audit,
--      time, product, sold_qty, consumed, qty, po_id, audit_count, adj, is_anchor}
--
-- Design note: every balance figure is an ADDITIVE aggregate (SUM of deltas),
-- never a per-row value picked by ROW_NUMBER — bronze contains exact-duplicate
-- sale rows (same item twice in one order), and picking a row's cumulative
-- value can silently drop its twin's delta.
-- A day with no events produces no row — the app adds the empty "today" row.
CREATE OR REPLACE VIEW inventory_tabular.view_ledger_daily (
  store_id,
  store_code,
  store_name,
  ingredient_id,
  ingredient_name,
  unit,
  anchor_date,
  anchor_count,
  date,
  day_usage,
  day_received,
  day_transfer_in,
  day_transfer_out,
  audit_adj,
  ending_balance,
  details_json)
WITH SCHEMA COMPENSATION
AS WITH ev AS (
  SELECT store_id, store_code, store_name, ingredient_id, ingredient_name, unit,
         source, event_ts, CAST(date AS DATE) AS d, qty_change, audit_count, audit_id,
         po_id, product, qty_units, order_number, transaction_type
  FROM workspace.inventory_tabular.view_inventory_events_last_audit
),
-- The anchor audit = the earliest audit row in the stream (the view emits
-- exactly the anchor + the last audit).
anchor AS (
  SELECT store_id, ingredient_id, event_ts AS anchor_ts, audit_count AS anchor_count,
         CAST(event_ts AS DATE) AS anchor_date,
         ROW_NUMBER() OVER (PARTITION BY store_id, ingredient_id ORDER BY event_ts ASC, audit_id ASC) AS rn
  FROM ev WHERE source = 'audit'
),
-- Running balance BEFORE each row's own change. Audit rows carry a NULL
-- qty_change (SUM ignores them), so running_before at an audit row is the
-- pre-audit balance — its adjustment is count − running_before. Additive over
-- a row set: deterministic even with duplicate rows.
pass1 AS (
  SELECT e.*, an.anchor_ts, an.anchor_count,
         an.anchor_count + COALESCE(SUM(COALESCE(e.qty_change, 0)) OVER (
           PARTITION BY e.store_id, e.ingredient_id
           ORDER BY e.event_ts, e.audit_id, e.po_id, e.order_number, e.product, e.source, e.qty_change
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS running_before
  FROM ev e
  JOIN anchor an
    ON an.store_id = e.store_id AND an.ingredient_id = e.ingredient_id AND an.rn = 1
),
day_agg AS (
  SELECT store_id, ingredient_id, d,
         ROUND(SUM(CASE WHEN source = 'pos_sale'
                          OR (source = 'inventory_tx' AND transaction_type = 'production'
                              AND COALESCE(qty_change, 0) < 0)
                        THEN -qty_change ELSE 0 END), 1) AS day_usage,
         ROUND(SUM(CASE WHEN source IN ('po_receipt', 'transfer_in')
                          OR (source = 'inventory_tx'
                              AND NOT (transaction_type = 'production'
                                       AND COALESCE(qty_change, 0) < 0))
                        THEN qty_change ELSE 0 END), 1) AS day_received,
         ROUND(SUM(CASE WHEN source = 'transfer_in' THEN qty_change ELSE 0 END), 1) AS day_transfer_in,
         ROUND(SUM(CASE WHEN source = 'transfer_out' THEN -qty_change ELSE 0 END), 1) AS day_transfer_out,
         ROUND(SUM(CASE WHEN source = 'audit' THEN audit_count - running_before ELSE 0 END), 1) AS audit_adj,
         SUM(CASE WHEN source = 'audit' THEN audit_count - running_before
                  ELSE qty_change END) AS day_delta
  FROM pass1
  GROUP BY store_id, ingredient_id, d
),
-- Ending balance per day = anchor + cumulative deltas through that day.
-- Additive across day rows: duplicate rows are always counted exactly once.
ending AS (
  SELECT dg.store_id, dg.ingredient_id, dg.d,
         ROUND(a.anchor_count + SUM(dg.day_delta) OVER (
           PARTITION BY dg.store_id, dg.ingredient_id ORDER BY dg.d
           ROWS UNBOUNDED PRECEDING), 1) AS ending_balance
  FROM day_agg dg
  JOIN anchor a ON a.store_id = dg.store_id AND a.ingredient_id = dg.ingredient_id AND a.rn = 1
),
details AS (
  SELECT store_id, ingredient_id, d,
         to_json(array_sort(collect_list(named_struct(
           'time', CAST(event_ts AS STRING),
           'kind', CASE source
                     WHEN 'pos_sale' THEN 'sale'
                     WHEN 'po_receipt' THEN 'po'
                     WHEN 'transfer_in' THEN 'transfer-in'
                     WHEN 'transfer_out' THEN 'transfer-out'
                     WHEN 'inventory_tx' THEN CASE WHEN transaction_type = 'production'
                                                   THEN CASE WHEN qty_change > 0 THEN 'production-yield'
                                                             ELSE 'production-usage' END
                                                   ELSE 'adjustment' END
                     ELSE 'audit' END,
           'product', product,
           'sold_qty', qty_units,
           'consumed', CASE WHEN source = 'pos_sale' THEN ROUND(-qty_change, 1) END,
           'qty', CASE WHEN source NOT IN ('pos_sale', 'audit') THEN qty_change END,
           'po_id', po_id,
           'audit_count', audit_count,
           'adj', CASE WHEN source = 'audit' THEN ROUND(audit_count - running_before, 1) END,
           'is_anchor', source = 'audit' AND event_ts = anchor_ts
         )))) AS details_json
  FROM pass1
  GROUP BY store_id, ingredient_id, d
)
SELECT p.store_id, p.store_code, p.store_name, p.ingredient_id, p.ingredient_name, p.unit,
       a.anchor_date, a.anchor_count,
       p.d AS date, dg.day_usage, dg.day_received, dg.day_transfer_in, dg.day_transfer_out,
       dg.audit_adj, e.ending_balance, dt.details_json
FROM (SELECT DISTINCT store_id, store_code, store_name, ingredient_id, ingredient_name, unit, d
      FROM pass1) p
JOIN anchor a ON a.store_id = p.store_id AND a.ingredient_id = p.ingredient_id AND a.rn = 1
JOIN day_agg  dg ON dg.store_id = p.store_id AND dg.ingredient_id = p.ingredient_id AND dg.d = p.d
JOIN ending   e  ON e.store_id = p.store_id AND e.ingredient_id = p.ingredient_id AND e.d = p.d
JOIN details  dt ON dt.store_id = p.store_id AND dt.ingredient_id = p.ingredient_id AND dt.d = p.d
