CREATE TABLE recipes_new (
    product_name TEXT,
    type TEXT DEFAULT 'retail',
    ingredient_mapping JSON NOT NULL,
    PRIMARY KEY (product_name, type)
);

INSERT INTO recipes_new (product_name, type, ingredient_mapping)
SELECT product_name, 'retail', ingredient_mapping FROM recipes;

DROP TABLE recipes;

ALTER TABLE recipes_new RENAME TO recipes;

ALTER TABLE purchase_orders ADD COLUMN fromLocation TEXT;
ALTER TABLE purchase_orders ADD COLUMN toLocation TEXT;
ALTER TABLE recipes ADD COLUMN hidden INTEGER DEFAULT 0;
ALTER TABLE ingredients ADD COLUMN hidden INTEGER DEFAULT 0;