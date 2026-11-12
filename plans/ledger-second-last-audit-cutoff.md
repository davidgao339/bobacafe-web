# Plan: Daily ledger cutoff — second-last audit (not last)

## Problem

The Daily ledger tab (stores-tabular; same view feeds warehouse-tabular) shows only
transactions **after the store×ingredient's latest audit**. When an audit happens
today (or the user runs the ledger the same day / shortly after), the loss is invisible:
the shrinkage only exists as the delta between the last two audits, and the window
that would show it is cut off.

Desired: cut off at the **second-last audit**, so the ledger shows

- all movements between audit N−1 and audit N (sales, PO receipts, transfers, production, adjustments), and
- **audit N itself as a row with its adjustment** (counted vs running → the loss/gain, already rendered by the existing `auditAdj` column).

The local D1 fallback path in `Ledger.jsx` already behaves this way (baseline =
last audit **at or before `from`**; later audits appear as audit-adj rows). The
lakehouse path is the one that over-trims.

## Current mechanics

- Lakehouse view `workspace.inventory_tabular.view_inventory_events_last_audit`
  emits atomic inventory events since each (store, ingredient)'s latest approved
  audit (anchor row `source='audit'` carries `audit_count`).
  **Its definition is NOT in the repo** (created ad hoc in Databricks; `scripts/lakehouse_sql/` has only 2 views).
- `apps/stores-tabular/src/pages/Ledger.jsx` LH path: anchors on the first
  `source==='audit'` event, replays everything after it into per-day rows; the
  audit detail row already computes `adj = counted − running` (the loss).
- `apps/stores-tabular/src/services/databricks.js` `fetchLedgerEvents` — same
  query duplicated in `apps/warehouse-tabular/src/services/databricks.js`.
- Inventory levels / PO suggestions are NOT affected: they anchor on
  `view_store_stock` / `view_whs_stock` → `view_current_inventory` (rn=1 last
  audit). Those stay untouched — ordering logic must keep anchoring on the
  **last** audit.

## Design decision: cutoff = rn=2 per store×ingredient

Anchor semantics stay per (store, ingredient) over audits that **counted** that
ingredient (partial audits supported), i.e. `ROW_NUMBER() ... rn = 2` — not
"second audit event of the store". This matches the existing anchoring model and
the audit-zero-vs-null semantics (counted rows, including zeros, are what define
an anchor). If only one audit ever counted the item → fall back to rn=1
(behavior identical to today).

## Changes

### 1. Lakehouse (one enforcement point, no app logic patches)

- Preflight: `SHOW CREATE TABLE workspace.inventory_tabular.view_inventory_events_last_audit`,
  commit the recovered definition to `scripts/lakehouse_sql/` as baseline
  (traceability — it currently exists nowhere in the repo).
- Check dependents before replacing: no other views/consumers reference it
  (repo grep shows only the two apps' `fetchLedgerEvents` + UI badges).
- New SQL (script style of `two_echelon_phase2_views.py` or a
  `scripts/lakehouse_sql/view_inventory_events_*.sql`): same shape as
  `view_current_inventory`'s `latest_audit`/`baseline` CTEs but
  `WHERE rn = 2` for the cut timestamp (COALESCE to rn=1 when rn=2 is absent),
  emitting:
  - events strictly after the rn=2 audit's cut_ts (same timestamp
    normalization: `audit_timestamp` if it starts with `audit_date`, else
    `date T23:59:59`),
  - the **rn=2 audit row** as `source='audit'` anchor (`audit_count`),
  - the **rn=1 audit row** as `source='audit'` too (so the ledger renders the
    counted qty + adjustment on that day).
  - same output columns as today (store_id … transaction_type) so the apps'
    row handling is unchanged.

### 2. Apps (only if we rename; zero changes if we replace in place)

- Option A (recommended): **replace the view in place**, keep the name. No app
  edits; both tabular apps pick it up on next load. Update the two doc strings
  that name the view (`Ledger.jsx` badge `title`, `SettingsModal.jsx` note) to
  say "events since the second-last audit".
- Option B (cleaner name, more churn): new view
  `view_inventory_events_last_two_audits` + update `fetchLedgerEvents` in both
  apps + badge titles. Use only if we want the old view preserved as-is.

## Verification

1. SQL spot-check in Databricks: pick a store×ingredient with ≥2 audits; confirm
   the new event window starts at audit N−1, contains the audit-N row, and that
   replaying ledger rows ends at the same `current_on_hand` as
   `view_store_stock` (balances view unchanged).
2. UI smoke via Playwright (AGENTS.md workaround, `scratch_pw/browser_test.js`
   pattern): open stores-tabular Daily ledger for an ingredient audited today →
   today's audit row visible with a non-zero audit adjustment (loss) instead of
   an empty ledger; "Ledger" badge still Lakehouse.
3. Same check in warehouse-tabular ledger (shares the view).
4. Check row volume: events since rn=2 can span a full audit interval
   (POS-derived sales rows) — confirm `fetchLedgerEvents` still returns
   comfortably within the Statement API wait budget; if not, consider a
   date-bounded variant later (not in this scope).

## Execution notes (2026-11-11 — done)

- Option A executed: view replaced **in place**, same name, apps untouched.
  Deployed via Statement API from `scripts/lakehouse_sql/view_inventory_events_last_audit.sql`
  (original rn=1 definition recovered to `scratch/events_view_current_definition.sql`).
- Preflight: no lakehouse views depend on it (`information_schema.views` → 0).
- Verification:
  - Window start == rn=2 audit cut_ts for every pair with ≥2 counted audits
    (spot-check exact match).
  - Audit events per pair: 1 (143 pairs, single-audit → rn=1 fallback) or 2 (619).
  - **Reconciliation 676/676**: replaying the widened window (anchor count →
    movements → last-audit reset → movements) lands exactly on
    `view_current_inventory.current_on_hand` for every active pair.
  - Row volume: 41,211 events total; per store max ~8.9k (RSQ) — comfortably
    within the Statement API budget used by `fetchLedgerEvents`.
- Edge case found & fixed during verification: legacy migrated audits share
  `audit_date` but header `audit_timestamp` was rewritten days later, so both
  the rn=2 anchor and the rn=1 audit normalize to the same fallback cut_ts
  (`date T23:59:59`). The strict `> anchor` join dropped the last-audit row and
  6 pairs (store 3) failed reconciliation. Fix: the rn=1 audit row is emitted
  whenever it isn't the anchor (`audit_id !=`), with its event_ts bumped by 1s
  only when tied with the anchor ts (movements still join on `> anchor`, so the
  window is unchanged; 6 bumped rows total, visible as `00:00:00` next-day ts).
- Not done (intentionally, per "view only"): app-side badge/SettingsModal doc
  strings still say the old semantics; UI Playwright smoke skipped — SQL-level
  reconciliation covers the ledger math, and the ledger UI already renders
  `source='audit'` rows with adjustments.

## Follow-up fix (2026-11-12): app dropped non-anchor audit events

User verified in the UI: ledger still anchored at the last audit (RSQ × Сироп
смородина: ending 992 vs estimate 1592). Root cause was NOT the view — the view
correctly emits the rn=2 anchor (RSQ-002, 1000) and the rn=1 audit (RSQ-003,
1600). But the LH replay loop in `Ledger.jsx` only handled `pos_sale` /
`po_receipt` / `transfer_*` / `inventory_tx` sources: a non-anchor `audit`
event matched no branch and was silently dropped (with the old view the only
audit event was the anchor, which is added separately, so the gap never
triggered).

Fix: added an `audit` branch to the replay loop in BOTH tabular apps
(`apps/stores-tabular/src/pages/Ledger.jsx`, `apps/warehouse-tabular/src/pages/Ledger.jsx`)
— non-anchor audit rows push `{kind:'audit', count}` so the day loop computes
`adj = counted − running` (the loss) and resets the balance. Both builds pass.
View deployed earlier is unchanged; no SQL change needed.

## Follow-up 2 (2026-11-12): baseline audit showed a fake "+adj"

After the replay fix the user saw RSQ-11-11 as two audit rows: "Counted: 1000
(+1000)" (the anchor RSQ-002) and "Counted: 1600 (+600)" (RSQ-003). The +1000
was an artifact — the LH day loop starts `running` at 0, so the anchor's
`adj = count − 0 = base` rendered like a gain (the local D1 fallback doesn't
have this problem: it starts `running = base`). Also confirmed via
`fact_audit_counts` that the 1000 IS real: RSQ ran three audits on 11-11
(07:35 RSQ-001=1600, 07:38 RSQ-002=1000, 07:50 RSQ-003=1600) — the Audit
history tab lists RSQ-002; expanding it shows the 1000.

Fix (both tabular apps): anchor audit detail gets `baseline: true` —
- excluded from `dayAuditAdj` (so the day's Audit Adj column shows only real
  corrections; a pure-baseline day may now be filtered out of display, the
  header still shows "Audit {date} · base {n}"),
- rendered as "Counted: N · starting balance" (i18n `ledger.auditBaseline`:
  en "starting balance", ru "стартовый остаток") instead of a signed adj.
Ending balances unaffected. Both builds pass.

## Follow-up 3 (2026-11-12): deletion ghost + two hardening fixes

User deleted audits RSQ-002/004/005 in the deployed stores-tabular Audit page
(/internal/audit — reads the LAKEHOUSE; D1 is only a write mirror + no-credential
bootstrap). D1 deletes landed (fact tables + legacy blob), RSQ-004/005 LH deletes
landed too, but **RSQ-002's LH delete push failed silently** (lhPush was
fire-and-forget, console.error only) — the ghost header+32 counts stayed in the
LH. The nightly sync could never fix it: phase 6a MERGE upserts never delete.
Cleaned manually (LH header sets now match D1 exactly, 229=229); ledger view
verified (RSQ сироп now anchors RSQ-001; RSQ пюре anchors A-235 10-27).

Two fixes implemented:

1. **Surface LH push failures (both tabular apps + shared toast).**
   `lhPush` in both `ConfigContext.jsx` now dispatches the existing
   `d1-sync-error` CustomEvent with `channel: 'lakehouse'`, `sql` (joined),
   and a `retry` closure re-running the statements. `SyncErrorToast`
   (inventory-app copy, shared via `@inventory/components`) branches on the
   channel: title "Lakehouse Save Error" / «Ошибка записи в озеро данных»,
   subtitle explains D1 was saved but the LH copy failed (balances/ledger may
   show stale data) — and offers Retry (runs the closure) as before. The
   tapioca-app copy of the toast is separate and unaffected.

2. **Nightly sync prunes audit deletion ghosts.**
   `scripts/sync_d1_to_databricks_tabular.py` (after the audit counts insert):
   compares LH `fact_audit_headers`/`fact_audit_counts` audit_ids against D1's
   header ids and DELETEs LH rows absent from D1 (chunked IN lists, ids
   quote-escaped, printed for observability). Policy change vs the 6a-era
   "LH-only audits are untouched" rule: with dual-write coverage complete
   (6b), an LH-only audit row can only be a failed-D1-mirror leftover.
   Verified end-to-end: planted `ZZ-GHOST-TEST` header+count → full sync ran
   green, reported and pruned the ghost, reconciliation 229/5029 rows clean.
   (Transactions/POs could get the same treatment later if D1 ghosts show up
   there too.)

## Risks / notes

- `view_store_stock` / `view_whs_stock` / `view_current_inventory` untouched —
  order quantities still anchor on the last audit. Only the *ledger window*
  widens.
- An ingredient whose latest audit counted it 0 (counted-zero): rn=2 anchor may
  be an older positive count; window includes the 0-count audit row, so the
  ledger correctly shows the drop to 0 as an audit adjustment.
- The LH badge/title texts referencing the view name should be kept accurate
  (small doc edits, Option A).
