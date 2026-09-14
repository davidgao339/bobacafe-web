const f = JSON.parse(require('fs').readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8'));
const po = f.data.purchaseOrders.find(p => p.id === 'PO-051');
console.log('PO-051:', po.receivedAt, po.receivedDate);
