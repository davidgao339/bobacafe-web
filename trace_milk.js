const fs = require('fs');

function run() {
  const file = JSON.parse(fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8'));
  const config = file.config || {};
  const data = file.data || {};
  const salesCache = file.salesCache || { rows: [] };
  
  const milk = config.ingredients.find(i => i.name === 'Молоко');
  if (!milk) {
    console.log("Could not find milk ingredient.");
    return;
  }
  const milkId = milk.id;
  console.log(`Milk Ingredient ID: ${milkId}`);
  
  const store = 'НОВО КП';
  
  // 1. Find last audit for store
  const audits = (data.audits || []).filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date));
  const lastMilkAudit = audits.find(a => a.counts && a.counts[milkId] != null);
  
  if (!lastMilkAudit) {
    console.log(`No audit found for Milk in store ${store}`);
    return;
  }
  
  const cutAudit = lastMilkAudit.date;
  const cutTime = lastMilkAudit.timestamp || `${cutAudit}T23:59:59`;
  console.log(`Last Audit: ${cutAudit} (Timestamp: ${cutTime}) - Count: ${lastMilkAudit.counts[milkId]}`);
  
  // 2. Sales since last audit
  let salesSinceLastAudit = 0;
  const recipes = config.recipes || {};
  
  for (const row of salesCache.rows) {
    if (row.store === store || row.store_name === store) {
      const date = row.date;
      if (date >= cutAudit && `${date}T23:59:58` > cutTime) {
        const recipe = recipes[row.product];
        if (recipe && recipe[milkId]) {
          salesSinceLastAudit += (row.quantity || row.qty || 0) * recipe[milkId];
        }
      }
    }
  }
  console.log(`Sales Since Last Audit: ${salesSinceLastAudit}`);
  
  // 3. Transactions since last audit
  let txSinceLastAudit = 0;
  const getPoTime = (poId) => {
    const po = (data.purchaseOrders || []).find(p => p.id === poId);
    return po?.receivedAt ?? (po?.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59');
  }

  for (const t of (data.transactions || [])) {
    if (t.store === store && t.ingredientId === milkId) {
      const date = t.date;
      if (date >= cutAudit) {
        let time = `${date}T12:00:00`;
        if (t.type === 'adjustment' && t.poId) time = getPoTime(t.poId);
        if (time > cutTime) {
          txSinceLastAudit += (t.type === 'adjustment' ? t.quantity : -t.quantity);
        }
      }
    }
  }
  console.log(`Transactions Since Last Audit: ${txSinceLastAudit}`);
  
  // 4. POs since last audit
  let poSinceLastAudit = 0;
  for (const po of (data.purchaseOrders || [])) {
    if (po.status !== 'received' || (po.fromLocation && po.toLocation)) continue;
    if (po.store === store) {
      const poTime = po.receivedAt ?? (po.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59');
      if (poTime > cutTime) {
        for (const l of po.lines) {
          if (l.ingredientId === milkId) {
            poSinceLastAudit += (l.received ?? l.ordered ?? 0);
          }
        }
      }
    }
  }
  console.log(`POs Since Last Audit: ${poSinceLastAudit}`);
  
  const estimate = lastMilkAudit.counts[milkId] - salesSinceLastAudit + txSinceLastAudit + poSinceLastAudit;
  console.log(`Estimated Current Stock: ${estimate}`);
}

run();
