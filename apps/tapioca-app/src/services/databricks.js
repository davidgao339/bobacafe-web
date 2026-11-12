// Lakehouse recipe access for tapioca-app. Recipes are LH-only: read and
// write go straight to workspace.inventory_tabular.fact_recipe_ingredients
// (recipe_type = 'retail'). No D1 legacy `recipes` involvement.
const T = (name) => `workspace.inventory_tabular.${name}`

export function esc(s) { return String(s ?? '').replace(/'/g, "''") }

// Statement API submit + poll; returns data_array rows.
export async function runLhSql(token, warehouseId, statement) {
  const url = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements'
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  const submit = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
    }),
  })
  if (!submit.ok) throw new Error(`Databricks submit failed (${submit.status}): ${(await submit.text().catch(() => '')).slice(0, 300)}`)
  let data = await submit.json()
  let state = data.status?.state
  const deadline = Date.now() + 60000
  while ((state === 'PENDING' || state === 'RUNNING') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    const poll = await fetch(`${url}/${data.statement_id}`, { headers })
    if (!poll.ok) throw new Error(`Databricks poll failed (${poll.status})`)
    data = await poll.json()
    state = data.status?.state
  }
  if (state !== 'SUCCEEDED') {
    const err = JSON.stringify(data.status?.error || {}).slice(0, 300)
    throw new Error(`Databricks statement ${state}: ${err}`)
  }
  return (data.result?.data_array) || []
}

// Read all retail recipe rows (raw fact shape; caller groups by product).
export function fetchRetailRecipesLh(token, warehouseId) {
  return runLhSql(
    token,
    warehouseId,
    `SELECT recipe_product_name, product_id, ingredient_id, ingredient_name, amount_per_serving, is_hidden FROM ${T('fact_recipe_ingredients')} WHERE recipe_type = 'retail'`,
  )
}

// Idempotent per-product retail replace, preserving the hidden flag.
// D1 write is NOT mirrored anymore — LH is the only store for recipes.
export function lhRecipeReplaceRetail(product, entries, productId, hidden) {
  return [
    lhRecipeDeleteRetail(product),
    ...entries.map(e => `INSERT INTO ${T('fact_recipe_ingredients')} (recipe_product_name, product_id, ingredient_id, ingredient_name, amount_per_serving, recipe_type, is_hidden) VALUES ('${esc(product)}', ${productId ?? 'NULL'}, ${Number(e.id)}, '${esc(e.name)}', ${Number(e.amt)}, 'retail', ${hidden ? 'true' : 'false'})`),
  ]
}

export function lhRecipeDeleteRetail(product) {
  return `DELETE FROM ${T('fact_recipe_ingredients')} WHERE recipe_product_name = '${esc(product)}' AND recipe_type = 'retail'`
}
