const SALES_TABLE = 'workspace.default.transactions'
const BACKUP_BASE = import.meta.env.DEV ? 'http://localhost:8787' : 'https://bobacafe-proxy.davidgao734.workers.dev'

export async function fetchDatabricksSales(token, warehouseId, fromDate, toDate) {
  if (!fromDate || !toDate) return []

  const statement = `
    SELECT CAST(date AS STRING) AS date, store_name AS store, product,
           transaction_type, is_topping, CAST(SUM(qty) AS DOUBLE) AS qty
    FROM ${SALES_TABLE}
    WHERE date >= '${fromDate}' AND date <= '${toDate}'
      AND is_return = false
    GROUP BY date, store_name, product, transaction_type, is_topping
    ORDER BY date DESC
  `

  const apiPath = import.meta.env.DEV
    ? '/databricks-proxy/api/2.0/sql/statements'
    : 'https://bobacafe-proxy.davidgao734.workers.dev'
    
  const resp = await fetch(apiPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ statement, warehouse_id: warehouseId, wait_timeout: '50s', on_wait_timeout: 'CANCEL' }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text.slice(0, 300) : ''}`)
  }

  const result = await resp.json()
  if (result.status?.state !== 'SUCCEEDED') {
    throw new Error(result.status?.error?.message ?? `Query ended: ${result.status?.state}`)
  }

  const cols = result.manifest.schema.columns.map(c => c.name)
  return (result.result?.data_array ?? []).map(row =>
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  )
}

export async function queryD1(sql, params = []) {
  const resp = await fetch(`${BACKUP_BASE}/d1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text : ''}`)
  }
  const data = await resp.json()
  return data.results || []
}
