const DATABRICKS_TARGET = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements'
const ORIGIN      = '*'
const MAX_AUTO_BACKUPS = 5
const MAX_MANUAL_BACKUPS = 10

export default {
  async fetch(request, env) {
    const url  = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() })
    }

    // ── Databricks proxy (root) ──────────────────────────────────────────────
    if (path === '/' || path === '') {
      return handleDatabricks(request)
    }

    // ── Backup: list ─────────────────────────────────────────────────────────
    if (path === '/backups' && request.method === 'GET') {
      return handleListBackups(env)
    }

    // ── Backup: save ─────────────────────────────────────────────────────────
    if (path === '/backups' && request.method === 'POST') {
      return handleSaveBackup(request, env)
    }

    // ── Backup: get one ───────────────────────────────────────────────────────
    const m = path.match(/^\/backups\/([^/]+)$/)
    if (m && request.method === 'GET') {
      return handleGetBackup(m[1], env)
    }
    
    // ── D1 Direct Query (for warehouse app eventually) ────────────────────────
    if (path === '/d1/execute' && request.method === 'POST') {
      return handleD1Query(request, env)
    }

    return new Response('Not found', { status: 404, headers: cors() })
  },
}

// ── Databricks proxy ──────────────────────────────────────────────────────────

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
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body:    request.body,
    })
    const text = await resp.text()
    return new Response(text, {
      status:  resp.status,
      headers: { 'Content-Type': 'application/json', ...cors() },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status:  502,
      headers: { 'Content-Type': 'application/json', ...cors() },
    })
  }
}

// ── Backup handlers ───────────────────────────────────────────────────────────

async function handleListBackups(env) {
  const result = await env.BACKUP_STORE.list({ prefix: 'backup:' })
  const backups = result.keys
    .filter(k => k.metadata)
    .map(k => k.metadata)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  return json(backups)
}

async function handleSaveBackup(request, env) {
  let body
  try { body = await request.json() } catch {
    return new Response('Bad request', { status: 400, headers: cors() })
  }

  const id      = new Date().toISOString().replace(/[:.]/g, '-')
  const savedAt = new Date().toISOString()

  // Metadata stored directly on the KV key
  const meta = {
    id,
    savedAt,
    ingredientCount: body.config?.ingredients?.length ?? 0,
    auditCount:      body.data?.audits?.length          ?? 0,
    poCount:         body.data?.purchaseOrders?.length  ?? 0,
    isManual:        body.isManual === true,
  }

  // Write full payload with metadata
  await env.BACKUP_STORE.put(`backup:${id}`, JSON.stringify(body), { metadata: meta })
  
  // Asynchronously mirror to D1 (Dual-Write)
  if (env.DB) {
    env.DB.batch([]).catch(() => {}) // warm up
    syncToD1(env.DB, body).catch(e => console.error('D1 Sync Error:', e.message))
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
      env.BACKUP_STORE.delete(old.name).catch(() => {})
    }
  }

  if (manualBackups.length > MAX_MANUAL_BACKUPS) {
    for (const old of manualBackups.slice(MAX_MANUAL_BACKUPS)) {
      env.BACKUP_STORE.delete(old.name).catch(() => {})
    }
  }

  return json({ id, savedAt })
}

async function handleGetBackup(id, env) {
  const value = await env.BACKUP_STORE.get(`backup:${id}`)
  if (!value) return new Response('Not found', { status: 404, headers: cors() })
  return new Response(value, {
    status:  200,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

// ── D1 Handlers ───────────────────────────────────────────────────────────────

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

async function syncToD1(db, payload) {
  const { config, data } = payload
  if (!config || !data) return

  const statements = []

  // 1. Ingredients
  if (config.ingredients) {
    statements.push(db.prepare(`DELETE FROM ingredients`))
    for (const ing of config.ingredients) {
      statements.push(db.prepare(
        `INSERT INTO ingredients (id, name, unit, productType, supplierId) VALUES (?, ?, ?, ?, ?)`
      ).bind(ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null))
    }
  }

  // 2. Recipes
  if (config.recipes) {
    statements.push(db.prepare(`DELETE FROM recipes`))
    for (const [productName, mapping] of Object.entries(config.recipes)) {
      statements.push(db.prepare(
        `INSERT INTO recipes (product_name, ingredient_mapping) VALUES (?, ?)`
      ).bind(productName, JSON.stringify(mapping)))
    }
  }

  // 3. Purchase Orders
  if (data.purchaseOrders) {
    statements.push(db.prepare(`DELETE FROM purchase_orders`))
    for (const po of data.purchaseOrders) {
      statements.push(db.prepare(
        `INSERT INTO purchase_orders (id, store, status, receivedAt, lines) VALUES (?, ?, ?, ?, ?)`
      ).bind(po.id, po.store, po.status, po.receivedAt || null, JSON.stringify(po.lines || [])))
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
        `INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`
      ).bind(audit.id, audit.store, audit.date, JSON.stringify(audit.counts || {}), audit.timestamp || new Date().toISOString()))
    }
  }

  // Execute in batches to prevent overwhelming D1 limits
  const BATCH_SIZE = 50
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
