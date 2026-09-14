const fs = require('fs');
async function check() {
  const f = JSON.parse(fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8'));
  const bonSales = (f.salesCache.rows || []).filter(s => s.store === 'БОН ПАССАЖ');
  
  const q = async sql => (await (await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', { 
    method: 'POST', 
    headers: {'Content-Type':'application/json'}, 
    body: JSON.stringify({sql}) 
  })).json()).results;
  
  const allRecipes = await q('SELECT * FROM recipes');
  const retailRecipes = await q("SELECT * FROM recipes WHERE type = 'retail'");
  
  const parse = res => Object.fromEntries(res.map(r => [r.product_name, JSON.parse(r.ingredient_mapping)]));
  const allMap = parse(allRecipes);
  const retailMap = parse(retailRecipes);
  
  let allConsumed = 0;
  let retailConsumed = 0;
  
  let badProducts = [];
  
  bonSales.forEach(s => {
    const qty = parseFloat(s.qty ?? 0);
    allConsumed += qty * (allMap[s.product]?.[18] ?? 0);
    retailConsumed += qty * (retailMap[s.product]?.[18] ?? 0);
    if (!retailMap[s.product] && allMap[s.product]) {
      badProducts.push(s.product);
    }
  });
  
  console.log('Milk consumed (All recipes):', allConsumed);
  console.log('Milk consumed (Retail only):', retailConsumed);
  console.log('Products in all but not retail:', [...new Set(badProducts)]);
}
check();
