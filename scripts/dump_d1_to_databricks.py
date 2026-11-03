"""
Dumps all tables from Cloudflare D1 into Databricks Delta Lake under `workspace.inventory`.
Tables:
  - workspace.inventory.ingredients
  - workspace.inventory.recipes
  - workspace.inventory.suppliers
  - workspace.inventory.purchase_orders
  - workspace.inventory.transactions
  - workspace.inventory.audits
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

# Paths & Config
ROOT_DIR = Path(__file__).resolve().parent.parent
SECRETS_FILE = ROOT_DIR / ".streamlit" / "secrets.toml"

WORKSPACE_URL = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
D1_PROXY_URL = "https://bobacafe-proxy.davidgao734.workers.dev/d1/execute"

# Load Databricks credentials
def load_credentials():
    token = os.environ.get("DATABRICKS_TOKEN")
    warehouse_id = os.environ.get("DATABRICKS_SQL_WAREHOUSE_ID")
    
    if not token or not warehouse_id:
        if SECRETS_FILE.exists():
            content = SECRETS_FILE.read_text(encoding="utf-8")
            for line in content.splitlines():
                line = line.strip()
                if line.startswith("token ="):
                    token = token or line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("warehouse_id ="):
                    warehouse_id = warehouse_id or line.split("=", 1)[1].strip().strip('"').strip("'")
                    
    if not token or not warehouse_id:
        raise ValueError("Missing Databricks token or warehouse_id in environment or .streamlit/secrets.toml")
        
    return token, warehouse_id

# Databricks SQL execution
def run_databricks_sql(token: str, warehouse_id: str, sql: str, retries: int = 3):
    url = f"{WORKSPACE_URL}/api/2.0/sql/statements"
    payload = json.dumps({
        "statement": sql,
        "warehouse_id": warehouse_id,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE"
    }).encode("utf-8")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }

    for attempt in range(retries):
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            
            stmt_id = data.get("statement_id")
            state = data.get("status", {}).get("state")
            
            # If still pending / running, poll until complete
            while state in ("PENDING", "RUNNING"):
                time.sleep(2)
                poll_req = urllib.request.Request(f"{url}/{stmt_id}", headers=headers)
                with urllib.request.urlopen(poll_req, timeout=30) as poll_resp:
                    data = json.loads(poll_resp.read().decode("utf-8"))
                    state = data.get("status", {}).get("state")
            
            if state != "SUCCEEDED":
                err = data.get("status", {}).get("error", {})
                raise RuntimeError(f"Databricks SQL failed ({state}): {err.get('message', data)}")
                
            return data
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  [Retry {attempt+1}/{retries}] Databricks error: {e}. Retrying in 3s...", file=sys.stderr)
            time.sleep(3)

# D1 query execution
def query_d1(sql: str, params: list = None):
    payload = json.dumps({"sql": sql, "params": params or []}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    req = urllib.request.Request(D1_PROXY_URL, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("success"):
        raise RuntimeError(f"D1 error: {data}")
    return data.get("results", [])

# Table definitions and column mapping
TABLE_SPECS = {
    "ingredients": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.ingredients (
                id INT,
                name STRING,
                unit STRING,
                productType STRING,
                supplierId INT,
                hidden BOOLEAN,
                warehouseOnly BOOLEAN
            ) USING DELTA
        """,
        "columns": [
            ("id", "INT"),
            ("name", "STRING"),
            ("unit", "STRING"),
            ("productType", "STRING"),
            ("supplierId", "INT"),
            ("hidden", "BOOLEAN"),
            ("warehouseOnly", "BOOLEAN")
        ]
    },
    "recipes": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.recipes (
                product_name STRING,
                type STRING,
                ingredient_mapping STRING,
                hidden BOOLEAN
            ) USING DELTA
        """,
        "columns": [
            ("product_name", "STRING"),
            ("type", "STRING"),
            ("ingredient_mapping", "STRING"),
            ("hidden", "BOOLEAN")
        ]
    },
    "suppliers": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.suppliers (
                id INT,
                name STRING
            ) USING DELTA
        """,
        "columns": [
            ("id", "INT"),
            ("name", "STRING")
        ]
    },
    "purchase_orders": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.purchase_orders (
                id STRING,
                store STRING,
                status STRING,
                receivedAt STRING,
                fromLocation STRING,
                toLocation STRING,
                createdDate STRING,
                sentDate STRING,
                lines STRING
            ) USING DELTA
        """,
        "columns": [
            ("id", "STRING"),
            ("store", "STRING"),
            ("status", "STRING"),
            ("receivedAt", "STRING"),
            ("fromLocation", "STRING"),
            ("toLocation", "STRING"),
            ("createdDate", "STRING"),
            ("sentDate", "STRING"),
            ("lines", "STRING")
        ]
    },
    "transactions": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.transactions (
                id STRING,
                store STRING,
                date STRING,
                type STRING,
                ingredientId INT,
                quantity DOUBLE,
                poId STRING,
                reason STRING,
                timestamp STRING
            ) USING DELTA
        """,
        "columns": [
            ("id", "STRING"),
            ("store", "STRING"),
            ("date", "STRING"),
            ("type", "STRING"),
            ("ingredientId", "INT"),
            ("quantity", "DOUBLE"),
            ("poId", "STRING"),
            ("reason", "STRING"),
            ("timestamp", "STRING")
        ]
    },
    "audits": {
        "create_sql": """
            CREATE OR REPLACE TABLE workspace.inventory.audits (
                id STRING,
                store STRING,
                date STRING,
                counts STRING,
                status STRING,
                timestamp STRING
            ) USING DELTA
        """,
        "columns": [
            ("id", "STRING"),
            ("store", "STRING"),
            ("date", "STRING"),
            ("counts", "STRING"),
            ("status", "STRING"),
            ("timestamp", "STRING")
        ]
    }
}

def format_sql_literal(val, col_type):
    if val is None:
        return "NULL"
    if col_type == "BOOLEAN":
        return "TRUE" if bool(val) and val not in (0, "0", False) else "FALSE"
    if col_type == "INT":
        try:
            return str(int(val))
        except (ValueError, TypeError):
            return "NULL"
    if col_type == "DOUBLE":
        try:
            return str(float(val))
        except (ValueError, TypeError):
            return "NULL"
    # String type: double up single quotes, handle null bytes
    s = str(val).replace("\x00", "").replace("'", "''")
    return f"'{s}'"

def sync_table(token: str, warehouse_id: str, table_name: str, spec: dict):
    print(f"\n[1/3] Fetching '{table_name}' from Cloudflare D1...")
    rows = query_d1(f"SELECT * FROM {table_name}")
    print(f"      Retrieved {len(rows)} rows from D1.")
    
    print(f"[2/3] Re-creating Delta table 'workspace.inventory.{table_name}' in Databricks...")
    run_databricks_sql(token, warehouse_id, spec["create_sql"])
    
    if not rows:
        print(f"      No rows to insert for '{table_name}'. Done.")
        return
        
    print(f"[3/3] Inserting {len(rows)} rows into 'workspace.inventory.{table_name}'...")
    cols = spec["columns"]
    batch_size = 150
    inserted = 0
    
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        value_tuples = []
        for r in chunk:
            tuple_literals = []
            for col_name, col_type in cols:
                raw_val = r.get(col_name)
                tuple_literals.append(format_sql_literal(raw_val, col_type))
            value_tuples.append(f"({', '.join(tuple_literals)})")
            
        col_names_str = ", ".join([c[0] for c in cols])
        insert_sql = f"INSERT INTO workspace.inventory.{table_name} ({col_names_str}) VALUES\n" + ",\n".join(value_tuples)
        run_databricks_sql(token, warehouse_id, insert_sql)
        inserted += len(chunk)
        print(f"      Inserted {inserted}/{len(rows)} rows...")

    # Verification count
    res = run_databricks_sql(token, warehouse_id, f"SELECT count(*) as cnt FROM workspace.inventory.{table_name}")
    dbx_cnt = res.get("result", {}).get("data_array", [[0]])[0][0]
    print(f"  --> Verification: D1={len(rows)} rows | Databricks={dbx_cnt} rows.")

def main():
    print("=" * 60)
    print("Cloudflare D1 -> Databricks Delta Lake Sync (`workspace.inventory`)")
    print("=" * 60)
    
    token, warehouse_id = load_credentials()
    print(f"Databricks Target: {WORKSPACE_URL}")
    print(f"Warehouse ID:      {warehouse_id}")
    print(f"D1 Proxy:          {D1_PROXY_URL}")
    
    # Ensure schema exists
    print("\nEnsuring schema `workspace.inventory` exists...")
    run_databricks_sql(token, warehouse_id, "CREATE SCHEMA IF NOT EXISTS workspace.inventory")
    print("Schema `workspace.inventory` is ready.")
    
    start_time = time.time()
    for table_name, spec in TABLE_SPECS.items():
        sync_table(token, warehouse_id, table_name, spec)
        
    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"ALL 6 TABLES DUMPED SUCCESSFULLY IN {elapsed:.1f}s!")
    print("Catalog & Schema: workspace.inventory.*")
    print("=" * 60)

if __name__ == "__main__":
    main()
