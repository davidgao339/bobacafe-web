-- Two-Echelon Costing Engine — Level 0/1: per-item unit cost (spec Rule 1/2/3)
--
-- Level 0 (purchased raws): PO-based WAC from view_ingredient_wac_30d.
-- Level 1 (produced items — finished / intermediate): PURE ACTUAL yield
--   absorption (user decision 2026-11-10, spec Rule 1):
--       unit_cost = (Σ actual consumed-component cost across runs
--                   + Σ labor for actual output units)
--                   / Σ actual yielded units
--   Components cost resolves through their OWN level: a produced component
--   (e.g. tapioca pearls inside another referenced item) explodes recursively
--   with a path-array cycle guard (spec Rule 3), stopping at terminal items.
--   Run attribution: production consumption legs carry `reason` = the output
--   product name (verified 2026-11-10 in fact_inventory_transactions).
-- Labor (spec Rule 2): dim_cook_unit_pay.pay_rate per output unit; NULL rows
--   are skipped (mochi family only for now — user decision 2026-11-10).
-- Produced items with zero runs keep unit_cost NULL and cost_source
-- 'expects_production' — the nightly DQ report surfaces them; they are NOT
-- silently priced as free.
CREATE OR REPLACE VIEW inventory_tabular.view_item_unit_cost AS
WITH RECURSIVE
run_outputs AS (
    -- Actual production runs: WHS output legs (positive quantity).
    SELECT i.ingredient_id, i.ingredient_name, SUM(l.quantity) AS produced_qty
    FROM workspace.inventory_tabular.fact_inventory_transactions l
    JOIN workspace.inventory_tabular.dim_ingredients i
      ON i.ingredient_id = l.ingredient_id
    WHERE l.transaction_type = 'production' AND l.quantity > 0
    GROUP BY i.ingredient_id, i.ingredient_name
),
run_inputs AS (
    -- Actual consumption legs, grouped by (output product, component item).
    -- Attribution: the leg's `reason` names the produced output; matched to
    -- the dim item by ё-normalized name (bronze is name-canonical).
    SELECT rl.reason AS produced_name,
           p.ingredient_id AS produced_id,
           rl.ingredient_id AS comp_id,
           SUM(-rl.quantity) AS qty_used
    FROM workspace.inventory_tabular.fact_inventory_transactions rl
    JOIN workspace.inventory_tabular.dim_ingredients p
      ON LOWER(REPLACE(p.ingredient_name, 'ё', 'е')) = LOWER(REPLACE(rl.reason, 'ё', 'е'))
    WHERE rl.transaction_type = 'production' AND rl.quantity < 0
      AND rl.reason IS NOT NULL
    GROUP BY 1, 2, 3
),
level0_cost AS (
    -- Level 0 unit cost per item id (purchased or catalog fallback).
    SELECT w.ingredient_id, w.effective_unit_cost, w.cost_source
    FROM workspace.inventory_tabular.view_ingredient_wac_30d w
),
produced_ids AS (
    SELECT ingredient_id FROM run_outputs
),
-- Spec Rule-3 explosion: propagate terminal component quantities through
-- produced intermediates per path; path array guards against circular BOMs.
explosion(node_id, comp_id, qty_total, path) AS (
    -- Base: terminal material legs (component is not a produced item).
    SELECT i.produced_id, i.comp_id, i.qty_used, ARRAY(i.comp_id)
    FROM run_inputs i
    LEFT JOIN produced_ids oc ON oc.ingredient_id = i.comp_id
    WHERE oc.ingredient_id IS NULL
    UNION ALL
    -- Recursive step: explode through produced intermediates. A unit of the
    -- intermediate consumed needs qty_used/produced_qty units of ITS inputs.
    SELECT e.node_id,
           i.comp_id,
           e.qty_total * i.qty_used / o2.produced_qty,
           concat(e.path, ARRAY(i.comp_id)) -- spec: cycle detection (path array)
    FROM explosion e
    JOIN run_inputs i ON i.produced_id = e.comp_id
    JOIN run_outputs o2 ON o2.ingredient_id = e.comp_id
    LEFT JOIN produced_ids oc ON oc.ingredient_id = i.comp_id
    WHERE oc.ingredient_id IS NULL            -- stop at terminal materials
      AND NOT array_contains(e.path, i.comp_id)  -- spec: cycle detection guardrail
),
mat_unit_cost AS (
    SELECT e.node_id AS ingredient_id,
           SUM(e.qty_total * w.effective_unit_cost) AS mat_cost
    FROM explosion e
    JOIN level0_cost w ON w.ingredient_id = e.comp_id
    GROUP BY e.node_id
),
labor_cost AS (
    SELECT o.ingredient_id,
           SUM(t.quantity * COALESCE(cp.pay_rate, 0)) AS labor_total
    FROM run_outputs o
    JOIN workspace.inventory_tabular.fact_inventory_transactions t
         ON t.transaction_type = 'production' AND t.quantity > 0
        AND t.ingredient_id = o.ingredient_id
    LEFT JOIN workspace.inventory_tabular.dim_cook_unit_pay cp
      ON LOWER(REPLACE(cp.product_name, 'ё', 'е')) = LOWER(REPLACE(o.ingredient_name, 'ё', 'е'))
    GROUP BY o.ingredient_id
),
produced_unit_cost AS (
    SELECT o.ingredient_id,
           ROUND((COALESCE(m.mat_cost, 0) + COALESCE(l2.labor_total, 0))
                 / o.produced_qty, 4) AS unit_cost
    FROM run_outputs o
    LEFT JOIN mat_unit_cost m ON m.ingredient_id = o.ingredient_id
    LEFT JOIN labor_cost l2 ON l2.ingredient_id = o.ingredient_id
)
SELECT
    i.ingredient_id,
    i.ingredient_name,
    i.item_class,
    i.product_id,
    CASE
        WHEN i.item_class IN ('finished', 'intermediate') THEN pc.unit_cost
        ELSE w.effective_unit_cost
    END AS unit_cost,
    CASE
        WHEN i.item_class IN ('finished', 'intermediate') AND pc.ingredient_id IS NOT NULL
            THEN 'production_actual'
        WHEN i.item_class IN ('finished', 'intermediate')
            THEN 'expects_production'
        ELSE w.cost_source
    END AS cost_source
FROM workspace.inventory_tabular.dim_ingredients i
LEFT JOIN produced_unit_cost pc ON pc.ingredient_id = i.ingredient_id
LEFT JOIN level0_cost w ON w.ingredient_id = i.ingredient_id
