async function main() {
  const q = async (sql) => {
    const res = await fetch('https://bobacafe-proxy.davidgao734.workers.dev/d1/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    return (await res.json()).results;
  };

  const tables = await q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const schema = {};
  for (const t of tables) {
    schema[t.name] = await q(`PRAGMA table_info('${t.name}')`);
  }
  console.log(JSON.stringify(schema, null, 2));
}
main();
