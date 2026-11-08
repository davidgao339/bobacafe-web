// Databricks SQL access for warehouse-tabular (lakehouse = single source of truth).
// Statement Execution API through the Cloudflare proxy — same channel as the inventory app's api.js.
const isDevDeploy = window.location.hostname.startsWith('dev.') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BACKUP_BASE = isDevDeploy
  ? 'https://bobacafe-proxy-dev.davidgao734.workers.dev'
  : 'https://bobacafe-proxy.davidgao734.workers.dev'

export async function runDatabricksSql(token, warehouseId, statement, retries = 4) {
  const apiPath = import.meta.env.DEV
    ? '/databricks-proxy/api/2.0/sql/statements'
    : BACKUP_BASE

  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ statement, warehouse_id: warehouseId, wait_timeout: '50s' }),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        let parsedMsg = text
        try {
          const parsed = JSON.parse(text)
          parsedMsg = parsed.message || parsed.error || text
        } catch {}
        throw new Error(`Databricks Error (${resp.status}): ${parsedMsg || 'Empty response'}`)
      }

      const result = await resp.json()
      if (result.status?.state !== 'SUCCEEDED') {
        throw new Error(result.status?.error?.message ?? `Query ended: ${result.status?.state}`)
      }

      const cols = result.manifest.schema.columns.map(c => c.name)
      return (result.result?.data_array ?? []).map(row =>
        Object.fromEntries(cols.map((c, idx) => [c, row[idx]]))
      )
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, 5000))
    }
  }
  throw lastErr
}

// Atomic inventory events since each store × ingredient's latest approved audit.
// Source of truth for the ledger screen — replaces the local usage derivation.
export function fetchLedgerEvents(token, warehouseId, storeCode) {
  const statement = `
    SELECT store_id, store_code, store_name, is_active,
           ingredient_id, ingredient_name, unit, source,
           CAST(event_ts AS STRING) AS event_ts,
           CAST(date AS STRING) AS date,
           qty_change, audit_count, audit_id,
           po_id, product, qty_units, order_number, transaction_type
    FROM workspace.inventory_tabular.view_inventory_events_last_audit
    WHERE store_code = '${storeCode}'
    ORDER BY event_ts ASC
  `
  return runDatabricksSql(token, warehouseId, statement.replace(/\s+/g, ' ').trim())
}

// Audit-anchored current balances for one store (active stores only).
export function fetchCurrentInventory(token, warehouseId, storeCode) {
  const statement = `
    SELECT store_code, ingredient_id, ingredient_name, unit,
           audit_quantity, last_audit_id, CAST(last_audit_date AS STRING) AS last_audit_date,
           pos_consumption_since_audit, po_receipts_since_audit,
           current_on_hand, CAST(current_on_hand_as_of_date AS STRING) AS current_on_hand_as_of_date
    FROM workspace.inventory_tabular.view_current_inventory
    WHERE store_code = '${storeCode}'
  `
  return runDatabricksSql(token, warehouseId, statement.replace(/\s+/g, ' ').trim())
}
