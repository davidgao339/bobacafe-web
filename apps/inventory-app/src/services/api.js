const SALES_TABLE = 'workspace.default.transactions'
const isDevDeploy = window.location.hostname.startsWith('dev.') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BACKUP_BASE = isDevDeploy 
  ? 'https://bobacafe-proxy-dev.davidgao734.workers.dev' 
  : 'https://bobacafe-proxy.davidgao734.workers.dev'

export async function fetchDatabricksSales(token, warehouseId, fromDate, toDate) {
  if (!fromDate || !toDate) return []

  const statement = `
    SELECT CAST(date AS STRING) AS date,
           COALESCE(CAST(datetime AS STRING), '') AS datetime,
           store_name AS store,
           product,
           transaction_type,
           is_topping,
           CAST(SUM(qty) AS DOUBLE) AS qty
    FROM ${SALES_TABLE}
    WHERE date >= '${fromDate}' AND date <= '${toDate}'
      AND is_return = false
    GROUP BY date, datetime, store_name, product, transaction_type, is_topping
    ORDER BY date DESC, datetime DESC
  `

  const cleanStatement = statement.replace(/\s+/g, ' ').trim()

  const apiPath = import.meta.env.DEV
    ? '/databricks-proxy/api/2.0/sql/statements'
    : BACKUP_BASE
    
  let lastErr
  for (let i = 0; i < 5; i++) {
    try {
      const resp = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ 
          statement: cleanStatement, 
          warehouse_id: warehouseId, 
          wait_timeout: '50s' 
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
        Object.fromEntries(cols.map((c, idx) => [c, row[idx]]))
      )
    } catch (err) {
      lastErr = err
      // ponytail: retry on 400s (warehouse cold/starting) or pending states
      await new Promise(r => setTimeout(r, 5000))
    }
  }
  throw lastErr
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
        let parsedMessage = text
        try {
          const parsed = JSON.parse(text)
          parsedMessage = parsed.error || parsed.message || text
        } catch {}
        throw new Error(parsedMessage ? `D1 Error (${resp.status}): ${parsedMessage}` : `HTTP ${resp.status}`)
      }
      const data = await resp.json()
      return data.results || []
    } catch (err) {
      if (i === retries) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('d1-sync-error', {
            detail: {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              sql,
              params,
              message: err.message || String(err),
              timestamp: new Date().toLocaleTimeString(),
              retry: () => queryD1(sql, params, 0)
            }
          }))
        }
        throw err
      }
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

