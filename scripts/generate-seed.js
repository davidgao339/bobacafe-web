const fs = require('fs');

const payload = JSON.parse(fs.readFileSync('d:/Github/bobacafe-web/inventory-debug.json', 'utf8'));
const { config, data } = payload;

let sql = '';
const esc = (val) => {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return "'" + val.replace(/'/g, "''") + "'";
  if (typeof val === 'object') return "'" + JSON.stringify(val).replace(/'/g, "''") + "'";
  return val;
};

if (config && config.ingredients) {
  sql += `DELETE FROM ingredients;\n`;
  for (const ing of config.ingredients) {
    sql += `INSERT INTO ingredients (id, name, unit, productType, supplierId) VALUES (${esc(ing.id)}, ${esc(ing.name)}, ${esc(ing.unit)}, ${esc(ing.productType)}, ${esc(ing.supplierId)});\n`;
  }
}

if (config && config.recipes) {
  sql += `DELETE FROM recipes;\n`;
  for (const [productName, mapping] of Object.entries(config.recipes)) {
    sql += `INSERT INTO recipes (product_name, ingredient_mapping) VALUES (${esc(productName)}, ${esc(mapping)});\n`;
  }
}

if (data && data.purchaseOrders) {
  sql += `DELETE FROM purchase_orders;\n`;
  for (const po of data.purchaseOrders) {
    sql += `INSERT INTO purchase_orders (id, store, status, receivedAt, fromLocation, toLocation, lines) VALUES (${esc(po.id)}, ${esc(po.store)}, ${esc(po.status)}, ${esc(po.receivedAt)}, ${esc(po.fromLocation)}, ${esc(po.toLocation)}, ${esc(po.lines || [])});\n`;
  }
}

if (data && data.transactions) {
  sql += `DELETE FROM transactions;\n`;
  for (const tx of data.transactions) {
    sql += `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (${esc(tx.id)}, ${esc(tx.store)}, ${esc(tx.date)}, ${esc(tx.type)}, ${esc(tx.ingredientId)}, ${esc(tx.quantity)}, ${esc(tx.poId)}, ${esc(tx.reason)}, ${esc(tx.timestamp || new Date().toISOString())});\n`;
  }
}

if (data && data.audits) {
  sql += `DELETE FROM audits;\n`;
  for (const audit of data.audits) {
    sql += `INSERT INTO audits (id, store, date, counts, timestamp) VALUES (${esc(audit.id)}, ${esc(audit.store)}, ${esc(audit.date)}, ${esc(audit.counts || {})}, ${esc(audit.timestamp || new Date().toISOString())});\n`;
  }
}

fs.writeFileSync('d:/Github/bobacafe-web/apps/databricks-proxy/seed.sql', sql);
console.log('Seed SQL generated.');
