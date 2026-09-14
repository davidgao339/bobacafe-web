const sql = "SELECT count(*) FROM purchase_orders"
fetch("https://bobacafe-proxy-dev.davidgao734.workers.dev/d1/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sql })
}).then(res => res.json()).then(console.log).catch(console.error)
