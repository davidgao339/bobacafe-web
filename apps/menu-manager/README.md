# Boba Cafe — Menu & Ingredient Master Data Management (MDM)

A production-grade Streamlit application running on **Streamlit Community Cloud** with direct write-back to **Databricks Delta Lake** (`workspace.gold.dim_product` and `workspace.inventory_tabular.dim_ingredients`) and real-time dual-write to **Cloudflare D1**.

---

## Features

1. **Menu & Product Master (`workspace.gold.dim_product`)**:
   - In-line editable grid for product names, Russian/English canonical rollup, `parent_product_id`, categories, subcategories, variants, active/inactive statuses, base prices, and unit costs.
   - **Parent Product ID Recalculation**: 1-click unification of `parent_product_id` across items grouped under the same English canonical parent name, ensuring split variants cleanly share the same parent ID.
   - **Live BOM Recipe COGS View (`view_product_recipe_cogs`)**: Dynamically computes recipe COGS and gross margins from unrolled recipe ingredients (`fact_recipe_ingredients`) and the real-time 30-day Rolling WAC view.
   - Unmapped POS items detector: automatically captures new items from transactions and provides one-click bulk import into the catalog.
   - Profitability & Gross Margin breakdown dashboard.

2. **Ingredient & Inventory Master (`dim_ingredients` + `view_ingredient_wac_30d`)**:
   - Full master catalog editor for all 142+ ingredients: name, unit (`мл`, `гр`, `шт`, `уп`, `порц`, `кг`, `л`), supplier/category, product type, baseline cost (`cost_per_unit`), warehouse-only flag, and hidden flag.
   - **Real-Time 30-Day Rolling WAC View (`view_ingredient_wac_30d`)**: Evaluates dynamically on query across purchase orders in the last 30 days (`SUM(qty * unit_cost) / SUM(qty)`), automatically falling back to the most recent purchase price if older than 30 days, or baseline catalog cost. Zero maintenance, zero stale batch jobs.
   - Add New Ingredient wizard with automatic sequential ID calculation.
   - **Real-Time Dual-Write**: Updates Databricks Delta Lake AND Cloudflare D1 simultaneously so store audit and inventory apps see changes immediately.
   - Supplier completeness and cost coverage health metrics.

3. **Enterprise Security & Auth Gate**:
   - Secured against unauthorized public web access.
   - **PIN / Password Authentication**: Uses management PINs (`7530`, `2372`) or custom `APP_PASSWORD`.
   - **Google OAuth Ready**: Supports native Google Sign-in on Streamlit Community Cloud.

4. **100% Cloud Resilience**:
   - Connects to Databricks SQL Warehouse using `databricks-sql-connector` with automatic fallback to Databricks REST API.
   - Zero dependence on Databricks internal App containers.

---

## Deployment to Streamlit Community Cloud

1. Go to [share.streamlit.io](https://share.streamlit.io).
2. Click **Create app** and select:
   - **Repository:** `davidgao339/bobacafe-web`
   - **Branch:** `main`
   - **Main file path:** `apps/menu-manager/streamlit_app.py`
   - **App URL:** e.g. `bobacafe-web-menu-manager.streamlit.app`

3. In **Advanced Settings -> Secrets**, paste the following configuration:

```toml
[databricks]
host = "dbc-d5bd17fc-eaf4.cloud.databricks.com"
token = "dapi<your-databricks-pat-token>"
warehouse_id = "959d56e804ae9b36"
http_path = "/sql/1.0/endpoints/959d56e804ae9b36"

# Management Portal PIN / Password
APP_PIN = "7530"
APP_PASSWORD = "boba_master_2026"

# Cloudflare D1 Dual-Write Proxy
D1_PROXY_URL = "https://bobacafe-proxy.davidgao734.workers.dev/d1/execute"

# (Optional) Google OAuth on Streamlit Community Cloud
# [auth]
# redirect_uri = "https://<your-app-name>.streamlit.app/oauth2callback"
# cookie_secret = "your_32_character_random_secret_here"
# client_id = "your-google-oauth-client-id.apps.googleusercontent.com"
# client_secret = "your-google-oauth-client-secret"
# server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
```

4. Click **Deploy!**
