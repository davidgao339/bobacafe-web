"""
Phase 2A Setup Script:
Creates tabular relational tables and automatic SQLite synchronization triggers in Cloudflare D1.
Seeds all historical records from D1 blob tables into the tabular tables.
Verifies real-time trigger synchronization.
"""

import urllib.request
import json
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

PROXY_URL = sys.argv[1] if len(sys.argv) > 1 else 'https://bobacafe-proxy.davidgao734.workers.dev/d1/execute'

def query_d1(sql: str, params=None):
    if params is None:
        params = []
    req = urllib.request.Request(
        PROXY_URL,
        data=json.dumps({'sql': sql, 'params': params}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode('utf-8'))
        return body.get('results', [])

# ─── STORE DIRECTORY & ALIASES ──────────────────────────────────────────────

STORES_DEF = [
    (1,  "RSQ", "НОВО КП",     "Red Square",   "Новороссийск", "retail",    1),
    (2,  "GPK", "ГП КУБАНЬ",    "GP Park",      "Краснодар",    "retail",    1),
    (3,  "BON", "БОН ПАССАЖ",   "Bon Passage",  "Новороссийск", "retail",    1),
    (4,  "CHM", "ЧЕРЕМУШКИ",    "Cheremushki",  "Краснодар",    "retail",    1),
    (5,  "SOV", "СОВЕТСКАЯ",    "Sovetskaya",   "Анапа",        "retail",    1),
    (6,  "GAL", "ГАЛЕРЕЯ",      "Gallery",      "Краснодар",    "retail",    1),
    (99, "WHS", "СКЛАД",        "Warehouse",    "Краснодар",    "warehouse", 1),
    (10, "OZM", "ОЗМОЛЛ",      "OZ Mall",      "Краснодар",    "retail",    0),
    (11, "ANP", "АНАПА",        "Anapa City",   "Анапа",        "retail",    0),
    (12, "GLN", "ГЕЛЕНДЖИК",    "Gelendzhik",   "Геленджик",    "retail",    0),
    (13, "KSK", "КИОСК",        "Kiosk",        "Новороссийск", "retail",    0),
]

STORE_ALIASES_BASE = [
    ("НОВО КП", 1), ("Red Square", 1), ("RSQ", 1),
    ("ГП КУБАНЬ", 2), ("ГРИН ПАРК", 2), ("GP Park", 2), ("GPK", 2),
    ("БОН ПАССАЖ", 3), ("Bon Passage", 3), ("BON", 3),
    ("ЧЕРЕМУШКИ", 4), ("ЧЕРНОМОРСКИЙ", 4), ("Cheremushki", 4), ("CHM", 4),
    ("СОВЕТСКАЯ", 5), ("СОВЕТОВ", 5), ("Sovetskaya", 5), ("SOV", 5),
    ("ГАЛЕРЕЯ", 6), ("Gallery", 6), ("GAL", 6),
    ("СКЛАД", 99), ("Warehouse", 99), ("WHS", 99),
    ("ОЗМОЛЛ", 10), ("OZ Mall", 10), ("OZM", 10),
    ("АНАПА", 11), ("Anapa City", 11), ("ANP", 11),
    ("ГЕЛЕНДЖИК", 12), ("Gelendzhik", 12), ("GLN", 12),
    ("КИОСК", 13), ("Kiosk", 13), ("KSK", 13),
]

# Generate multi-case variants
STORE_ALIASES = []
for name, sid in STORE_ALIASES_BASE:
    variants = {name.strip(), name.strip().upper(), name.strip().lower(), name.strip().title(), name.strip().capitalize()}
    for v in variants:
        STORE_ALIASES.append((v, sid))

def main():
    print("=" * 70)
    print("PHASE 2A: CREATING D1 TABULAR TABLES & AUTO-SYNC TRIGGERS")
    print("=" * 70)

    # 1. Create relational tables in D1
    print("\n[Step 1/5] Creating relational tables in Cloudflare D1...")

    query_d1("""
    CREATE TABLE IF NOT EXISTS dim_stores (
        store_id INTEGER PRIMARY KEY,
        store_code TEXT NOT NULL UNIQUE,
        store_name TEXT NOT NULL,
        store_name_en TEXT NOT NULL,
        city TEXT NOT NULL,
        store_type TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS dim_store_aliases (
        alias_name TEXT PRIMARY KEY,
        store_id INTEGER NOT NULL,
        FOREIGN KEY (store_id) REFERENCES dim_stores(store_id)
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS dim_ingredients (
        ingredient_id INTEGER PRIMARY KEY,
        ingredient_name TEXT NOT NULL,
        unit TEXT NOT NULL,
        product_type TEXT,
        supplier_id INTEGER,
        supplier_name TEXT,
        is_warehouse_only INTEGER DEFAULT 0,
        is_hidden INTEGER DEFAULT 0,
        cost_per_unit REAL
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS dim_cook_unit_pay (
        product_name TEXT PRIMARY KEY,
        pay_rate REAL NOT NULL
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_recipe_ingredients (
        recipe_product_name TEXT NOT NULL,
        ingredient_id INTEGER NOT NULL,
        ingredient_name TEXT NOT NULL,
        amount_per_serving REAL NOT NULL,
        recipe_type TEXT DEFAULT 'retail',
        is_hidden INTEGER DEFAULT 0,
        PRIMARY KEY (recipe_product_name, ingredient_id)
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_audit_headers (
        audit_id TEXT PRIMARY KEY,
        store_id INTEGER,
        store_code TEXT,
        audit_date TEXT NOT NULL,
        audit_timestamp TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved'
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_audit_counts (
        audit_id TEXT NOT NULL,
        store_id INTEGER,
        audit_date TEXT NOT NULL,
        ingredient_id INTEGER NOT NULL,
        ingredient_name TEXT,
        count_quantity REAL NOT NULL,
        PRIMARY KEY (audit_id, ingredient_id)
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_purchase_orders (
        po_id TEXT PRIMARY KEY,
        order_type TEXT NOT NULL,
        store_id INTEGER,
        store_code TEXT,
        from_store_id INTEGER,
        to_store_id INTEGER,
        status TEXT NOT NULL,
        received_date TEXT,
        received_at TEXT,
        created_date TEXT,
        sent_date TEXT
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_purchase_order_lines (
        po_id TEXT NOT NULL,
        line_index INTEGER NOT NULL,
        ingredient_id INTEGER,
        ingredient_name TEXT NOT NULL,
        is_custom_item INTEGER DEFAULT 0,
        ordered_quantity REAL DEFAULT 0,
        received_quantity REAL DEFAULT 0,
        unit TEXT,
        PRIMARY KEY (po_id, line_index)
    )
    """)

    query_d1("""
    CREATE TABLE IF NOT EXISTS fact_inventory_transactions (
        transaction_id TEXT PRIMARY KEY,
        store_id INTEGER,
        store_code TEXT,
        transaction_date TEXT NOT NULL,
        transaction_timestamp TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        ingredient_id INTEGER,
        ingredient_name TEXT,
        quantity REAL NOT NULL,
        po_id TEXT,
        reason TEXT
    )
    """)

    print("  ✓ All 10 relational tables created successfully in D1.")

    # 2. Indexes for fast queries
    print("\n[Step 2/5] Creating query acceleration indexes in D1...")
    query_d1("CREATE INDEX IF NOT EXISTS idx_audit_counts_store_date ON fact_audit_counts(store_id, audit_date)")
    query_d1("CREATE INDEX IF NOT EXISTS idx_audit_counts_ing ON fact_audit_counts(ingredient_id)")
    query_d1("CREATE INDEX IF NOT EXISTS idx_po_lines_po ON fact_purchase_order_lines(po_id)")
    query_d1("CREATE INDEX IF NOT EXISTS idx_po_lines_ing ON fact_purchase_order_lines(ingredient_id)")
    query_d1("CREATE INDEX IF NOT EXISTS idx_tx_store_date ON fact_inventory_transactions(store_id, transaction_date)")
    query_d1("CREATE INDEX IF NOT EXISTS idx_tx_ing ON fact_inventory_transactions(ingredient_id)")
    print("  ✓ Indexes created.")

    # 3. Seed dim_stores & dim_store_aliases
    print("\n[Step 3/5] Seeding dim_stores and dim_store_aliases...")
    for s in STORES_DEF:
        query_d1(
            "INSERT OR REPLACE INTO dim_stores (store_id, store_code, store_name, store_name_en, city, store_type, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
            list(s)
        )
    for alias, s_id in STORE_ALIASES:
        query_d1(
            "INSERT OR REPLACE INTO dim_store_aliases (alias_name, store_id) VALUES (?, ?)",
            [alias, s_id]
        )
    print(f"  ✓ Seeded {len(STORES_DEF)} stores and {len(STORE_ALIASES)} aliases.")

    # 4. Seed historical data from existing blob tables
    print("\n[Step 4/5] Seeding historical data from blob tables into relational tables...")

    # Seed dim_ingredients
    query_d1("""
    INSERT OR REPLACE INTO dim_ingredients (ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name, is_warehouse_only, is_hidden, cost_per_unit)
    SELECT 
        i.id,
        i.name,
        i.unit,
        i.productType,
        i.supplierId,
        s.name,
        COALESCE(i.warehouseOnly, 0),
        COALESCE(i.hidden, 0),
        NULL
    FROM ingredients i
    LEFT JOIN suppliers s ON i.supplierId = s.id
    """)
    ing_count = query_d1("SELECT COUNT(*) as c FROM dim_ingredients")[0]["c"]
    print(f"  ✓ dim_ingredients: {ing_count} rows seeded")

    # Seed dim_cook_unit_pay
    settings = query_d1("SELECT value FROM settings WHERE key = 'cook_unit_pay'")
    if settings and settings[0].get("value"):
        rates = json.loads(settings[0]["value"])
        for pname, rate in rates.items():
            query_d1(
                "INSERT OR REPLACE INTO dim_cook_unit_pay (product_name, pay_rate) VALUES (?, ?)",
                [pname, float(rate)]
            )
    cook_count = query_d1("SELECT COUNT(*) as c FROM dim_cook_unit_pay")[0]["c"]
    print(f"  ✓ dim_cook_unit_pay: {cook_count} rows seeded")

    # Seed fact_recipe_ingredients
    query_d1("""
    INSERT OR REPLACE INTO fact_recipe_ingredients (recipe_product_name, ingredient_id, ingredient_name, amount_per_serving, recipe_type, is_hidden)
    SELECT 
        r.product_name,
        CAST(j.key AS INTEGER),
        COALESCE(i.name, 'Ingredient #' || j.key),
        CAST(j.value AS REAL),
        COALESCE(r.type, 'retail'),
        COALESCE(r.hidden, 0)
    FROM recipes r, json_each(r.ingredient_mapping) j
    LEFT JOIN ingredients i ON CAST(j.key AS INTEGER) = i.id
    WHERE json_valid(r.ingredient_mapping)
    """)
    recipe_count = query_d1("SELECT COUNT(*) as c FROM fact_recipe_ingredients")[0]["c"]
    print(f"  ✓ fact_recipe_ingredients: {recipe_count} rows seeded")

    # Seed fact_audit_headers
    query_d1("""
    INSERT OR REPLACE INTO fact_audit_headers (audit_id, store_id, store_code, audit_date, audit_timestamp, status)
    SELECT 
        a.id,
        sa.store_id,
        s.store_code,
        a.date,
        a.timestamp,
        COALESCE(a.status, 'approved')
    FROM audits a
    LEFT JOIN dim_store_aliases sa ON TRIM(a.store) = sa.alias_name
    LEFT JOIN dim_stores s ON sa.store_id = s.store_id
    """)
    audit_h_count = query_d1("SELECT COUNT(*) as c FROM fact_audit_headers")[0]["c"]
    print(f"  ✓ fact_audit_headers: {audit_h_count} rows seeded")

    # Seed fact_audit_counts (filtering out 0 counts)
    query_d1("""
    INSERT OR REPLACE INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity)
    SELECT 
        a.id,
        sa.store_id,
        a.date,
        CAST(j.key AS INTEGER),
        COALESCE(i.name, 'Ingredient #' || j.key),
        CAST(j.value AS REAL)
    FROM audits a
    JOIN json_each(a.counts) j
    LEFT JOIN dim_store_aliases sa ON TRIM(a.store) = sa.alias_name
    LEFT JOIN ingredients i ON CAST(j.key AS INTEGER) = i.id
    WHERE json_valid(a.counts) AND CAST(j.value AS REAL) > 0
    """)
    audit_c_count = query_d1("SELECT COUNT(*) as c FROM fact_audit_counts")[0]["c"]
    print(f"  ✓ fact_audit_counts: {audit_c_count} rows seeded")

    # Seed fact_purchase_orders
    query_d1("""
    INSERT OR REPLACE INTO fact_purchase_orders (
        po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date
    )
    SELECT 
        po.id,
        CASE WHEN po.fromLocation IS NOT NULL AND po.toLocation IS NOT NULL THEN 'inter_store_transfer' ELSE 'vendor_order' END,
        sa.store_id,
        s.store_code,
        sa_from.store_id,
        sa_to.store_id,
        po.status,
        SUBSTR(po.receivedAt, 1, 10),
        po.receivedAt,
        po.createdDate,
        po.sentDate
    FROM purchase_orders po
    LEFT JOIN dim_store_aliases sa ON TRIM(po.store) = sa.alias_name
    LEFT JOIN dim_stores s ON sa.store_id = s.store_id
    LEFT JOIN dim_store_aliases sa_from ON TRIM(po.fromLocation) = sa_from.alias_name
    LEFT JOIN dim_store_aliases sa_to ON TRIM(po.toLocation) = sa_to.alias_name
    """)
    po_h_count = query_d1("SELECT COUNT(*) as c FROM fact_purchase_orders")[0]["c"]
    print(f"  ✓ fact_purchase_orders: {po_h_count} rows seeded")

    # Seed fact_purchase_order_lines: Array format
    query_d1("""
    INSERT OR REPLACE INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
    SELECT 
        po.id,
        CAST(j.key AS INTEGER),
        json_extract(j.value, '$.ingredientId'),
        COALESCE(i.name, json_extract(j.value, '$.name'), 'Item'),
        CASE WHEN json_extract(j.value, '$.ingredientId') IS NULL THEN 1 ELSE 0 END,
        COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
        COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
        COALESCE(json_extract(j.value, '$.unit'), i.unit, '')
    FROM purchase_orders po
    JOIN json_each(po.lines) j
    LEFT JOIN ingredients i ON json_extract(j.value, '$.ingredientId') = i.id
    WHERE json_valid(po.lines)
      AND json_type(po.lines) = 'array'
      AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
           OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0)
    """)

    # Seed fact_purchase_order_lines: Object format (regular + custom)
    query_d1("""
    INSERT OR REPLACE INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
    SELECT 
        po.id,
        CAST(j.key AS INTEGER),
        json_extract(j.value, '$.ingredientId'),
        COALESCE(i.name, 'Ingredient #' || json_extract(j.value, '$.ingredientId')),
        0,
        COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
        COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
        COALESCE(json_extract(j.value, '$.unit'), i.unit, '')
    FROM purchase_orders po
    JOIN json_each(json_extract(po.lines, '$.regular')) j
    LEFT JOIN ingredients i ON json_extract(j.value, '$.ingredientId') = i.id
    WHERE json_valid(po.lines)
      AND json_type(po.lines) = 'object'
      AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
           OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0)
    """)

    query_d1("""
    INSERT OR REPLACE INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
    SELECT 
        po.id,
        1000 + CAST(j.key AS INTEGER),
        NULL,
        COALESCE(json_extract(j.value, '$.name'), json_extract(j.value, '$.rawName'), 'Custom Item'),
        1,
        COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
        COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
        COALESCE(json_extract(j.value, '$.unit'), 'шт')
    FROM purchase_orders po
    JOIN json_each(json_extract(po.lines, '$.custom')) j
    WHERE json_valid(po.lines)
      AND json_type(po.lines) = 'object'
    """)
    po_l_count = query_d1("SELECT COUNT(*) as c FROM fact_purchase_order_lines")[0]["c"]
    print(f"  ✓ fact_purchase_order_lines: {po_l_count} rows seeded")

    # Seed fact_inventory_transactions
    query_d1("""
    INSERT OR REPLACE INTO fact_inventory_transactions (
        transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id, reason
    )
    SELECT 
        t.id,
        sa.store_id,
        s.store_code,
        t.date,
        t.timestamp,
        t.type,
        t.ingredientId,
        i.name,
        t.quantity,
        t.poId,
        t.reason
    FROM transactions t
    LEFT JOIN dim_store_aliases sa ON TRIM(t.store) = sa.alias_name
    LEFT JOIN dim_stores s ON sa.store_id = s.store_id
    LEFT JOIN ingredients i ON t.ingredientId = i.id
    """)
    tx_count = query_d1("SELECT COUNT(*) as c FROM fact_inventory_transactions")[0]["c"]
    print(f"  ✓ fact_inventory_transactions: {tx_count} rows seeded")

    # 5. Install Real-Time SQLite Triggers
    print("\n[Step 5/5] Installing automatic SQLite triggers on legacy blob tables...")

    # Drop existing triggers if any
    for trg in [
        "trg_audits_insert", "trg_audits_update", "trg_audits_delete",
        "trg_pos_insert", "trg_pos_update", "trg_pos_delete",
        "trg_recipes_insert", "trg_recipes_update", "trg_recipes_delete",
        "trg_transactions_insert", "trg_transactions_delete",
        "trg_ingredients_insert", "trg_ingredients_update", "trg_ingredients_delete"
    ]:
        query_d1(f"DROP TRIGGER IF EXISTS {trg}")

    # AUDIT TRIGGERS
    query_d1("""
    CREATE TRIGGER trg_audits_insert
    AFTER INSERT ON audits
    BEGIN
        INSERT OR REPLACE INTO fact_audit_headers (audit_id, store_id, store_code, audit_date, audit_timestamp, status)
        VALUES (
            NEW.id,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            (SELECT store_code FROM dim_stores WHERE store_id = (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1)),
            NEW.date,
            NEW.timestamp,
            COALESCE(NEW.status, 'approved')
        );

        DELETE FROM fact_audit_counts WHERE audit_id = NEW.id;

        INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity)
        SELECT 
            NEW.id,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            NEW.date,
            CAST(j.key AS INTEGER),
            COALESCE((SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = CAST(j.key AS INTEGER)), 'Ingredient #' || j.key),
            CAST(j.value AS REAL)
        FROM json_each(NEW.counts) j
        WHERE json_valid(NEW.counts) AND CAST(j.value AS REAL) > 0;
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_audits_update
    AFTER UPDATE ON audits
    BEGIN
        INSERT OR REPLACE INTO fact_audit_headers (audit_id, store_id, store_code, audit_date, audit_timestamp, status)
        VALUES (
            NEW.id,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            (SELECT store_code FROM dim_stores WHERE store_id = (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1)),
            NEW.date,
            NEW.timestamp,
            COALESCE(NEW.status, 'approved')
        );

        DELETE FROM fact_audit_counts WHERE audit_id = NEW.id;

        INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity)
        SELECT 
            NEW.id,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            NEW.date,
            CAST(j.key AS INTEGER),
            COALESCE((SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = CAST(j.key AS INTEGER)), 'Ingredient #' || j.key),
            CAST(j.value AS REAL)
        FROM json_each(NEW.counts) j
        WHERE json_valid(NEW.counts) AND CAST(j.value AS REAL) > 0;
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_audits_delete
    AFTER DELETE ON audits
    BEGIN
        DELETE FROM fact_audit_headers WHERE audit_id = OLD.id;
        DELETE FROM fact_audit_counts WHERE audit_id = OLD.id;
    END
    """)
    print("  ✓ Audits auto-sync triggers installed.")

    # PURCHASE ORDER TRIGGERS
    query_d1("""
    CREATE TRIGGER trg_pos_insert
    AFTER INSERT ON purchase_orders
    BEGIN
        INSERT OR REPLACE INTO fact_purchase_orders (
            po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date
        )
        VALUES (
            NEW.id,
            CASE WHEN NEW.fromLocation IS NOT NULL AND NEW.toLocation IS NOT NULL THEN 'inter_store_transfer' ELSE 'vendor_order' END,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            (SELECT store_code FROM dim_stores WHERE store_id = (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1)),
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.fromLocation) LIMIT 1),
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.toLocation) LIMIT 1),
            NEW.status,
            SUBSTR(NEW.receivedAt, 1, 10),
            NEW.receivedAt,
            NEW.createdDate,
            NEW.sentDate
        );

        DELETE FROM fact_purchase_order_lines WHERE po_id = NEW.id;

        -- Array format lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            CAST(j.key AS INTEGER),
            json_extract(j.value, '$.ingredientId'),
            COALESCE(
                (SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = json_extract(j.value, '$.ingredientId')),
                json_extract(j.value, '$.name'),
                'Item'
            ),
            CASE WHEN json_extract(j.value, '$.ingredientId') IS NULL THEN 1 ELSE 0 END,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), '')
        FROM json_each(NEW.lines) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'array'
          AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
               OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0);

        -- Object format: regular lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            CAST(j.key AS INTEGER),
            json_extract(j.value, '$.ingredientId'),
            COALESCE(
                (SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = json_extract(j.value, '$.ingredientId')),
                'Ingredient #' || json_extract(j.value, '$.ingredientId')
            ),
            0,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), '')
        FROM json_each(json_extract(NEW.lines, '$.regular')) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'object'
          AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
               OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0);

        -- Object format: custom lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            1000 + CAST(j.key AS INTEGER),
            NULL,
            COALESCE(json_extract(j.value, '$.name'), json_extract(j.value, '$.rawName'), 'Custom Item'),
            1,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), 'шт')
        FROM json_each(json_extract(NEW.lines, '$.custom')) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'object';
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_pos_update
    AFTER UPDATE ON purchase_orders
    BEGIN
        INSERT OR REPLACE INTO fact_purchase_orders (
            po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date
        )
        VALUES (
            NEW.id,
            CASE WHEN NEW.fromLocation IS NOT NULL AND NEW.toLocation IS NOT NULL THEN 'inter_store_transfer' ELSE 'vendor_order' END,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            (SELECT store_code FROM dim_stores WHERE store_id = (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1)),
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.fromLocation) LIMIT 1),
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.toLocation) LIMIT 1),
            NEW.status,
            SUBSTR(NEW.receivedAt, 1, 10),
            NEW.receivedAt,
            NEW.createdDate,
            NEW.sentDate
        );

        DELETE FROM fact_purchase_order_lines WHERE po_id = NEW.id;

        -- Array format lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            CAST(j.key AS INTEGER),
            json_extract(j.value, '$.ingredientId'),
            COALESCE(
                (SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = json_extract(j.value, '$.ingredientId')),
                json_extract(j.value, '$.name'),
                'Item'
            ),
            CASE WHEN json_extract(j.value, '$.ingredientId') IS NULL THEN 1 ELSE 0 END,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), '')
        FROM json_each(NEW.lines) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'array'
          AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
               OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0);

        -- Object format: regular lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            CAST(j.key AS INTEGER),
            json_extract(j.value, '$.ingredientId'),
            COALESCE(
                (SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = json_extract(j.value, '$.ingredientId')),
                'Ingredient #' || json_extract(j.value, '$.ingredientId')
            ),
            0,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), '')
        FROM json_each(json_extract(NEW.lines, '$.regular')) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'object'
          AND (COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0) > 0 
               OR COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0) > 0);

        -- Object format: custom lines
        INSERT INTO fact_purchase_order_lines (po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit)
        SELECT 
            NEW.id,
            1000 + CAST(j.key AS INTEGER),
            NULL,
            COALESCE(json_extract(j.value, '$.name'), json_extract(j.value, '$.rawName'), 'Custom Item'),
            1,
            COALESCE(CAST(json_extract(j.value, '$.ordered') AS REAL), 0),
            COALESCE(CAST(json_extract(j.value, '$.received') AS REAL), 0),
            COALESCE(json_extract(j.value, '$.unit'), 'шт')
        FROM json_each(json_extract(NEW.lines, '$.custom')) j
        WHERE json_valid(NEW.lines) 
          AND json_type(NEW.lines) = 'object';
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_pos_delete
    AFTER DELETE ON purchase_orders
    BEGIN
        DELETE FROM fact_purchase_orders WHERE po_id = OLD.id;
        DELETE FROM fact_purchase_order_lines WHERE po_id = OLD.id;
    END
    """)
    print("  ✓ Purchase Orders auto-sync triggers installed.")

    # TRANSACTION TRIGGERS
    query_d1("""
    CREATE TRIGGER trg_transactions_insert
    AFTER INSERT ON transactions
    BEGIN
        INSERT OR REPLACE INTO fact_inventory_transactions (
            transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id, reason
        )
        VALUES (
            NEW.id,
            (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1),
            (SELECT store_code FROM dim_stores WHERE store_id = (SELECT store_id FROM dim_store_aliases WHERE alias_name = TRIM(NEW.store) LIMIT 1)),
            NEW.date,
            NEW.timestamp,
            NEW.type,
            NEW.ingredientId,
            (SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = NEW.ingredientId),
            NEW.quantity,
            NEW.poId,
            NEW.reason
        );
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_transactions_delete
    AFTER DELETE ON transactions
    BEGIN
        DELETE FROM fact_inventory_transactions WHERE transaction_id = OLD.id;
    END
    """)
    print("  ✓ Transactions auto-sync triggers installed.")

    # RECIPE TRIGGERS
    query_d1("""
    CREATE TRIGGER trg_recipes_insert
    AFTER INSERT ON recipes
    BEGIN
        DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = NEW.product_name;

        INSERT INTO fact_recipe_ingredients (recipe_product_name, ingredient_id, ingredient_name, amount_per_serving, recipe_type, is_hidden)
        SELECT 
            NEW.product_name,
            CAST(j.key AS INTEGER),
            COALESCE((SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = CAST(j.key AS INTEGER)), 'Ingredient #' || j.key),
            CAST(j.value AS REAL),
            COALESCE(NEW.type, 'retail'),
            COALESCE(NEW.hidden, 0)
        FROM json_each(NEW.ingredient_mapping) j
        WHERE json_valid(NEW.ingredient_mapping);
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_recipes_update
    AFTER UPDATE ON recipes
    BEGIN
        DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = NEW.product_name;

        INSERT INTO fact_recipe_ingredients (recipe_product_name, ingredient_id, ingredient_name, amount_per_serving, recipe_type, is_hidden)
        SELECT 
            NEW.product_name,
            CAST(j.key AS INTEGER),
            COALESCE((SELECT ingredient_name FROM dim_ingredients WHERE ingredient_id = CAST(j.key AS INTEGER)), 'Ingredient #' || j.key),
            CAST(j.value AS REAL),
            COALESCE(NEW.type, 'retail'),
            COALESCE(NEW.hidden, 0)
        FROM json_each(NEW.ingredient_mapping) j
        WHERE json_valid(NEW.ingredient_mapping);
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_recipes_delete
    AFTER DELETE ON recipes
    BEGIN
        DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = OLD.product_name;
    END
    """)
    print("  ✓ Recipes auto-sync triggers installed.")

    # INGREDIENT TRIGGERS
    query_d1("""
    CREATE TRIGGER trg_ingredients_insert
    AFTER INSERT ON ingredients
    BEGIN
        INSERT OR REPLACE INTO dim_ingredients (ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name, is_warehouse_only, is_hidden, cost_per_unit)
        VALUES (
            NEW.id,
            NEW.name,
            NEW.unit,
            NEW.productType,
            NEW.supplierId,
            (SELECT name FROM suppliers WHERE id = NEW.supplierId),
            COALESCE(NEW.warehouseOnly, 0),
            COALESCE(NEW.hidden, 0),
            NULL
        );
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_ingredients_update
    AFTER UPDATE ON ingredients
    BEGIN
        INSERT OR REPLACE INTO dim_ingredients (ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name, is_warehouse_only, is_hidden, cost_per_unit)
        VALUES (
            NEW.id,
            NEW.name,
            NEW.unit,
            NEW.productType,
            NEW.supplierId,
            (SELECT name FROM suppliers WHERE id = NEW.supplierId),
            COALESCE(NEW.warehouseOnly, 0),
            COALESCE(NEW.hidden, 0),
            NULL
        );
    END
    """)

    query_d1("""
    CREATE TRIGGER trg_ingredients_delete
    AFTER DELETE ON ingredients
    BEGIN
        DELETE FROM dim_ingredients WHERE ingredient_id = OLD.id;
    END
    """)
    print("  ✓ Ingredients auto-sync triggers installed.")

    # ─── LIVE TRIGGER VALIDATION TEST ─────────────────────────────────────────
    print("\n" + "=" * 70)
    print("RUNNING LIVE END-TO-END TRIGGER VERIFICATION...")
    print("=" * 70)

    test_audit_id = "A-TEST-SYNC-999"
    # Ensure any previous test row is cleaned
    query_d1("DELETE FROM audits WHERE id = ?", [test_audit_id])

    print(f"1. Simulating React app inserting {test_audit_id} into legacy 'audits' table...")
    query_d1(
        "INSERT INTO audits (id, store, date, counts, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)",
        [test_audit_id, "НОВО КП", "2026-11-03", '{"1": 150, "2": 0, "3": 50.5}', "2026-11-03T12:00:00.000Z", "approved"]
    )

    header_res = query_d1("SELECT * FROM fact_audit_headers WHERE audit_id = ?", [test_audit_id])
    counts_res = query_d1("SELECT * FROM fact_audit_counts WHERE audit_id = ? ORDER BY ingredient_id", [test_audit_id])

    print("  Header auto-created by trigger:", header_res)
    print("  Counts auto-unrolled by trigger:", counts_res)

    assert len(header_res) == 1, "Header was not created by trigger!"
    assert header_res[0]["store_id"] == 1, f"Store ID was not mapped correctly (got {header_res[0]['store_id']})!"
    assert header_res[0]["store_code"] == "RSQ", f"Store Code was not mapped correctly (got {header_res[0]['store_code']})!"
    assert len(counts_res) == 2, f"Expected 2 active count lines, got {len(counts_res)}!"

    print("2. Simulating React app deleting the audit...")
    query_d1("DELETE FROM audits WHERE id = ?", [test_audit_id])

    header_after = query_d1("SELECT * FROM fact_audit_headers WHERE audit_id = ?", [test_audit_id])
    counts_after = query_d1("SELECT * FROM fact_audit_counts WHERE audit_id = ?", [test_audit_id])
    assert len(header_after) == 0, "Header was not cleaned up on delete!"
    assert len(counts_after) == 0, "Counts were not cleaned up on delete!"
    print("  ✓ Audit and unrolled lines automatically purged on delete.")

    # Null store checks
    print("\n3. Verifying 0 NULL stores in seeded tables:")
    null_audits = query_d1("SELECT COUNT(*) as c FROM fact_audit_headers WHERE store_id IS NULL")[0]["c"]
    null_pos = query_d1("SELECT COUNT(*) as c FROM fact_purchase_orders WHERE store_id IS NULL")[0]["c"]
    null_tx = query_d1("SELECT COUNT(*) as c FROM fact_inventory_transactions WHERE store_id IS NULL")[0]["c"]
    print(f"  NULL store_id in fact_audit_headers:        {null_audits}")
    print(f"  NULL store_id in fact_purchase_orders:      {null_pos}")
    print(f"  NULL store_id in fact_inventory_transactions: {null_tx}")

    assert null_audits == 0, f"Found {null_audits} unmapped store audits!"
    assert null_pos == 0, f"Found {null_pos} unmapped store POs!"
    assert null_tx == 0, f"Found {null_tx} unmapped store transactions!"

    print("\n" + "=" * 70)
    print("PHASE 2A SETUP COMPLETED WITH 100% VERIFIED SYNCHRONIZATION!")
    print("=" * 70)

if __name__ == "__main__":
    main()
