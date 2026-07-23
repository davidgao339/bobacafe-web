import json, urllib.request, sys

WORKSPACE    = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
TOKEN        = ""  # your Databricks PAT token (dapi...)
WAREHOUSE_ID = ""  # SQL warehouse ID
OUTPUT_PATH  = "inventory-app/src/data/sales-data.json"

stores_sql = "'НОВО КП', 'ГРИН ПАРК', 'БОН ПАССАЖ'"
query = f"""
    SELECT
        CAST(date AS STRING)     AS date,
        store,
        product,
        CAST(SUM(qty) AS DOUBLE) AS qty
    FROM workspace.default.product_sales_v2
    WHERE store IN ({stores_sql})
      AND date >= '2026-05-01'
      AND date <= '2026-05-26'
      AND qty > 0
    GROUP BY date, store, product
    ORDER BY date DESC, store, product
"""

payload = json.dumps({
    "statement": query,
    "warehouse_id": WAREHOUSE_ID,
    "wait_timeout": "50s",
    "on_wait_timeout": "CANCEL",
}).encode()

req = urllib.request.Request(
    f"{WORKSPACE}/api/2.0/sql/statements",
    data=payload,
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode(), file=sys.stderr)
    sys.exit(1)

state = result.get("status", {}).get("state")
if state != "SUCCEEDED":
    print("SQL error:", json.dumps(result.get("status"), indent=2), file=sys.stderr)
    sys.exit(1)

cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
rows = result.get("result", {}).get("data_array", [])
data = [dict(zip(cols, row)) for row in rows]

with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Written {len(data):,} rows to {OUTPUT_PATH}")
print("Distinct products:")
products = sorted(set(r["product"] for r in data))
for p in products:
    print(f"  {p}")
