const SALES_TABLE = 'workspace.default.transactions'
const isDevDeploy = window.location.hostname.startsWith('dev.') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BACKUP_BASE = isDevDeploy 
  ? 'https://bobacafe-proxy-dev.davidgao734.workers.dev' 
  : 'https://bobacafe-proxy.davidgao734.workers.dev'

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

  const cleanStatement = statement.replace(/\s+/g, ' ').trim()

  const apiPath = import.meta.env.DEV
    ? '/databricks-proxy/api/2.0/sql/statements'
    : BACKUP_BASE
    
  const resp = await fetch(apiPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ 
      statement: cleanStatement, 
      warehouse_id: warehouseId, 
      wait_timeout: '30s' 
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    console.error('Databricks API Error Response:', resp.status, text)
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
    Object.fromEntries(cols.map((c, i) => [c, row[i]]))
  )
}

export async function queryD1(sql, params = [], retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(`${BACKUP_BASE}/d1/execute`, {
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
    } catch (err) {
      if (i === retries) throw err
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}
