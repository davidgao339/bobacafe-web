#!/usr/bin/env python3
"""
Deploy fully rendered visual widgets (KPI cards, charts, and tables)
to the Boba Cafe Executive & Category Trends Lakeview Dashboard.
"""

import subprocess
import json
import uuid
import urllib.request
import urllib.error

def get_token():
    res = subprocess.check_output(['databricks', 'auth', 'token', '-p', 'dev-workspace'], text=True)
    return json.loads(res)['access_token']

def short_id():
    return uuid.uuid4().hex[:8]

def build_dashboard_with_widgets():
    token = get_token()
    host = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
    dash_id = "01f1e7a4f23a1a559f68b6f3e8ae4084"

    # Fetch existing dashboard to reuse verified dataset IDs
    req = urllib.request.Request(
        f"{host}/api/2.0/lakeview/dashboards/{dash_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
    
    spec = json.loads(data['serialized_dashboard'])
    datasets = spec['datasets']
    
    # Map dataset names
    ds_map = {d['displayName']: d['name'] for d in datasets}
    ds_sales = ds_map.get('ds_sales_line_items')
    ds_kpis = ds_map.get('ds_store_kpis')
    ds_cat = ds_map.get('ds_category_trends')
    ds_attach = ds_map.get('ds_basket_attach')

    print("Found Datasets:", ds_map)

    # ── Widgets Layout ────────────────────────────────────────────────────────
    layout = []

    # 1. KPI Counter: Network Revenue (Top Left)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_sales,
                        "fields": [
                            {"name": "sum(revenue)", "expression": "SUM(`revenue`)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Total Revenue (₽)", "showTitle": True},
                "widgetType": "counter",
                "encodings": {
                    "value": {"fieldName": "sum(revenue)"}
                }
            }
        },
        "position": {"x": 0, "y": 0, "width": 3, "height": 3}
    })

    # 2. KPI Counter: Total Orders (Top Middle-Left)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_sales,
                        "fields": [
                            {"name": "count_orders", "expression": "COUNT(DISTINCT `order_number`)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Total Orders", "showTitle": True},
                "widgetType": "counter",
                "encodings": {
                    "value": {"fieldName": "count_orders"}
                }
            }
        },
        "position": {"x": 3, "y": 0, "width": 3, "height": 3}
    })

    # 3. KPI Counter: Average Check / AOV (Top Middle-Right)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_sales,
                        "fields": [
                            {"name": "aov", "expression": "ROUND(SUM(`revenue`) / NULLIF(COUNT(DISTINCT `order_number`), 0), 1)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Avg Check (AOV ₽)", "showTitle": True},
                "widgetType": "counter",
                "encodings": {
                    "value": {"fieldName": "aov"}
                }
            }
        },
        "position": {"x": 6, "y": 0, "width": 3, "height": 3}
    })

    # 4. KPI Counter: Food & Dessert Attach % (Top Right)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_attach,
                        "fields": [
                            {"name": "avg_attach", "expression": "ROUND(AVG(`food_attach_pct`), 1)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Food Attach Rate %", "showTitle": True},
                "widgetType": "counter",
                "encodings": {
                    "value": {"fieldName": "avg_attach"}
                }
            }
        },
        "position": {"x": 9, "y": 0, "width": 3, "height": 3}
    })

    # 5. Store Performance Matrix Table (Left Side, Middle)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_kpis,
                        "fields": [
                            {"name": "store_name", "expression": "`store_name`"},
                            {"name": "rev_current", "expression": "`rev_current`"},
                            {"name": "wow_growth_pct", "expression": "`wow_growth_pct`"},
                            {"name": "net_impact_rub", "expression": "`net_impact_rub`"},
                            {"name": "network_share_pct", "expression": "`network_share_pct`"},
                            {"name": "primary_driver", "expression": "`primary_driver`"}
                        ],
                        "disaggregated": True
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Store Revenue & Growth Drivers (Current 7D vs Prior)", "showTitle": True},
                "rowsPerPage": 10,
                "displayRowNumbers": False,
                "widgetType": "table",
                "encodings": {
                    "columns": [
                        {"fieldName": "store_name"},
                        {"fieldName": "rev_current", "format": {"type": "numeral.js", "format": "0,0"}},
                        {"fieldName": "wow_growth_pct", "format": {"type": "numeral.js", "format": "+0.0%"}},
                        {"fieldName": "net_impact_rub", "format": {"type": "numeral.js", "format": "+0,0"}},
                        {"fieldName": "network_share_pct", "format": {"type": "numeral.js", "format": "0.0%"}},
                        {"fieldName": "primary_driver"}
                    ]
                }
            }
        },
        "position": {"x": 0, "y": 3, "width": 6, "height": 6}
    })

    # 6. Daily Revenue Trend by Store (Right Side, Middle)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_sales,
                        "fields": [
                            {"name": "date", "expression": "`date`"},
                            {"name": "store_name", "expression": "`store_name`"},
                            {"name": "daily_rev", "expression": "SUM(`revenue`)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 3,
                "frame": {"title": "Daily Revenue Trajectory by Store", "showTitle": True},
                "widgetType": "line",
                "encodings": {
                    "x": {"fieldName": "date", "scale": {"type": "temporal"}},
                    "y": {"fieldName": "daily_rev", "scale": {"type": "quantitative"}},
                    "color": {"fieldName": "store_name", "scale": {"type": "nominal"}}
                }
            }
        },
        "position": {"x": 6, "y": 3, "width": 6, "height": 6}
    })

    # 7. Category Revenue Breakdown Over Time (Left Side, Bottom)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_cat,
                        "fields": [
                            {"name": "date", "expression": "`date`"},
                            {"name": "category", "expression": "`category`"},
                            {"name": "cat_rev", "expression": "SUM(`total_revenue`)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 3,
                "frame": {"title": "Category Revenue Trajectory (Drinks vs Food vs Desserts)", "showTitle": True},
                "widgetType": "bar",
                "encodings": {
                    "x": {"fieldName": "date", "scale": {"type": "temporal"}},
                    "y": {"fieldName": "cat_rev", "scale": {"type": "quantitative"}},
                    "color": {"fieldName": "category", "scale": {"type": "nominal"}}
                }
            }
        },
        "position": {"x": 0, "y": 9, "width": 6, "height": 6}
    })

    # 8. Subcategory Dynamics Table (Right Side, Bottom)
    layout.append({
        "widget": {
            "name": short_id(),
            "queries": [
                {
                    "name": "main_query",
                    "query": {
                        "datasetName": ds_cat,
                        "fields": [
                            {"name": "category", "expression": "`category`"},
                            {"name": "subcategory", "expression": "`subcategory`"},
                            {"name": "units", "expression": "SUM(`units_sold`)"},
                            {"name": "revenue", "expression": "SUM(`total_revenue`)"}
                        ],
                        "disaggregated": False
                    }
                }
            ],
            "spec": {
                "version": 2,
                "frame": {"title": "Subcategory Volume & Revenue Ranking", "showTitle": True},
                "rowsPerPage": 10,
                "displayRowNumbers": False,
                "widgetType": "table",
                "encodings": {
                    "columns": [
                        {"fieldName": "category"},
                        {"fieldName": "subcategory"},
                        {"fieldName": "units", "format": {"type": "numeral.js", "format": "0,0"}},
                        {"fieldName": "revenue", "format": {"type": "numeral.js", "format": "0,0"}}
                    ]
                }
            }
        },
        "position": {"x": 6, "y": 9, "width": 6, "height": 6}
    })

    # Put into page 0
    spec['pages'][0]['layout'] = layout

    # Save to Databricks
    payload = {
        "display_name": "Boba Cafe Executive & Category Trends",
        "warehouse_id": "959d56e804ae9b36",
        "serialized_dashboard": json.dumps(spec)
    }

    patch_req = urllib.request.Request(
        f"{host}/api/2.0/lakeview/dashboards/{dash_id}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        data=json.dumps(payload).encode("utf-8"),
        method="PATCH"
    )

    with urllib.request.urlopen(patch_req) as resp:
        print("Dashboard updated with 8 widgets!")

    # Republish
    pub_req = urllib.request.Request(
        f"{host}/api/2.0/lakeview/dashboards/{dash_id}/published",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        data=json.dumps({"warehouse_id": "959d56e804ae9b36"}).encode("utf-8"),
        method="POST"
    )
    with urllib.request.urlopen(pub_req) as pub_resp:
        print("Dashboard republished successfully with all visual charts and tables!")

if __name__ == "__main__":
    build_dashboard_with_widgets()
