async function main() {
  const resp = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT id, receivedAt, status FROM purchase_orders WHERE id IN ("PO-051", "PO-038", "PO-013")' })
  });
  const data = await resp.json();
  console.log(data.results);
}
main();
