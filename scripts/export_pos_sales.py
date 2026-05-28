"""
Export recent sales from Databricks product_sales_v2 → inventory-app/src/data/sales-data.json

Run by the nightly GitHub Actions workflow. Requires:
  DATABRICKS_CLIENT_ID      — OAuth service-principal client ID
  DATABRICKS_CLIENT_SECRET  — OAuth service-principal client secret
  DATABRICKS_SQL_WAREHOUSE_ID — SQL warehouse ID (from Databricks workspace UI)

Usage (local):
  export DATABRICKS_CLIENT_ID=...
  export DATABRICKS_CLIENT_SECRET=...
  export DATABRICKS_SQL_WAREHOUSE_ID=...
  python scripts/export_pos_sales.py
"""

import json
import os
import sys
import urllib.parse
import urllib.request

WORKSPACE     = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
TARGET_STORES = ["НОВО КП", "ГРИН ПАРК", "БОН ПАССАЖ"]
LOOKBACK_DAYS = 30
OUTPUT_PATH   = "inventory-app/src/data/sales-data.json"


def get_oauth_token(client_id: str, client_secret: str) -> str:
    import base64
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    body  = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()
    req   = urllib.request.Request(
        f"{WORKSPACE}/oidc/v1/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def run_sql(token: str, warehouse_id: str, statement: str) -> list[dict]:
    """Execute a SQL statement and return rows as list of dicts."""
    payload = json.dumps({
        "statement":     statement,
        "warehouse_id":  warehouse_id,
        "wait_timeout":  "50s",
        "on_wait_timeout": "CANCEL",
    }).encode()
    req = urllib.request.Request(
        f"{WORKSPACE}/api/2.0/sql/statements",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())

    if result.get("status", {}).get("state") != "SUCCEEDED":
        print("SQL error:", json.dumps(result.get("status"), indent=2), file=sys.stderr)
        sys.exit(1)

    cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
    rows = result.get("result", {}).get("data_array", [])
    return [dict(zip(cols, row)) for row in rows]


def main():
    client_id     = os.environ.get("DATABRICKS_CLIENT_ID", "")
    client_secret = os.environ.get("DATABRICKS_CLIENT_SECRET", "")
    warehouse_id  = os.environ.get("DATABRICKS_SQL_WAREHOUSE_ID", "")

    if not all([client_id, client_secret, warehouse_id]):
        print(
            "Missing env vars. Set DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, "
            "and DATABRICKS_SQL_WAREHOUSE_ID.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Authenticating with Databricks...")
    token = get_oauth_token(client_id, client_secret)

    stores_sql = ", ".join(f"'{s}'" for s in TARGET_STORES)
    query = f"""
        SELECT
            CAST(date AS STRING)        AS date,
            store,
            product,
            CAST(SUM(qty) AS DOUBLE)    AS qty
        FROM workspace.default.product_sales_v2
        WHERE store IN ({stores_sql})
          AND date >= DATEADD(DAY, -{LOOKBACK_DAYS}, CURRENT_DATE())
          AND qty > 0
        GROUP BY date, store, product
        ORDER BY date DESC, store, product
    """

    print(f"Querying last {LOOKBACK_DAYS} days of product_sales_v2...")
    rows = run_sql(token, warehouse_id, query)
    print(f"  {len(rows):,} rows returned")

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
