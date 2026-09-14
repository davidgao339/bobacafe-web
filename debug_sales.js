const fs = require('fs');

async function main() {
  const f = JSON.parse(fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8'));
  const sales = f.salesCache.data || [];
  console.log('Total sales:', sales.length);
  
  const bonSales = sales.filter(s => s.store === 'БОН ПАССАЖ');
  console.log('Sales for БОН ПАССАЖ:', bonSales.length);

  const q = async (sql) => {
    const res = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    return (await res.json()).results;
  };
  const recRes = await q("SELECT * FROM recipes WHERE type = 'retail'");
  const recipes = Object.fromEntries(recRes.map(r => [r.product_name, JSON.parse(r.ingredient_mapping)]));
  
  let totalConsumed = 0;
  bonSales.forEach(s => {
    const consumed = s.quantity * (recipes[s.product]?.[18] ?? 0);
    totalConsumed += consumed;
  });
  console.log('Total milk consumed at БОН ПАССАЖ:', totalConsumed);
}
main();
