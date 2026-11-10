# -*- coding: utf-8 -*-
"""
Two-Echelon Model — Phase 3: Clean recipes (dedupe fact_recipe_ingredients)

Duplicate rows hurt: POS consumption double-counts, app order suggestions and
audit baselines inflate. A row is a duplicate of another when
(recipe_type, recipe_product_name, ingredient_id, amount_per_serving) repeats;
the keeper is the row with the richest identity (non-NULL product_id, then
parent_product_id).

Dry run (default): prints what would be dropped, touches nothing.
--apply: rewrites fact_recipe_ingredients keeping exactly one best row per key.
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
TABLE = 'workspace.inventory_tabular.fact_recipe_ingredients'
LEDGER = ROOT_DIR / 'scratch' / 'two_echelon_phase3_ledger.json'

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

DUPE_QUERY = f"""
    SELECT recipe_type, recipe_product_name, ingredient_id, ingredient_name,
           amount_per_serving, COUNT(*) AS n,
           COUNT(DISTINCT product_id) AS pid_variants,
           MAX(CASE WHEN product_id IS NOT NULL THEN product_id END) AS keep_pid,
           MAX(CASE WHEN parent_product_id IS NOT NULL THEN parent_product_id END) AS keep_ppid,
           COUNT(CASE WHEN product_id IS NOT NULL THEN 1 END) AS rows_with_pid
    FROM {TABLE}
    GROUP BY recipe_type, recipe_product_name, ingredient_id, ingredient_name, amount_per_serving
    HAVING COUNT(*) > 1
    ORDER BY recipe_type, recipe_product_name, ingredient_id
"""

def main():
    apply_mode = '--apply' in sys.argv
    print("=" * 70)
    print(f"TWO-ECHELON PHASE 3: DEDUPE RECIPES   mode = {'APPLY' if apply_mode else 'DRY RUN'}")
    print("=" * 70)

    total_before = int(run_databricks_sql(f"SELECT COUNT(*) AS n FROM {TABLE}")[0]["n"])
    dup_groups = run_databricks_sql(DUPE_QUERY)
    print(f"\ntotal rows: {total_before}; duplicate keys: {len(dup_groups)}")
    drop = 0
    for g in dup_groups:
        will_drop = int(g["n"]) - 1
        drop += will_drop
        print(f"  [{g['recipe_type']}] {g['recipe_product_name'][:40]}: ingredient {g['ingredient_id']} "
              f"amount={g['amount_per_serving']} ×{g['n']} (drop {will_drop}; pid variants {g['pid_variants']})")
    print(f"\nrows to drop: {drop} → total after: {total_before - drop}")

    ledger = {"run_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "applied": apply_mode,
              "total_before": total_before, "dup_groups": dup_groups, "rows_to_drop": drop}

    if not apply_mode:
        print("\nDRY RUN — no changes made. Re-run with --apply to execute.")
        Path(LEDGER).write_text(json.dumps(ledger, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        return

    plan = f"""
    CREATE OR REPLACE TABLE {TABLE} AS
    SELECT * FROM (
      SELECT t.*,
             COALESCE(t.product_id IS NOT NULL, false) AS keep_rich,
             ROW_NUMBER() OVER (
               PARTITION BY t.recipe_type, t.recipe_product_name, t.ingredient_id, t.amount_per_serving
               ORDER BY COALESCE(t.product_id IS NOT NULL, false) DESC,   -- prefer catalog-linked row
                        COALESCE(t.parent_product_id IS NOT NULL, false) DESC,
                        t.ingredient_name
             ) AS keep_rn
      FROM {TABLE} t
    ) ranked
    WHERE keep_rn = 1
    """
    run_databricks_sql(plan)
    total_after = int(run_databricks_sql(f"SELECT COUNT(*) AS n FROM {TABLE}")[0]["n"])
    remaining = run_databricks_sql(DUPE_QUERY)
    print(f"\napplied. before={total_before} after={total_after} (dropped {total_before - total_after})")
    print(f"remaining duplicate keys: {len(remaining)}")
    ledger.update({"total_after": total_after, "remaining_dup_keys": len(remaining)})
    Path(LEDGER).write_text(json.dumps(ledger, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"ledger -> {LEDGER}")

if __name__ == "__main__":
    main()
