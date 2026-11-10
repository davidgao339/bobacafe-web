// Databricks SQL access for warehouse-tabular (lakehouse = single source of truth).
// Statement Execution API through the Cloudflare proxy — same channel as the inventory app's api.js.
const isDevDeploy = window.location.hostname.startsWith('dev.') || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BACKUP_BASE = isDevDeploy
  ? 'https://bobacafe-proxy-dev.davidgao734.workers.dev'
  : 'https://bobacafe-proxy.davidgao734.workers.dev'

export async function runDatabricksSql(token, warehouseId, statement, retries = 4) {
  // The worker serves the Databricks proxy at ROOT (POST / → statements API);
  // there is no /api/2.0/sql/statements route on it. Absolute URL (worker
  // serves CORS) so vite dev works too.
  const apiPath = BACKUP_BASE

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

// WHS on-hand from the echelon-enforced view (warehouse rows only; store
// screens can never see these). Same row shape the stores app derives from
// view_store_stock.
export function fetchCurrentInventory(token, warehouseId) {
  const statement = `
    SELECT 'WHS' AS store_code, ingredient_id, ingredient_name, unit, item_class,
           audit_quantity, last_audit_id, CAST(last_audit_date AS STRING) AS last_audit_date,
           net_movement_since_audit AS pos_consumption_since_audit,
           po_receipts_since_audit,
           current_on_hand, CAST(current_on_hand_as_of_date AS STRING) AS current_on_hand_as_of_date
    FROM workspace.inventory_tabular.view_whs_stock
  `
  return runDatabricksSql(token, warehouseId, statement.replace(/\s+/g, ' ').trim())
}

// ── Direct lakehouse reads (6c: the read path — no D1 fallback) ──────────────
const T = t => `workspace.inventory_tabular.${t}`
export const LH_QUERIES = {
  stores: `SELECT store_id, store_code, store_name, store_name_en, city, store_type, is_active FROM ${T('dim_stores')} ORDER BY store_id ASC`,
  ingredients: `SELECT i.ingredient_id AS id, i.ingredient_name AS name, i.unit, i.product_type AS productType, i.supplier_id AS supplierId, i.supplier_name AS supplierName, i.is_warehouse_only AS warehouseOnly, i.is_hidden AS hidden, i.cost_per_unit AS costPerUnit, i.item_class AS itemClass, i.last_purchase_cost AS lastPurchaseCost, w.effective_unit_cost AS wacCost30d FROM ${T('dim_ingredients')} i LEFT JOIN ${T('view_ingredient_wac_30d')} w ON w.ingredient_id = i.ingredient_id`,
  recipes: `SELECT recipe_product_name, product_id, ingredient_id, amount_per_serving FROM ${T('fact_recipe_ingredients')} WHERE recipe_type = 'production'`,
  suppliers: `SELECT DISTINCT supplier_id AS id, supplier_name AS name FROM ${T('dim_ingredients')} WHERE supplier_id IS NOT NULL ORDER BY id ASC`,
  transactions: `SELECT transaction_id AS id, store_id AS storeId, store_code AS storeCode, transaction_date AS date, transaction_timestamp AS timestamp, transaction_type AS type, ingredient_id AS ingredientId, ingredient_name AS ingredientName, quantity, po_id AS poId, reason FROM ${T('fact_inventory_transactions')} ORDER BY transaction_date DESC, transaction_timestamp DESC`,
  purchaseOrders: `SELECT po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date, CAST(NULL AS INT) AS supplier_id FROM ${T('fact_purchase_orders')} ORDER BY po_id DESC`,
  poLines: `SELECT po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, CASE WHEN is_custom_item THEN 'overhead' ELSE 'cogs' END AS cost_category, CAST(NULL AS STRING) AS overhead_category FROM ${T('fact_purchase_order_lines')} ORDER BY po_id, line_index ASC NULLS LAST`,
  auditHeaders: `SELECT audit_id AS id, store_id AS storeId, store_code AS storeCode, audit_date AS date, audit_timestamp AS timestamp, status FROM ${T('fact_audit_headers')} ORDER BY audit_date DESC, audit_timestamp DESC`,
  auditCounts: `SELECT audit_id, ingredient_id, count_quantity FROM ${T('fact_audit_counts')}`,
  cookUnitPay: `SELECT product_name, pay_rate FROM ${T('dim_cook_unit_pay')}`,
  // Product master (gold schema): canonical catalog the Recipes tab treats as
  // its product universe. Read-only from this app — recipes write to
  // fact_recipe_ingredients only; dim_product stays managed in menu-manager.
  dimProduct: `SELECT product_id AS productId, product_ru AS productRu, parent_product_id AS parentProductId, parent_product_en AS parentProductEn, variant, category, subcategory, is_active AS isActive, is_modifier AS isModifier, base_price AS basePrice, cost FROM workspace.gold.dim_product ORDER BY parent_product_en, variant, product_ru`,
}

export function fetchLh(token, warehouseId, queryKey) {
  return runDatabricksSql(token, warehouseId, LH_QUERIES[queryKey])
}

// ── Push helpers (spec §3): idempotent MERGEs so re-saves never duplicate ────
// Same shapes as stores-tabular: D1 write is saved first; a failed push is
// logged and healed by the nightly MERGE sync.
export function esc(s) { return String(s ?? '').replace(/'/g, "''") }
export const LH_PUSH = {
  auditHeader: (a) => `MERGE INTO ${T('fact_audit_headers')} t USING (SELECT '${esc(a.auditId)}' AS audit_id, ${a.storeId} AS store_id, '${esc(a.storeCode)}' AS store_code, '${esc(a.date)}' AS audit_date, '${esc(a.ts)}' AS audit_timestamp, 'approved' AS status) s ON t.audit_id = s.audit_id WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *`,
  po: (p) => `MERGE INTO ${T('fact_purchase_orders')} t USING (SELECT '${esc(p.poId)}' AS po_id, '${esc(p.orderType)}' AS order_type, ${p.storeId ?? 'NULL'} AS store_id, '${esc(p.storeCode)}' AS store_code, ${p.fromStoreId ?? 'NULL'} AS from_store_id, ${p.toStoreId ?? 'NULL'} AS to_store_id, '${esc(p.status)}' AS status, ${p.receivedDate ? `'${esc(p.receivedDate)}'` : 'NULL'} AS received_date, ${p.receivedAt ? `'${esc(p.receivedAt)}'` : 'NULL'} AS received_at, '${esc(p.createdDate)}' AS created_date, ${p.sentDate ? `'${esc(p.sentDate)}'` : 'NULL'} AS sent_date) s ON t.po_id = s.po_id WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *`,
  tx: (x) => `MERGE INTO ${T('fact_inventory_transactions')} t USING (SELECT '${esc(x.id)}' AS transaction_id, ${x.storeId} AS store_id, '${esc(x.storeCode)}' AS store_code, '${esc(x.date)}' AS transaction_date, '${esc(x.ts)}' AS transaction_timestamp, '${esc(x.type)}' AS transaction_type, ${x.ingredientId ?? 'NULL'} AS ingredient_id, '${esc(x.ingredientName)}' AS ingredient_name, ${Number(x.qty) || 0} AS quantity, ${x.poId ? `'${esc(x.poId)}'` : 'NULL'} AS po_id, ${x.reason ? `'${esc(x.reason)}'` : 'NULL'} AS reason) s ON t.transaction_id = s.transaction_id WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *`,
  auditCountsReplace: (auditId, storeId, date, entries) => [
    `DELETE FROM ${T('fact_audit_counts')} WHERE audit_id = '${esc(auditId)}'`,
    ...entries.filter(e => e.ingredientId != null).map(e => `INSERT INTO ${T('fact_audit_counts')} (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES ('${esc(auditId)}', ${storeId}, '${esc(date)}', ${e.ingredientId}, '${esc(e.name)}', ${Number(e.qty)})`),
  ],
  poLinesReplace: (poId, lines) => [
    `DELETE FROM ${T('fact_purchase_order_lines')} WHERE po_id = '${esc(poId)}'`,
    ...(() => { let reg = 0, cust = 0; return lines.map(l => {
      // line_index matches D1/fact semantics: regular lines 0..n, custom 1000+idx
      const lineIndex = l.isCustom ? 1000 + cust++ : reg++
      return `INSERT INTO ${T('fact_purchase_order_lines')} (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost) VALUES ('${esc(poId)}', ${lineIndex}, ${l.ingredientId ?? 'NULL'}, '${esc(l.name)}', ${l.isCustom ? 'true' : 'false'}, ${Number(l.ordered) || 0}, ${Number(l.received) || 0}, '${esc(l.unit || '')}', ${Number(l.unitCost) || 0}, ${Number(l.totalCost) || 0})`
    }) })(),
  ],
  del: (table, where) => `DELETE FROM ${T(table)} WHERE ${where}`,
  upd: (table, set, where) => `UPDATE ${T(table)} SET ${set} WHERE ${where}`,
  // product_id attaches rows to dim_product so recipes survive spelling
  // renames; NULL for products absent from dim (catalog fixed in menu-manager).
  recipeReplace: (product, entries, productId) => [
    `DELETE FROM ${T('fact_recipe_ingredients')} WHERE recipe_product_name = '${esc(product)}' AND recipe_type = 'production'`,
    ...entries.map(e => `INSERT INTO ${T('fact_recipe_ingredients')} (recipe_product_name, product_id, ingredient_id, ingredient_name, amount_per_serving, recipe_type) VALUES ('${esc(product)}', ${productId ?? 'NULL'}, ${Number(e.id)}, '${esc(e.name)}', ${Number(e.amt)}, 'production')`),
  ],
  ingredient: (i) => `MERGE INTO ${T('dim_ingredients')} t USING (SELECT ${i.id} AS ingredient_id, '${esc(i.name)}' AS ingredient_name, '${esc(i.unit)}' AS unit, ${i.productType ? `'${esc(i.productType)}'` : 'NULL'} AS product_type, ${i.supplierId ?? 'NULL'} AS supplier_id, ${i.supplierName ? `'${esc(i.supplierName)}'` : 'NULL'} AS supplier_name, ${i.warehouseOnly ? 'true' : 'false'} AS is_warehouse_only, ${i.hidden ? 'true' : 'false'} AS is_hidden, ${i.costPerUnit ?? 'NULL'} AS cost_per_unit) s ON t.ingredient_id = s.ingredient_id WHEN MATCHED THEN UPDATE SET ingredient_name = s.ingredient_name, unit = s.unit, product_type = s.product_type, supplier_id = s.supplier_id, supplier_name = s.supplier_name, is_warehouse_only = s.is_warehouse_only, is_hidden = s.is_hidden, cost_per_unit = s.cost_per_unit WHEN NOT MATCHED THEN INSERT (ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name, is_warehouse_only, is_hidden, cost_per_unit) VALUES (s.ingredient_id, s.ingredient_name, s.unit, s.product_type, s.supplier_id, s.supplier_name, s.is_warehouse_only, s.is_hidden, s.cost_per_unit)`,
  cookPay: (product, rate) => rate == null
    ? `DELETE FROM ${T('dim_cook_unit_pay')} WHERE product_name = '${esc(product)}'`
    : `MERGE INTO ${T('dim_cook_unit_pay')} t USING (SELECT '${esc(product)}' AS product_name, ${Number(rate)} AS pay_rate) s ON t.product_name = s.product_name WHEN MATCHED THEN UPDATE SET * WHEN NOT MATCHED THEN INSERT *`,
}
