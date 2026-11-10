# -*- coding: utf-8 -*-
"""
One-time bronze normalization: rewrite historical POS spelling variants in
workspace.default.transactions to the canonical dim_product spellings, so
sales join dims by exact spelling going forward (append-only bronze — each
rewrite is permanent; future drift handled by extending OLD_TO_CANON and re-run).

Ledger of every rename is appended to scratch/bronze_rename_log.json
(provenance lives here, NOT as a lakehouse table).

Default is DRY RUN (reports counts only). Pass --apply to execute.
Idempotent: re-running converges to 0 updates.
"""
import sys, json, time, re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".streamlit" / "secrets.toml"
LEDGER = ROOT / "scratch" / "bronze_rename_log.json"
APPLY = "--apply" in sys.argv

# OLD POS spelling (exact) -> canonical dim_product.product_ru.
# Extend this mapping when the drift report flags a new spelling.
OLD_TO_CANON = {
    "Айс Латте лаванда":              "Айс Латте Лаванда",
    "Вишневая кислинка лимонад":      "Вишневая кислинка Лимонад",
    "Бабл-ти  Лаймовый (чай)":        "Бабл-ти Лаймовый (чай)",
    "Моти сливочный":                 "Моти Сливочный",
    "Моти рафаэлло":                  "Моти Рафаэлло",
    "Корн-дог сыр":                   "Корн-дог с сыром",
    "Моти банан-шоколад":             "Моти Банан в шоколаде",
    "Блинчики нутелла (2шт)":         "Блинчики с нутеллой (2шт)",
    # case-only variants, included defensively (POS never wrote these, but re-run safe)
    "Моти манго":                     "Моти Манго",
    "Моти нутелла":                   "Моти Нутелла",
    "Моти орео":                      "Моти Орео",
    "Моти лесные ягоды":              "Моти Лесные ягоды",
}

token = warehouse_id = None
for line in SECRETS.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line.startswith("token ="):
        token = line.split("=", 1)[1].strip().strip('"').strip("'")
    elif line.startswith("warehouse_id ="):
        warehouse_id = line.split("=", 1)[1].strip().strip('"').strip("'")
warehouse_id = warehouse_id or '959d56e804ae9b36'
URL = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements"

def sql(stmt):
    body = json.dumps({"statement": stmt, "warehouse_id": warehouse_id, "wait_timeout": "50s"}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    t0 = time.time()
    while result.get("status", {}).get("state") in ("PENDING", "RUNNING") and time.time() - t0 < 120:
        time.sleep(2)
        req2 = urllib.request.Request(f"{URL}/{result['statement_id']}", method="GET",
            headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req2, timeout=30) as r2:
            result = json.loads(r2.read())
    if result.get("status", {}).get("state") != "SUCCEEDED":
        raise RuntimeError(f"SQL failed: {str(result.get('status', {}).get('error'))[:300]}")
    cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
    return [dict(zip(cols, row)) for row in (result.get("result", {}).get("data_array") or [])]

# sanity: every canonical spelling must exist exactly once in dim_product
for old, canon in OLD_TO_CANON.items():
    hit = sql(f"SELECT product_id FROM workspace.gold.dim_product WHERE product_ru = '{canon}'")
    assert len(hit) == 1, f"canonical '{canon}' not resolved uniquely in dim_product: {hit}"

entries = [f"'{old.replace(chr(39), chr(39) * 2)}'" for old in OLD_TO_CANON]
counts = sql(f"""
    SELECT product, COUNT(*) AS n, CAST(MIN(date) AS STRING) AS first_seen,
           CAST(MAX(date) AS STRING) AS last_seen
    FROM workspace.default.transactions
    WHERE product IN ({', '.join(entries)})
    GROUP BY product ORDER BY product
""")
plan = {c["product"]: {"rows": int(c["n"]), "first": c["first_seen"], "last": c["last_seen"],
                       "canon": OLD_TO_CANON[c["product"]]} for c in counts}
total = sum(p["rows"] for p in plan.values())
print(f"rows to rewrite: {total}")
for old, p in plan.items():
    print(f"  {old!r:40} -> {p['canon']!r:36} rows={p['rows']:>5} ({p['first']}..{p['last']})")

if not APPLY:
    print("\nDRY RUN — nothing executed. Re-run with --apply.")
    sys.exit(0)

ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else []
for old, p in plan.items():
    if p["rows"] == 0:
        continue
    esc_old = old.replace("'", "''")
    esc_new = p["canon"].replace("'", "''")
    sql(f"""UPDATE workspace.default.transactions
            SET product = '{esc_new}' WHERE product = '{esc_old}'""")
    print(f"  rewritten {p['rows']:>5}: {old!r} -> {p['canon']!r}")
    ledger.append({
        "ts": datetime.now(timezone.utc).isoformat(),
        "old": old, "canon": p["canon"], "rows": p["rows"],
        "first_seen": p["first"], "last_seen": p["last"],
        "script": "scripts/normalize_bronze_product_names.py",
    })
LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\nledger -> {LEDGER}")

# verification: after rewrite no mapped spelling remains
left = sql(f"SELECT COUNT(*) AS n FROM workspace.default.transactions WHERE product IN ({', '.join(entries)})")
print(f"rows still on old spellings: {left[0]['n']}")
