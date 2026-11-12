# Plan: Audit fool-proofing + real-time lakehouse counts

## Status: implemented 2026-11-12 (commits on main)

### Done earlier
- audit-app: NO default store (was auto-RSQ), store gate blocks counting until
  chosen, store switch clears counts / cancels edit, mandatory confirm modal
  before submit.
- stores-tabular + warehouse-tabular Count tabs: session-local store choice,
  big store buttons, confirm modal (warehouse preselects its single location).

### This round (user-approved scope: Tier 1.1 + CSV move + real-time LH)
1. **Date guardrails** (both audit-app and stores-tabular CountTab):
   - Future-dated audit → blocked for everyone (device-clock mistake).
   - Backdated audit (older than the store's latest approved audit date) →
     barista HARD BLOCK, manager override allowed with amber warning.
   - Blind-count safe: only the audit DATE is fetched for baristas
     (`fetchLatestStoreAuditDate` / `fetchLatestAuditDates` in audit-app's
     services/d1.js; stores-tabular derives it from already-loaded audits).
2. **CSV import moved into audit-app (manager-only "Импорт CSV" tab)**:
   - Same CSV format as the old stores-tabular ImportTab (store, date, time,
     ingredient, unit, supplier, qty), delimiter autodetect, DD.MM.YYYY dates,
     Russian label-row skip — ported to apps/audit-app/src/utils/auditCsv.js.
   - Stores matched by RU name, EN name, or code against ACTIVE dim_stores.
   - Preview grouped by store+date with item counts; row errors and unknown
     ingredients reported; future-dated groups BLOCK the import; backdated
     groups flagged. Explicit confirm button writes via the same saveAudit()
     as manual counts. Template download included.
   - **Import tab removed from stores-tabular** (single write path).
3. **Real-time lakehouse push (orders are placed the same day after an audit):**
   - Worker endpoint `POST /lh/audit` (apps/databricks-proxy/worker.js):
     fixed-shape payload `{audits: [...], deletes: [...]}` — no SQL from
     clients. Builds the same idempotent statements stores-tabular's LH_PUSH
     uses (header MERGE + counts DELETE+INSERT into
     workspace.inventory_tabular.fact_audit_*). Runs each statement via the
     Statement Execution API (submit + poll) with the server-side token.
   - Credentials: worker secret `DATABRICKS_TOKEN`. Initial manual attempts
     failed (PowerShell swallowed `--env=""`), so the deploy workflow now sets
     it from the existing GitHub secret `DATABRICKS_TOKEN` on every prod deploy
     (deploy-proxy.yml "Ensure DATABRICKS_TOKEN secret" step, non-interactive,
     idempotent).
   - VERIFIED LIVE 2026-11-12: empty probe returns `{"ok":true,"executed":0}`;
     smoke test (TEST-LH-SMOKE → header MERGE + count insert → rows visible in
     fact_audit_headers/count within seconds → delete → 0 leftover rows) passed.
   - audit-app calls it fire-and-forget after every saveAudit (manual + each
     CSV-imported group, batched in one request) and deleteAudit. Failure →
     warning toast; nightly sync remains the backstop (and ghost-pruner).

### Remaining fool-proofing tiers (not yet built)
- Tier 1 leftovers: deletion safeguards (type-to-confirm, block deleting the
  ledger anchor audit), auditor attribution (who counted).
- Tier 2: delta preview in confirm modal, blank-vs-zero nudge, duplicate-audit
  merge choice.
- Tier 3: no-default store for POs/transactions in stores-tabular, LH ghost
  prune extension to transactions/POs.
