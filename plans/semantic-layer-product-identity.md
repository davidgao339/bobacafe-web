# Semantic Layer: Canonical Product Identity (product_id-matched)

Status: **PLAN v2 — nothing executed.** Approach A (ETL/semantic layer owns
resolution), **without** an alias table — historical drift fixed at bronze
(append-only confirmed), future drift handled by report + explicit repair.

## Problem statement

Product identity derives from free-text names at every layer: POS spellings
persist in bronze (`workspace.default.transactions`), dup rows ingest into
`gold.dim_product` (5 confirmed groups), `fact_recipe_ingredients` keys on raw
names, and app/sync/scripts each patch the mismatch independently. Root cause:
**product_id is not enforced before the app layer.**

## End state

```
POS (bronze — rewritten ONCE to canonical spellings; incremental afterwards)
  → silver facts (workspace.inventory_tabular) keyed by product_id
      name columns are display-only
  → gold semantic views (id → canonical spelling)
  → apps read ids; future drift stops consumption loud (report), not silent
```

No alias table. No managed mapping surface. Repair path per future incident:
fix POS menu → run the normalize script (bronze + facts + dim) → done.

---

## Phase 0 — One-time silver fix (existing script, dry-run validated)

**Executes:** `clean_dim_product_dups.py --apply`
**Preconditions (user):** POS menu renamed to canonical Title Case;
`Тапиока в шариках` added to dim_product in menu-manager.

**Does:** folds 5 dim dup rows (retire as `is_active = false`), repoints
children + `dim_cook_unit_pay`, rekeys `fact_recipe_ingredients` onto canonical
spellings with clash dedup, backfills `product_id`/`parent_product_id` via
MERGE against active dim rows.

**Acceptance:** 446 → 441 products; 0 active same-norm dup groups; 13/13
production recipe keys resolve to active dim rows.

## Phase 1 — One-time bronze rewrite (replaces the alias table)

**Executes:** new script `scripts/normalize_bronze_product_names.py`.

**Does:** `UPDATE workspace.default.transactions SET product = canonical WHERE
product IN (old_spelling, …)` — covers:
- the 5 folded dup spellings (`Моти Сливочный` 217→…, `Бабл-ти  Лаймовый (чай)`
  double-space, etc.)
- rename sources still present in POS history (`Корн-дог сыр`,
  `Блинчики нутелла (2шт)`, `Моти банан-шоколад`, lowercase mochi variants)

**Ledger:** every rename written to `scratch/bronze_rename_log.json` (provenance
kept in-repo, not as a lakehouse table).
**Safety:** exact-spelling WHERE clauses only; re-runnable (converges to 0
updates); no date/row ambiguity.

**Acceptance:** zero transactions whose spelling fails exact match against an
active dim row (excluding `Списание - …` pseudo-products).

## Phase 2 — Ingest guard, shrunk (no alias dict, no alias table)

**In:** `sync_d1_to_databricks_tabular.py` — after bronze is canonical, the
lookup needs only norm-case/whitespace tolerance as a safety net (not aliases):
- stamp `product_id`/`parent_product_id` on all product-keyed fact loads
- unresolved names → printed sync report (drift becomes visible the morning
  after a POS typo, not months later)
- **deletes** the hardcoded `prod_aliases` dict and exact-lowercase lookup

**Acceptance:** post-sync, production fact rows are 100% `product_id`-resolved;
Report lists only write-in pseudo-products.

## Phase 3 — Recurrence protocol (the accepted "it will happen again")

When a future POS spelling drifts:
1. Weekly/manual report: transaction spellings with no active-dim and no
   alias-free exact match (one script, no table).
2. Fix POS menu to canonical spelling.
3. Re-run `normalize_bronze_product_names.py` with the new mapping appended
   (ledger documents it) → re-run phase <= sync reconciliation.

Repair cost per incident ≈ one script run. Nothing silently degrades.

## Phase 4 — Deprecation of app-layer patches

After Phase 2 runs clean for a few nights:
- delete `normProductKey`/`salesRecipeFor` normalized fallback and resolver
  name-fallback branches (`ConfigContext`, `useInventoryCalcs`)
- cleanup script's CANON/REKEY constants retire; script shrinks to a runner
  or is archived (phase 0 is history)

---

## What NOT to do

- No alias table / no managed mapping surface (rejected: maintenance surface).
- No FK enforcement in Delta (doesn't exist; validation queries instead).
- No app-layer spelling patches as permanent infrastructure.
- Bronze only ever rewritten by the explicit ledger script — never ad-hoc.

## Execution order

| Phase | Owner | Blocks |
|---|---|---|
| 0 preconditions | User (POS fix, dim add) | 0 apply, 1 |
| 1 bronze rewrite | Assistant (after 0) | 3 |
| 2 ingest guard | Assistant (after 1) | 4 |
| 3 recurrence protocol | Assistant scripts, user actions | — |
| 4 dep cleanup | Assistant (after 2 stable) | — |
