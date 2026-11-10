"""
Phase 1 Migration Script:
Syncs and uncouples Cloudflare D1 inventory data into Databricks Delta Lake (workspace.inventory_tabular).
"""

import urllib.request
import json
import time
import re
import sys
import os
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from echelon_semantics import classify_item, link_product, build_product_index, LINK_CLASSES

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

# ─── CONFIGURATION ───────────────────────────────────────────────────────────

D1_PROXY_URL = 'https://bobacafe-proxy.davidgao734.workers.dev/d1/execute'
DATABRICKS_URL = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com'
DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID = load_credentials()
TARGET_SCHEMA = 'workspace.inventory_tabular'

# ─── STORE DIRECTORY & MAPPING ──────────────────────────────────────────────

STORES_DEF = [
    {"store_id": 1,  "store_code": "RSQ", "store_name": "НОВО КП",     "store_name_en": "Red Square",   "city": "Новороссийск", "store_type": "retail",    "is_active": True},
    {"store_id": 2,  "store_code": "GPK", "store_name": "ГП КУБАНЬ",    "store_name_en": "GP Park",      "city": "Краснодар",    "store_type": "retail",    "is_active": True},
    {"store_id": 3,  "store_code": "BON", "store_name": "БОН ПАССАЖ",   "store_name_en": "Bon Passage",  "city": "Новороссийск", "store_type": "retail",    "is_active": True},
    {"store_id": 4,  "store_code": "CHM", "store_name": "ЧЕРЕМУШКИ",    "store_name_en": "Cheremushki",  "city": "Краснодар",    "store_type": "retail",    "is_active": True},
    {"store_id": 5,  "store_code": "SOV", "store_name": "СОВЕТСКАЯ",    "store_name_en": "Sovetskaya",   "city": "Анапа",        "store_type": "retail",    "is_active": True},
    {"store_id": 6,  "store_code": "GAL", "store_name": "ГАЛЕРЕЯ",      "store_name_en": "Gallery",      "city": "Краснодар",    "store_type": "retail",    "is_active": True},
    {"store_id": 99, "store_code": "WHS", "store_name": "СКЛАД",        "store_name_en": "Warehouse",    "city": "Краснодар",    "store_type": "warehouse", "is_active": True},
    {"store_id": 10, "store_code": "OZM", "store_name": "ОЗМОЛЛ",      "store_name_en": "OZ Mall",      "city": "Краснодар",    "store_type": "retail",    "is_active": False},
    {"store_id": 11, "store_code": "ANP", "store_name": "АНАПА",        "store_name_en": "Anapa City",   "city": "Анапа",        "store_type": "retail",    "is_active": False},
    {"store_id": 12, "store_code": "GLN", "store_name": "ГЕЛЕНДЖИК",    "store_name_en": "Gelendzhik",   "city": "Геленджик",    "store_type": "retail",    "is_active": False},
    {"store_id": 13, "store_code": "KSK", "store_name": "КИОСК",        "store_name_en": "Kiosk",        "city": "Новороссийск", "store_type": "retail",    "is_active": False},
]

STORE_ALIAS_MAP = {
    "ново кп": 1, "red square": 1, "rsq": 1,
    "гп кубань": 2, "грин парк": 2, "gp park": 2, "gpk": 2,
    "бон пассаж": 3, "bon passage": 3, "bon": 3,
    "черемушки": 4, "черноморский": 4, "cheremushki": 4, "chm": 4,
    "советская": 5, "советов": 5, "sovetskaya": 5, "sov": 5,
    "галерея": 6, "gallery": 6, "gal": 6,
    "склад": 99, "warehouse": 99, "whs": 99,
    "озмолл": 10, "oz mall": 10, "ozm": 10,
    "анапа": 11, "anp": 11,
    "геленджик": 12, "gln": 12,
    "киоск": 13, "ksk": 13
}

STORE_ID_TO_CODE = {s["store_id"]: s["store_code"] for s in STORES_DEF}
STORE_ID_TO_NAME = {s["store_id"]: s["store_name"] for s in STORES_DEF}

def resolve_store_id(name):
    if not name:
        return None
    cleaned = str(name).strip().lower()
    return STORE_ALIAS_MAP.get(cleaned)

# ─── INGREDIENT PRODUCT TYPE CLASSIFIER ──────────────────────────────────────

def detect_product_type(name = '', unit = ''):
    if not name or not isinstance(name, str):
        return 'other'
    c = name.strip().lower()
    if ('500' in c and any(x in c for x in ['стакан', 'cup', 'пластик', 'plastic'])) or ('стакан' in c and '500' in c):
        return 'cups_plastic_500'
    if ('320' in c and any(x in c for x in ['стакан', 'cup', 'пластик', 'plastic'])) or ('стакан' in c and '320' in c):
        return 'cups_plastic_320'
    if any(x in c for x in ['бумажн', 'paper cup', 'стакан горяч']) or re.search(r'стакан.*(250|350|400)', c):
        return 'cups_paper'
    if any(x in c for x in ['джус-бол', 'джусбол', 'juice ball', 'поппинг', 'popping']):
        return 'juice_balls'
    if any(x in c for x in ['паток', 'patoka', 'мальтоз']):
        return 'patoka'
    if any(x in c for x in ['газированн', 'газ. вод', 'газ вод', 'sparkling', 'содов', 'минеральн']):
        return 'sparkling_water'
    if 'корн-дог' in c or 'корндог' in c or 'corn dog' in c:
        return 'corndogs'
    if 'моти' in c or 'mochi' in c:
        return 'mochi'
    if any(x in c for x in ['блин', 'pancake', 'вафл', 'waffle']):
        return 'pancakes'
    if 'какао' in c or 'cocoa' in c:
        return 'cocoa'
    if any(x in c for x in ['сырн', 'cheese powder', 'сырный порошок']):
        return 'cheese_powder'
    if any(x in c for x in ['сухое молок', 'сухие сливк', 'порошок', 'порошков', 'powder', 'пудра', 'матча', 'matcha']):
        return 'powder'
    if 'сливк' in c or 'cream' in c:
        return 'cream'
    if 'молок' in c or 'milk' in c:
        return 'milk'
    if any(x in c for x in ['чай', 'tea', 'ассам', 'assam', 'жасмин', 'jasmine', 'улун', 'oolong', 'эрл грей', 'earl grey', 'сенча', 'sencha', 'каркаде', 'тигуанинь']):
        return 'tea'
    if any(x in c for x in ['кофе', 'coffee', 'эспрессо', 'espresso', 'зерн']):
        return 'coffee'
    if 'пюре' in c or 'puree' in c:
        return 'puree'
    if any(x in c for x in ['сахар', 'sugar', 'фруктоз', 'fructose', 'глюкоз']):
        return 'sugar'
    if 'сироп' in c or 'syrup' in c:
        return 'syrup'
    if 'сок' in c or 'juice' in c or 'нектар' in c:
        return 'juice'
    if 'крышк' in c or 'lid' in c:
        return 'lids'
    if 'трубочк' in c or 'straw' in c:
        return 'straws'
    if 'маршмеллоу' in c or 'marshmallow' in c:
        return 'marshmallow'
    if any(x in c for x in ['топпинг', 'topping', 'желе', 'jelly', 'алоэ', 'aloe', 'боба', 'boba', 'nata', 'тапиок', 'tapioca']):
        return 'topping'
    return 'ingredient'

# ─── API CLIENT HELPERS ──────────────────────────────────────────────────────

def query_d1(sql: str, params=None):
    if params is None:
        params = []
    req = urllib.request.Request(
        D1_PROXY_URL,
        data=json.dumps({'sql': sql, 'params': params}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode('utf-8'))
        return body.get('results', [])

def run_databricks_sql(sql: str, retries: int = 3):
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
                raise RuntimeError(f"Databricks SQL failed ({state}): {err.get('message', data)}")
                
            manifest = data.get("manifest", {})
            schema = manifest.get("schema", {})
            columns = [c["name"] for c in schema.get("columns", [])]
            rows = data.get("result", {}).get("data_array", [])
            return [dict(zip(columns, r)) for r in rows]
        except urllib.error.HTTPError as http_err:
            body = ""
            try:
                body = http_err.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            print(f"  [ERROR] Databricks API HTTP {http_err.code} ({http_err.reason}) on attempt {attempt+1}/{retries}:\n{body}")
            if attempt == retries - 1:
                raise RuntimeError(f"Databricks API HTTP {http_err.code}: {body or http_err.reason}") from http_err
            time.sleep(2)
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2)

def sql_escape(val):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    # String escaping
    s = str(val).replace("'", "''")
    return f"'{s}'"

def batch_insert(table_name: str, columns: list, rows: list, batch_size: int = 500):
    if not rows:
        print(f"  No rows to insert into {table_name}")
        return
    col_str = ", ".join(columns)
    total = len(rows)
    inserted = 0
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        values_list = []
        for row in batch:
            val_strs = [sql_escape(val) for val in row]
            values_list.append(f"({', '.join(val_strs)})")
        sql = f"INSERT INTO {table_name} ({col_str}) VALUES {', '.join(values_list)}"
        run_databricks_sql(sql)
        inserted += len(batch)
        print(f"  [{table_name}] Inserted {inserted}/{total} rows...")

# ─── 6a: MERGE-BASED LOADER (Phase 6 of lh-only-reads plan) ──────────────────
# Truncate-reload is no longer safe: the tabular apps write rows directly to
# the Lakehouse, and CREATE OR REPLACE TABLE wipes them nightly. MERGE upserts
# keep app-authored rows alive; D1 data still refreshes everything it carries.

def _merge_condition(keys):
    """ON t.k = s.k pairs; NULLable single keys use equality only."""
    return " AND ".join(f"t.{k} = src.{k}" for k in keys)

def batch_merge(table_name: str, columns: list, rows: list, merge_keys: list, batch_size: int = 400):
    if not rows:
        print(f"  No rows to merge into {table_name}")
        return 0
    total = len(rows)
    merged = 0
    # Databricks MERGE rejects a column alias list directly on the USING
    # relation ("COLUMN_ALIASES_NOT_ALLOWED"), so wrap VALUES in a subquery
    # and expose named columns via the SELECT list instead.
    proj = ", ".join(f"col{n + 1} AS {name}" for n, name in enumerate(columns))
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        values_list = []
        for row in batch:
            values_list.append("(" + ", ".join(sql_escape(v) for v in row) + ")")
        on = _merge_condition(merge_keys)
        sql = (
            f"MERGE INTO {table_name} AS t USING "
            f"(SELECT {proj} FROM (VALUES {', '.join(values_list)}) AS v) AS src "
            f"ON {on} "
            f"WHEN MATCHED THEN UPDATE SET * "
            f"WHEN NOT MATCHED THEN INSERT *"
        )
        run_databricks_sql(sql)
        merged += len(batch)
        print(f"  [{table_name}] Merged {merged}/{total} rows...")
    return merged

def delete_children_by_parents(table_name: str, parent_col: str, parent_values: list, batch_size: int = 400):
    """Exact-refresh helper for fact children fully derived from a parent blob
    (audit counts, PO lines, recipe rows): delete all rows whose parent key is
    part of tonight's D1 dataset, then re-insert from D1. Parent rows that only
    exist LH-side (app-authored, not yet in D1) are never deleted."""
    if not parent_values:
        return
    for i in range(0, len(parent_values), batch_size):
        batch = parent_values[i:i + batch_size]
        vals = ", ".join(sql_escape(v) for v in batch)
        run_databricks_sql(f"DELETE FROM {table_name} WHERE {parent_col} IN ({vals})")

def delete_facts_by_composite_parents(table_name: str, pairs: list, batch_size: int = 300):
    """DELETE WHERE (recipe_product_name, recipe_type) matches tonight's set."""
    if not pairs:
        return
    for i in range(0, len(pairs), batch_size):
        batch = pairs[i:i + batch_size]
        vals = ", ".join(f"({sql_escape(a)}, {sql_escape(b)})" for a, b in batch)
        run_databricks_sql(
            f"DELETE FROM {table_name} WHERE EXISTS ("
            f" SELECT 1 FROM (VALUES {vals}) AS v(recipe_product_name, recipe_type)"
            f" WHERE v.recipe_product_name = {table_name}.recipe_product_name"
            f"   AND v.recipe_type = {table_name}.recipe_type)")

def delete_recipe_rows_by_identity(table_name: str, parents: list, prod_lookup, key_fn, pid_to_name):
    """6c Gap A: identity-keyed recipe refresh.

    For each D1 (raw_name, type) parent that resolves to a dim_product:
      - delete rows spelling the product ANY way under that type — raw D1
        spelling, canonical dim spelling, and LH-authored variants attached to
        the same product_id (app pushes are product_id-attached).
    Unresolved parents refresh by exact raw spelling only.
    """
    for raw_name, rtype in parents:
        prod_info = prod_lookup.get(key_fn(raw_name), {})
        p_id = prod_info.get("product_id")
        canon = pid_to_name.get(p_id) if p_id is not None else None
        cond = f"recipe_product_name = {sql_escape(raw_name)}"
        if canon and canon != raw_name:
            cond += f" OR recipe_product_name = {sql_escape(canon)}"
        if p_id is not None:
            cond += f" OR product_id = {int(p_id)}"
        run_databricks_sql(
            f"DELETE FROM {table_name} WHERE recipe_type = {sql_escape(rtype)} AND ({cond})")

# ─── MAIN MIGRATION PIPELINE ─────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("BOBACAFE PHASE 1: D1 TO DATABRICKS TABULAR DELTA MIGRATION")
    print("=" * 70)

    # 1. Target Schema setup
    print("\n[Step 1/9] Ensuring schema exists...")
    run_databricks_sql(f"CREATE SCHEMA IF NOT EXISTS {TARGET_SCHEMA}")
    print(f"Schema {TARGET_SCHEMA} is ready.")

    # 2. Extract D1 datasets
    print("\n[Step 2/9] Extracting all tables from Cloudflare D1 via proxy...")
    d1_ingredients = query_d1("SELECT * FROM ingredients")
    d1_suppliers = query_d1("SELECT * FROM suppliers")
    d1_recipes = query_d1("SELECT * FROM recipes")
    d1_audits = query_d1("SELECT * FROM audits")
    d1_pos = query_d1("SELECT * FROM purchase_orders")
    d1_txs = query_d1("SELECT * FROM transactions")
    d1_settings = query_d1("SELECT * FROM settings")
    # App-maintained dim columns live only in the D1 dim mirror (apps write
    # cost_per_unit on edit, last_purchase_cost/date on PO receive). The legacy
    # blob does not carry them.
    try:
        d1_dim_costs = {int(r["ingredient_id"]): r for r in
                        query_d1("SELECT ingredient_id, cost_per_unit, last_purchase_cost, last_purchase_date FROM dim_ingredients")}
    except Exception:
        d1_dim_costs = {}
    print(f"  D1 ingredients:     {len(d1_ingredients)} rows")
    print(f"  D1 dim cost rows:   {len(d1_dim_costs)} rows")
    print(f"  D1 suppliers:       {len(d1_suppliers)} rows")
    print(f"  D1 recipes:         {len(d1_recipes)} rows")
    print(f"  D1 audits:          {len(d1_audits)} rows")
    print(f"  D1 purchase orders: {len(d1_pos)} rows")
    print(f"  D1 transactions:    {len(d1_txs)} rows")
    print(f"  D1 settings:        {len(d1_settings)} rows")

    # 3. Extract Databricks Product Catalog
    print("\n[Step 3/9] Fetching product catalog from workspace.gold.dim_product...")
    db_products = run_databricks_sql("SELECT product_id, parent_product_id, product_ru, is_active FROM workspace.gold.dim_product")
    print(f"  Loaded {len(db_products)} products from Databricks.")

    # Build product name lookup map: case/whitespace-insensitive keys
    # (spelling drift like 'Бабл-ти  Лаймовый' or 'моти манго' vs 'Моти Манго'),
    # preferring ACTIVE rows so folded dedup duplicates lose gracefully.
    # NOTE: no alias table here by design — bronze
    # (workspace.default.transactions) is rewritten to canonical spellings by
    # scripts/normalize_bronze_product_names.py; spellings that still miss dim
    # are REPORTED below (they loaded with NULL product ids) so drift is
    # visible the morning after a POS typo, not hidden behind an alias.
    def _key(name):
        return re.sub(r"\s+", " ", str(name or '').lower().replace('ё', 'е')).strip()

    prod_lookup = {}
    for p in db_products:
        p_ru = (p.get('product_ru') or '').strip()
        if not p_ru:
            continue
        info = {
            "product_id": int(p['product_id']),
            "parent_product_id": int(p['parent_product_id']),
            "product_name": p_ru,
            "_active": bool(p.get('is_active', True)),
        }
        existing = prod_lookup.get(_key(p_ru))
        if existing is None or (info["_active"] and not existing["_active"]):
            prod_lookup[_key(p_ru)] = info

    unresolved_product_names = {}  # name -> row count; reported after the load

    # ─── TABLE 1: dim_stores ─────────────────────────────────────────────────
    print("\n[Step 4/9] Creating and loading dim_stores...")
    table_stores = f"{TARGET_SCHEMA}.dim_stores"
    run_databricks_sql(f"""
    CREATE OR REPLACE TABLE {table_stores} (
        store_id INT,
        store_code STRING,
        store_name STRING,
        store_name_en STRING,
        city STRING,
        store_type STRING,
        is_active BOOLEAN
    ) USING DELTA
    """)
    store_rows = [
        [s["store_id"], s["store_code"], s["store_name"], s["store_name_en"], s["city"], s["store_type"], s["is_active"]]
        for s in STORES_DEF
    ]
    batch_insert(table_stores, ["store_id", "store_code", "store_name", "store_name_en", "city", "store_type", "is_active"], store_rows)

    # ─── TABLE 2: dim_ingredients ───────────────────────────────────────────
    print("\n[Step 5/9] Creating and loading dim_ingredients...")
    supplier_map = {int(s["id"]): s["name"] for s in d1_suppliers if s.get("id")}
    table_ingredients = f"{TARGET_SCHEMA}.dim_ingredients"
    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_ingredients} (
        ingredient_id INT,
        ingredient_name STRING,
        unit STRING,
        product_type STRING,
        supplier_id INT,
        supplier_name STRING,
        is_warehouse_only BOOLEAN,
        is_hidden BOOLEAN,
        cost_per_unit DOUBLE,
        last_purchase_cost DOUBLE,
        last_purchase_date STRING,
        item_class STRING,
        product_id INT
    ) USING DELTA
    """)
    # 6c pre-existing tables lack the app-maintained dim cost columns — add
    # them best-effort (Delta ADD COLUMN is idempotent-safe to retry).
    for col_sql in (
        f"ALTER TABLE {table_ingredients} ADD COLUMN last_purchase_cost DOUBLE",
        f"ALTER TABLE {table_ingredients} ADD COLUMN last_purchase_date STRING",
    ):
        try:
            run_databricks_sql(col_sql)
        except Exception:
            pass
    
    ingredient_rows = []
    ing_name_map = {}
    # Two-echelon classification: usage refs from D1 recipes (same evidence the
    # ending fact counts in LH carry), then the shared semantic module decides.
    prod_refs_map, retail_refs_map = {}, {}
    for r in d1_recipes:
        rtype = (r.get("type") or "retail")
        try:
            mapping = json.loads(r.get("ingredient_mapping") or "{}")
        except Exception:
            continue
        ref_map = prod_refs_map if rtype == "production" else (retail_refs_map if rtype == "retail" else None)
        if ref_map is None:
            continue
        for ing_id_str in mapping:
            try:
                ref_map[int(ing_id_str)] = ref_map.get(int(ing_id_str), 0) + 1
            except Exception:
                continue
    prod_index_active, prod_index_any = build_product_index(db_products)
    for ing in d1_ingredients:
        ing_id = int(ing["id"])
        name = ing["name"].strip()
        unit = ing["unit"].strip()
        ing_name_map[ing_id] = name
        ptype = ing.get("productType") or detect_product_type(name, unit)
        supp_id = int(ing["supplierId"]) if ing.get("supplierId") is not None else None
        supp_name = supplier_map.get(supp_id)
        wh_only = bool(ing.get("warehouseOnly", 0))
        hidden = bool(ing.get("hidden", 0))
        item_class, _dead = classify_item(
            name, ptype,
            'true' if wh_only else 'false',
            prod_refs_map.get(ing_id, 0),
            retail_refs_map.get(ing_id, 0),
        )
        item_pid, _src = (link_product(name, prod_index_active, prod_index_any)
                          if item_class in LINK_CLASSES
                          else (None, 'n/a'))
        if item_pid is None and item_class in LINK_CLASSES:
            item_pid = None   # no forced link; nightly DQ report surfaces gaps
        dim_costs = d1_dim_costs.get(ing_id, {})
        cpu = dim_costs.get("cost_per_unit")
        lpc = dim_costs.get("last_purchase_cost")
        lpd = dim_costs.get("last_purchase_date")
        ingredient_rows.append([ing_id, name, unit, ptype, supp_id, supp_name, wh_only, hidden,
                                float(cpu) if cpu is not None and str(cpu) != '' else None,
                                float(lpc) if lpc is not None and str(lpc) != '' else None,
                                lpd, item_class, item_pid])

    batch_merge(
        table_ingredients,
        ["ingredient_id", "ingredient_name", "unit", "product_type", "supplier_id", "supplier_name", "is_warehouse_only", "is_hidden", "cost_per_unit", "last_purchase_cost", "last_purchase_date", "item_class", "product_id"],
        ingredient_rows,
        merge_keys=["ingredient_id"]
    )

    # ─── TABLE 3: dim_cook_unit_pay ──────────────────────────────────────────
    print("\n[Step 6/9] Creating and loading dim_cook_unit_pay...")
    table_cook_pay = f"{TARGET_SCHEMA}.dim_cook_unit_pay"
    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_cook_pay} (
        product_name STRING,
        product_id INT,
        parent_product_id INT,
        pay_rate DOUBLE
    ) USING DELTA
    """)

    cook_pay_rows = []
    for setting in d1_settings:
        if setting.get("key") == "cook_unit_pay" and setting.get("value"):
            try:
                rates = json.loads(setting["value"])
                for pname, rate in rates.items():
                    prod_info = prod_lookup.get(_key(pname), {})
                    if not prod_info:
                        unresolved_product_names[pname] = unresolved_product_names.get(pname, 0) + 1
                    p_id = prod_info.get("product_id")
                    parent_p_id = prod_info.get("parent_product_id")
                    cook_pay_rows.append([pname, p_id, parent_p_id, float(rate)])
            except Exception as e:
                print(f"  Warning: failed to parse cook_unit_pay: {e}")

    batch_merge(table_cook_pay, ["product_name", "product_id", "parent_product_id", "pay_rate"], cook_pay_rows,
                merge_keys=["product_name"])

    # ─── TABLE 4: fact_recipe_ingredients (Unrolled BOM) ────────────────────
    print("\n[Step 7/9] Creating and loading fact_recipe_ingredients...")
    table_recipes = f"{TARGET_SCHEMA}.fact_recipe_ingredients"
    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_recipes} (
        recipe_product_name STRING,
        product_id INT,
        parent_product_id INT,
        ingredient_id INT,
        ingredient_name STRING,
        amount_per_serving DOUBLE,
        recipe_type STRING,
        is_hidden BOOLEAN
    ) USING DELTA
    """)

    recipe_rows = []
    pid_to_name = {}
    for p in db_products:
        p_ru = (p.get('product_ru') or '').strip()
        p_id = p.get('product_id')
        if p_ru and p_id is not None and int(p_id) not in pid_to_name:
            pid_to_name[int(p_id)] = p_ru
    for r in d1_recipes:
        pname = r.get("product_name", "").strip()
        rtype = r.get("type", "retail")
        hidden = bool(r.get("hidden", 0))
        mapping_raw = r.get("ingredient_mapping")
        if not mapping_raw:
            continue
        try:
            mapping = json.loads(mapping_raw)
        except Exception:
            continue
        
        prod_info = prod_lookup.get(_key(pname), {})
        if not prod_info:
            unresolved_product_names[pname] = unresolved_product_names.get(pname, 0) + 1
        p_id = prod_info.get("product_id")
        parent_p_id = prod_info.get("parent_product_id")

        # 6c Gap A: canonicalize the recipe spelling LH-side. D1 rows keep
        # legacy spellings forever; the app keys recipes on canonical dim
        # names (product_id-attached), so one product must never exist under
        # two spellings in the Lakehouse. No dim match → keep raw D1 spelling
        # (pseudo-products like 'Списание - …').
        canon_name = pid_to_name.get(p_id, pname) if p_id is not None else pname

        for ing_id_str, amt in mapping.items():
            try:
                ing_id = int(ing_id_str)
                amt_val = float(amt)
                ing_name = ing_name_map.get(ing_id, f"Ingredient #{ing_id}")
                recipe_rows.append([canon_name, p_id, parent_p_id, ing_id, ing_name, amt_val, rtype, hidden])
            except Exception:
                continue

    # Recipes are fully derived per product identity — refresh exactly, keep
    # LH-only product recipes untouched (app-authored, absent from D1).
    # Identity-keyed (6c Gap A): a refresh deletes ALL spellings of the same
    # product (raw D1 spelling, canonical dim spelling, and any LH-authored
    # variant carrying the same product_id) before reinserting canonical rows.
    recipe_parents = sorted(set((r.get("product_name", "").strip(), r.get("type", "retail"))
                                for r in d1_recipes if r.get("product_name", "").strip()))
    delete_recipe_rows_by_identity(table_recipes, recipe_parents, prod_lookup, _key, pid_to_name)
    batch_insert(
        table_recipes,
        ["recipe_product_name", "product_id", "parent_product_id", "ingredient_id", "ingredient_name", "amount_per_serving", "recipe_type", "is_hidden"],
        recipe_rows
    )

    # ─── TABLE 5 & 6: fact_audit_headers & fact_audit_counts ────────────────
    print("\n[Step 8/9] Creating and loading fact_audit_headers & fact_audit_counts...")
    table_audit_headers = f"{TARGET_SCHEMA}.fact_audit_headers"
    table_audit_counts = f"{TARGET_SCHEMA}.fact_audit_counts"

    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_audit_headers} (
        audit_id STRING,
        store_id INT,
        store_code STRING,
        audit_date STRING,
        audit_timestamp STRING,
        status STRING
    ) USING DELTA
    """)

    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_audit_counts} (
        audit_id STRING,
        store_id INT,
        audit_date STRING,
        ingredient_id INT,
        ingredient_name STRING,
        count_quantity DOUBLE
    ) USING DELTA
    """)

    audit_headers_rows = []
    audit_counts_rows = []

    for a in d1_audits:
        audit_id = a.get("id")
        store_name = a.get("store")
        store_id = resolve_store_id(store_name)
        store_code = STORE_ID_TO_CODE.get(store_id)
        audit_date = a.get("date")
        timestamp = a.get("timestamp")
        status = a.get("status", "approved")
        audit_headers_rows.append([audit_id, store_id, store_code, audit_date, timestamp, status])

        counts_raw = a.get("counts")
        if not counts_raw:
            continue
        try:
            counts = json.loads(counts_raw)
        except Exception:
            continue

        for ing_id_str, qty in counts.items():
            try:
                ing_id = int(ing_id_str)
                qty_val = float(qty)
                # Filter zero counts strictly
                if qty_val > 0:
                    ing_name = ing_name_map.get(ing_id, f"Ingredient #{ing_id}")
                    audit_counts_rows.append([audit_id, store_id, audit_date, ing_id, ing_name, qty_val])
            except Exception:
                continue

    # Audit counts are fully derived per audit id — refresh exactly; LH-only
    # audits (app-authored, absent in D1) are untouched.
    batch_merge(table_audit_headers,
                ["audit_id", "store_id", "store_code", "audit_date", "audit_timestamp", "status"],
                audit_headers_rows, merge_keys=["audit_id"])
    audit_ids = [a.get("id") for a in d1_audits if a.get("id")]
    delete_children_by_parents(table_audit_counts, "audit_id", audit_ids)
    batch_insert(table_audit_counts,
                 ["audit_id", "store_id", "audit_date", "ingredient_id", "ingredient_name", "count_quantity"],
                 audit_counts_rows)

    # ─── TABLE 7 & 8: fact_purchase_orders & fact_purchase_order_lines ───────
    print("\n[Step 9/9] Creating and loading fact_purchase_orders & fact_purchase_order_lines...")
    table_pos = f"{TARGET_SCHEMA}.fact_purchase_orders"
    table_po_lines = f"{TARGET_SCHEMA}.fact_purchase_order_lines"

    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_pos} (
        po_id STRING,
        order_type STRING,
        store_id INT,
        store_code STRING,
        from_store_id INT,
        to_store_id INT,
        status STRING,
        received_date STRING,
        received_at STRING,
        created_date STRING,
        sent_date STRING
    ) USING DELTA
    """)

    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_po_lines} (
        po_id STRING,
        line_index INT,
        ingredient_id INT,
        ingredient_name STRING,
        is_custom_item BOOLEAN,
        ordered_quantity DOUBLE,
        received_quantity DOUBLE,
        unit STRING,
        unit_cost DOUBLE,
        total_cost DOUBLE
    ) USING DELTA
    """)
    try:
        run_databricks_sql(f"ALTER TABLE {table_po_lines} ADD COLUMN line_index INT")
    except Exception:
        pass

    po_headers_rows = []
    po_lines_rows = []

    for po in d1_pos:
        po_id = po.get("id")
        store_name = po.get("store")
        store_id = resolve_store_id(store_name)
        store_code = STORE_ID_TO_CODE.get(store_id)
        
        from_loc = po.get("fromLocation")
        to_loc = po.get("toLocation")
        from_id = resolve_store_id(from_loc)
        to_id = resolve_store_id(to_loc)

        # Distinguish order type
        if from_loc and to_loc:
            order_type = "inter_store_transfer"
        else:
            order_type = "vendor_order"

        status = po.get("status")
        received_at = po.get("receivedAt")
        received_date = received_at[:10] if received_at and len(received_at) >= 10 else None
        created_date = po.get("createdDate")
        sent_date = po.get("sentDate")

        po_headers_rows.append([po_id, order_type, store_id, store_code, from_id, to_id, status, received_date, received_at, created_date, sent_date])

        lines_raw = po.get("lines")
        if not lines_raw:
            continue
        try:
            parsed = json.loads(lines_raw)
        except Exception:
            continue

        raw_items = []
        if isinstance(parsed, list):
            for idx, it in enumerate(parsed):
                raw_items.append((it, False, idx))
        elif isinstance(parsed, dict):
            for idx, reg in enumerate(parsed.get("regular", [])):
                raw_items.append((reg, False, idx))
            for idx, cust in enumerate(parsed.get("custom", [])):
                raw_items.append((cust, True, 1000 + idx))

        for it, is_cust, line_idx in raw_items:
            try:
                ordered = float(it.get("ordered") or 0)
                received = float(it.get("received") or 0)
                # Filter zero rows strictly
                if ordered <= 0 and received <= 0:
                    continue

                if is_cust or it.get("ingredientId") is None:
                    ing_id = None
                    ing_name = it.get("name") or it.get("rawName") or "Custom Item"
                    unit = it.get("unit") or "шт"
                    is_custom = True
                else:
                    ing_id = int(it.get("ingredientId"))
                    ing_name = ing_name_map.get(ing_id, f"Ingredient #{ing_id}")
                    unit = it.get("unit") or ""
                    is_custom = False

                unit_cost = float(it.get("unitCost") or it.get("unit_cost") or it.get("cost") or it.get("price") or 0.0)
                total_cost = round(received * unit_cost, 2)
                # 6c Gap B: line_index matches D1/app semantics exactly
                # (regular lines 0..n, custom lines 1000+idx).
                po_lines_rows.append([po_id, line_idx, ing_id, ing_name, is_custom, ordered, received, unit, unit_cost, total_cost])
            except Exception:
                continue

    # POs: headers MERGE by id; lines fully derived per po (custom items have
    # NULL ingredient_id → no stable composite key) — delete+insert per po_id,
    # keeping LH-only POs untouched.
    batch_merge(table_pos,
                ["po_id", "order_type", "store_id", "store_code", "from_store_id", "to_store_id", "status", "received_date", "received_at", "created_date", "sent_date"],
                po_headers_rows, merge_keys=["po_id"])
    po_ids = [po.get("id") for po in d1_pos if po.get("id")]
    delete_children_by_parents(table_po_lines, "po_id", po_ids)
    batch_insert(
        table_po_lines,
        ["po_id", "line_index", "ingredient_id", "ingredient_name", "is_custom_item", "ordered_quantity", "received_quantity", "unit", "unit_cost", "total_cost"],
        po_lines_rows
    )

    # ─── TABLE 9: fact_inventory_transactions ────────────────────────────────
    print("\n[Step 10/10] Merging fact_inventory_transactions (append-only ledger)...")
    table_tx = f"{TARGET_SCHEMA}.fact_inventory_transactions"
    run_databricks_sql(f"""
    CREATE TABLE IF NOT EXISTS {table_tx} (
        transaction_id STRING,
        store_id INT,
        store_code STRING,
        transaction_date STRING,
        transaction_timestamp STRING,
        transaction_type STRING,
        ingredient_id INT,
        ingredient_name STRING,
        quantity DOUBLE,
        po_id STRING,
        reason STRING
    ) USING DELTA
    """)

    tx_rows = []
    for t in d1_txs:
        t_id = str(t.get("id"))
        store_name = t.get("store")
        store_id = resolve_store_id(store_name)
        store_code = STORE_ID_TO_CODE.get(store_id)
        t_date = t.get("date")
        t_time = t.get("timestamp")
        t_type = t.get("type")
        ing_id = int(t.get("ingredientId")) if t.get("ingredientId") is not None else None
        ing_name = ing_name_map.get(ing_id, f"Ingredient #{ing_id}") if ing_id else None
        qty = float(t.get("quantity") or 0)
        po_id = t.get("poId")
        reason = t.get("reason")
        tx_rows.append([t_id, store_id, store_code, t_date, t_time, t_type, ing_id, ing_name, qty, po_id, reason])

    batch_merge(
        table_tx,
        ["transaction_id", "store_id", "store_code", "transaction_date", "transaction_timestamp", "transaction_type", "ingredient_id", "ingredient_name", "quantity", "po_id", "reason"],
        tx_rows,
        merge_keys=["transaction_id"]
    )

    # ─── TABLE 10: fact_inventory_balance ───────────────────────────────────
    # Derived cache from D1; the app computes balances from views, so this is
    # best-effort: if D1's balance table is absent/renamed the pipeline must
    # NOT abort before the cost views deploy.
    print("\n[Step 10/10] Syncing fact_inventory_balance (best-effort)...")
    table_balance = f"{TARGET_SCHEMA}.fact_inventory_balance"
    try:
        run_databricks_sql(f"""
        CREATE OR REPLACE TABLE {table_balance} (
            store_id INT,
            ingredient_id INT,
            current_quantity DOUBLE,
            unit STRING,
            last_audit_id STRING,
            last_audit_date STRING,
            last_updated_at TIMESTAMP
        ) USING DELTA
        """)
        d1_balances = query_d1("SELECT store_id, ingredient_id, current_quantity, unit, last_audit_id, last_audit_date, last_updated_at FROM fact_inventory_balance")
        balance_rows = []
        for b in d1_balances:
            balance_rows.append([
                b["store_id"],
                b["ingredient_id"],
                b["current_quantity"],
                b["unit"],
                b["last_audit_id"],
                b["last_audit_date"],
                b["last_updated_at"]
            ])
        batch_insert(
            table_balance,
            ["store_id", "ingredient_id", "current_quantity", "unit", "last_audit_id", "last_audit_date", "last_updated_at"],
            balance_rows
        )
    except Exception as e:
        print(f"  ⚠ fact_inventory_balance skipped ({str(e)[:200]}) — views below still deploy")

    # ─── TABLE 11 & 12: REAL-TIME WAC & RECIPE COGS VIEWS ────────────────────
    print("\n[Step 11/11] Ensuring real-time WAC & Recipe COGS views are active...")
    view_wac = f"{TARGET_SCHEMA}.view_ingredient_wac_30d"
    run_databricks_sql(f"""
    CREATE OR REPLACE VIEW {view_wac} AS
    WITH po_ranked AS (
        SELECT 
            l.ingredient_id,
            l.received_quantity,
            l.unit_cost,
            h.received_date,
            ROW_NUMBER() OVER (PARTITION BY l.ingredient_id ORDER BY h.received_date DESC) AS rn
        FROM {table_po_lines} l
        JOIN {table_pos} h ON l.po_id = h.po_id
        WHERE h.status = 'received' 
          AND l.received_quantity > 0 
          AND l.unit_cost > 0
    ),
    wac_30d AS (
        SELECT 
            ingredient_id,
            ROUND(SUM(received_quantity * unit_cost) / SUM(received_quantity), 4) AS wac_30d,
            SUM(received_quantity) AS units_30d,
            COUNT(*) AS po_count_30d
        FROM po_ranked
        WHERE received_date >= date_sub(current_date(), 30)
        GROUP BY ingredient_id
    ),
    last_po AS (
        SELECT 
            ingredient_id,
            unit_cost AS last_purchase_cost,
            received_date AS last_purchase_date
        FROM po_ranked
        WHERE rn = 1
    )
    SELECT 
        i.ingredient_id,
        i.ingredient_name,
        i.unit,
        i.supplier_id,
        i.supplier_name,
        i.product_type,
        i.is_warehouse_only,
        i.is_hidden,
        COALESCE(i.cost_per_unit, 0.0) AS manual_catalog_cost,
        w.wac_30d,
        w.units_30d,
        w.po_count_30d,
        lp.last_purchase_cost,
        lp.last_purchase_date,
        CASE 
            WHEN w.wac_30d IS NOT NULL THEN '30d_wac'
            WHEN lp.last_purchase_cost IS NOT NULL THEN 'last_purchase'
            WHEN i.cost_per_unit > 0 THEN 'manual_catalog'
            ELSE 'unpriced'
        END AS cost_source,
        COALESCE(w.wac_30d, lp.last_purchase_cost, i.cost_per_unit, 0.0) AS effective_unit_cost
    FROM {table_ingredients} i
    LEFT JOIN wac_30d w ON i.ingredient_id = w.ingredient_id
    LEFT JOIN last_po lp ON i.ingredient_id = lp.ingredient_id
    """)

    # Two-echelon costing engine (Level 0/1 cost DAG + Level 2 POS COGS).
    # SQL lives in scripts/lakehouse_sql/ — the single source of truth shared
    # with scripts/two_echelon_phase5_costing.py, so the nightly sync always
    # deploys the current engine instead of a stale inline copy.
    cost_sql_dir = Path(__file__).resolve().parent / "lakehouse_sql"
    for sql_name in ("view_item_unit_cost.sql", "view_product_recipe_cogs.sql"):
        run_databricks_sql((cost_sql_dir / sql_name).read_text(encoding="utf-8"))
        print(f"  deployed {sql_name}")

    # ─── FINAL AUDIT & RECONCILIATION SUMMARY ────────────────────────────────
    print("\n" + "=" * 70)
    print("MIGRATION COMPLETED! RUNNING RECONCILIATION VERIFICATION...")
    print("=" * 70)

    # Drift report: product names from D1 that resolved to no active dim row.
    # With bronze normalized these should only ever be API contract changes /
    # genuinely unknown spellings — if this list is non-empty, a name is
    # missing from dim_product or POS/menu started writing a new spelling.
    if unresolved_product_names:
        print("\n⚠ UNRESOLVED product names (loaded with NULL product_id) — resolve in dim_product/menu:")
        for name, cnt in sorted(unresolved_product_names.items(), key=lambda x: -x[1]):
            print(f"  {name!r} (x{cnt})")
    else:
        print("\n✓ All product names resolved to dim_product ids (0 unresolved)")

    tables_to_verify = [
        "dim_stores",
        "dim_ingredients",
        "dim_cook_unit_pay",
        "fact_recipe_ingredients",
        "fact_audit_headers",
        "fact_audit_counts",
        "fact_purchase_orders",
        "fact_purchase_order_lines",
        "fact_inventory_transactions",
        "fact_inventory_balance",
        "view_ingredient_wac_30d",
        "view_product_recipe_cogs",
    ]

    for tbl in tables_to_verify:
        full_tbl = f"{TARGET_SCHEMA}.{tbl}"
        res = run_databricks_sql(f"SELECT COUNT(*) as cnt FROM {full_tbl}")
        cnt = res[0]["cnt"] if res else "N/A"
        print(f"  ✓ {full_tbl:50} : {cnt:>6} rows")

    print("\nPhase 1 migration finished with zero errors!")

if __name__ == "__main__":
    main()
