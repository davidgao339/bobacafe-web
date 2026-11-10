# Two-Echelon Inventory Model: WHS produces, Stores trade finished SKUs

Status: **SPEC v2 APPROVED 2026-11-10. Phases 1–5 EXECUTED (see per-phase ledgers
in scratch/). Costing engine live but showing data-gap zeros until PO unit costs
are entered (user confirmed 2026-11-10: PO costs not yet added).**

## Problem

Stores stock and sell **finished products** (mochi, blini, corn dogs). They never
touch flour. WHS consumes **raw materials** via production and ships SKUs.
Today both echelons share one item universe (`dim_ingredients`) with no enforced
layering: SKU rows sit next to flour in the same table, a SKU has two parallel
identities (stock-engine `ingredient_id` ↔ catalog `product_id`), and nothing
stops a store from "holding" or "consuming" a raw material.

## Ground truth (2026-11-09 diagnostics)

- `dim_ingredients`: ~174 items — raw materials + packaging + finished SKUs
  (9 mochi, 9 pancakes, 5 corndogs as product_types), `is_warehouse_only` is
  the only WHS/store hint, and it means *"raw, not store-visible"* — not a class.
- `fact_recipe_ingredients`:
  - `production` recipes: SKU → raw materials (WHS BOM). Correct.
  - `retail` recipes: POS sale → **1.0 × the SKU's own ingredient row** for
    finished goods; raw-material amounts for drinks. Correct *semantics,
    wrong representation* (a SKU depletes itself through a faux-recipe).
  - Dup artifacts: `Моти Рафаэлло` / `Моти Сливочный` retail rows duplicated.
- `fact_inventory_transactions`: `adjustment` (3,342) + `production` (275).
- Stock: `mv_inventory` metric view (measures per Store × Ingredient) →
  `view_current_inventory`. Negative balances exist on some blini SKUs at
  stores (`Блинчики крем-сыр` −19) — symptom of unenforced echelon rules.
- SKUs cost: `dim_product.cost` + `view_product_recipe_cogs` (rolls ingredient
  cost into SKU cost) — WHS-side costing already exists.

## Target model

```
dim_ingredients (physical item universe — stays, gains item_class)
  item_class:
    finished         — WHS produces from raw; transferred to stores in units;
                       1:1 linked to dim_product via product_id
    intermediate     — "middle process item": produced by WHS from raws AND
                       consumed as an ingredient (tapioca: starch → balls →
                       drinks). Cost = rolled BOM (see Costing section)
    whs_only         — purchased raw consumed only by WHS production
    store_only       — store-stocked consumable, never in production BOMs
    dual_use         — store-stocked consumable AND production input
                       (Молоко, Сахар, Сгущенка, Топпинг клубника, ...)

Echelon rules (enforced by views + app, not by convention):
  Store stock/depletion transfers/POs   → finished + store_only + dual_use
  WHS production consumption            → whs_only + dual_use (+ transfers in
                                          of finished/intermediate outputs)
  SKU/intermediate cost                 → rolled-up from BOM (Costing below)
```

The "recipes" stay exactly as they are — they ARE the right depletion
mechanism. What changes is the identity model, not the recipes.

## Phases (each small, each verifiable)

| Phase | Change | Acceptance |
|---|---|---|
| **1. Classify** | Add `item_class` (+ `product_id` link on finished rows). Classification from existing data: `is_warehouse_only=true` → `raw`; product_type in (mochi, pancakes, corndogs) → `finished`; the rest by supplier/usage audit (I propose the list, you approve) | `dim_ingredients` 0 rows without a valid class; every finished row has a dim_product match |
| **2. Enforce by view** | `view_store_stock` (finished + store_consumable), `view_whs_raw_stock` (raw), rebuild `view_current_inventory` semantics on top; inventory value views reflect classes | A store view physically cannot show flour; WHS view shows both echelons |
| **3. Clean recipes + stock anomalies** | Dedupe retail `(key, ingredient_id)` pairs; write-off/adjust-plan for negative store balances (needs your business input: true negative = theft/spoilage between audits?) | 0 duplicate recipe rows; negative balances either resolved or explained |
| **4. App semantics** | Stores app: everything store-facing reads `view_store_stock` classes — order suggestions offer SKUs (finished) and consumables; WHS raw consumption driven by production recipes; nothing user-visible changes for drinks | No store screen lists a raw material; WHS screens list raws |
| **5. Later (optional)** | If two-table friction still bothers you: dim_product becomes the SKU master (ids unify), dim_ingredients keeps raw/consumables only — a mechanical migration after phases 1–4 prove the model | Single identity per SKU |

## What stays untouched (deliberately)

- POS history, D1 blob tables, the existing production/retail recipe mechanics
- `mv_inventory` / audit flow (audit counts still per item id — stores count
  SKUs + their consumables, WHS counts raws + finished)
- The dual-write app pattern until LH-only migration happens

## Decisions (resolved)

1. **Physical model**: ✅ A — one item table + enforced classes/views
   (no stock-machinery rewrite; hard split remains a later option).
2. **Negative balances**: ✅ Deferred — handle after the class model lands.
3. **Classification list**: proposed (`scratch/classification_proposal.md`,
   21 finished / 26 production_input / 95 store_consumable) with four
   exceptions pending user confirmation:
   - `Подложка для корн-дога` → store_consumable (cardboard base, not a SKU)
   - `Тапиока в шариках` (id 66) → intermediate, linked to dim_product 447
   - add `dual_use` class (Молоко, Сахар, Сгущенка, Порошок банан,
     Топпинг клубника, Кокосовая стружка)
   - `Корн-дог Сникерс сладкий` / `Моти клубника` noted as dead/new SKU
     to-fix items

## Costing: multi-level BOM (no double counting)

User case: `Тапиока в шариках` is a WAREHOUSE product (produced from tapioca
starch) that is ALSO an ingredient of drinks — a *middle process item*.
Cost must flow starch → tapioca → drink exactly once per unit sold.

### Rules (the invariants that make double counting impossible)

1. **Cost is a DAG, computed per level:**
   - Level 0 — purchased raws (`whs_only` / `dual_use` inputs): cost =
     PO-based WAC (`view_ingredient_wac_30d`), already exists.
   - Level 1 — finished goods + produced intermediates (tapioca): unit cost =
     BOM explosion of level-0/level-1 costs (`view_product_recipe_cogs`,
     extended with a recursive CTE so an intermediate may consume another
     intermediate).
   - Level 2 — POS items: retail recipe cost = Σ (component unit cost ×
     amount), where each component resolves through its OWN cost level
     (raw → WAC, finished/intermediate → rolled cost).
2. **Production is a conversion, not an expense.** Starch write-off + tapioca
   output are value-neutral: WHS raw value decreases, tapioca value increases
   by the same amount. A `production` transaction never appears in COGS.
3. **Internal transfers are value moves, not expenses.** A store receiving
   tapioca inherits WHS cost; no COGS event on transfer.
4. **Expense is recognized exactly once — at external sale or waste.** Store
   sale of a drink with a tapioca portion ⇒ COGS = the drink's rolled cost,
   which includes tapioca's rolled cost, which includes starch's WAC.
5. **An item's cost comes from exactly one level.** An intermediate's
   `cost_per_unit` in `dim_ingredients` stays NULL (read-only); its cost
   always comes from its own BOM. If we ever buy tapioca balls pre-made, that
   item's source flips to PO-WAC — never both in parallel for the same item.

### The double-count answer explicitly

The double count would only happen if tapioca were expensed **twice**: once
when starch is written off at WHS production, and again when the store
consumes tapioca in a drink. Rule 2 forbids the first leg from ever being an
expense — production is conversion. Raw value is ⚡transformed⚡ into
intermediate value; only the final external event (POS sale / write-off)
books COGS. Each unit of starch enters the DAG exactly once and exits
exactly once as sale/waste.

### Concrete tapioca walk-through (per 100 gr portion, illustrative numbers)

| Event | Value effect |
|---|---|
| Buy 50 kg starch @ WAC 300₽/kg | raws +15,000₽ |
| WHS produces 40 kg balls from 50 kg starch | raws −15,000₽, tapioca +15,000₽ (0.375₽/gr) — **no expense** |
| Transfer 5 kg to store | WHS −1,875₽, store +1,875₽ — **no expense** |
| Store sells drink w/ 100 gr tapioca | COGS = 37.5₽ tapioca component — **counted once** |

Company COGS for the drink = 37.5₽ = the starch that physically became the
portion. Blini/mochi (finished SKUs sold directly) follow the same flow with
one less hop — their retail recipe depletes the SKU at its rolled BOM cost.

### What is broken TODAY that this fixes

- `view_product_recipe_cogs` resolves every retail component through PO-WAC.
  Tapioca balls and other intermediates were never PO'd as balls ⇒ WAC is
  NULL ⇒ **drinks containing tapioca are currently costed as if tapioca were
  free**. The DAG costing fixes this by resolving tapioca through its rolled
  BOM cost instead.
- The naive alternative (count starch write-off as expense AND count tapioca
  consumption at stores) is the actual double count; Rule 2 forbids it.

## Spec v2 (2026-11-10 user specification) — deltas & Databricks adaptations

User issued a formal spec. Ground-truth probes (`scratch/spec_probe.py`,
results in `scratch/spec_probe.json`) verified feasibility:

- **Recursive CTE: SUPPORTED** on our warehouse (trivial `WITH RECURSIVE` test
  returned correctly). Spec's Rule-3 pattern (path-array cycle guard) is
  implementable as written.
- **Labor data already exists**: `dim_cook_unit_pay(product_name, product_id,
  parent_product_id, pay_rate)` — pay_rate = labor cost per produced unit,
  keyed by product_id. Rule 2 gets NO new table; join this into the rollup.
  Data notes: pay_rate 16.0 flat on sampled mochi products; some rows have
  NULL product_id (e.g. `Моти банан-шоколад`) → re-key; tapioca/blini coverage
  TBD.
- **Actual yield IS recorded**: `fact_inventory_transactions` production legs
  exist on both sides — 31 negative (ingredients consumed) and 12 positive
  (outputs produced, e.g. Моти манго +208 шт) — so Rule 1 (absorption by actual
  yield) is computable from real events.

### Adaptation decisions (Databricks reality)

| Spec requirement | Databricks adaptation |
|---|---|
| UNIQUE constraint on finished→product_id | Delta has no enforced UNIQUE; use **NOT NULL + CHECK constraint** (`item_class='finished'` ⇒ `product_id IS NOT NULL`) + sync-time uniqueness assertion + nightly DQ report |
| Triggers for the 1:1 rule | No triggers in Databricks. Enforcement = app write-path validation (`LH_PUSH.recipeReplace`/dim edits refuse finished rows without product_id) + nightly DQ report (same report-and-repair protocol as product-identity plan) |
| `view_whs_raw_stock` incl. finished/intermediate | Rename **`view_whs_stock`** — it holds everything WHS can stock (raws + produced), the "raw" name was wrong |
| Recursive CTE | Implemented as-is (supported); PLUS app-side and sync-side cycle rejection at write time, so bad data never reaches the view |
| Labor in rolled cost | `LEFT JOIN dim_cook_unit_pay pay ON pay.product_id = parent_product_id`; NULL pay_rate ⇒ excluded + reported (no silent zeros) |
| Absorption (Method A) actual yield | **RESOLVED 2026-11-10: pure actual, as spec literally says** (user rejected α). Unit cost(finished/intermediate) = Σ actual consumed material cost across the product's production runs ÷ Σ actual yielded units; falls back to theoretical BOM rollup only when a product has **zero** production events (E.g. brand-new SKU). Documented trade-off: 1–3 runs/product means unit costs are spiky by design; accepted per user. Guard: nightly DQ report prints per-product run count + unit cost trend so fragility stays visible |

### Revised execution phases (spec's 5 phases, our gates)

| Phase | Scope | Verified by |
|---|---|---|
| **1. Classify** | ALTER `dim_ingredients` ADD `item_class STRING` + `product_id INT`; populate from approved mapping (explicit constants; diff list review before `--apply`); CHECK constraint for finished⇒product_id; tapioca → `intermediate` linked to dim_product 447; fold known NULL pay_rate rows of dim_cook_unit_pay by product_id re-key | 0 rows NULL item_class; every finished row has product_id; uniqueness report clean |
| **2. Enforce by view** | `view_store_stock` (finished, intermediate*, store_only, dual_use), `view_whs_stock` (whs_only, dual_use, intermediate, finished); store apps read `view_store_stock` | Store view cannot return flour |
| **3. Clean recipes** | Dedupe retail `(recipe_product_name, ingredient_id)` dups (Моти Рафаэлло / Сливочный) | 0 dup rows |
| **4. App semantics** | Switch store-facing queries to `view_store_stock`, WHS to `view_whs_stock`; cycle rejection in recipe write path | No store screen lists a raw |
| **5. Costing rollout** | Rewrite `view_product_recipe_cogs`: recursive CTE explosion (path-array guard), component cost by own level (raw→WAC, produced→rolled), labor join from dim_cook_unit_pay, α efficiency factor from actual production runs | Tapioca drink COGS > 0 and equals rolled starch→tapioca cost once; mochi/blini COGS = mat + 16₽ labor |

*intermediate appears in BOTH views: tapioca pearls are physically stocked at
stores as a drink component and produced at WHS — it is the live dual-zone
item that motivated the model.

### Phase-1 scope decisions (2026-11-10 user)

- ✅ Exceptions approved as constants: `Подложка для корн-дога` → store_only,
  `Тапиока в шариках` (id 66) → intermediate (+ product_id 447),
  `dual_use` for Молоко / Сахар / Сгущенка / Порошок банан /
  Топпинг клубника / Кокосовая стружка, `Корн-дог Сникерс сладкий` /
  `Моти клубника` flagged dead (listed, not forced into finished).
- ✅ Costing = **pure actual yield** (spec literal), theoretical-BOM fallback
  only for products with zero runs.
- ✅ Labor join = mochi-family pay_rate only for now (NULL rows skipped +
  reported; extend later without blocking).

## Execution results (2026-11-10)

| Phase | Result | Ledger |
|---|---|---|
| 1 Classify | `item_class`+`product_id` live on dim_ingredients: 22 finished (21 linked), 1 intermediate (Тапиока→447), 25 whs_only, 88 store_only, 6 dual_use. CHECK constraint held back pending the dead `Корн-дог Сникерс сладкий` (no dim row) | `two_echelon_phase1_ledger.json` |
| 2 Views | `view_current_inventory` extended (item_class+product_id append), `view_store_stock` + `view_whs_stock` deployed. 0 class leaks, 0 raw-material leaks, tapioca in both views | `two_echelon_phase2_ledger.json` |
| 3 Recipes | **No-op**: 0 duplicate keys exist (prior folds already cleaned them) | `two_echelon_phase3_ledger.json` |
| 4 App | Store-facing filter = class model (legacy `is_warehouse_only` fallback for D1 rows); LH rows carry item_class; production BOM self-reference blocked at write path; vite build ✓ | — |
| 5 Costing | `view_item_unit_cost` (Level 0/1 DAG: pure actual yield + labor, recursive explosion + path-array cycle guard) and `view_product_recipe_cogs` (Level 2) deployed; sync now deploys both SQL files from `scripts/lakehouse_sql/` (single source of truth) | `two_echelon_phase5_ledger.json` |

### Structural fixes along the way

- **`scripts/echelon_semantics.py`** — classification rules live once; nightly
  sync re-derives them at insert time, so `CREATE OR REPLACE TABLE
  dim_ingredients` no longer wipes the model each night (caught pre-emptively).
- Spark SQL adaptations: `array_contains` instead of `<> ALL(...)`,
  `concat(path, ARRAY(x))` instead of `path || x`.

### Known data gaps surfaced by the engine (Working-As-Intended)

1. **PO unit costs: 0.0 on every received line** (user 2026-11-10: not yet
   entered). Until then `view_ingredient_wac_30d` reports most inputs
   `unpriced`; dim `cost_per_unit` fallback applies where populated.
2. **dim_cook_unit_pay gaps**: Моти рафаэлло / сливочный / нутелла /
   `Моти банан-шоколад` (NULL product_id) have no pay_rate → those units cost
   0.0 (no material + no labor). Add pay rows to fix.
3. **Blini flavors mostly `expects_production`** (no production runs recorded)
   — resolve with first runs or a data decision on where blini are made.
4. **Orphan ingredient id 167** (`Ingredient #167`) is a tapioca-run input
   component with no dim row — its cost is silently excluded from the explosion;
   repair the dim row for correct tapioca cost.
5. Engine sanity confirmed: `Тапиока в шариках` = 0.075₽/gr actual; level-2
   rollup keys on `parent_product_id` (variant products group upward) — verify
   per-parent not per-variant when reading the view.
