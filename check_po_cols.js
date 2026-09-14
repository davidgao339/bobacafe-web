async function main() {
  const resp = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: "PRAGMA table_info('purchase_orders')" })
  });
  const data = await resp.json();
  console.log(data.results);
}
main();
