const fs = require('fs');

async function queryD1(sql, params = []) {
  const BACKUP_BASE = 'https://bobacafe-proxy.davidgao734.workers.dev'
  const resp = await fetch(`${BACKUP_BASE}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text : ''}`)
  }
  const data = await resp.json()
  return data.results || []
}

async function main() {
  console.log("Fetching Prod D1 data...");
  const auditsReq = await queryD1("SELECT * FROM audits");
  const txReq = await queryD1("SELECT * FROM transactions");
  const poReq = await queryD1("SELECT * FROM purchase_orders");
  
  console.log("Reading local JSON file...");
  const localDataStr = fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8');
  const localFile = JSON.parse(localDataStr);
  
  const d1Audits = auditsReq;
  const d1Tx = txReq;
  const d1Po = poReq;
  
  const localAudits = localFile.data.audits || [];
  const localTx = localFile.data.transactions || [];
  const localPo = localFile.data.purchaseOrders || [];
  
  console.log(`\n--- COUNTS ---`);
  console.log(`Audits:        Prod D1 = ${d1Audits.length}, Local = ${localAudits.length}`);
  console.log(`Transactions:  Prod D1 = ${d1Tx.length}, Local = ${localTx.length}`);
  console.log(`POs:           Prod D1 = ${d1Po.length}, Local = ${localPo.length}`);
  
  console.log(`\n--- DIFFERENCES IN TRANSACTIONS ---`);
  const d1TxIds = new Set(d1Tx.map(t => t.id));
  const localTxIds = new Set(localTx.map(t => t.id));
  
  const txInD1NotLocal = d1Tx.filter(t => !localTxIds.has(t.id));
  const txInLocalNotD1 = localTx.filter(t => !d1TxIds.has(t.id));
  
  console.log(`In Prod D1, missing in Local: ${txInD1NotLocal.length}`);
  if (txInD1NotLocal.length > 0) {
      console.log("Sample D1 only:", txInD1NotLocal.slice(0, 3));
  }
  
  console.log(`In Local, missing in Prod D1: ${txInLocalNotD1.length}`);
  if (txInLocalNotD1.length > 0) {
      console.log("Sample Local only:", txInLocalNotD1.slice(0, 3));
  }
  
  console.log(`\n--- DIFFERENCES IN AUDITS ---`);
  const d1AuditIds = new Set(d1Audits.map(t => t.id));
  const localAuditIds = new Set(localAudits.map(t => t.id));
  
  const auditsInD1NotLocal = d1Audits.filter(t => !localAuditIds.has(t.id));
  const auditsInLocalNotD1 = localAudits.filter(t => !d1AuditIds.has(t.id));
  console.log(`In Prod D1, missing in Local: ${auditsInD1NotLocal.length}`);
  if (auditsInD1NotLocal.length > 0) console.log("Sample D1 only:", auditsInD1NotLocal.slice(0, 2));
  console.log(`In Local, missing in Prod D1: ${auditsInLocalNotD1.length}`);
  if (auditsInLocalNotD1.length > 0) console.log("Sample Local only:", auditsInLocalNotD1.slice(0, 2));
  
  console.log(`\n--- DIFFERENCES IN POs ---`);
  const d1PoIds = new Set(d1Po.map(t => t.id));
  const localPoIds = new Set(localPo.map(t => t.id));
  
  const poInD1NotLocal = d1Po.filter(t => !localPoIds.has(t.id));
  const poInLocalNotD1 = localPo.filter(t => !d1PoIds.has(t.id));
  console.log(`In Prod D1, missing in Local: ${poInD1NotLocal.length}`);
  console.log(`In Local, missing in Prod D1: ${poInLocalNotD1.length}`);
}

main().catch(console.error);
