async function queryD1(sql, params = []) {
  const resp = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });
  if (!resp.ok) throw new Error(resp.status);
  const data = await resp.json();
  return data.results || [];
}
async function test() {
  try {
    const [ingRes, recRes, suppRes, txRes, poRes, audRes] = await Promise.all([
      queryD1('SELECT * FROM ingredients'),
      queryD1("SELECT * FROM recipes WHERE type = 'retail'"),
      queryD1('SELECT * FROM suppliers'),
      queryD1('SELECT * FROM transactions'),
      queryD1('SELECT * FROM purchase_orders'),
      queryD1('SELECT * FROM audits')
    ]);
    console.log('Ingredients count:', ingRes.length);
    console.log('Recipes count:', recRes.length);
    const recipes = Object.fromEntries(recRes.map(r => [r.product_name, JSON.parse(r.ingredient_mapping)]));
    const nextIngId = Math.max(0, ...ingRes.map(i => i.id)) + 1;
    const pos = poRes.map(po => ({...po, lines: JSON.parse(po.lines)}));
    const auds = audRes.map(a => ({...a, counts: JSON.parse(a.counts)}));
    console.log('SUCCESS');
  } catch (e) {
    console.error('ERROR:', e);
  }
}
test();
