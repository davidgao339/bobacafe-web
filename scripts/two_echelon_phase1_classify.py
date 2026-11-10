# -*- coding: utf-8 -*-
"""
Two-Echelon Model — Phase 1: Classify
Adds item_class + product_id to dim_ingredients and populates them from the
approved mapping (spec v2, plans/two-echelon-inventory-model.md).

Classes:
  finished        WHS produced, transferred to stores; 1:1 with dim_product
  intermediate    WHS produced AND consumed as ingredient (tapioca pearls)
  whs_only        purchased raw, WHS production only
  store_only      store consumable, never in WHS BOM
  dual_use        store-stocked AND WHS production input

Dry run (default): prints the full diff list, touches nothing.
--apply: ALTER TABLE + UPDATE batches + CHECK constraint (if gate passes) + ledger.
"""

import urllib.request
import urllib.error
import json
import time
import re
import sys
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
TABLE = 'workspace.inventory_tabular.dim_ingredients'
LEDGER = ROOT_DIR / 'scratch' / 'two_echelon_phase1_ledger.json'

sys.path.insert(0, str(Path(__file__).resolve().parent))
import echelon_semantics as es

# Classification rules live in echelon_semantics.py (single source of truth,
# shared with the nightly sync). This script is only the one-time executor.

# ─── SQL HARNESS (same pattern as sync_d1_to_databricks_tabular.py) ──────────

def run_databricks_sql(sql, retries=3):
    url = f"{DATABRICKS_URL}/api/2.0/sql/statements"
    payload = json.dumps({
        "statement": sql,
        "warehouse_id": DATABRICKS_WAREHOUSE_ID,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE"
    }).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DATABRICKS_TOKEN}"
    }
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            stmt_id = data.get("statement_id")
            state = data.get("status", {}).get("state")
            while state in ("PENDING", "RUNNING"):
                time.sleep(1.5)
                poll_req = urllib.request.Request(f"{url}/{stmt_id}", headers=headers)
                with urllib.request.urlopen(poll_req, timeout=30) as poll_resp:
                    data = json.loads(poll_resp.read().decode("utf-8"))
                    state = data.get("status", {}).get("state")
            if state != "SUCCEEDED":
                err = data.get("status", {}).get("error", {})
                raise RuntimeError(f"Databricks SQL failed ({state}): {str(err.get('message', data))[:500]}")
            manifest = data.get("manifest", {})
            columns = [c["name"] for c in manifest.get("schema", {}).get("columns", [])]
            rows = data.get("result", {}).get("data_array", [])
            return [dict(zip(columns, r)) for r in rows]
        except urllib.error.HTTPError as http_err:
            body = ""
            try:
                body = http_err.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            print(f"  [ERROR] HTTP {http_err.code} attempt {attempt+1}/{retries}: {body[:300]}")
            if attempt == retries - 1:
                raise
            time.sleep(2)

def norm(name):
    return re.sub(r"\s+", " ", str(name or '').lower().replace('ё', 'е')).strip()

def ids_sql(items):
    return ",".join(str(int(i)) for i in items)

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    apply_mode = '--apply' in sys.argv
    print("=" * 70)
    print(f"TWO-ECHELON PHASE 1: CLASSIFY   mode = {'APPLY' if apply_mode else 'DRY RUN'}")
    print("=" * 70)

    # 1. Load items with usage evidence
    items = run_databricks_sql(f"""
        SELECT i.ingredient_id AS id, i.ingredient_name AS name, i.unit AS unit,
               i.product_type AS ptype, CAST(i.is_warehouse_only AS STRING) AS wh_only,
               COALESCE(p.n, 0) AS prod_refs,
               COALESCE(r.n, 0) AS retail_refs
        FROM {TABLE} i
        LEFT JOIN (SELECT ingredient_id, COUNT(*) AS n
                   FROM workspace.inventory_tabular.fact_recipe_ingredients
                   WHERE recipe_type = 'production' GROUP BY 1) p
               ON p.ingredient_id = i.ingredient_id
        LEFT JOIN (SELECT ingredient_id, COUNT(*) AS n
                   FROM workspace.inventory_tabular.fact_recipe_ingredients
                   WHERE recipe_type = 'retail' GROUP BY 1) r
               ON r.ingredient_id = i.ingredient_id
    """)
    # Databricks statement API returns ints as strings — coerce
    for it in items:
        it["id"] = int(it["id"]); it["prod_refs"] = int(it["prod_refs"]); it["retail_refs"] = int(it["retail_refs"])
    print(f"items: {len(items)}")

    # 2. Product catalog for finished/intermediate linking
    products = run_databricks_sql(
        "SELECT product_id, product_ru, CAST(is_active AS STRING) AS is_active FROM workspace.gold.dim_product")
    active_by_name, any_by_name = es.build_product_index(products)
    print(f"dim_product rows: {len(products)} (active names: {len(active_by_name)})")

    # 3. Classification rules — shared semantic module (single source of truth)
    for it in items:
        cls, dead = es.classify_item(
            it["name"], it["ptype"], (it["wh_only"] or "").lower(),
            it["prod_refs"], it["retail_refs"])
        it["item_class"] = cls
        it["dead"] = dead
        if cls in es.LINK_CLASSES:
            it["product_id"], it["link_source"] = es.link_product(it["name"], active_by_name, any_by_name)
        else:
            it["product_id"], it["link_source"] = None, 'n/a'

    # 4. Diff report
    by_class = {}
    for it in items:
        by_class.setdefault(it["item_class"], []).append(it)
    print("\nclass counts: " + ", ".join(f"{k}={len(v)}" for k, v in sorted(by_class.items())))

    print("\n-- finished / intermediate product_id links --")
    linked, missing = [], []
    for it in sorted(by_class.get('finished', []) + by_class.get('intermediate', []), key=lambda x: x["name"]):
        tag = "DEAD" if it["dead"] else "    "
        status = f"product_id {it['product_id']} ({it['link_source']})" if it["product_id"] else "NO dim_product match"
        print(f"  {int(it['id']):>4} {it['name'][:44]:<44} {it['item_class']:<12} -> {status} {tag}")
        (linked if it["product_id"] else missing).append(it)
    print(f"linked={len(linked)} missing={len(missing)}")

    # 5. Current state (idempotency check)
    existing_cols = {r["col_name"] for r in run_databricks_sql(f"DESCRIBE {TABLE}")}
    has_class, has_pid = 'item_class' in existing_cols, 'product_id' in existing_cols
    print(f"\ncolumns present: item_class={has_class} product_id={has_pid}")

    ledger = {
        "run_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "applied": apply_mode,
        "class_counts": {k: len(v) for k, v in by_class.items()},
        "linked": [{"id": i["id"], "name": i["name"], "product_id": i["product_id"], "source": i.get("link_source")} for i in linked],
        "missing_product_id": [{"id": i["id"], "name": i["name"]} for i in missing],
        "dead_flags": sorted(es.DEAD_FLAGS),
        "items": [{"id": i["id"], "name": i["name"], "item_class": i["item_class"],
                   "product_id": i["product_id"]} for i in items],
    }

    if not apply_mode:
        print("\nDRY RUN — no changes made. Re-run with --apply to execute.")
        Path(LEDGER).write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
        return

    # 6. ALTER TABLE (add missing columns)
    if not has_class:
        run_databricks_sql(f"ALTER TABLE {TABLE} ADD COLUMN item_class STRING")
        print("added column item_class")
    else:
        print("column item_class already exists — values will be refreshed")
    if not has_pid:
        run_databricks_sql(f"ALTER TABLE {TABLE} ADD COLUMN product_id INT")
        print("added column product_id")
    else:
        print("column product_id already exists — values will be refreshed")

    # 7. UPDATE batches per class
    for cls, members in sorted(by_class.items()):
        run_databricks_sql(f"UPDATE {TABLE} SET item_class = '{cls}' WHERE ingredient_id IN ({ids_sql(m['id'] for m in members)})")
        print(f"item_class={cls:<12} updated {len(members)}")

    # product_id for finished/intermediate
    for cls in ('finished', 'intermediate'):
        members = [m for m in by_class.get(cls, []) if m["product_id"]]
        if members:
            cases = " ".join(f"WHEN {int(m['id'])} THEN {int(m['product_id'])}" for m in members)
            run_databricks_sql(
                f"UPDATE {TABLE} SET product_id = CASE ingredient_id {cases} END "
                f"WHERE ingredient_id IN ({ids_sql(m['id'] for m in members)})")
            print(f"product_id ({cls}) updated {len(members)}")
        # clear product_id where no match found (avoid stale ids)
        nomatch = [m for m in by_class.get(cls, []) if not m["product_id"]]
        if nomatch:
            run_databricks_sql(f"UPDATE {TABLE} SET product_id = NULL WHERE ingredient_id IN ({ids_sql(m['id'] for m in nomatch)})")
            print(f"product_id ({cls}) cleared {len(nomatch)} (no dim match)")

    # 8. CHECK constraint — only if integrity gate passes
    if missing:
        print(f"\nCHECK constraint SKIPPED: {len(missing)} finished/intermediate rows lack product_id:")
        for m in missing:
            print(f"   {m['name']} (id {m['id']}) — add the dim_product row or retire the item")
    else:
        try:
            run_databricks_sql(
                f"ALTER TABLE {TABLE} DROP CONSTRAINT IF EXISTS dim_ingredients_finished_product_id")
        except Exception:
            pass
        run_databricks_sql(
            f"ALTER TABLE {TABLE} ADD CONSTRAINT dim_ingredients_finished_product_id "
            f"CHECK (item_class <> 'finished' OR product_id IS NOT NULL)")
        print("CHECK constraint dim_ingredients_finished_product_id created")

    # 9. Verification
    counts = run_databricks_sql(f"SELECT item_class, COUNT(*) AS n FROM {TABLE} GROUP BY item_class ORDER BY item_class")
    print("\nverify class counts:", json.dumps([(r["item_class"], int(r["n"])) for r in counts]))
    bad = run_databricks_sql(f"SELECT ingredient_id, ingredient_name FROM {TABLE} WHERE item_class='finished' AND product_id IS NULL")
    print(f"verify finished without product_id: {len(bad)}")
    dups = run_databricks_sql(
        f"SELECT product_id, COUNT(*) AS n FROM {TABLE} WHERE item_class='finished' AND product_id IS NOT NULL "
        f"GROUP BY product_id HAVING COUNT(*) > 1")
    print(f"verify duplicate product_id among finished: {len(dups)}")

    ledger["applied"] = True
    ledger["check_constraint"] = not missing
    Path(LEDGER).write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nledger -> {LEDGER}")

if __name__ == "__main__":
    main()
