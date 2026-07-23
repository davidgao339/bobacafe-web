// Maps POS product names (from product_sales_v2.product) to inventory menu item IDs.
//
// HOW TO FILL THIS IN:
//   Run this query in Databricks:
//     SELECT DISTINCT product, SUM(qty) as total_qty
//     FROM workspace.default.product_sales_v2
//     WHERE store IN ('НОВО КП', 'ГРИН ПАРК', 'БОН ПАССАЖ')
//     GROUP BY product ORDER BY total_qty DESC
//
//   Match each drink name to its menu item ID (1–5 defined in fakeData.js):
//     1 = Classic Milk Tea
//     2 = Taro Milk Tea
//     3 = Brown Sugar Boba
//     4 = Matcha Latte
//     5 = Peach Green Tea
//
// Toppings (e.g. 'Порция тапиоки') should NOT be mapped here — they are
// accounted for as direct ingredient consumption, not via recipes.
//
// Until this map is populated, the app falls back to demo (fake) sales data.

export const PRODUCT_MAP = {
  // 'Классический молочный чай': 1,
  // 'Таро молочный чай': 2,
  // 'Коричневый сахар боба': 3,
  // 'Маття латте': 4,
  // 'Персиковый зелёный чай': 5,
}
