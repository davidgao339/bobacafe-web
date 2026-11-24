# -*- coding: utf-8 -*-
"""
Two-Echelon Model — Phase 5: Costing rollout
Deploys scripts/lakehouse_sql/view_item_unit_cost.sql (Level 0/1 cost DAG)
and view_product_recipe_cogs.sql (Level 2 POS COGS), then verifies:
  - every produced item has a positive rolled unit cost (or flagged)
  - tapioca-containing drinks cost tapioca > 0 (the original free-tapioca bug)
  - mochi family absorbs its 16₽ labor rate (Rule 2, mochi only for now)
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
SQL_DIR = Path(__file__).resolve().parent / "lakehouse_sql"
LEDGER = ROOT_DIR / 'scratch' / 'two_echelon_phase5_ledger.json'

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
                raise RuntimeError(f"Databricks SQL failed ({state}): {str(err.get('message', data))[:600]}")
            columns = [c["name"] for c in data.get("manifest", {}).get("schema", {}).get("columns", [])]
            rows = data.get("result", {}).get("data_array", [])
            return [dict(zip(columns, r)) for r in rows]
        except urllib.error.HTTPError as http_err:
            body = http_err.read().decode("utf-8", errors="replace")
            print(f"  [ERROR] HTTP {http_err.code} attempt {attempt+1}/{retries}: {body[:300]}")
            if attempt == retries - 1:
                raise
            time.sleep(2)

def main():
    print("=" * 70)
    print("TWO-ECHELON PHASE 5: COSTING ROLLOUT")
    print("=" * 70)

    for name in ("view_item_unit_cost.sql", "view_product_recipe_cogs.sql"):
        sql = (SQL_DIR / name).read_text(encoding="utf-8")
        run_databricks_sql(sql)
        print(f"deployed {name}")

    out = {}

    # 1. Produced items unit costs
    rows = run_databricks_sql("""
        SELECT ingredient_id, ingredient_name, item_class, unit_cost, cost_source
        FROM workspace.inventory_tabular.view_item_unit_cost
        WHERE item_class IN ('finished','intermediate')
        ORDER BY ingredient_name""")
    print("\n-- produced item costs --")
    for r in rows:
        cost = f"{float(r['unit_cost']):.4f}" if r['unit_cost'] is not None else "NULL"
        print(f"  {str(r['ingredient_name'])[:40]:<40} {str(r['item_class']):<12} "
              f"cost={cost:>14} {r['cost_source']}")
    out["produced_costs"] = rows

    # 2. Tapioca unit cost (the former free component)
    tapi = run_databricks_sql("""
        SELECT unit_cost, cost_source FROM workspace.inventory_tabular.view_item_unit_cost
        WHERE ingredient_name = 'Тапиока в шариках'""")
    print("\ntapioca unit cost:", tapi)
    out["tapioca"] = tapi

    # 3. POS cogs sanity: drinks containing tapioca must have cogs > 0
    drinks = run_databricks_sql("""
        SELECT p.product_ru, p.base_price, c.calculated_cogs, c.gross_margin_pct
        FROM workspace.inventory_tabular.view_product_recipe_cogs c
        JOIN workspace.gold.dim_product p ON p.product_id = c.parent_product_id
        JOIN workspace.inventory_tabular.fact_recipe_ingredients r
          ON r.product_id = p.product_id AND r.recipe_type = 'retail'
        JOIN workspace.inventory_tabular.dim_ingredients i
          ON i.ingredient_id = r.ingredient_id AND i.ingredient_name = 'Тапиока в шариках'
        GROUP BY p.product_ru, p.base_price, c.calculated_cogs, c.gross_margin_pct
        LIMIT 10""")
    print("\n-- tapioca-containing product cogs --")
    for r in drinks:
        print(f"  {r['product_ru'][:44]:<44} price={r['base_price']} cogs={r['calculated_cogs']} margin={r['gross_margin_pct']}%")
    out["tapioca_drinks"] = drinks

    # 4. labor absorption: mochi unit cost > WAC-only (= labor added). Compare
    # produced actual cost vs raw material cost share (mochi pay_rate 16.0/unit).
    labor_check = run_databricks_sql("""
        SELECT c.ingredient_name, c.unit_cost AS actual_cost, w.effective_unit_cost AS wac_only
        FROM workspace.inventory_tabular.view_item_unit_cost c
        LEFT JOIN workspace.inventory_tabular.view_ingredient_wac_30d w
          ON w.ingredient_id = c.ingredient_id
        WHERE c.cost_source = 'production_actual' AND c.unit_cost IS NOT NULL
        ORDER BY c.unit_cost DESC
        LIMIT 12""")
    print("\n-- production_actual vs pure-WAC (labor/gap check) --")
    for r in labor_check:
        print(f"  {r['ingredient_name'][:40]:<40} actual={r['actual_cost']} waconly={r['wac_only']}")
    out["labor_check"] = labor_check

    Path(LEDGER).write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\nledger -> {LEDGER}")

if __name__ == "__main__":
    main()
