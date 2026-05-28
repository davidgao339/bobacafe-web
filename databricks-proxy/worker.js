const TARGET = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements'
const ORIGIN = 'https://bobacafe.net'

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const auth = request.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer dapi')) {
      return new Response('Unauthorized', { status: 401 })
    }
    try {
      const resp = await fetch(TARGET, {
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
  },
}

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
