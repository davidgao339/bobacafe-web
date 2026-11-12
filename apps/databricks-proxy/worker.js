const DATABRICKS_TARGET = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements'
const ORIGIN = '*'
const MAX_AUTO_BACKUPS = 5
const MAX_MANUAL_BACKUPS = 10

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() })
    }

    // â”€â”€ Databricks proxy (root) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/' || path === '') {
      return handleDatabricks(request)
    }

    // â”€â”€ Backup: list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/backups' && request.method === 'GET') {
      return handleListBackups(env)
    }

    // â”€â”€ Backup: save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/backups' && request.method === 'POST') {
      return handleSaveBackup(request, env, ctx)
    }

    // â”€â”€ Backup: get one â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const m = path.match(/^\/backups\/([^/]+)$/)
    if (m && request.method === 'GET') {
      return handleGetBackup(m[1], env)
    }

    // â”€â”€ D1 Direct Query (for warehouse app eventually) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/d1/execute' && request.method === 'POST') {
      return handleD1Query(request, env)
    }

    // â”€â”€ Real-time lakehouse audit push (server-side credentials) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (path === '/lh/audit' && request.method === 'POST') {
      return handleLakehouseAuditPush(request, env)
    }

    return new Response('Not found', { status: 404, headers: cors() })
  },
}

// â”€â”€ Databricks proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handleDatabricks(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors() })
  }
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer dapi')) {
    return new Response('Unauthorized', { status: 401, headers: cors() })
  }
  try {
    const resp = await fetch(DATABRICKS_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body: request.body,
    })
    const text = await resp.text()
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json', ...cors() },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...cors() },
    })
  }
}

// â”€â”€ Backup handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handleListBackups(env) {
  const result = await env.BACKUP_STORE.list({ prefix: 'backup:' })
  const backups = result.keys
    .filter(k => k.metadata)
    .map(k => k.metadata)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  return json(backups)
}

async function handleSaveBackup(request, env, ctx) {
  let body
  try { body = await request.json() } catch {
    return new Response('Bad request', { status: 400, headers: cors() })
  }

  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const savedAt = new Date().toISOString()

  // Metadata stored directly on the KV key
  const meta = {
    id,
    savedAt,
    ingredientCount: body.config?.ingredients?.length ?? 0,
    auditCount: body.data?.audits?.length ?? 0,
    poCount: body.data?.purchaseOrders?.length ?? 0,
    isManual: body.isManual === true,
  }

  // Write full payload with metadata
  await env.BACKUP_STORE.put(`backup:${id}`, JSON.stringify(body), { metadata: meta })

  // Asynchronously mirror to D1 (Dual-Write)
  if (env.DB) {
    env.DB.batch([]).catch(() => { }) // warm up
    ctx.waitUntil(syncToD1(env.DB, body).catch(e => console.error('D1 Sync Error:', e.message)))
  }

  // Clean up old backups based on list
  const result = await env.BACKUP_STORE.list({ prefix: 'backup:' })
  const backups = result.keys
    .filter(k => k.metadata)
    .sort((a, b) => b.metadata.savedAt.localeCompare(a.metadata.savedAt))

  const autoBackups = backups.filter(k => !k.metadata.isManual)
  const manualBackups = backups.filter(k => k.metadata.isManual)

  if (autoBackups.length > MAX_AUTO_BACKUPS) {
    for (const old of autoBackups.slice(MAX_AUTO_BACKUPS)) {
      env.BACKUP_STORE.delete(old.name).catch(() => { })
    }
  }

  if (manualBackups.length > MAX_MANUAL_BACKUPS) {
    for (const old of manualBackups.slice(MAX_MANUAL_BACKUPS)) {
      env.BACKUP_STORE.delete(old.name).catch(() => { })
    }
  }

  return json({ id, savedAt })
}

async function handleGetBackup(id, env) {
  const value = await env.BACKUP_STORE.get(`backup:${id}`)
  if (!value) return new Response('Not found', { status: 404, headers: cors() })
  return new Response(value, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

// â”€â”€ D1 Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handleD1Query(request, env) {
  let body
  try { body = await request.json() } catch {
    return new Response('Bad request', { status: 400, headers: cors() })
  }
  if (!body.sql) return new Response('Missing sql', { status: 400, headers: cors() })

  try {
    const stmt = env.DB.prepare(body.sql).bind(...(body.params || []))
    const results = await stmt.all()
    return json(results)
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors() })
  }
}

// â”€â”€ Lakehouse audit push (server-side credentials) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The audit-app (employee phones) has no Databricks token, so the browser can't
// push MERGEs directly like stores-tabular does. This endpoint accepts a
// FIXED-SHAPE payload (no SQL from clients) and runs the same idempotent
// statements stores-tabular's LH_PUSH builds (header MERGE + counts
// delete+insert), so an audit lands in the lakehouse within seconds and
// same-day order screens see it. Failures are non-fatal: the nightly
// D1â†’LH sync is the backstop.
const LH_SCHEMA = 'workspace.inventory_tabular'
const sqlEsc = (s) => String(s ?? '').replace(/'/g, "''")

async function handleLakehouseAuditPush(request, env) {
  if (!env.DATABRICKS_TOKEN || !env.DATABRICKS_WAREHOUSE_ID) {
    return new Response(JSON.stringify({ error: 'Lakehouse push not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...cors() },
    })
  }

  let body
  try { body = await request.json() } catch {
    return new Response('Bad request', { status: 400, headers: cors() })
  }

  const statements = []
  for (const auditId of body.deletes || []) {
    statements.push(`DELETE FROM ${LH_SCHEMA}.fact_audit_counts WHERE audit_id = '${sqlEsc(auditId)}'`)
    statements.push(`DELETE FROM ${LH_SCHEMA}.fact_audit_headers WHERE audit_id = '${sqlEsc(auditId)}'`)
  }
  for (const a of body.audits || []) {
    if (!a.auditId || !a.storeId || !a.date) {
      return new Response(JSON.stringify({ error: 'audit requires auditId, storeId, date' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...cors() },
      })
    }
    statements.push(
      `MERGE INTO ${LH_SCHEMA}.fact_audit_headers t USING (SELECT '${sqlEsc(a.auditId)}' AS audit_id, ${Number(a.storeId)} AS store_id, '${sqlEsc(a.storeCode)}' AS store_code, '${sqlEsc(a.date)}' AS audit_date, '${sqlEsc(a.ts || new Date().toISOString())}' AS audit_timestamp, '${sqlEsc(a.status || 'approved')}' AS status) s ON t.audit_id = s.audit_id WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *`
    )
    statements.push(`DELETE FROM ${LH_SCHEMA}.fact_audit_counts WHERE audit_id = '${sqlEsc(a.auditId)}'`)
    for (const c of a.counts || []) {
      if (c.ingredientId == null) continue
      statements.push(
        `INSERT INTO ${LH_SCHEMA}.fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES ('${sqlEsc(a.auditId)}', ${Number(a.storeId)}, '${sqlEsc(a.date)}', ${Number(c.ingredientId)}, '${sqlEsc(c.name)}', ${Number(c.qty)})`
      )
    }
  }

  if (statements.length === 0) {
    return json({ ok: true, executed: 0 })
  }

  try {
    for (const statement of statements) {
      await runLhStatement(env, statement)
    }
    return json({ ok: true, executed: statements.length })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502, headers: { 'Content-Type': 'application/json', ...cors() },
    })
  }
}

// Runs one SQL statement and polls to completion (Statement Execution API).
async function runLhStatement(env, statement) {
  const submit = await fetch(DATABRICKS_TARGET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DATABRICKS_TOKEN}`,
    },
    body: JSON.stringify({
      statement,
      warehouse_id: env.DATABRICKS_WAREHOUSE_ID,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
    }),
  })
  if (!submit.ok) {
    throw new Error(`Databricks submit failed (${submit.status}): ${(await submit.text().catch(() => '')).slice(0, 300)}`)
  }
  let data = await submit.json()
  let state = data.status?.state
  const deadline = Date.now() + 60000
  while ((state === 'PENDING' || state === 'RUNNING') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    const poll = await fetch(`${DATABRICKS_TARGET}/${data.statement_id}`, {
      headers: { 'Authorization': `Bearer ${env.DATABRICKS_TOKEN}` },
    })
    if (!poll.ok) throw new Error(`Databricks poll failed (${poll.status})`)
    data = await poll.json()
    state = data.status?.state
  }
  if (state !== 'SUCCEEDED') {
    const err = JSON.stringify(data.status?.error || {}).slice(0, 300)
    throw new Error(`Databricks statement ${state}: ${err}`)
  }
  return state
}

async function syncToD1(db, payload) {
  const { config, data } = payload
  if (!config || !data) return

  const statements = []

  // 1. Ingredients
  if (config.ingredients) {
    statements.push(db.prepare(`DELETE FROM ingredients`))
    for (const ing of config.ingredients) {
      statements.push(db.prepare(
        `INSERT INTO ingredients (id, name, unit, productType, supplierId, hidden, warehouseOnly) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null, ing.hidden ? 1 : 0, ing.warehouseOnly ? 1 : 0))
    }
  }

  // 2. Recipes — removed: recipes are lakehouse-only now. The legacy D1
  // `recipes` table is no longer maintained (apps write
  // fact_recipe_ingredients in LH directly; the nightly sync no longer
  // rebuilds it from D1 either).

  // 3. Purchase Orders
  if (data.purchaseOrders) {
    statements.push(db.prepare(`DELETE FROM purchase_orders`))
    for (const po of data.purchaseOrders) {
      statements.push(db.prepare(
        `INSERT INTO purchase_orders (id, store, status, receivedAt, fromLocation, toLocation, createdDate, sentDate, lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(po.id, po.store, po.status, po.receivedAt || null, po.fromLocation || null, po.toLocation || null, po.createdDate || null, po.sentDate || null, JSON.stringify(po.lines || [])))
    }
  }

  // 4. Transactions
  if (data.transactions) {
    statements.push(db.prepare(`DELETE FROM transactions`))
    for (const tx of data.transactions) {
      statements.push(db.prepare(
        `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tx.id, tx.store, tx.date, tx.type, tx.ingredientId, tx.quantity, tx.poId || null, tx.reason || null, tx.timestamp || new Date().toISOString()))
    }
  }

  // 5. Audits
  if (data.audits) {
    statements.push(db.prepare(`DELETE FROM audits`))
    for (const audit of data.audits) {
      statements.push(db.prepare(
        `INSERT INTO audits (id, store, date, counts, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(audit.id, audit.store, audit.date, JSON.stringify(audit.counts || {}), audit.timestamp || new Date().toISOString(), audit.status || 'approved'))
    }
  }

  // Execute in batches to prevent overwhelming D1 limits
  const BATCH_SIZE = 50
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE))
  }
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
