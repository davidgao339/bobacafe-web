# -*- coding: utf-8 -*-
"""
Two-Echelon Model — Phase 2: Enforce by view
  1. view_current_inventory gains item_class + product_id (append-only, additive;
     existing named-column consumers unaffected)
  2. view_store_stock: non-WHS rows, classes finished/intermediate/store_only/dual_use
  3. view_whs_stock:   WHS rows only (what the warehouse physically holds)

Idempotent: CREATE OR REPLACE VIEW can be re-run any time.
Ledger: scratch/two_echelon_phase2_ledger.json
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT_DIR = Path(__file__).resolve().parent.parent
SECRETS_FILE = ROOT_DIR / ".streamlit" / "secrets.toml"

def load_credentials():
    import os
    token = os.environ.get("DATABRICKS_TOKEN")
    warehouse_id = os.environ.get("DATABRICKS_SQL_WAREHOUSE_ID")
    if not token or not warehouse_id:
        if SECRETS_FILE.exists():
            for line in SECRETS_FILE.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("token ="):
                    token = token or line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("warehouse_id ="):
                    warehouse_id = warehouse_id or line.split("=", 1)[1].strip().strip('"').strip("'")
    return token, warehouse_id

import os
DATABRICKS_URL = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com'
DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID = load_credentials()
LEDGER = ROOT_DIR / 'scratch' / 'two_echelon_phase2_ledger.json'

def run_databricks_sql(sql, retries=3):
    url = f"{DATABRICKS_URL}/api/2.0/sql/statements"
    payload = json.dumps({
        "statement": sql, "warehouse_id": DATABRICKS_WAREHOUSE_ID,
        "wait_timeout": "50s", "on_wait_timeout": "CONTINUE"
    }).encode("utf-8")
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {DATABRICKS_TOKEN}"}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            stmt_id = data.get("statement_id")
            state = data.get("status", {}).get("state")
            while state in ("PENDING", "RUNNING"):
                time.sleep(1.5)
                with urllib.request.urlopen(urllib.request.Request(
                        f"{url}/{stmt_id}", headers=headers), timeout=30) as poll_resp:
                    data = json.loads(poll_resp.read().decode("utf-8"))
                    state = data.get("status", {}).get("state")
            if state != "SUCCEEDED":
                err = data.get("status", {}).get("error", {})
                raise RuntimeError(f"Databricks SQL failed ({state}): {str(err.get('message', data))[:500]}")
            columns = [c["name"] for c in data.get("manifest", {}).get("schema", {}).get("columns", [])]
            rows = data.get("result", {}).get("data_array", [])
            return [dict(zip(columns, r)) for r in rows]
        except urllib.error.HTTPError as http_err:
            body = http_err.read().decode("utf-8", errors="replace")
            print(f"  [ERROR] HTTP {http_err.code} attempt {attempt+1}/{retries}: {body[:300]}")
            if attempt == retries - 1:
                raise
            time.sleep(2)

# view_current_inventory: original definition (2026-11-10) + item_class/product_id
# appended to the column list and the final SELECT. Nothing else changes.
VIEW_CURRENT_INVENTORY = """
CREATE OR REPLACE VIEW inventory_tabular.view_current_inventory (
  store_id, store_code, store_name,
  ingredient_id, ingredient_name, unit, is_hidden, is_warehouse_only,
  last_audit_id, last_audit_date, audit_quantity,
  net_movement_since_audit, pos_consumption_since_audit, po_receipts_since_audit,
  current_on_hand, current_on_hand_as_of_date,
  item_class, product_id
)
AS WITH latest_audit AS (
  SELECT c.store_id, c.ingredient_id, c.count_quantity, c.audit_id, c.audit_date, h.audit_timestamp,
         ROW_NUMBER() OVER (PARTITION BY c.store_id, c.ingredient_id
                            ORDER BY c.audit_date DESC, c.audit_id DESC) AS rn
  FROM workspace.inventory_tabular.fact_audit_counts c
  JOIN workspace.inventory_tabular.fact_audit_headers h ON h.audit_id = c.audit_id
  WHERE h.status != 'rejected'
),
baseline AS (
  SELECT store_id, ingredient_id, count_quantity, audit_id, audit_date,
         CAST(CASE WHEN audit_timestamp LIKE concat(audit_date, '%')
                   THEN audit_timestamp
                   ELSE concat(audit_date, 'T23:59:59') END AS TIMESTAMP) AS cut_ts
  FROM latest_audit WHERE rn = 1
),
pos_consumption AS (
  SELECT m.store_id, r.ingredient_id, m.pos_ts,
         SUM(m.qty * r.amount_per_serving) AS consumed_qty
  FROM (
    SELECT t.datetime AS pos_ts, t.product, t.qty,
           CASE t.store_name
             WHEN 'НОВО КП' THEN 1 WHEN 'ГРИН ПАРК' THEN 2 WHEN 'БОН ПАССАЖ' THEN 3
             WHEN 'ЧЕРНОМОРСКИЙ' THEN 4 WHEN 'СОВЕТОВ' THEN 5 WHEN 'ГАЛЕРЕЯ' THEN 6
             WHEN 'ОЗМОЛЛ' THEN 10 WHEN 'КИОСК' THEN 13 WHEN 'АНАПА' THEN 11 WHEN 'ГЕЛЕНДЖИК' THEN 12
           END AS store_id
    FROM workspace.default.transactions t
    -- Business rule: a returned drink still consumed its syrup. Count gross sales only.
    WHERE NOT COALESCE(t.is_return, FALSE)
      AND t.qty > 0
  ) m
  JOIN workspace.inventory_tabular.fact_recipe_ingredients r
    ON r.recipe_product_name = m.product AND r.recipe_type = 'retail'
  WHERE m.store_id IS NOT NULL
  GROUP BY m.store_id, r.ingredient_id, m.pos_ts
),
po_receipts AS (
  SELECT po.store_id, pol.ingredient_id,
         COALESCE(try_cast(po.received_at AS TIMESTAMP),
                  CAST(concat(po.received_date, 'T12:00:00') AS TIMESTAMP)) AS po_ts,
         COALESCE(pol.received_quantity, pol.ordered_quantity, 0) AS received_qty
  FROM workspace.inventory_tabular.fact_purchase_orders po
  JOIN workspace.inventory_tabular.fact_purchase_order_lines pol ON pol.po_id = po.po_id
  LEFT JOIN (SELECT DISTINCT po_id FROM workspace.inventory_tabular.fact_inventory_transactions
             WHERE po_id IS NOT NULL) tx ON tx.po_id = po.po_id
  WHERE po.status IN ('received', 'partially_received')
    AND tx.po_id IS NULL
    AND NOT (po.from_store_id IS NOT NULL AND po.to_store_id IS NOT NULL)
),
tx_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE
           WHEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END > b.cut_ts
           THEN t.quantity END), 0) AS net_movement_since_audit,
         MAX(CASE
           WHEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END > b.cut_ts
           THEN CASE WHEN t.transaction_type = 'adjustment' AND t.po_id IS NOT NULL
                     THEN COALESCE(try_cast(po.received_at AS TIMESTAMP),
                                  CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP))
                     ELSE CAST(concat(t.transaction_date, 'T12:00:00') AS TIMESTAMP) END
           END) AS last_tx_ts
  FROM baseline b
  LEFT JOIN workspace.inventory_tabular.fact_inventory_transactions t
    ON t.store_id = b.store_id AND t.ingredient_id = b.ingredient_id
  LEFT JOIN workspace.inventory_tabular.fact_purchase_orders po ON po.po_id = t.po_id
  GROUP BY b.store_id, b.ingredient_id
),
pos_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE WHEN p.pos_ts > b.cut_ts THEN p.consumed_qty END), 0) AS pos_consumption_since_audit,
         MAX(CASE WHEN p.pos_ts > b.cut_ts THEN p.pos_ts END) AS last_pos_ts
  FROM baseline b
  LEFT JOIN pos_consumption p
    ON p.store_id = b.store_id AND p.ingredient_id = b.ingredient_id
  GROUP BY b.store_id, b.ingredient_id
),
po_movements AS (
  SELECT b.store_id, b.ingredient_id,
         COALESCE(SUM(CASE WHEN pr.po_ts > b.cut_ts THEN pr.received_qty END), 0) AS po_receipts_since_audit,
         MAX(CASE WHEN pr.po_ts > b.cut_ts THEN pr.po_ts END) AS last_po_ts
  FROM baseline b
  LEFT JOIN po_receipts pr
    ON pr.store_id = b.store_id AND pr.ingredient_id = b.ingredient_id
  GROUP BY b.store_id, b.ingredient_id
)
SELECT
  b.store_id,
  s.store_code,
  s.store_name,
  b.ingredient_id,
  i.ingredient_name,
  i.unit,
  i.is_hidden,
  i.is_warehouse_only,
  b.audit_id AS last_audit_id,
  b.audit_date AS last_audit_date,
  b.count_quantity AS audit_quantity,
  tx.net_movement_since_audit,
  pos.pos_consumption_since_audit,
  po.po_receipts_since_audit,
  b.count_quantity + tx.net_movement_since_audit - pos.pos_consumption_since_audit + po.po_receipts_since_audit AS current_on_hand,
  CAST(COALESCE(GREATEST(tx.last_tx_ts, pos.last_pos_ts, po.last_po_ts), CAST(b.audit_date AS TIMESTAMP)) AS DATE) AS current_on_hand_as_of_date
FROM baseline b
JOIN workspace.inventory_tabular.dim_stores s ON s.store_id = b.store_id
JOIN workspace.inventory_tabular.dim_ingredients i ON i.ingredient_id = b.ingredient_id
JOIN tx_movements tx ON tx.store_id = b.store_id AND tx.ingredient_id = b.ingredient_id
JOIN pos_movements pos ON pos.store_id = b.store_id AND pos.ingredient_id = b.ingredient_id
JOIN po_movements po ON po.store_id = b.store_id AND po.ingredient_id = b.ingredient_id
-- Only active stores belong in "current" inventory; closed stores' closing stock stays in the base tables
WHERE s.is_active
"""

# We append item_class / product_id strictly AFTER the last original SELECT
# expression so positional mapping matches the declared column list.
VIEW_CURRENT_INVENTORY = VIEW_CURRENT_INVENTORY.replace(
    "  CAST(COALESCE(GREATEST(tx.last_tx_ts, pos.last_pos_ts, po.last_po_ts), CAST(b.audit_date AS TIMESTAMP)) AS DATE) AS current_on_hand_as_of_date\n",
    "  CAST(COALESCE(GREATEST(tx.last_tx_ts, pos.last_pos_ts, po.last_po_ts), CAST(b.audit_date AS TIMESTAMP)) AS DATE) AS current_on_hand_as_of_date,\n"
    "  i.item_class AS item_class,\n"
    "  i.product_id AS product_id\n",
)

VIEW_STORE_STOCK = """
CREATE OR REPLACE VIEW inventory_tabular.view_store_stock (
  store_id, store_code, store_name,
  ingredient_id, ingredient_name, unit, is_hidden,
  item_class, product_id,
  last_audit_id, last_audit_date, audit_quantity,
  net_movement_since_audit, pos_consumption_since_audit, po_receipts_since_audit,
  current_on_hand, current_on_hand_as_of_date
)
AS SELECT
  v.store_id, v.store_code, v.store_name,
  v.ingredient_id, v.ingredient_name, v.unit, v.is_hidden,
  v.item_class, v.product_id,
  v.last_audit_id, v.last_audit_date, v.audit_quantity,
  v.net_movement_since_audit, v.pos_consumption_since_audit, v.po_receipts_since_audit,
  v.current_on_hand, v.current_on_hand_as_of_date
FROM workspace.inventory_tabular.view_current_inventory v
WHERE v.store_code != 'WHS'
  AND v.item_class IN ('finished', 'intermediate', 'store_only', 'dual_use')
"""

VIEW_WHS_STOCK = """
CREATE OR REPLACE VIEW inventory_tabular.view_whs_stock (
  ingredient_id, ingredient_name, unit, is_hidden,
  item_class, product_id,
  last_audit_id, last_audit_date, audit_quantity,
  net_movement_since_audit, pos_consumption_since_audit, po_receipts_since_audit,
  current_on_hand, current_on_hand_as_of_date
)
AS SELECT
  v.ingredient_id, v.ingredient_name, v.unit, v.is_hidden,
  v.item_class, v.product_id,
  v.last_audit_id, v.last_audit_date, v.audit_quantity,
  v.net_movement_since_audit, v.pos_consumption_since_audit, v.po_receipts_since_audit,
  v.current_on_hand, v.current_on_hand_as_of_date
FROM workspace.inventory_tabular.view_current_inventory v
WHERE v.store_code = 'WHS'
  AND v.item_class IN ('whs_only', 'dual_use', 'intermediate', 'finished')
"""

def main():
    print("=" * 70)
    print("TWO-ECHELON PHASE 2: ENFORCE BY VIEW")
    print("=" * 70)

    # 1. view_current_inventory — additive extension
    run_databricks_sql(VIEW_CURRENT_INVENTORY)
    print("view_current_inventory recreated (added item_class, product_id)")

    # 2. Echelon views
    run_databricks_sql(VIEW_STORE_STOCK)
    print("view_store_stock created")
    run_databricks_sql(VIEW_WHS_STOCK)
    print("view_whs_stock created")

    # 3. Verification
    out = {}
    # class coverage in the base view
    counts = run_databricks_sql("""
        SELECT item_class, COUNT(*) AS rows FROM workspace.inventory_tabular.view_current_inventory
        GROUP BY item_class ORDER BY item_class""")
    print("\nview_current_inventory rows by class:", json.dumps([(r["item_class"], int(r["rows"])) for r in counts]))
    out["class_counts"] = counts

    # store view must never return anything WHS-flavored
    leak = run_databricks_sql("""
        SELECT ingredient_name, item_class FROM workspace.inventory_tabular.view_store_stock
        WHERE item_class NOT IN ('finished','intermediate','store_only','dual_use')""")
    print(f"store-view class leak: {len(leak)} rows")
    out["store_view_leak"] = leak

    flour = run_databricks_sql("""
        SELECT ingredient_name FROM workspace.inventory_tabular.view_store_stock
        WHERE ingredient_name LIKE '%Мука%' OR ingredient_name LIKE '%крахмал%'""")
    print(f"store-view raw-material leak (мука/крахмал): {len(flour)} rows")
    out["store_view_flour"] = flour

    # tapioca must appear in BOTH views (the dual-zone item)
    tapioca = run_databricks_sql("""
        SELECT 'store' AS zone, COUNT(*) AS rows FROM workspace.inventory_tabular.view_store_stock WHERE ingredient_name = 'Тапиока в шариках'
        UNION ALL
        SELECT 'whs', COUNT(*) FROM workspace.inventory_tabular.view_whs_stock WHERE ingredient_name = 'Тапиока в шариках'""")
    print("tapioca presence:", json.dumps([(r["zone"], int(r["rows"])) for r in tapioca]))
    out["tapioca"] = tapioca

    store_counts = run_databricks_sql("""
        SELECT item_class, COUNT(*) AS rows FROM workspace.inventory_tabular.view_store_stock
        GROUP BY item_class ORDER BY item_class""")
    print("view_store_stock rows by class:", json.dumps([(r["item_class"], int(r["rows"])) for r in store_counts]))
    out["store_counts"] = store_counts

    whs_counts = run_databricks_sql("""
        SELECT item_class, COUNT(*) AS rows FROM workspace.inventory_tabular.view_whs_stock
        GROUP BY item_class ORDER BY item_class""")
    print("view_whs_stock rows by class:", json.dumps([(r["item_class"], int(r["rows"])) for r in whs_counts]))
    out["whs_counts"] = whs_counts

    Path(LEDGER).write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\nledger -> {LEDGER}")

if __name__ == "__main__":
    main()
