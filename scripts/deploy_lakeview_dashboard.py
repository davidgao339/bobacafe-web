#!/usr/bin/env python3
"""
Update and publish Boba Cafe Executive & Category Trends AI/BI Lakeview Dashboard
Dashboard ID: 01f1e7a4f23a1a559f68b6f3e8ae4084
"""

import subprocess
import json
import urllib.request
import urllib.error
import sys

def main():
    print("Obtaining Databricks token...")
    res = subprocess.check_output(['databricks', 'auth', 'token', '-p', 'dev-workspace'], text=True)
    token = json.loads(res)['access_token']
    workspace_url = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }

    dash_id = '01f1e7a4f23a1a559f68b6f3e8ae4084'
    warehouse_id = '959d56e804ae9b36'

    # 1. Fetch current draft
    print(f"Fetching dashboard {dash_id}...")
    req = urllib.request.Request(f"{workspace_url}/api/2.0/lakeview/dashboards/{dash_id}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        d = json.loads(resp.read().decode())

    spec = json.loads(d.get('serialized_dashboard', '{}'))
    page = spec['pages'][0]
    ds_sales_id = '5c2e922f'

    # 2. Build Unified Dataset Query
    unified_query = """WITH sales_clean AS (
  SELECT 
    t.datetime AS event_ts,
    CAST(t.date AS DATE) AS date,
    t.order_number,
    t.store_name,
    t.product AS raw_product,
    t.qty,
    t.revenue,
    t.transaction_type AS payment_type,
    COALESCE(t.is_return, FALSE) AS is_return,
    CASE 
      WHEN DAYOFWEEK(t.date) IN (1, 6, 7) THEN 'Weekend (Fri-Sun)'
      ELSE 'Weekday (Mon-Thu)'
    END AS day_type,
    lower(replace(replace(trim(regexp_replace(t.product, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey
  FROM workspace.default.transactions t
  WHERE NOT COALESCE(t.is_return, FALSE) AND t.qty > 0
),
dim_picked AS (
  SELECT product_id, product_ru, category, subcategory, nkey FROM (
    SELECT 
      product_id, product_ru, category, subcategory,
      lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е')) AS nkey,
      ROW_NUMBER() OVER (
        PARTITION BY lower(replace(replace(trim(regexp_replace(product_ru, '\\\\s+', ' ')), '-', ' '), 'ё', 'е'))
        ORDER BY COALESCE(is_active, FALSE) DESC, product_id DESC
      ) AS rn
    FROM workspace.gold.dim_product
    WHERE product_ru IS NOT NULL
  ) WHERE rn = 1
),
enriched AS (
  SELECT 
    s.event_ts,
    s.date,
    s.order_number,
    s.store_name,
    s.day_type,
    s.payment_type,
    s.raw_product,
    dp.product_ru AS canonical_product,
    COALESCE(dp.category, 'Other') AS category,
    COALESCE(dp.subcategory, 'General') AS subcategory,
    s.qty,
    s.revenue
  FROM sales_clean s
  LEFT JOIN dim_picked dp ON s.nkey = dp.nkey
),
ref_date AS (
  SELECT MAX(date) AS max_d FROM enriched
)
SELECT 
  e.event_ts,
  e.date,
  e.order_number,
  e.store_name,
  e.day_type,
  e.payment_type,
  e.raw_product,
  e.canonical_product,
  e.category,
  e.subcategory,
  e.qty,
  e.revenue,
  CASE WHEN e.date >= DATE_SUB(r.max_d, 6) THEN e.qty ELSE 0 END AS cur_qty,
  CASE WHEN e.date >= DATE_SUB(r.max_d, 6) THEN e.revenue ELSE 0 END AS cur_rev,
  CASE WHEN e.date >= DATE_SUB(r.max_d, 13) AND e.date < DATE_SUB(r.max_d, 6) THEN e.revenue ELSE 0 END AS prior_rev
FROM enriched e
CROSS JOIN ref_date r"""

    # Update ds_sales_line_items
    for ds in spec.get('datasets', []):
        if ds.get('name') == ds_sales_id:
            ds['queryLines'] = [line + '\n' for line in unified_query.split('\n')]

    # 3. Build Widgets Layout
    layout = []

    # Filter 1: Date Range Picker
    date_filter = {
        'name': 'f44a8747',
        'queries': [
            {
                'name': f'dashboards/{dash_id}/datasets/01f1e7a5ae5118038c9054934c06adf7_date',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [
                        {'name': 'date', 'expression': '`date`'},
                        {'name': 'date_associativity', 'expression': 'COUNT_IF(`associative_filter_predicate_group`)'}
                    ],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {'showTitle': True, 'title': 'Date Range'},
            'widgetType': 'filter-date-range-picker',
            'encodings': {
                'fields': [
                    {
                        'fieldName': 'date',
                        'queryName': f'dashboards/{dash_id}/datasets/01f1e7a5ae5118038c9054934c06adf7_date'
                    }
                ]
            }
        }
    }
    layout.append({'widget': date_filter, 'position': {'x': 0, 'y': 0, 'width': 6, 'height': 1}})

    # Filter 2: Store Multi-Select Filter
    store_filter = {
        'name': 'f44a8748',
        'queries': [
            {
                'name': f'dashboards/{dash_id}/datasets/ds_store_filter',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [
                        {'name': 'store_name', 'expression': '`store_name`'},
                        {'name': 'store_name_associativity', 'expression': 'COUNT_IF(`associative_filter_predicate_group`)'}
                    ],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {'showTitle': True, 'title': 'Store Name'},
            'widgetType': 'filter-multi-select',
            'encodings': {
                'fields': [
                    {
                        'fieldName': 'store_name',
                        'queryName': f'dashboards/{dash_id}/datasets/ds_store_filter'
                    }
                ]
            }
        }
    }
    layout.append({'widget': store_filter, 'position': {'x': 6, 'y': 0, 'width': 6, 'height': 1}})

    # Counter 1: Total Sales (₽)
    c1 = {
        'name': 'f33861f4',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [{'name': 'sum(revenue)', 'expression': 'SUM(`revenue`)'}],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {'title': 'Total Sales (₽)', 'showTitle': True},
            'widgetType': 'counter',
            'encodings': {
                'value': {
                    'fieldName': 'sum(revenue)',
                    'format': {'type': 'numeral.js', 'format': '0,0'}
                }
            }
        }
    }
    layout.append({'widget': c1, 'position': {'x': 0, 'y': 1, 'width': 4, 'height': 2}})

    # Counter 2: Total Orders
    c2 = {
        'name': '84475672',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [{'name': 'count_orders', 'expression': 'COUNT(DISTINCT `order_number`)'}],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {'title': 'Total Orders', 'showTitle': True},
            'widgetType': 'counter',
            'encodings': {
                'value': {
                    'fieldName': 'count_orders',
                    'format': {'type': 'numeral.js', 'format': '0,0'}
                }
            }
        }
    }
    layout.append({'widget': c2, 'position': {'x': 4, 'y': 1, 'width': 4, 'height': 2}})

    # Counter 3: Average Order Value (AOV ₽)
    c3 = {
        'name': 'f421be77',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [{'name': 'aov', 'expression': 'ROUND(SUM(`revenue`) / NULLIF(COUNT(DISTINCT `order_number`), 0), 0)'}],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {'title': 'Average Order Value (AOV ₽)', 'showTitle': True},
            'widgetType': 'counter',
            'encodings': {
                'value': {
                    'fieldName': 'aov',
                    'format': {'type': 'numeral.js', 'format': '0,0'}
                }
            }
        }
    }
    layout.append({'widget': c3, 'position': {'x': 8, 'y': 1, 'width': 4, 'height': 2}})

    # Middle Row Left: Store Performance Scorecard Table
    scorecard = {
        'name': 'e04c30ae',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [
                        {'name': 'store_name', 'expression': '`store_name`'},
                        {'name': 'store_sales', 'expression': 'SUM(`revenue`)'},
                        {'name': 'network_share_pct', 'expression': 'ROUND(SUM(`revenue`) / NULLIF(SUM(SUM(`revenue`)) OVER (), 0) * 100, 1)'},
                        {'name': 'orders', 'expression': 'COUNT(DISTINCT `order_number`)'},
                        {'name': 'store_aov', 'expression': 'ROUND(SUM(`revenue`) / NULLIF(COUNT(DISTINCT `order_number`), 0), 0)'},
                        {'name': 'upt', 'expression': 'ROUND(SUM(`qty`) / NULLIF(COUNT(DISTINCT `order_number`), 0), 2)'}
                    ],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {
                'title': 'Store Performance Scorecard',
                'showTitle': True
            },
            'rowsPerPage': 10,
            'displayRowNumbers': False,
            'widgetType': 'table',
            'encodings': {
                'columns': [
                    {'fieldName': 'store_name', 'displayName': 'Store Name'},
                    {'fieldName': 'store_sales', 'displayName': 'Store Sales ₽', 'format': {'type': 'numeral.js', 'format': '0,0'}},
                    {'fieldName': 'network_share_pct', 'displayName': 'Network Share %', 'format': {'type': 'numeral.js', 'format': '0.0%'}},
                    {'fieldName': 'orders', 'displayName': 'Orders', 'format': {'type': 'numeral.js', 'format': '0,0'}},
                    {'fieldName': 'store_aov', 'displayName': 'Store AOV ₽', 'format': {'type': 'numeral.js', 'format': '0,0'}},
                    {'fieldName': 'upt', 'displayName': 'UPT', 'format': {'type': 'numeral.js', 'format': '0.00'}}
                ]
            }
        }
    }
    layout.append({'widget': scorecard, 'position': {'x': 0, 'y': 3, 'width': 7, 'height': 7}})

    # Middle Row Right: Category Sales Mix (Pie Chart)
    pie = {
        'name': 'c5e74af2',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [
                        {'name': 'sum(revenue)', 'expression': 'SUM(`revenue`)'},
                        {'name': 'category', 'expression': '`category`'}
                    ],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 3,
            'frame': {
                'title': 'Category Sales Mix',
                'showTitle': True
            },
            'widgetType': 'pie',
            'encodings': {
                'angle': {
                    'fieldName': 'sum(revenue)',
                    'scale': {'type': 'quantitative'},
                    'displayName': 'Total Sales'
                },
                'color': {
                    'fieldName': 'category',
                    'scale': {'type': 'categorical'},
                    'displayName': 'Category'
                },
                'label': {'show': True}
            }
        }
    }
    layout.append({'widget': pie, 'position': {'x': 7, 'y': 3, 'width': 5, 'height': 7}})

    # Bottom Row: Subcategory WoW Performance Table
    subcat = {
        'name': '223ac770',
        'queries': [
            {
                'name': 'main_query',
                'query': {
                    'datasetName': ds_sales_id,
                    'fields': [
                        {'name': 'subcategory', 'expression': '`subcategory`'},
                        {'name': 'units_sold', 'expression': 'SUM(`cur_qty`)'},
                        {'name': 'total_revenue', 'expression': 'SUM(`cur_rev`)'},
                        {'name': 'wow_growth_pct', 'expression': 'ROUND((SUM(`cur_rev`) - SUM(`prior_rev`)) / NULLIF(SUM(`prior_rev`), 0) * 100, 1)'},
                        {'name': 'net_impact_rub', 'expression': 'ROUND(SUM(`cur_rev`) - SUM(`prior_rev`), 0)'}
                    ],
                    'disaggregated': False
                }
            }
        ],
        'spec': {
            'version': 2,
            'frame': {
                'title': 'Subcategory WoW Performance (Recent 7D vs Prior 7D)',
                'showTitle': True
            },
            'rowsPerPage': 10,
            'displayRowNumbers': False,
            'widgetType': 'table',
            'encodings': {
                'columns': [
                    {'fieldName': 'subcategory', 'displayName': 'Subcategory'},
                    {'fieldName': 'units_sold', 'displayName': 'Units Sold', 'format': {'type': 'numeral.js', 'format': '0,0'}},
                    {'fieldName': 'total_revenue', 'displayName': 'Total Revenue ₽', 'format': {'type': 'numeral.js', 'format': '0,0'}},
                    {'fieldName': 'wow_growth_pct', 'displayName': 'WoW Growth %', 'format': {'type': 'numeral.js', 'format': '+0.0%'}},
                    {'fieldName': 'net_impact_rub', 'displayName': 'Net ₽ Impact', 'format': {'type': 'numeral.js', 'format': '+0,0'}}
                ]
            }
        }
    }
    layout.append({'widget': subcat, 'position': {'x': 0, 'y': 10, 'width': 12, 'height': 7}})

    page['layout'] = layout

    # 4. Patch dashboard
    print("Patching dashboard draft...")
    payload = {
        'display_name': 'Boba Cafe Executive & Category Trends',
        'warehouse_id': warehouse_id,
        'serialized_dashboard': json.dumps(spec)
    }

    req_patch = urllib.request.Request(
        f"{workspace_url}/api/2.0/lakeview/dashboards/{dash_id}",
        data=json.dumps(payload).encode(),
        headers=headers,
        method='PATCH'
    )
    try:
        with urllib.request.urlopen(req_patch) as resp:
            print("Dashboard draft updated successfully!")
    except urllib.error.HTTPError as e:
        print(f"PATCH Error {e.code}: {e.read().decode()}")
        sys.exit(1)

    # 5. Republish dashboard
    print("Republishing dashboard...")
    req_pub = urllib.request.Request(
        f"{workspace_url}/api/2.0/lakeview/dashboards/{dash_id}/published",
        data=json.dumps({}).encode(),
        headers=headers
    )
    try:
        with urllib.request.urlopen(req_pub) as resp:
            print(f"Dashboard published successfully! Status: {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"Publish Error {e.code}: {e.read().decode()}")
        sys.exit(1)

    print("\nVerification: Successfully updated and published Boba Cafe Executive & Category Trends dashboard!")
    print(f"URL: {workspace_url}/sql/dashboardsv3/{dash_id}")

if __name__ == '__main__':
    main()
