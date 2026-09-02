-- Initialize Cloudflare D1 Schema for Bobacafe Ledger

-- 1. Ingredients (Core catalog of all items tracked)
CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    productType TEXT,
    supplierId INTEGER
);

-- 2. Recipes (Maps a product string to its ingredient usage)
-- Because recipes can be complex JSON mapping multiple ingredients to quantities,
-- we'll store the mapping as a JSON string for simple D1 storage that matches the app's config.recipes object.
CREATE TABLE IF NOT EXISTS recipes (
    product_name TEXT,
    type TEXT DEFAULT 'retail',
    ingredient_mapping JSON NOT NULL,
    PRIMARY KEY (product_name, type)
);

-- 3. Suppliers (If needed, based on their config)
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

-- 4. Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    status TEXT NOT NULL,
    receivedAt TEXT,
    lines JSON NOT NULL -- JSON array of { ingredientId, ordered, received, unitCost }
);

-- 5. Transactions (The core of the ledger: adjustments, transfers, production)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL, -- 'adjustment', 'transfer-in', 'transfer-out', 'production', etc.
    ingredientId INTEGER NOT NULL,
    quantity REAL NOT NULL,
    poId TEXT,
    reason TEXT,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Audits (Physical inventory counts)
CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    date TEXT NOT NULL,
    counts JSON NOT NULL, -- JSON object of { ingredientId: counted_qty }
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. App Configuration State (Optional, for storing global settings)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL
);
