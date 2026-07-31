const DATABRICKS_TARGET = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements'
const ORIGIN      = 'https://bobacafe.net'
const MAX_BACKUPS = 5

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
  }

  // Write full payload with metadata
  await env.BACKUP_STORE.put(`backup:${id}`, JSON.stringify(body), { metadata: meta })

  // Clean up old backups based on list
  const result = await env.BACKUP_STORE.list({ prefix: 'backup:' })
  const backups = result.keys
    .filter(k => k.metadata)
    .sort((a, b) => b.metadata.savedAt.localeCompare(a.metadata.savedAt))

  if (backups.length > MAX_BACKUPS) {
    const evicted = backups.slice(MAX_BACKUPS)
    for (const old of evicted) {
      // Don't wait for deletions so the response is fast
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
