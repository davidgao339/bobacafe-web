-- view_stock_stats — one row per store × ingredient with the numbers the
-- stores-tabular app currently re-derives in useInventoryCalcs.jsx (~330 lines
-- of JS loops over sales × recipes + transactions + POs).
--
-- Semantics mirror the JS line by line:
--   • variance window = the last two audits that COUNTED the ingredient
--     (opening = rn=2, closing = rn=1). With a single audit the JS shows no
--     variance (win=null → actual/unexplained NULL) but still accumulates
--     sales consumption over all history — mirrored via the 0000-01-01
--     sentinel open_date (variance columns come out NULL);
--   • consumed_14d = POS sales × recipe + non-adjustment tx over
--     (max_bronze_date − 14, max_bronze_date]; consumed_daily_14d = per-day
--     sales array, exactly 14 entries (sparkline);
--   • sales_consumption_window / direct_consumption_window / adj_delta_window /
--     transfer_net_window / po_in_window mirror the JS window aggregations
--     (date-only comparisons, status='received' POs only, transfers excluded
--     from po_in_window but counted in transfer_net via their adjustment legs);
--   • actual_consumed = opening − closing + po_in_window + transfer_net_window;
--     unexplained_variance = actual − sales − direct (shrinkage);
--     variance_pct = unexplained / sales_window × 100 (0 when sales_window 0);
--   • days_left = current_on_hand / daily_avg (NULL when daily_avg 0);
--   • order_qty_raw = consumed_14d × 1.05 − current_on_hand (the app applies
--     roundOrderQty per unit type — kept client-side on purpose).
--
-- Sales consumption comes from view_pos_sales_resolved (the validated
-- product_id bridge) — this also fixes the app's name-based salesRecipes drift
-- hole: JS and SQL previously disagreed on case-drifted spellings.
-- Pairs never audited are absent (view_current_inventory requires a baseline);
-- the app keeps its tiny local fallback for those only.
CREATE OR REPLACE VIEW inventory_tabular.view_stock_stats (
  store_id,
  store_code,
  store_name,
  ingredient_id,
  ingredient_name,
  unit,
  item_class,
  is_warehouse_only,
  is_hidden,
  last_audit_date,
  last_audit_count,
  prev_audit_date,
  prev_audit_count,
  current_on_hand,
  current_on_hand_as_of_date,
  pos_consumption_since_audit,
  consumed_sales_14d,
  consumed_tx_14d,
  consumed_14d,
  daily_avg,
  consumed_daily_14d,
  sales_consumption_window,
  direct_consumption_window,
  adj_delta_window,
  transfer_net_window,
  po_in_window,
  actual_consumed,
  unexplained_variance,
  variance_pct,
  days_left,
  order_qty_raw)
WITH SCHEMA COMPENSATION
AS WITH inv AS (
  SELECT store_id, store_code, store_name, ingredient_id, ingredient_name, unit,
         item_class, is_warehouse_only, is_hidden,
         last_audit_date, audit_quantity AS last_audit_count,
         current_on_hand, current_on_hand_as_of_date, pos_consumption_since_audit
  FROM workspace.inventory_tabular.view_current_inventory
),
audits AS (
  SELECT c.store_id, c.ingredient_id, c.audit_date, c.count_quantity,
         ROW_NUMBER() OVER (PARTITION BY c.store_id, c.ingredient_id
                            ORDER BY c.audit_date DESC, c.audit_id DESC) AS rn
  FROM workspace.inventory_tabular.fact_audit_counts c
  JOIN workspace.inventory_tabular.fact_audit_headers h ON h.audit_id = c.audit_id
  WHERE h.status != 'rejected'
),
w14 AS (
  SELECT to_date, date_add(to_date, -14) AS from_date FROM (
    SELECT CAST(COALESCE(MAX(CAST(date AS DATE)), current_date()) AS DATE) AS to_date
    FROM workspace.default.transactions
    WHERE NOT COALESCE(is_return, FALSE) AND qty > 0
  )
),
-- Sales consumption per pair and day (validated product_id bridge)
sales AS (
  SELECT store_id, ingredient_id, date, SUM(consumed_qty) AS consumed_qty
  FROM workspace.inventory_tabular.view_pos_sales_resolved
  GROUP BY store_id, ingredient_id, date
),
sales14 AS (
  SELECT s.store_id, s.ingredient_id, ROUND(SUM(s.consumed_qty), 1) AS consumed_sales_14d
  FROM sales s CROSS JOIN w14
  WHERE s.date > w14.from_date AND s.date <= w14.to_date
  GROUP BY s.store_id, s.ingredient_id
),
-- 14-date spine so the sparkline array always has exactly 14 entries (0-filled)
dates14 AS (
  SELECT explode(sequence(date_add(w14.to_date, -13), w14.to_date)) AS d FROM w14
),
daily14 AS (
  SELECT k.store_id, k.ingredient_id,
         array_sort(collect_list(named_struct('d', dates14.d, 'v', COALESCE(dd.consumed_qty, 0.0)))) AS arr
  FROM (SELECT store_id, ingredient_id FROM inv) k
  CROSS JOIN dates14
  LEFT JOIN sales dd ON dd.store_id = k.store_id AND dd.ingredient_id = k.ingredient_id AND dd.date = dates14.d
  GROUP BY k.store_id, k.ingredient_id
),
-- Variance-window bounds: opening = rn=2 audit, closing = rn=1. open_count is
-- NULL when no opening audit exists → variance columns NULL (JS win=null).
win AS (
  SELECT k.store_id, k.ingredient_id,
         CAST(COALESCE(o.audit_date, '0000-01-01') AS DATE) AS open_date,
         o.count_quantity AS open_count,
         CAST(c.audit_date AS DATE) AS close_date,
         c.count_quantity AS close_count
  FROM inv k
  LEFT JOIN audits o ON o.store_id = k.store_id AND o.ingredient_id = k.ingredient_id AND o.rn = 2
  LEFT JOIN audits c ON c.store_id = k.store_id AND c.ingredient_id = k.ingredient_id AND c.rn = 1
),
-- One scan covering BOTH windows (the variance window can extend beyond the
-- 14-day window in either direction); each output applies its own date filter.
tx_agg AS (
  SELECT t.store_id, t.ingredient_id,
         ROUND(SUM(CASE WHEN t.transaction_type != 'adjustment'
                         AND CAST(t.transaction_date AS DATE) > w14.from_date
                         AND CAST(t.transaction_date AS DATE) <= w14.to_date
                        THEN t.quantity ELSE 0 END), 1) AS consumed_tx_14d,
         ROUND(SUM(CASE WHEN t.transaction_type != 'adjustment'
                         AND CAST(t.transaction_date AS DATE) > win.open_date
                         AND CAST(t.transaction_date AS DATE) <= win.close_date
                        THEN t.quantity ELSE 0 END), 1) AS direct_consumption_window,
         ROUND(SUM(CASE WHEN t.transaction_type = 'adjustment'
                         AND NOT (t.quantity < 0 AND t.po_id IS NOT NULL)
                         AND CAST(t.transaction_date AS DATE) > win.open_date
                         AND CAST(t.transaction_date AS DATE) <= win.close_date
                        THEN t.quantity ELSE 0 END), 1) AS adj_delta_window,
         ROUND(SUM(CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                         AND CAST(t.transaction_date AS DATE) > win.open_date
                         AND CAST(t.transaction_date AS DATE) <= win.close_date
                        THEN t.quantity ELSE 0 END), 1) AS transfer_net_window
  FROM workspace.inventory_tabular.fact_inventory_transactions t
  JOIN win ON win.store_id = t.store_id AND win.ingredient_id = t.ingredient_id
  CROSS JOIN w14
  WHERE CAST(t.transaction_date AS DATE) > LEAST(w14.from_date, win.open_date)
    AND CAST(t.transaction_date AS DATE) <= GREATEST(w14.to_date, win.close_date)
  GROUP BY t.store_id, t.ingredient_id
),
-- JS poInWindow: status='received' only, transfers excluded, receivedDate in
-- (opening, closing], per line received ?? ordered.
po_in AS (
  SELECT po.store_id, pol.ingredient_id,
         ROUND(SUM(COALESCE(pol.received_quantity, pol.ordered_quantity, 0)), 1) AS po_in_window
  FROM workspace.inventory_tabular.fact_purchase_orders po
  JOIN workspace.inventory_tabular.fact_purchase_order_lines pol ON pol.po_id = po.po_id
  JOIN win ON win.store_id = po.store_id AND win.ingredient_id = pol.ingredient_id
  WHERE po.status = 'received'
    AND NOT (po.from_store_id IS NOT NULL AND po.to_store_id IS NOT NULL)
    AND COALESCE(po.received_date, '') > CAST(win.open_date AS STRING)
    AND COALESCE(po.received_date, '') <= CAST(win.close_date AS STRING)
  GROUP BY po.store_id, pol.ingredient_id
)
SELECT
  inv.store_id, inv.store_code, inv.store_name, inv.ingredient_id, inv.ingredient_name, inv.unit,
  inv.item_class, inv.is_warehouse_only, inv.is_hidden,
  inv.last_audit_date, inv.last_audit_count,
  win.open_date AS prev_audit_date, win.open_count AS prev_audit_count,
  inv.current_on_hand, inv.current_on_hand_as_of_date, inv.pos_consumption_since_audit,
  s14.consumed_sales_14d, t.consumed_tx_14d,
  ROUND(COALESCE(s14.consumed_sales_14d, 0) + COALESCE(t.consumed_tx_14d, 0), 1) AS consumed_14d,
  ROUND((COALESCE(s14.consumed_sales_14d, 0) + COALESCE(t.consumed_tx_14d, 0)) / 14, 1) AS daily_avg,
  transform(d14.arr, x -> x.v) AS consumed_daily_14d,
  ROUND(COALESCE(sw.sales_consumption_window, 0), 1) AS sales_consumption_window,
  t.direct_consumption_window, t.adj_delta_window, t.transfer_net_window,
  pi.po_in_window,
  CASE WHEN win.open_count IS NULL THEN NULL
       ELSE ROUND(win.open_count - win.close_count + COALESCE(pi.po_in_window, 0)
                  + COALESCE(t.transfer_net_window, 0), 1) END AS actual_consumed,
  CASE WHEN win.open_count IS NULL THEN NULL
       ELSE ROUND(win.open_count - win.close_count + COALESCE(pi.po_in_window, 0)
                  + COALESCE(t.transfer_net_window, 0)
                  - COALESCE(sw.sales_consumption_window, 0)
                  - COALESCE(t.direct_consumption_window, 0), 1) END AS unexplained_variance,
  CASE WHEN win.open_count IS NULL OR COALESCE(sw.sales_consumption_window, 0) = 0 THEN 0.0
       ELSE ROUND((win.open_count - win.close_count + COALESCE(pi.po_in_window, 0)
                  + COALESCE(t.transfer_net_window, 0)
                  - COALESCE(sw.sales_consumption_window, 0)
                  - COALESCE(t.direct_consumption_window, 0))
                  / sw.sales_consumption_window * 100, 1) END AS variance_pct,
  CASE WHEN (COALESCE(s14.consumed_sales_14d, 0) + COALESCE(t.consumed_tx_14d, 0)) / 14 > 0
       THEN ROUND(inv.current_on_hand / ((COALESCE(s14.consumed_sales_14d, 0) + COALESCE(t.consumed_tx_14d, 0)) / 14), 1) END AS days_left,
  ROUND((COALESCE(s14.consumed_sales_14d, 0) + COALESCE(t.consumed_tx_14d, 0)) * 1.05 - inv.current_on_hand, 1) AS order_qty_raw
FROM inv
LEFT JOIN win ON win.store_id = inv.store_id AND win.ingredient_id = inv.ingredient_id
LEFT JOIN sales14 s14 ON s14.store_id = inv.store_id AND s14.ingredient_id = inv.ingredient_id
LEFT JOIN daily14 d14 ON d14.store_id = inv.store_id AND d14.ingredient_id = inv.ingredient_id
LEFT JOIN tx_agg t ON t.store_id = inv.store_id AND t.ingredient_id = inv.ingredient_id
LEFT JOIN po_in pi ON pi.store_id = inv.store_id AND pi.ingredient_id = inv.ingredient_id
LEFT JOIN (
  SELECT sales.store_id, sales.ingredient_id,
         SUM(CASE WHEN sales.date > win.open_date AND sales.date <= win.close_date
                  THEN sales.consumed_qty ELSE 0 END) AS sales_consumption_window
  FROM sales
  JOIN win ON win.store_id = sales.store_id AND win.ingredient_id = sales.ingredient_id
  GROUP BY sales.store_id, sales.ingredient_id
) sw ON sw.store_id = inv.store_id AND sw.ingredient_id = inv.ingredient_id
