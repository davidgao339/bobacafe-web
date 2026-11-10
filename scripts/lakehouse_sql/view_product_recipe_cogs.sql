-- Two-Echelon Costing Engine — Level 2: POS product COGS (retail recipes)
--
-- Same output shape as the legacy WAC-only view (7 dims + cogs/profit/margin),
-- so every consumer keeps working. The change is component resolution: each
-- retail component prices through view_item_unit_cost — its OWN cost level:
--   purchased component → PO WAC
--   produced component (tapioca pearls, finished SKUs) → rolled actual cost
-- A component with unit_cost NULL contributes 0 implicitly (SUM skips NULL)
-- and is visible in view_item_unit_cost.cost_source = 'expects_production'.
-- Expense is recognized here only as a pricing basis: the actual COGS event is
-- the external sale (production/transfers are value moves, not expenses).
CREATE OR REPLACE VIEW inventory_tabular.view_product_recipe_cogs AS
SELECT
    p.product_ru,
    p.parent_product_id,
    p.parent_product_en,
    p.category,
    p.variant,
    p.is_active,
    p.base_price,
    ROUND(SUM(r.amount_per_serving * c.unit_cost), 2) AS calculated_cogs,
    ROUND(p.base_price - SUM(r.amount_per_serving * c.unit_cost), 2) AS gross_profit,
    ROUND(
        (p.base_price - SUM(r.amount_per_serving * c.unit_cost)) / NULLIF(p.base_price, 0) * 100,
        1
    ) AS gross_margin_pct
FROM workspace.gold.dim_product p
JOIN workspace.inventory_tabular.fact_recipe_ingredients r
  ON r.product_id IS NOT NULL AND r.product_id = p.product_id
JOIN workspace.inventory_tabular.view_item_unit_cost c
  ON c.ingredient_id = r.ingredient_id
GROUP BY
    p.product_ru, p.parent_product_id, p.parent_product_en,
    p.category, p.variant, p.is_active, p.base_price
