const fs = require('fs');

function fix(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Reading from D1
  content = content.replace(
    'purchaseOrders: poRes.map(po => ({...po, lines: JSON.parse(po.lines)})),',
    'purchaseOrders: poRes.map(po => ({...po, lines: JSON.parse(po.lines), receivedDate: po.receivedAt ? po.receivedAt.split("T")[0] : null})),'
  );

  // 2. addPurchaseOrder
  content = content.replace(
    /INSERT INTO purchase_orders \\(id, store, status, receivedAt, fromLocation, toLocation, lines\\) VALUES \\(\\?, \\?, \\?, \\?, \\?, \\?, \\?\\)/g,
    'INSERT INTO purchase_orders (id, store, status, receivedAt, createdDate, sentDate, fromLocation, toLocation, lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  content = content.replace(
    /\\[po\\.id, po\\.store, po\\.status, po\\.receivedAt \\|\\| null, po\\.fromLocation \\|\\| null, po\\.toLocation \\|\\| null, JSON\\.stringify\\(po\\.lines \\|\\| \\[\\]\\)\\]/g,
    '[po.id, po.store, po.status, po.receivedAt || null, po.createdDate || null, po.sentDate || null, po.fromLocation || null, po.toLocation || null, JSON.stringify(po.lines || [])]'
  );

  // 3. updatePurchaseOrder
  content = content.replace(
    /UPDATE purchase_orders SET status = \\?, receivedAt = \\?, fromLocation = \\?, toLocation = \\?, lines = \\? WHERE id = \\?/g,
    'UPDATE purchase_orders SET status = ?, receivedAt = ?, createdDate = ?, sentDate = ?, fromLocation = ?, toLocation = ?, lines = ? WHERE id = ?'
  );
  content = content.replace(
    /\\[updatedPo\\.status, updatedPo\\.receivedAt \\|\\| null, updatedPo\\.fromLocation \\|\\| null, updatedPo\\.toLocation \\|\\| null, JSON\\.stringify\\(updatedPo\\.lines\\), id\\]/g,
    '[updatedPo.status, updatedPo.receivedAt || null, updatedPo.createdDate || null, updatedPo.sentDate || null, updatedPo.fromLocation || null, updatedPo.toLocation || null, JSON.stringify(updatedPo.lines), id]'
  );

  fs.writeFileSync(filePath, content);
}

fix('d:/Github/bobacafe-web/apps/inventory-app/src/context/ConfigContext.jsx');
fix('d:/Github/bobacafe-web/apps/warehouse-app/src/context/ConfigContext.jsx');
