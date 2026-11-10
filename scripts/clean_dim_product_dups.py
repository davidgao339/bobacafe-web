# -*- coding: utf-8 -*-
"""
Deduplicate workspace.gold.dim_product rows that differ only by formatting
(letter case, double spaces). Canonical row choice:
  1. product_ru that a production recipe in fact_recipe_ingredients is keyed on
  2. else the spelling used most often in POS transactions (exact match)
  3. else lowest product_id

Folding per duplicate pair (dup -> canonical):
  - fact_recipe_ingredients: recipe_product_name = canonical (production + retail)
  - gold.dim_product children: parent_product_id / parent_product_en -> canonical
  - dim_product dup row itself: is_active = false (history keeps pointing at it)
  - inventory_tabular.dim_cook_unit_pay: product_name remap (skipped if the
    canonical row already has a pay rate)

Default is DRY RUN (plans only). Pass --apply to execute.
"""
import sys, json, time, re
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".streamlit" / "secrets.toml"
APPLY = "--apply" in sys.argv

token = warehouse_id = None
for line in SECRETS.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line.startswith("token ="):
        token = line.split("=", 1)[1].strip().strip('"').strip("'")
    elif line.startswith("warehouse_id ="):
        warehouse_id = line.split("=", 1)[1].strip().strip('"').strip("'")
warehouse_id = warehouse_id or '959d56e804ae9b36'
assert token, "no Databricks token"

HOST = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
URL = f"{HOST}/api/2.0/sql/statements"

def sql(stmt, timeout_s=120):
    body = json.dumps({"statement": stmt, "warehouse_id": warehouse_id, "wait_timeout": "50s"}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        result = json.loads(resp.read())
    t0 = time.time()
    while result.get("status", {}).get("state") in ("PENDING", "RUNNING") and time.time() - t0 < timeout_s:
        time.sleep(2)
        req2 = urllib.request.Request(f"{URL}/{result['statement_id']}", method="GET",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req2, timeout=30) as r2:
            result = json.loads(r2.read())
    state = result.get("status", {}).get("state")
    if state != "SUCCEEDED":
        raise RuntimeError(f"SQL failed: {state}: {json.dumps(result.get('status', {}).get('error'))} [{stmt[:120]}]")
    cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
    return [dict(zip(cols, row)) for row in (result.get("result", {}).get("data_array") or [])]

def exec_stmt(stmt):
    """DDL/DML without result set."""
    return sql(stmt)

def norm(name):
    s = str(name).lower().replace("ё", "е")
    s = re.sub(r"\s+", " ", s).strip()
    return s

# ── 1. Find duplicate groups ─────────────────────────────────────────────────
products = sql("""
    SELECT product_id, product_ru, parent_product_id, parent_product_en, variant,
           category, subcategory, is_active, is_modifier, base_price, cost
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
""")
groups = {}
for p in products:
    groups.setdefault(norm(p["product_ru"]), []).append(p)
dup_groups = {k: v for k, v in groups.items()
              if len(v) > 1 and len({p["product_ru"].strip() for p in v}) > 1}

# production-recipe keys guide the canonical choice
prod_recipe_keys = {r["recipe_product_name"] for r in sql(
    "SELECT DISTINCT recipe_product_name FROM workspace.inventory_tabular.fact_recipe_ingredients WHERE recipe_type = 'production'")}
# exact-spelling POS usage counts (not normalized)
pos_counts = {t["product"]: int(t["n"]) for t in sql(
    "SELECT product, COUNT(*) AS n FROM workspace.default.transactions WHERE COALESCE(is_return, false) = false GROUP BY product")}

actions = []
for key, grp in dup_groups.items():
    def rank(p):
        has_prod_recipe = p["product_ru"] in prod_recipe_keys
        return (0 if has_prod_recipe else 1,
                -pos_counts.get(p["product_ru"], 0),
                int(p["product_id"]))
    grp = sorted(grp, key=rank)
    keep, dups = grp[0], grp[1:]
    actions.append((key, keep, dups))

print(f"duplicate groups: {len(actions)}")
for key, keep, dups in actions:
    print(f"  [{key}] canonical: id={keep['product_id']} '{keep['product_ru']}' "
          f"({pos_counts.get(keep['product_ru'], 0)} tx"
          f"{', production recipe' if keep['product_ru'] in prod_recipe_keys else ''})"
          f" <- folds {[(d['product_id'], d['product_ru']) for d in dups]}")

if not APPLY:
    print("\nDRY RUN — nothing executed. Re-run with --apply to execute.")
    sys.exit(0)

# ── 2. Execute folds ─────────────────────────────────────────────────────────
def esc(s):
    return str(s).replace("'", "''")

for key, keep, dups in actions:
    keep_id = int(keep["product_id"])
    keep_name = keep["product_ru"]
    keep_parent_en = keep["parent_product_en"]
    for d in dups:
        dup_id = int(d["product_id"])
        dup_name = d["product_ru"]

        # 2a. recipes: rekey dup-spelled recipes onto the canonical name.
        # If canonical already has a production recipe, keep canonical's rows
        # and drop the dup's production rows instead of merging duplicates.
        clash = sql(f"""
            SELECT ingredient_id, COUNT(*) AS n
            FROM workspace.inventory_tabular.fact_recipe_ingredients
            WHERE recipe_product_name IN ('{esc(dup_name)}', '{esc(keep_name)}')
              AND recipe_type = 'production'
            GROUP BY ingredient_id
            HAVING COUNT(*) > 1
        """)
        for c in clash:
            exec_stmt(f"""DELETE FROM workspace.inventory_tabular.fact_recipe_ingredients
                WHERE recipe_product_name = '{esc(dup_name)}' AND recipe_type = 'production'
                  AND ingredient_id = {c['ingredient_id']}""")
        exec_stmt(f"""UPDATE workspace.inventory_tabular.fact_recipe_ingredients
            SET recipe_product_name = '{esc(keep_name)}'
            WHERE recipe_product_name = '{esc(dup_name)}'""")

        # 2b. children pointing at the dup as parent
        exec_stmt(f"""UPDATE workspace.gold.dim_product
            SET parent_product_id = {keep_id}, parent_product_en = '{esc(keep_parent_en)}'
            WHERE parent_product_id = {dup_id}""")

        # 2c. cook pay remap (skip if canonical already carries a rate)
        pay = sql(f"""SELECT product_name, pay_rate FROM workspace.inventory_tabular.dim_cook_unit_pay
            WHERE product_name IN ('{esc(dup_name)}', '{esc(keep_name)}')""")
        by_name = {p["product_name"]: p["pay_rate"] for p in pay}
        if dup_name in by_name and keep_name not in by_name:
            exec_stmt(f"""UPDATE workspace.inventory_tabular.dim_cook_unit_pay
                SET product_name = '{esc(keep_name)}'
                WHERE product_name = '{esc(dup_name)}'""")
        elif dup_name in by_name and keep_name in by_name:
            exec_stmt(f"""DELETE FROM workspace.inventory_tabular.dim_cook_unit_pay
                WHERE product_name = '{esc(dup_name)}'""")

        # 2d. retire the duplicate row (historical POS spellings keep matching it)
        exec_stmt(f"""UPDATE workspace.gold.dim_product
            SET is_active = false WHERE product_id = {dup_id}""")

# ── 3. Validation ────────────────────────────────────────────────────────────
still = sql("""
    SELECT lower(trim(product_ru)) AS k, COUNT(*) AS n
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL AND is_modifier = false
    GROUP BY lower(trim(product_ru))
    HAVING COUNT(*) > 1
""")
orphans = sql("""
    SELECT recipe_type, COUNT(*) AS unmatched
    FROM (SELECT DISTINCT recipe_product_name, recipe_type
          FROM workspace.inventory_tabular.fact_recipe_ingredients) r
    LEFT JOIN workspace.gold.dim_product p ON r.recipe_product_name = p.product_ru
    WHERE p.product_id IS NULL
    GROUP BY recipe_type
""")
print("\nvalidation — remaining same-normalized dup groups:", len(still))
for r in still:
    print("  ", r)
print("orphan recipe keys after cleanup:", orphans)
print("done")
