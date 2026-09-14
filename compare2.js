const fs = require('fs');

async function queryD1(sql, params = []) {
  const BACKUP_BASE = 'https://bobacafe-proxy.davidgao734.workers.dev'
  const resp = await fetch(`${BACKUP_BASE}/d1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`)
  }
  const data = await resp.json()
  return data.results || []
}

async function main() {
  const [d1Ingredients, d1Recipes] = await Promise.all([
    queryD1("SELECT * FROM ingredients"),
    queryD1("SELECT * FROM recipes")
  ]);
  
  const localDataStr = fs.readFileSync('C:/Users/david/Downloads/inventory-debug-2026-09-14.json', 'utf8');
  const localFile = JSON.parse(localDataStr);
  
  const localIngredients = localFile.config.ingredients || [];
  const localRecipes = localFile.config.recipes || {};
  
  console.log(`\n--- COUNTS ---`);
  console.log(`Ingredients: Prod D1 = ${d1Ingredients.length}, Local = ${localIngredients.length}`);
  console.log(`Recipes:     Prod D1 = ${d1Recipes.length}, Local = ${Object.keys(localRecipes).length}`);
  
  console.log(`\n--- DIFFERENCES IN INGREDIENTS ---`);
  const d1IngMap = new Map(d1Ingredients.map(i => [i.id, i]));
  const localIngMap = new Map(localIngredients.map(i => [i.id, i]));
  
  for (const [id, d1i] of d1IngMap) {
    if (!localIngMap.has(id)) console.log(`In Prod D1, missing in Local: ${d1i.name}`);
    else {
      const loc = localIngMap.get(id);
      if (JSON.stringify(d1i) !== JSON.stringify(loc)) {
         console.log(`Difference in ${d1i.name}: D1 =`, d1i, 'Local =', loc);
      }
    }
  }
  for (const [id, loci] of localIngMap) {
    if (!d1IngMap.has(id)) console.log(`In Local, missing in Prod D1: ${loci.name}`);
  }
  
  console.log(`\n--- DIFFERENCES IN RECIPES ---`);
  // d1Recipes format: { product_name, type, ingredient_mapping: stringified_json }
  const d1RecipeMap = new Map();
  for (const r of d1Recipes) {
    if (r.type === 'retail') d1RecipeMap.set(r.product_name, JSON.parse(r.ingredient_mapping));
  }
  
  for (const [prodName, d1mapping] of d1RecipeMap) {
    if (!localRecipes[prodName]) {
      console.log(`In Prod D1, missing in Local: ${prodName}`);
    } else {
      const loc = localRecipes[prodName];
      if (JSON.stringify(d1mapping) !== JSON.stringify(loc)) {
         console.log(`Difference in ${prodName}: D1 =`, d1mapping, 'Local =', loc);
      }
    }
  }
  for (const prodName of Object.keys(localRecipes)) {
    if (!d1RecipeMap.has(prodName)) console.log(`In Local, missing in Prod D1: ${prodName}`);
  }

}

main().catch(console.error);
