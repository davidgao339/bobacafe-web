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
