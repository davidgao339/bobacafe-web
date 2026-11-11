# Plan: Audit counts — 0 vs NULL (counted-zero vs not-counted)

## Problem

A store that counts an item as **0** (sold out) is indistinguishable from an item that
**wasn't counted** — explicit zeros are silently dropped at every layer, so the inventory
engine keeps anchoring on an *older positive count* and overstates stock.

Evidence:

| Layer | Location | Bug |
|---|---|---|
| D1 triggers | `scripts/setup_d1_tabular_and_sync.py:464,493` | `WHERE CAST(j.value AS REAL) > 0` — zeros never reach `fact_audit_counts` |
| Migration seed | same file `:294` | "Seed fact_audit_counts (filtering out 0 counts)" |
| Nightly sync | `scripts/sync_d1_to_databricks_tabular.py:650` | `if qty_val > 0` — "Filter zero counts strictly" — even app-pushed zeros die in LH overnight |
| stores-tabular write | `src/context/ConfigContext.jsx:637,688` | `if (Number(qty) > 0)` before INSERT into D1 fact_audit_counts (warehouse-tabular has the same filters) |
| App read | `ConfigContext.jsx:477` (both tabular apps) | `Number(c.count_quantity) \|\| 0` — collapses NULL→0 on read |
| LH data today | D1 `fact_audit_counts`: 4,545 rows, **0 zeros** | zeros absent everywhere |

Current behavior consequence: `view_current_inventory` / `view_inventory_events_last_audit`
anchor per store×item on the **latest audit row that exists** (rn=1). If the newest audit
counted the item 0, the row doesn't exist → the anchor falls back to an older positive
count → `audit_quantity` and `current_on_hand` are overstated.

Recoverable data: legacy D1 `audits` JSON **still holds the original zeros** (129 of 224
audits contain explicit `0` entries) — apps always wrote zeros into the legacy JSON, only
the fact-table/derivation layers filtered them.

## Semantics (decision)

- **Counted** = a row exists in `fact_audit_counts` for (audit, ingredient).
  - `count_quantity = 0.0` → *nothing left* — treat as a hard zero anchor.
- **Not counted** = **no row** → "ignore": keep the previous anchor (per-item fallback to
  the most recent audit that counted that item). Partial audits stay supported.
- We never write NULL `count_quantity` rows — absence *is* NULL. No schema change, no
  `is_counted` flag (a second source of truth invites drift).
- The LH views need **no SQL change**: once zeros exist as rows, `rn = 1` picks the newest
  audit's 0 and the fallback-to-older-audit only happens for genuinely uncounted items.
- Rejected audits already excluded (`WHERE h.status != 'rejected'`) — unchanged.

## Changes

### A. Pipeline scripts (fix the filters)
1. `scripts/sync_d1_to_databricks_tabular.py` — drop `if qty_val > 0`; keep skipping
   non-numeric/null entries only.
2. `scripts/setup_d1_tabular_and_sync.py` — triggers & seed: `> 0` →
   `json_type(j.value) IN ('integer','real')` (keeps 0, excludes null/garbage).

### B. D1 backfill (one-off, zero-gap fill — not a rebuild)
Legacy `audits` JSON is authoritative (apps update it on every add/edit with zeros
preserved), so fill **only the missing zero rows**:
- For each legacy audit, for each JSON entry with value `0`, if
  `fact_audit_counts` has no (audit_id, ingredient_id) row → INSERT with `count_quantity = 0`.
- Report (don't touch) any value mismatches between JSON and fact rows.
- Verify: D1 `SUM(count_quantity = 0)` > 0.

### C. LH backfill
- Run the **fixed nightly sync** (`sync_d1_to_databricks_tabular.py`) — it already deletes
  and re-derives children for every D1-parent audit, so zeros flow to LH and LH-only
  (app-authored) audits stay untouched.
- Verify: LH `fact_audit_counts` zero count matches D1.

### D. App fixes (both tabular apps; audit-app is already correct — it writes explicit zeros)
1. **Write** `ConfigContext.jsx` `addAudit`/`updateAudit` (stores-tabular + warehouse-tabular):
   `if (Number(qty) > 0)` → write when the value is a finite number, including 0
   (`Number.isFinite(Number(qty))`). Blank values are already absent from `counts` — that's
   the NULL path and stays untouched.
2. **Read** `ConfigContext.jsx:477` (both apps): `Number(c.count_quantity) || 0` →
   `c.count_quantity == null ? null : Number(c.count_quantity)` — zeros stay 0, a stray
   NULL row can no longer masquerade as "counted zero".

### E. UI clarity (stores-tabular Count tab)
- The count input placeholder is `"0"` — it makes "empty" look like "zero". Change to
  `"—"` (not counted) so the visual language matches the data semantics. History tab and
  the "N / total counted" chips already count zero-rows as counted once zeros exist.

## Verification

1. SQL: D1 + LH zero counts; spot-check one backfilled audit's rows.
2. LH views: for a store×item whose newest count is 0 — `view_current_inventory` must show
   `audit_quantity = 0` (no fallback to the older positive count) and
   `current_on_hand = 0 + movements since audit`.
3. Playwright (stores-tabular): count an item as 0 → History shows it as counted;
   Inventory levels reflect the zero anchor; PO suggestions respond accordingly.

## Risks / expectations

- Inventory levels for zero-counted items will **drop** (correctly) → PO suggestions may
  increase. That's the point of the fix.
- The backfill only adds rows; no existing row is modified or deleted.
- `warehouse-tabular` Ledger's `Number(anchor.audit_count) || 0` is safe (0→0; anchor rows
  only exist for counted items).

## Execution order

1. A (scripts) → 2. B (D1 backfill) → 3. C (sync → LH) → 4. D+E (apps, build, commit, push) → 5. Verify.
