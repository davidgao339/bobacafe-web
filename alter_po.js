async function main() {
  const resp1 = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: "ALTER TABLE purchase_orders ADD COLUMN createdDate TEXT" })
  });
  console.log(await resp1.json());

  const resp2 = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: "ALTER TABLE purchase_orders ADD COLUMN sentDate TEXT" })
  });
  console.log(await resp2.json());
}
main();
