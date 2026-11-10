# -*- coding: utf-8 -*-
"""
Deduplicate workspace.gold.dim_product rows that differ only by formatting
(letter case, double spaces) and rekey fact_recipe_ingredients onto the
canonical dim_product spellings.

CANONICAL SPELLINGS ARE EXPLICIT below (review before --apply), matching the
menu-manager naming standard: Title Case, single spaces, English parent name.

Folding per duplicate pair (dup -> canonical):
  - fact_recipe_ingredients: recipe_product_name = canonical (production + retail)
  - gold.dim_product children: parent_product_id / parent_product_en -> canonical
  - dim_product dup row itself: is_active = false (history keeps pointing at it)
  - inventory_tabular.dim_cook_unit_pay: product_name remap (skipped if the
    canonical row already has a pay rate)

Recipe-key renames (fact_recipe_ingredients) are applied for keys that a dim
row simply renamed (e.g. Кorн-дог сыр -> Корн-дог с сыром). 'Тапиока в шариках'
has NO dim row yet — add it in menu-manager, then run this script again.

Default is DRY RUN (plans only). Pass --apply to execute.
"""
import sys, json, time, re
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".streamlit" / "secrets.toml"
APPLY = "--apply" in sys.argv

# ── explicit canonical mapping (normalized lower-key → keep row) ─────────────
# Review carefully — these spellings become the master throughout the stack.
CANON = {
    "моти сливочный":          (217, "Моти Сливочный"),
    "моти рафаэлло":           (253, "Моти Рафаэлло"),
    "вишневая кислинка лимонад": (70, "Вишневая кислинка Лимонад"),
    "айс латте лаванда":       (181, "Айс Латте Лаванда"),
    "бабл-ти лаймовый (чай)":  (99, "Бабл-ти Лаймовый (чай)"),
}
# parent_product_en fixes for kept rows whose English parent got dirty
KEEP_PARENT_FIX = {
    181: "Ice Latte Lavender",
}

# fact_recipe_ingredients keys that renamed / case-fixed in the catalog
REKEY_RECIPE_KEYS = {
    "моти манго":            "Моти Манго",
    "моти нутелла":          "Моти Нутелла",
    "моти орео":             "Моти Орео",
    "моти лесные ягоды":     "Моти Лесные ягоды",
    "блинчики нутелла (2шт)": "Блинчики с нутеллой (2шт)",
    "корн-дог сыр":          "Корн-дог с сыром",
    "моти банан-шоколад":    "Моти Банан в шоколаде",
}
# keys that cannot be rekeyed automatically — require adding the product to dim
PENDING_DIM_ADDITIONS = ["тапиока в шариках"]

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

# ── 1. Find duplicate groups (explicit mapping drives canonical choice) ──────
products = sql("""
    SELECT product_id, product_ru, parent_product_id, parent_product_en, variant,
           category, subcategory, is_active, is_modifier, base_price, cost
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
""") or []
by_id = {int(p["product_id"]): p for p in products}
by_norm = {}
for p in products:
    by_norm.setdefault(norm(p["product_ru"]), []).append(p)

actions = []
missing_canon = []
for key, (keep_id, keep_ru) in CANON.items():
    if keep_id not in by_id:
        raise RuntimeError(f"CANON references missing product_id {keep_id} ({keep_ru})")
    keep = by_id[keep_id]
    if keep["product_ru"].strip() != keep_ru:
        raise RuntimeError(f"CANON product_ru mismatch for id {keep_id}: table has '{keep['product_ru']}'")
    dups = [p for p in by_norm.get(key, []) if int(p["product_id"]) != keep_id]
    if not dups:
        actions.append((key, keep, []))  # already folded, nothing to do
    else:
        actions.append((key, keep, dups))

# prod-recipe keys sanity: which rekey targets exist?
prod_recipe_keys = {r["recipe_product_name"] for r in sql(
    "SELECT DISTINCT recipe_product_name FROM workspace.inventory_tabular.fact_recipe_ingredients WHERE recipe_type = 'production'")}
all_recipe_keys = {r["recipe_product_name"] for r in sql(
    "SELECT DISTINCT recipe_product_name FROM workspace.inventory_tabular.fact_recipe_ingredients")}

print(f"duplicate groups handled: {len(actions)}")
for key, keep, dups in actions:
    print(f"  [{key}] canonical: id={keep['product_id']} '{keep['product_ru']}'"
          + (" — already folded" if not dups else f" <- folds {[(d['product_id'], d['product_ru']) for d in dups]}"))

print("\nrecipe-key renames:")
for src_norm, tgt in REKEY_RECIPE_KEYS.items():
    hits = [k for k in all_recipe_keys if norm(k) == src_norm]
    print(f"  {hits or src_norm!r} -> '{tgt}'"
          + ("" if hits else "  (no fact rows use this key — nothing to do)"))
    if hits and tgt not in by_norm and norm(tgt) not in by_norm:
        missing_canon.append(tgt)

for key in PENDING_DIM_ADDITIONS:
    if key not in by_norm:
        print(f"  PENDING: recipe key '{key}' has no dim_product row — ADD IN MENU-MANAGER first")

if missing_canon:
    raise RuntimeError(f"rekey targets missing from dim_product: {missing_canon}")

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

# 2e. parent_product_en tidy-up for retained canonical rows
for pid, parent_en in KEEP_PARENT_FIX.items():
    exec_stmt(f"""UPDATE workspace.gold.dim_product
        SET parent_product_en = '{esc(parent_en)}' WHERE product_id = {pid}""")

# 2f. recipe-key renames: production + retail rows still keyed on old spellings.
# If the target spelling already exists (dual-writes created both), keep the
# TARGET's rows and only migrate ingredient_ids the target doesn't have yet.
print("\nrecipe-key renames:")
for src_norm, tgt in REKEY_RECIPE_KEYS.items():
    keys = [k for k in all_recipe_keys if norm(k) == src_norm]
    for k in keys:
        tgt_ids = {r["ingredient_id"] for r in sql(f"""
            SELECT ingredient_id FROM workspace.inventory_tabular.fact_recipe_ingredients
            WHERE recipe_product_name = '{esc(tgt)}'""")}
        src_rows = sql(f"""
            SELECT ingredient_id, COUNT(*) AS n
            FROM workspace.inventory_tabular.fact_recipe_ingredients
            WHERE recipe_product_name = '{esc(k)}'
            GROUP BY ingredient_id""")
        moved = dropped = 0
        for row in src_rows:
            ing = row["ingredient_id"]
            n = int(row["n"])
            if ing in tgt_ids:
                exec_stmt(f"""DELETE FROM workspace.inventory_tabular.fact_recipe_ingredients
                    WHERE recipe_product_name = '{esc(k)}' AND ingredient_id = {ing}""")
                dropped += n
            else:
                exec_stmt(f"""UPDATE workspace.inventory_tabular.fact_recipe_ingredients
                    SET recipe_product_name = '{esc(tgt)}'
                    WHERE recipe_product_name = '{esc(k)}' AND ingredient_id = {ing}""")
                moved += n
        print(f"  '{k}' -> '{tgt}' ({moved} rows migrated, {dropped} duplicates of existing target rows dropped)")
        all_recipe_keys.discard(k); all_recipe_keys.add(tgt)

# ── 2g. Attach fact rows to dim_product by product_id ────────────────────────
# Canonical rows for the whole catalog: recipes match the ACTIVE dim spelling.
# Retired spellings (dup rows / renames) have no id to earn — they get NULLed
# so validation stays honest. Idempotent: re-runs converge.
pre = sql("""
    SELECT f.recipe_type AS recipe_type, COUNT(*) AS rows_total,
           SUM(CASE WHEN f.product_id IS NULL THEN 1 ELSE 0 END) AS rows_without_id,
           SUM(CASE WHEN p.product_id IS NULL OR p.product_id != f.product_id THEN 1 ELSE 0 END) AS rows_mismatched
    FROM workspace.inventory_tabular.fact_recipe_ingredients f
    LEFT JOIN (SELECT product_id, product_ru FROM workspace.gold.dim_product
               WHERE COALESCE(is_active, true)) p
           ON f.recipe_product_name = p.product_ru
    GROUP BY f.recipe_type
""")
print("\nfact_recipe_ingredients.product_id state before backfill:")
for r in pre:
    print(f"  [{r['recipe_type']}] rows={r['rows_total']} without_id={r['rows_without_id']} mismatched={r['rows_mismatched']}")

exec_stmt("""
MERGE INTO workspace.inventory_tabular.fact_recipe_ingredients f
USING (
    SELECT product_id, parent_product_id, product_ru
    FROM workspace.gold.dim_product
    WHERE COALESCE(is_active, true)
) p
ON f.recipe_product_name = p.product_ru
WHEN MATCHED THEN UPDATE
    SET f.product_id = p.product_id, f.parent_product_id = p.parent_product_id
WHEN NOT MATCHED THEN UPDATE
    SET f.product_id = NULL, f.parent_product_id = NULL
""")

# ── 3. Validation ────────────────────────────────────────────────────────────
still = sql("""
    SELECT lower(trim(product_ru)) AS k, COUNT(*) AS n
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
      AND COALESCE(is_active, true)
      AND is_modifier = false
    GROUP BY lower(trim(product_ru))
    HAVING COUNT(*) > 1
""")
orphans = sql("""
    SELECT r.recipe_product_name AS key, r.recipe_type AS recipe_type
    FROM (SELECT DISTINCT recipe_product_name, recipe_type
          FROM workspace.inventory_tabular.fact_recipe_ingredients) r
    LEFT JOIN (SELECT product_id, product_ru, is_active FROM workspace.gold.dim_product) p
           ON r.recipe_product_name = p.product_ru
    WHERE (p.product_id IS NULL OR NOT COALESCE(p.is_active, true))
    ORDER BY r.recipe_type, r.recipe_product_name
""")
post = sql("""
    SELECT f.recipe_type AS recipe_type, COUNT(*) AS rows_total,
           SUM(CASE WHEN f.product_id IS NULL THEN 1 ELSE 0 END) AS rows_without_id
    FROM workspace.inventory_tabular.fact_recipe_ingredients f
    GROUP BY f.recipe_type
""")

activity = sql("""
    SELECT recipe_product_name AS key, COUNT(DISTINCT recipe_type) AS types
    FROM workspace.inventory_tabular.fact_recipe_ingredients
    WHERE recipe_type = 'production'
    GROUP BY recipe_product_name
""")
mapped_prods = {p["product_ru"] for p in products if (str(p.get("is_active") or "true").lower() in ("true", "1"))}

print("\nvalidation — active dim_product same-normalized dup groups:", len(still))
for r in still:
    print("  ", r)
print("fact_recipe_ingredients.product_id after backfill:")
for r in post:
    print(f"  [{r['recipe_type']}] rows={r['rows_total']} without_id={r['rows_without_id']}")
print("production recipes NOT keyed on an ACTIVE dim_product spelling:")
for r in orphans:
    if r["recipe_type"] == "production":
        print(f"  [{r['recipe_type']}] {r['key']}  (retail pseudo-products below are expected)")
    else:
        print(f"  [{r['recipe_type']}] {r['key']}")
print(f"production recipe keys total: {len(activity)}; "
      f"expected 12/13 matched until 'Тапиока в шариках' is added in menu-manager")
print("done")
