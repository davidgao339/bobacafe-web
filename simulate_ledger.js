const fs = require('fs');

async function simulate() {
  const f = JSON.parse(fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8'));
  const STORES = ['НОВО КП', 'ГРИН ПАРК', 'БОН ПАССАЖ', 'ЧЕРНОМОРСКИЙ', 'СОВЕТОВ', 'КИОСК', 'ГАЛЕРЕЯ', 'ОЗМОЛЛ', 'Warehouse'];
  
  function rowsToSales(rows) {
    return rows
      .map(r => ({ ...r, store: r.store ?? r.store_name }))
      .filter(r => STORES.includes(r.store))
      .map((r, i) => ({
        id: i + 1, store: r.store, product: r.product, date: r.date,
        quantity: Math.round(parseFloat(r.qty ?? r.quantity ?? 0)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  const rows = f.salesCache?.rows || [];
  const fiscalRows = rows.filter(r => r.transaction_type !== 'Non-Fiscal');
  const nonFiscalRows = rows.filter(r => r.transaction_type === 'Non-Fiscal');
  
  const sales = rowsToSales(fiscalRows);
  const posWaste = rowsToSales(nonFiscalRows);
  
  const q = async sql => (await (await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', { 
    method: 'POST', 
    headers: {'Content-Type':'application/json'}, 
    body: JSON.stringify({sql}) 
  })).json()).results;
  
  const recRes = await q("SELECT * FROM recipes WHERE type = 'retail'");
  const recipes = Object.fromEntries(recRes.map(r => [r.product_name, JSON.parse(r.ingredient_mapping)]));
  
  const selectedStore = 'НОВО КП';
  const selectedId = 2; // Milk
  const from = '2026-02-28';
  
  const storeAudits = [...f.data.audits]
    .filter(a => a.store === selectedStore && a.counts[selectedId] != null)
    .sort((a, b) => a.date.localeCompare(b.date));
    
  const baseAudit = [...storeAudits].filter(a => a.date <= from).pop() ?? storeAudits[0];
  const startDate = baseAudit.date;
  
  // NEW LOGIC
  const baseAuditTime = (baseAudit.timestamp && baseAudit.timestamp.startsWith(startDate)) ? baseAudit.timestamp : `${startDate}T23:59:59`;
  
  const byDate = {};
  const ensure = d => { if (!byDate[d]) byDate[d] = { details: [] } };
  
  sales
    .filter(s => s.store === selectedStore && s.date >= startDate)
    .forEach(s => {
      const time = `${s.date}T23:59:58`;
      if (time <= baseAuditTime) return;
      const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0);
      if (!consumed) return;
      ensure(s.date);
      byDate[s.date].details.push({ kind: 'sale', product: s.product, soldQty: s.quantity, consumed, time });
    });

  const getPoTime = (poId) => {
    const po = f.data.purchaseOrders.find(p => p.id === poId)
    return po?.receivedAt ?? (po?.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
  }

  f.data.transactions
    .filter(t => t.ingredientId === selectedId && t.store === selectedStore && t.date >= startDate)
    .forEach(t => {
      let time = `${t.date}T12:00:00`
      if (t.type === 'adjustment' && t.poId) time = getPoTime(t.poId)
      if (time <= baseAuditTime) return

      ensure(t.date)
      if (t.type === 'adjustment') {
        if (t.quantity < 0 && t.poId) {
          byDate[t.date].details.push({ kind: 'transfer-out', qty: Math.abs(t.quantity), poId: t.poId, time })
        } else if (t.quantity > 0 && t.poId) {
          byDate[t.date].details.push({ kind: 'transfer-in', qty: t.quantity, poId: t.poId, time })
        } else {
          byDate[t.date].details.push({ kind: 'adjustment', qty: t.quantity, time })
        }
      } else {
        byDate[t.date].details.push({ kind: t.type, qty: t.quantity, time })
      }
    })

  f.data.purchaseOrders
    .filter(po =>
      po.store === selectedStore &&
      po.status === 'received' &&
      !(po.fromLocation && po.toLocation)
    )
    .forEach(po => {
      const time = po.receivedAt ?? (po.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
      if (time <= baseAuditTime) return
      const d = po.receivedDate ?? time.slice(0, 10)
      if (d < startDate) return

      const line = po.lines.find(l => l.ingredientId === selectedId)
      if (!line) return
      const qty = line.received ?? line.ordered ?? 0
      if (!qty) return

      ensure(d)
      byDate[d].details.push({ kind: 'po', poId: po.id, qty, time })
    })

  const auditsByDate = new Map(
    storeAudits
      .filter(a => a.date >= startDate && ((a.timestamp && a.timestamp.startsWith(a.date)) ? a.timestamp : `${a.date}T23:59:59`) > baseAuditTime)
      .map(a => [a.date, a])
  )
    
  const allDates = [
    ...new Set([startDate, ...Object.keys(byDate), ...[...auditsByDate.keys()], '2026-09-14'])
  ].sort()
  
  let running = baseAudit.counts[selectedId];
  const allRows = [];
  
  for (const d of allDates) {
    if (d < startDate) continue;
    
    const dayData = byDate[d] ?? { details: [] };
    const details = [...dayData.details];
    
    if (auditsByDate.has(d)) {
      const audit = auditsByDate.get(d)
      details.push({
        kind: 'audit',
        count: audit.counts[selectedId] ?? 0,
        time: (audit.timestamp && audit.timestamp.startsWith(d)) ? audit.timestamp : `${d}T23:59:59`
      })
    }

    details.sort((a, b) => a.time.localeCompare(b.time))

    let dayUsage = 0
    let dayReceived = 0
    let dayTransferOut = 0
    let dayAuditAdj = null

    for (const ev of details) {
      if (ev.kind === 'audit') {
        const adj = (ev.count - running)
        ev.adj = adj
        dayAuditAdj = dayAuditAdj === null ? adj : (dayAuditAdj + adj)
        running = ev.count
      } else if (ev.kind === 'po' || ev.kind === 'transfer-in') {
        running = (running + ev.qty)
        dayReceived = (dayReceived + ev.qty)
      } else if (ev.kind === 'transfer-out') {
        running = (running - ev.qty)
        dayTransferOut = (dayTransferOut + ev.qty)
      } else if (ev.kind === 'sale' || ev.kind === 'waste') {
        running = (running - ev.consumed)
        dayUsage = (dayUsage + ev.consumed)
      } else if (ev.kind === 'adjustment') {
        running = (running + ev.qty)
        dayReceived = (dayReceived + ev.qty)
      } else {
        running = (running - ev.qty)
        dayUsage = (dayUsage + ev.qty)
      }
    }

    allRows.push({ date: d, usage: dayUsage, received: dayReceived, transferOut: dayTransferOut, auditAdj: dayAuditAdj, ending: running, details })
  }
  
  const displayRows = allRows
    .filter(r => r.date >= from && r.date <= '2026-09-14' && (r.usage > 0 || r.received !== 0 || r.transferOut > 0 || r.auditAdj !== null || r.date === '2026-09-14'))
    .reverse()
    
  console.log('Total display rows:', displayRows.length);
  if (displayRows.length > 0) {
    console.log(displayRows[0]);
    console.log(displayRows[displayRows.length - 1]);
  }
}
simulate();
