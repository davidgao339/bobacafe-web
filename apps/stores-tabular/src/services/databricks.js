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

// ── Direct lakehouse-read mode (swappable data source; D1 becomes optional) ──
// Mirrors the D1 tabular SELECTs (same aliases) so ConfigContext transforms
// rows identically whichever source serves them. Columns absent in the
// lakehouse are aliased to NULL / derived values instead.
const T = t => `workspace.inventory_tabular.${t}`

export const LH_QUERIES = {
  stores: `SELECT store_id, store_code, store_name, is_active FROM ${T('dim_stores')} ORDER BY store_id ASC`,
  ingredients: `SELECT ingredient_id AS id, ingredient_name AS name, unit, product_type AS productType, supplier_id AS supplierId, supplier_name AS supplierName, is_warehouse_only AS warehouseOnly, is_hidden AS hidden, cost_per_unit AS costPerUnit, CAST(NULL AS DOUBLE) AS lastPurchaseCost, CAST(NULL AS DOUBLE) AS wacCost30d FROM ${T('dim_ingredients')}`,
  recipes: `SELECT recipe_product_name, ingredient_id, amount_per_serving FROM ${T('fact_recipe_ingredients')} WHERE recipe_type = 'production'`,
  transactions: `SELECT transaction_id AS id, store_id AS storeId, store_code AS storeCode, transaction_date AS date, transaction_timestamp AS timestamp, transaction_type AS type, ingredient_id AS ingredientId, ingredient_name AS ingredientName, quantity, po_id AS poId, reason FROM ${T('fact_inventory_transactions')} ORDER BY transaction_date DESC, transaction_timestamp DESC`,
  purchaseOrders: `SELECT po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date, CAST(NULL AS INT) AS supplier_id FROM ${T('fact_purchase_orders')} ORDER BY po_id DESC`,
  poLines: `SELECT po_id, CAST(ROW_NUMBER() OVER (PARTITION BY po_id ORDER BY ingredient_id) AS INT) AS line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, CASE WHEN is_custom_item THEN 'overhead' ELSE 'cogs' END AS cost_category, CAST(NULL AS STRING) AS overhead_category FROM ${T('fact_purchase_order_lines')} ORDER BY po_id, ingredient_id ASC`,
  auditHeaders: `SELECT audit_id AS id, store_id AS storeId, store_code AS storeCode, audit_date AS date, audit_timestamp AS timestamp, status FROM ${T('fact_audit_headers')} ORDER BY audit_date DESC, audit_timestamp DESC`,
  auditCounts: `SELECT audit_id, ingredient_id, count_quantity FROM ${T('fact_audit_counts')}`,
}

export function fetchLh(token, warehouseId, queryKey) {
  return runDatabricksSql(token, warehouseId, LH_QUERIES[queryKey])
}
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
