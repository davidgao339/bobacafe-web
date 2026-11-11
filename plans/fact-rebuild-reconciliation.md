# Plan: D1 fact-table rebuild + D1↔LH reconciliation

## Why

The corn dog regression proved D1's **trigger-derived fact tables can silently rot**
(an unscoped trigger deleted production recipe fact rows when a retail recipe was
edited), and the nightly sync faithfully copies that rot into the lakehouse. D1 is
the master; LH is the copy — so the guarantee we want is:

> every D1 derived-fact row is exactly what its trigger *would* produce from the
> legacy master, and LH matches D1 after a sync.

The legacy masters (`recipes`, `audits`, `transactions`, `purchase_orders`,
`ingredients`, `suppliers`, `settings`) were never damaged — they stay untouched.

## Scope

### Rebuilt (D1, derived from legacy masters — delete + reinsert, trigger-equivalent SQL)

| D1 table | Master | Notes |
|---|---|---|
| `fact_recipe_ingredients` | `recipes.ingredient_mapping` | name via `dim_ingredients` (trigger-equivalent) |
| `fact_audit_headers` | `audits` | store resolution via `dim_store_aliases` |
| `fact_audit_counts` | `audits.counts` JSON | zeros kept (`json_type IN integer/real`) |
| `fact_purchase_orders` | `purchase_orders` | trigger-equivalent columns |
| `fact_purchase_order_lines` | `purchase_orders.lines` | array + regular + custom; unit/total cost preserved |
| `fact_inventory_transactions` | `transactions` | name via `dim_ingredients` |

### Repaired in place (identity fields only)

| D1 table | Master | Preserved |
|---|---|---|
| `dim_ingredients` | `ingredients` | app-maintained cost columns (`cost_per_unit`, `last_purchase_cost`, `last_purchase_date`, `wac_cost_30d`) |

### NOT touched (app-maintained masters, not derived)

- `fact_inventory_balance` (audit-app maintains balances directly)
- all legacy tables
- `suppliers`, `settings`, `dim_stores`, `dim_store_aliases`, `dim_cook_unit_pay`

### Environments

Both **prod** and **dev** D1 (same script, parameterized worker URL).

## Steps

1. **Rebuild** — `scratch/rebuild_d1_facts.py`:
   per env: full delete + reinsert of the 6 derived tables above using the exact
   seed/trigger SQL patterns from `setup_d1_tabular_and_sync.py`;
   identity-field repair of `dim_ingredients` (insert missing, update
   name/unit/type/supplier/flags, delete orphans — costs preserved).
   Post-check: row counts vs master counts (JSON lengths).
2. **Sync** — re-run `sync_d1_to_databricks_tabular.py` (LH = copy of rebuilt D1).
3. **Reconcile** — `scratch/reconcile_lh_d1.py`: for each LH table vs its D1
   source: row count + key aggregates (sum of quantities, per-parent line counts).
   Recipe names may legitimately differ (LH canonicalizes names / attaches
   product_id); LH-only app-authored recipes may legitimately exist — these are
   reported as *explained*, not drift.
4. **Report** — table-by-table PASS/DRIFT; any real drift gets fixed and re-synced.
5. **Cleanup** — delete scratch scripts after success.

## Findings during execution

- Sync dropped one PO line vs D1: zero-quantity **custom** lines were filtered
  by the sync but not by D1 triggers (PO-325 «Все блины неопознанные», 0/0).
  Fixed: sync now keeps custom lines at any quantity (trigger semantics).
- LH orphan found: production rows under «Корн-дог сыр» (pid NULL, 9 rows)
  survived the legacy rename because no D1 parent refreshes that spelling
  anymore. Deleted in LH (LH production now 129 = D1 129).

## Acceptance

- D1: every derived fact table row count == master-derived expectation.
- LH↔D1: counts and quantity aggregates match on every table (or diff is
  explained by canonicalization/LH-only recipes).
- Corn dog spot-check survives: retail = finished good ×1 only; production sets
  intact in both D1 and LH.
