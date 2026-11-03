import urllib.request
import json
import time
import sys
import os

from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent.parent
SECRETS_FILE = ROOT_DIR / ".streamlit" / "secrets.toml"

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
    return token, warehouse_id or '959d56e804ae9b36'

WORKSPACE_URL = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com'
TOKEN, WAREHOUSE_ID = load_credentials()

def run_sql(sql: str, retries: int = 3):
    url = f"{WORKSPACE_URL}/api/2.0/sql/statements"
    payload = json.dumps({
        "statement": sql,
        "warehouse_id": WAREHOUSE_ID,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE"
    }).encode("utf-8")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}"
    }

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            
            stmt_id = data.get("statement_id")
            state = data.get("status", {}).get("state")
            
            while state in ("PENDING", "RUNNING"):
                time.sleep(2)
                poll_req = urllib.request.Request(f"{url}/{stmt_id}", headers=headers)
                with urllib.request.urlopen(poll_req, timeout=30) as poll_resp:
                    data = json.loads(poll_resp.read().decode("utf-8"))
                    state = data.get("status", {}).get("state")
            
            if state != "SUCCEEDED":
                err = data.get("status", {}).get("error", {})
                raise RuntimeError(f"Databricks SQL failed ({state}): {err.get('message', data)}")
                
            manifest = data.get("manifest", {})
            schema = manifest.get("schema", {})
            columns = [c["name"] for c in schema.get("columns", [])]
            rows = data.get("result", {}).get("data_array", [])
            return [dict(zip(columns, r)) for r in rows]
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  [Retry {attempt+1}/{retries}] SQL error: {e}. Retrying...", file=sys.stderr)
            time.sleep(3)

print("=== MIGRATING workspace.gold.dim_product ===")

# Step 1: Create backup
print("[1/4] Creating backup table workspace.gold.dim_product_backup...")
run_sql("CREATE OR REPLACE TABLE workspace.gold.dim_product_backup AS SELECT * FROM workspace.gold.dim_product")
bkp_cnt = run_sql("SELECT count(*) as cnt FROM workspace.gold.dim_product_backup")[0]["cnt"]
print(f"  Backup created with {bkp_cnt} rows.")

# Step 2: Create new DDL
print("[2/4] Creating new schema for workspace.gold.dim_product with INT product_id and INT parent_product_id...")
ddl_sql = """
CREATE OR REPLACE TABLE workspace.gold.dim_product (
    product_id INT NOT NULL COMMENT 'Primary key integer product variant ID (1..444)',
    parent_product_id INT NOT NULL COMMENT 'Parent menu item grouping integer ID (1..440)',
    product_ru STRING NOT NULL COMMENT 'Full Russian product name matching POS sales & inventory recipes',
    parent_product_en STRING COMMENT 'English parent product name for Genie queries',
    parent_product_ru STRING COMMENT 'Russian parent product name',
    variant STRING COMMENT 'Product variant (e.g. Standard, Large Cup 500ml)',
    category STRING COMMENT 'POS product category (e.g. Drinks, Pastry, Dessert)',
    subcategory STRING COMMENT 'POS product subcategory (e.g. Milk Tea, Fruit Tea)',
    is_modifier BOOLEAN COMMENT 'True if topping/modifier add-on',
    base_price DOUBLE COMMENT 'Retail menu price in RUB',
    cost FLOAT COMMENT 'Standard unit cost in RUB',
    is_active BOOLEAN COMMENT 'True if product is currently active',
    updated_at TIMESTAMP COMMENT 'Last update timestamp',
    parent_slug STRING COMMENT 'Legacy string slug (e.g. prod_bubble_tea_mango_island) preserved for reference'
) USING DELTA COMMENT 'Canonical product catalog with integer product_id and parent_product_id'
"""
run_sql(ddl_sql)
print("  Table created successfully.")

# Step 3: Populate with deduplication and integer IDs
print("[3/4] Inserting deduplicated rows with integer IDs...")
insert_sql = """
INSERT INTO workspace.gold.dim_product
WITH deduped AS (
    SELECT
        parent_product_id AS old_parent_slug,
        product_ru,
        parent_product_en,
        parent_product_ru,
        COALESCE(variant, 'Standard') AS variant,
        category,
        subcategory,
        is_modifier,
        base_price,
        cost,
        is_active,
        updated_at,
        ROW_NUMBER() OVER (
            PARTITION BY product_ru, COALESCE(variant, 'Standard')
            ORDER BY updated_at DESC
        ) AS rn
    FROM workspace.gold.dim_product_backup
),
clean AS (
    SELECT * FROM deduped WHERE rn = 1
)
SELECT
    CAST(ROW_NUMBER() OVER (ORDER BY category, subcategory, old_parent_slug, product_ru) AS INT) AS product_id,
    CAST(DENSE_RANK() OVER (ORDER BY category, subcategory, old_parent_slug) AS INT) AS parent_product_id,
    product_ru,
    parent_product_en,
    parent_product_ru,
    variant,
    category,
    subcategory,
    is_modifier,
    base_price,
    cost,
    is_active,
    updated_at,
    old_parent_slug AS parent_slug
FROM clean
"""
run_sql(insert_sql)
new_cnt = run_sql("SELECT count(*) as cnt FROM workspace.gold.dim_product")[0]["cnt"]
print(f"  Inserted {new_cnt} clean deduplicated products.")

# Step 4: Verification
print("[4/4] Verifying table...")
sample = run_sql("SELECT product_id, parent_product_id, product_ru, parent_product_en, variant, category FROM workspace.gold.dim_product ORDER BY product_id LIMIT 5")
print("Sample rows:")
for r in sample:
    print(f"  id={r['product_id']} | parent_id={r['parent_product_id']} | {r['product_ru']} | cat={r['category']}")

null_checks = run_sql("SELECT count(*) as null_pids FROM workspace.gold.dim_product WHERE product_id IS NULL OR parent_product_id IS NULL")[0]["null_pids"]
print(f"Null product_id or parent_product_id count: {null_checks}")

print("\n=== MIGRATION COMPLETED SUCCESSFULLY ===")

