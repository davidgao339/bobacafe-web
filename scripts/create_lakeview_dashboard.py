#!/usr/bin/env python3
"""
Create and publish or update the Boba Cafe Executive & Category Trends AI/BI Lakeview Dashboard
directly to Databricks using the Databricks Lakeview REST API and in-dashboard datasets.
"""

import subprocess
import json
import uuid
import urllib.request
import urllib.error
import sys

def get_token():
    res = subprocess.check_output(['databricks', 'auth', 'token', '-p', 'dev-workspace'], text=True)
    return json.loads(res)['access_token']

def short_id():
    return uuid.uuid4().hex[:8]

def build_dashboard_spec():
    # Dataset IDs
    ds_sales_id = short_id()
    ds_store_kpis_id = short_id()
    ds_cat_trends_id = short_id()
    ds_attach_id = short_id()

    datasets = [
        {
            "name": ds_sales_id,
            "displayName": "ds_sales_line_items",
            "queryLines": [
                "WITH sales_clean AS (\n",
                "  SELECT \n",
                "    t.datetime AS event_ts,\n",
                "    CAST(t.date AS DATE) AS date,\n",
                "    t.order_number,\n",
                "    t.store_name,\n",
                "    t.product AS raw_product,\n",
                "    t.qty,\n",
                "    t.revenue,\n",
                "    t.transaction_type AS payment_type,\n",
                "    COALESCE(t.is_return, FALSE) AS is_return,\n",
                "    CASE \n",
                "      WHEN DAYOFWEEK(t.date) IN (1, 6, 7) THEN 'Weekend (Fri-Sun)'\n",
                "      ELSE 'Weekday (Mon-Thu)'\n",
                "    END AS day_type,\n",
                "    lower(replace(replace(trim(regexp_replace(t.product, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey\n",
                "  FROM workspace.default.transactions t\n",
                "  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0\n",
                "),\n",
                "dim_picked AS (\n",
                "  SELECT product_id, product_ru, category, subcategory, nkey FROM (\n",
                "    SELECT \n",
                "      product_id, product_ru, category, subcategory,\n",
                "      lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey,\n",
                "      ROW_NUMBER() OVER (\n",
                "        PARTITION BY lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е'))\n",
                "        ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC\n",
                "      ) AS rn\n",
                "    FROM workspace.gold.dim_product\n",
                "    WHERE product_ru IS NOT NULL\n",
                "  ) WHERE rn = 1\n",
                ")\n",
                "SELECT \n",
                "  s.event_ts,\n",
                "  s.date,\n",
                "  s.order_number,\n",
                "  s.store_name,\n",
                "  s.day_type,\n",
                "  s.payment_type,\n",
                "  s.raw_product,\n",
                "  dp.product_ru AS canonical_product,\n",
                "  COALESCE(dp.category, 'Other') AS category,\n",
                "  COALESCE(dp.subcategory, 'General') AS subcategory,\n",
                "  s.qty,\n",
                "  s.revenue\n",
                "FROM sales_clean s\n",
                "LEFT JOIN dim_picked dp ON s.nkey = dp.nkey\n"
            ]
        },
        {
            "name": ds_store_kpis_id,
            "displayName": "ds_store_kpis",
            "queryLines": [
                "WITH daily_store AS (\n",
                "  SELECT \n",
                "    date,\n",
                "    store_name,\n",
                "    SUM(revenue) AS daily_rev,\n",
                "    COUNT(DISTINCT order_number) AS daily_orders\n",
                "  FROM workspace.default.transactions\n",
                "  WHERE NOT COALESCE(is_return, FALSE) AND qty > 0\n",
                "  GROUP BY date, store_name\n",
                "),\n",
                "store_periods AS (\n",
                "  SELECT \n",
                "    store_name,\n",
                "    SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), 7) THEN daily_rev ELSE 0 END) AS rev_current,\n",
                "    SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), 7) THEN daily_orders ELSE 0 END) AS orders_current,\n",
                "    SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), 14) AND date < DATE_SUB(CURRENT_DATE(), 7) THEN daily_rev ELSE 0 END) AS rev_prior,\n",
                "    SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), 14) AND date < DATE_SUB(CURRENT_DATE(), 7) THEN daily_orders ELSE 0 END) AS orders_prior,\n",
                "    SUM(CASE WHEN date >= DATE_SUB(CURRENT_DATE(), 28) THEN daily_rev ELSE 0 END) / 4.0 AS rev_4w_avg\n",
                "  FROM daily_store\n",
                "  GROUP BY store_name\n",
                ")\n",
                "SELECT \n",
                "  store_name,\n",
                "  rev_current,\n",
                "  orders_current,\n",
                "  ROUND(CASE WHEN orders_current > 0 THEN rev_current / orders_current ELSE 0 END, 0) AS aov_current,\n",
                "  rev_prior,\n",
                "  orders_prior,\n",
                "  ROUND(CASE WHEN orders_prior > 0 THEN rev_prior / orders_prior ELSE 0 END, 0) AS aov_prior,\n",
                "  rev_4w_avg,\n",
                "  ROUND((rev_current - rev_prior) / NULLIF(rev_prior, 0) * 100, 1) AS wow_growth_pct,\n",
                "  ROUND(rev_current - rev_prior, 0) AS net_impact_rub,\n",
                "  ROUND(rev_current / NULLIF(SUM(rev_current) OVER (), 0) * 100, 1) AS network_share_pct,\n",
                "  CASE \n",
                "    WHEN (orders_current - orders_prior) / NULLIF(orders_prior, 0) > (rev_current - rev_prior) / NULLIF(rev_prior, 0) \n",
                "      THEN 'Traffic Led'\n",
                "    ELSE 'Basket Led'\n",
                "  END AS primary_driver\n",
                "FROM store_periods\n",
                "ORDER BY rev_current DESC\n"
            ]
        },
        {
            "name": ds_cat_trends_id,
            "displayName": "ds_category_trends",
            "queryLines": [
                "WITH sales_clean AS (\n",
                "  SELECT \n",
                "    CAST(t.date AS DATE) AS date,\n",
                "    t.store_name,\n",
                "    t.product,\n",
                "    t.qty,\n",
                "    t.revenue,\n",
                "    t.order_number,\n",
                "    lower(replace(replace(trim(regexp_replace(t.product, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey\n",
                "  FROM workspace.default.transactions t\n",
                "  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0\n",
                "),\n",
                "dim_picked AS (\n",
                "  SELECT product_ru, category, subcategory, nkey FROM (\n",
                "    SELECT \n",
                "      product_ru, category, subcategory,\n",
                "      lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey,\n",
                "      ROW_NUMBER() OVER (\n",
                "        PARTITION BY lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е'))\n",
                "        ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC\n",
                "      ) AS rn\n",
                "    FROM workspace.gold.dim_product\n",
                "    WHERE product_ru IS NOT NULL\n",
                "  ) WHERE rn = 1\n",
                ")\n",
                "SELECT \n",
                "  s.date,\n",
                "  s.store_name,\n",
                "  COALESCE(dp.category, 'Напитки') AS category,\n",
                "  COALESCE(dp.subcategory, 'Прочее') AS subcategory,\n",
                "  SUM(s.qty) AS units_sold,\n",
                "  SUM(s.revenue) AS total_revenue,\n",
                "  COUNT(DISTINCT s.order_number) AS distinct_orders\n",
                "FROM sales_clean s\n",
                "LEFT JOIN dim_picked dp ON s.nkey = dp.nkey\n",
                "GROUP BY s.date, s.store_name, dp.category, dp.subcategory\n"
            ]
        },
        {
            "name": ds_attach_id,
            "displayName": "ds_basket_attach",
            "queryLines": [
                "WITH sales_cat AS (\n",
                "  SELECT \n",
                "    CAST(t.date AS DATE) AS date,\n",
                "    t.store_name,\n",
                "    t.order_number,\n",
                "    COALESCE(dp.category, 'Напитки') AS category\n",
                "  FROM workspace.default.transactions t\n",
                "  LEFT JOIN workspace.gold.dim_product dp\n",
                "    ON lower(replace(replace(trim(regexp_replace(t.product, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) = \n",
                "       lower(replace(replace(trim(regexp_replace(dp.product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е'))\n",
                "  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0\n",
                "),\n",
                "order_summary AS (\n",
                "  SELECT \n",
                "    date,\n",
                "    store_name,\n",
                "    order_number,\n",
                "    MAX(CASE WHEN category IN ('Напитки', 'Кофе', 'Чай', 'Drinks') THEN 1 ELSE 0 END) AS has_drink,\n",
                "    MAX(CASE WHEN category IN ('Еда', 'Десерты', 'Корн-доги', 'Food', 'Dessert') THEN 1 ELSE 0 END) AS has_food,\n",
                "    MAX(CASE WHEN category IN ('Топпинги', 'Toppings', 'Modifiers') THEN 1 ELSE 0 END) AS has_topping\n",
                "  FROM sales_cat\n",
                "  GROUP BY date, store_name, order_number\n",
                ")\n",
                "SELECT \n",
                "  date,\n",
                "  store_name,\n",
                "  COUNT(DISTINCT order_number) AS total_orders,\n",
                "  SUM(has_drink) AS drink_orders,\n",
                "  SUM(CASE WHEN has_drink = 1 AND has_food = 1 THEN 1 ELSE 0 END) AS drink_with_food_orders,\n",
                "  SUM(CASE WHEN has_drink = 1 AND has_topping = 1 THEN 1 ELSE 0 END) AS drink_with_topping_orders,\n",
                "  ROUND(SUM(CASE WHEN has_drink = 1 AND has_food = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(has_drink), 0) * 100, 1) AS food_attach_pct,\n",
                "  ROUND(SUM(CASE WHEN has_drink = 1 AND has_topping = 1 THEN 1 ELSE 0 END) / NULLIF(SUM(has_drink), 0) * 100, 1) AS topping_attach_pct\n",
                "FROM order_summary\n",
                "GROUP BY date, store_name\n"
            ]
        }
    ]

    # Minimal single-page canvas with layout
    page_id = short_id()
    pages = [
        {
            "name": page_id,
            "displayName": "Executive & Category Trends",
            "layout": []
        }
    ]

    return {
        "datasets": datasets,
        "pages": pages,
        "uiSettings": {}
    }

def verify_queries(token, host, warehouse_id, spec):
    print("Verifying datasets via Databricks Statement Execution API...")
    for ds in spec["datasets"]:
        name = ds["displayName"]
        sql = "".join(ds["queryLines"])
        # Wrap query in a subquery or limit to verify syntax and execution without blowing 25MB inline byte limit
        verification_sql = f"SELECT * FROM ({sql}) LIMIT 10"
        print(f" -> Testing {name}...", end=" ", flush=True)
        stmt_req = urllib.request.Request(
            f"{host}/api/2.0/sql/statements",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            data=json.dumps({
                "warehouse_id": warehouse_id,
                "statement": verification_sql,
                "wait_timeout": "45s"
            }).encode("utf-8"),
            method="POST"
        )
        with urllib.request.urlopen(stmt_req) as resp:
            res = json.loads(resp.read().decode())
            status = res.get("status", {}).get("state")
            if status == "SUCCEEDED":
                row_count = res.get("manifest", {}).get("total_row_count", "unknown")
                print(f"PASSED (rows verified: {row_count})")
            else:
                err = res.get("status", {}).get("error", {})
                print(f"FAILED: {err}")
                raise RuntimeError(f"Query {name} failed: {err}")

def update_or_create_dashboard(dashboard_id=None):
    token = get_token()
    host = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
    warehouse_id = "959d56e804ae9b36"
    
    spec = build_dashboard_spec()
    verify_queries(token, host, warehouse_id, spec)

    serialized_dashboard = json.dumps(spec)

    payload = {
        "display_name": "Boba Cafe Executive & Category Trends",
        "warehouse_id": warehouse_id,
        "serialized_dashboard": serialized_dashboard
    }

    if dashboard_id:
        url = f"{host}/api/2.0/lakeview/dashboards/{dashboard_id}"
        method = "PATCH"
        print(f"Updating existing dashboard: {dashboard_id}...")
    else:
        url = f"{host}/api/2.0/lakeview/dashboards"
        method = "POST"
        payload["parent_path"] = "/Users/davidgao734@gmail.com"
        print("Creating new dashboard...")

    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        data=json.dumps(payload).encode("utf-8"),
        method=method
    )

    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        dash_id = data.get("dashboard_id", dashboard_id)
        print("==========================================================")
        print(" SUCCESS! Boba Cafe AI/BI Dashboard Updated/Created:")
        print(f" Dashboard ID: {dash_id}")
        print(f" Display Name: {data.get('display_name')}")
        print(f" URL: {host}/dashboardsv3/{dash_id}")
        print("==========================================================")
        
        # Publish draft
        pub_req = urllib.request.Request(
            f"{host}/api/2.0/lakeview/dashboards/{dash_id}/published",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            data=json.dumps({"warehouse_id": warehouse_id}).encode("utf-8"),
            method="POST"
        )
        try:
            with urllib.request.urlopen(pub_req) as pub_resp:
                print(" Dashboard published successfully!")
        except Exception as pe:
            print("Notice on publish:", pe)

def main():
    target_id = sys.argv[1] if len(sys.argv) > 1 else "01f1e7a4f23a1a559f68b6f3e8ae4084"
    update_or_create_dashboard(target_id)

if __name__ == "__main__":
    main()
