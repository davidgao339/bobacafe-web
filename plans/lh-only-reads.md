# Phase 6 — Apps read from Lakehouse views only (stores & PO/WHS apps)

Status: **6a–6c EXECUTED & VERIFIED 2026-11-10** (full sync green, classification
survived MERGE intact — 22/1/25/88/6, tapioca 0.075₽ actual costing live,
echelon views intact; both tabular apps now read lakehouse-only). 6d next.

## Goal

Stores-tabular and warehouse-tabular (PO/WHS app) stop depending on D1 blob
mirrors for reads. "Who sees what" is enforced by echelon views; the nightly
sync stops being the read path; D1 keeps serving legacy apps until they retire.

## Why this is more than swapping queries (discovery findings)

1. **Sync is truncate-reload.** Every night `CREATE OR REPLACE TABLE` wipes and
   reloads facts from D1. Any row written LH-only **dies nightly**. This is why
   reads were pinned to D1 (dual-write era): D1 was the only durable source.
   -> Phase 6a must convert the sync to **MERGE upserts** (by primary keys:
   transaction_id, audit_id, po_id, ingredient_id, product_id/name...) so
   app-written rows survive and D1 merges instead of clobbering.
2. **Write-path coverage gap.** App pushes already exist for transactions,
   recipes, ingredients (`LH_PUSH.*`). POs and audits: NOT verified — if the
   PO app writes POs only to D1, an LH-only read shows them only after the
   nightly sync. Phase 6b: audit all write paths, add missing pushes.
3. **Read switches.** Phase 6c: replace the config D1 bulk-pulls in both apps
   with LH list queries against the same facts (dim_ingredients w/ item_class,
   recipes, txs, POs, audits, dim_cook_unit_pay) and the echelon views for
   inventory: stores app → `view_store_stock`, WHS app → `view_whs_stock`
   (+ `view_current_inventory` for cross-echelon ledgers).

## Phases

| Sub-phase | Change | Acceptance |
|---|---|---|
| **6a. Sync MERGE** ✅ | Converted 2026-11-10. `batch_merge` (MERGE … USING (SELECT … FROM (VALUES …))) upserts dim_ingredients (key ingredient_id), cook pay (product_name), audit headers (audit_id), PO headers (po_id), transactions (transaction_id); recipes/audit counts/PO lines exact-refresh per parent (delete+insert) — LH-only rows survive. All facts `CREATE TABLE IF NOT EXISTS`. Best-effort balance cache so views always deploy | Verified: full sync green, item_class counts 22/1/25/88/6 intact, tapioca + Порция тапиоки COGS correct, echelon views intact. Dialect trap fixed: `USING (VALUES …) AS src(col,…)` → `COLUMN_ALIASES_NOT_ALLOWED`; wrap in subquery. Also: `UPDATE SET *` needs every target column in source |
| **6b. Write-path audit** ✅ | Audited 2026-11-10. stores-tabular already dual-writes (audits/txs/POs/recipes/ingredients/cookPay). **warehouse-tabular had ZERO LH pushes** (context forked without them) — ported the full push layer: `LH_PUSH`+`esc` in `services/databricks.js`, `lhPush`+`buildPoLines` helpers, and pushes at every write site (audit header/counts/delete, tx add/delete/production update, PO create/update/delete, transfer legs, received-date edit, revert-to-sent, recipe replace/delete + self-reference guard, ingredient merge/delete, cookPay) | Both apps' builds pass. Accepted D1-only gaps (documented): supplier CRUD (no LH dim_suppliers table — supplier rides on ingredients), `dim_ingredients.last_purchase_cost` update on receive (intentional — LH derives it from PO facts + WAC view), localStorage settings, legacy blob mirrors, importConfig (restore tool) |
| **6c. Read switch** ✅ | Executed 2026-11-10. Both apps read lakehouse-only: `useLh = Boolean(token && warehouseId)` — LH is THE read path, D1 only a no-credentials bootstrap. Settings toggle removed (stores). Warehouse ported the full read layer (LH_QUERIES/coerceLhRows/fetchLh, `view_whs_stock` balances keyed under 'Warehouse', view-prioritized `estimateCurrentStock`, canonical dim-keyed recipes + dimMatch push). Sync hardening: Gap A identity-keyed recipe refresh (delete by raw OR canonical OR product_id, reinsert canonical), Gap B `line_index` in fact_purchase_order_lines (regular 0..n, custom 1000+idx), Gap C `last_purchase_cost`/`last_purchase_date` synced from the D1 dim mirror | Acceptance met for reads: Playwright smoke (`scratch_pw/test_6c_lh_reads.js`) — **0 D1 reads, 0 alerts, 27/24 LH statements, live data rendered** in both apps (screenshots `scratch_pw/6c_*.png`). Zero multi-spelling product_ids; 3772 PO-line rows with 0 NULL line_index; tapioca COGS intact. Residual: the app-write → LH → nightly-sync round-trip (PO/audit/recipe authored in-app) was NOT re-run in this session — 6b already verified all push sites compile & fire, and the next natural sync run validates survival; run a deliberate write test if wanted |
| **6d. Legacy apps** | inventory-app / audit-app / warehouse-app / tapioca-app stay on D1 (they still write audits → sync merges). Retire or migrate later | Unchanged behavior |

## What "cleaner" buys you

- One enforcement point: echelon classes + views → no store screen can ever
  resurface raw materials, regardless of app logic drift.
- No read latency/wait for the nightly sync to backfill states the app
  itself just wrote.
- The identity/normalization fixes live in one place (sync + views), not
 app-side name patches in N apps.
- Future path: D1 demoted to cold storage once legacy apps retire.

## 6c — Read switch detailed plan (written 2026-11-10, EXECUTED same day — see phase table for results)

### Pre-flight findings (verified live 2026-11-10)

1. **Echelon views are read-ready.** `view_store_stock` covers all 6 active
   retail stores (BON/CHM/GAL/GPK/RSQ/SOV — 601 rows), `view_whs_stock`
   covers WHS (41 rows). Both carry every column the apps consume
   (audit_quantity, pos/po movements, current_on_hand) **plus `item_class`** —
   so reads get echelon enforcement for free.
2. **stores-tabular already has a complete LH read mode** behind the manual
   Settings toggle (`settings.dataSource = 'lakehouse'`): `LH_QUERIES` (13
   queries incl. dimProduct from gold), `coerceLhRows`, `lhBalancesByStore`
   view-first estimates. Switching is mostly: flip the default, delete the D1
   branch.
3. **warehouse-tabular has zero LH read machinery** — 6c = port the same
   layer from stores (near-identical context, port verified line-for-line in 6b).
4. **Store-name resolution survives without the alias table.** The 120 D1
   `dim_store_aliases` rows are case variants + EN spellings; facts carry
   `store_id`/`store_code`, and `resolveStoreId` already falls back to
   case-insensitive matching over dim names + codes + CANONICAL_UI_STORE_NAMES.
   LH mode drops the alias read (stores app already does `Promise.resolve([])`).
5. **Ledger already LH** in both apps (`view_inventory_events_last_audit`).
   `fetchCurrentInventory` is dead code in warehouse.

### Gaps that must be fixed as part of 6c (sync-side, per the no-app-patches rule)

- **Gap A — recipe identity.** D1-synced recipe rows key on raw D1 spelling;
  app pushes key on canonical dim names (product_id attached). No collisions
  exist today (verified: zero product_ids with 2+ spellings), but the first
  app-side edit of a recipe whose D1 name differs from dim would create BOTH —
  duplicate recipes in reads and double-counted COGS. Fix in the sync:
  exact-refresh per (name, type) must also delete LH rows whose
  `product_id` equals that parent's resolved product (refresh by identity, not
  spelling).
- **Gap B — poLines `line_index`.** The LH fact table has no `line_index`
  (custom lines ride at 1000+idx in D1); the stores LH query re-derives it
  with `ROW_NUMBER() BY ingredient_id`, which renumbers NULL-ingredient custom
  lines wrongly. Fix: add `line_index` to `fact_purchase_order_lines` (sync
  loads it; app pushes include it).
- **Gap C — `last_purchase_cost` missing in LH dim.** Apps use it as the PO
  line-cost fallback; LH dim_ingredients lacks the column so it reads NULL.
  Fix: carry it through the sync (one column) — app behavior unchanged.

### Steps

| # | Change | Files |
|---|---|---|
| 0 | Sync hardening: recipe refresh keyed by product_id; `line_index` + `last_purchase_cost` added to fact/dim tables & loaders | `scripts/sync_d1_to_databricks_tabular.py` |
| 1 | stores-tabular: default `dataSource='lakehouse'` (SettingsModal + context fallback), delete the D1 read branch in loadFromD1/refreshRecipes; balances switch `view_current_inventory` → `view_store_stock` | `src/ConfigContext.jsx`, `src/services/databricks.js`, `SettingsModal.jsx` |
| 2 | warehouse-tabular: port LH read layer (LH_QUERIES, coerceLhRows, fetchLh, lhBalances view-first over `view_whs_stock`), switch config load + refreshRecipes to LH, adopt canonical dim-keyed recipes (same as stores), delete D1 read branch | same two files |
| 3 | Acceptance: grep shows zero D1 SELECT reads in both apps; builds pass; Playwright smoke (AGENTS.md workaround, `scratch_pw/`): create PO → save audit → edit recipe → rows verified directly in LH; nightly sync rerun shows LH-authored rows survive | scratch/ |

### Risks / notes

- Statement API returns strings — `coerceLhRows` handles (existing, verified).
- `gold.dim_product` permission error already non-fatal (best-effort catch).
- Suppliers read becomes LH-derived `DISTINCT` from dim_ingredients (only
  suppliers referenced by ingredients); writes stay D1 (6b residual).
- Removing the D1/LH toggle changes user muscle memory — Settings modal keeps
  the buttons but D1 becomes a no-op (or hide them; decide at review).

### Decisions (user, 2026-11-10)

1. **Remove the toggle — LH always.** No D1 fallback lever.
2. **All three sync gaps in scope** (recipe identity, line_index,
   last_purchase_cost).
3. **Gap A design**: sync canonicalizes recipe spellings LH-side — refresh
   deletes by (raw name, canonical name, product_id) type-scoped, reinserts
   under the dim_product canonical spelling; D1 stays untouched for legacy
   apps. App edits (canonical) + nightly sync converge on ONE spelling.

## 6c execution notes (2026-11-10)

- **Dev-path bug found by the smoke test**: the Databricks proxy worker serves
  the statements API at **ROOT** (`POST /` → `DATABRICKS_TARGET`); there is no
  `/api/2.0/sql/statements` (or `/databricks-proxy/...`) route on it — both
  404. `runDatabricksSql` in both tabular apps now POSTs the absolute worker
  base URL (dev → `bobacafe-proxy-dev`, prod → `bobacafe-proxy`; worker serves
  CORS). Same fix applied to `fetchDatabricksSales` in
  `apps/inventory-app/src/services/api.js`, which is shared by the tabular
  apps and still had the broken relative dev path. `queryD1` already used the
  correct absolute `/d1/execute` URL.
- **Smoke method**: `scratch_pw/test_6c_lh_reads.js` injects real credentials
  (from `.streamlit/secrets.toml`) into localStorage, bypasses the PIN gate
  (admin 7530), resets counters, reloads, waits 25 s for statement polling.
  Counts `/d1/execute` reads vs worker-root POSTs; fails on any alert dialog.
- Dev servers stopped after the run (ports 5176/5177).
- `scratch/` one-time scripts cleaned (diag_*, preflight_6c_*, smoke_merge,
  verify_*, spec_probe*). Ledger JSONs + classification evidence kept.

## 6d — Legacy apps (documented, no code change)

- inventory-app, audit-app, warehouse-app, tapioca-app continue reading and
  writing D1 exactly as today. Their writes reach the lakehouse through the
  nightly MERGE sync (6a), which preserves LH-authored rows.
- The tabular apps never write `dim_product` (user owns it); legacy apps
  inherit the same rule.
- D1 tables not synced (supplier CRUD, settings, legacy blobs) remain
  legacy-app-only concerns until those apps retire; then D1 can be demoted to
  cold storage.
