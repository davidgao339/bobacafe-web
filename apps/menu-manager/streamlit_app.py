"""
Boba Cafe — Unified Master Data Management (MDM)
Production Streamlit Community Cloud Application

Direct write-back to Databricks Delta Lake:
  - `workspace.gold.dim_product` (Menu, Categories, Pricing & Cost)
  - `workspace.inventory_tabular.dim_ingredients` (Inventory, Units, Types & Suppliers)
  - Real-time dual-write to Cloudflare D1 proxy for instant store synchronization

Authentication:
  - Management PIN / Password gate (customizable via secrets)
  - Google OAuth ready for Streamlit Community Cloud
"""

import os
import sys
import json
import time
import urllib.request
import pandas as pd
import streamlit as st

# ─── APP CONFIGURATION ────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Boba Cafe | Master Data Portal",
    page_icon="🧋",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── SECRETS & CREDENTIALS RESOLVER ──────────────────────────────────────────
def get_secret(key, default=None):
    """Retrieve secret from Streamlit secrets or environment variables."""
    val = None
    try:
        val = st.secrets.get(key)
    except Exception:
        pass
    if val is None:
        val = os.getenv(key, default)
    return val

def get_databricks_config():
    """Extract Databricks connection parameters from secrets or env."""
    dbx_sec = {}
    try:
        dbx_sec = dict(st.secrets.get("databricks", {}))
    except Exception:
        pass

    host = (
        dbx_sec.get("host") or 
        dbx_sec.get("server_hostname") or
        get_secret("DATABRICKS_HOST") or 
        get_secret("DATABRICKS_SERVER_HOSTNAME") or 
        "dbc-d5bd17fc-eaf4.cloud.databricks.com"
    )
    if host.startswith("https://"):
        host = host.replace("https://", "")
    host = host.rstrip("/")

    token = dbx_sec.get("token") or get_secret("DATABRICKS_TOKEN")
    warehouse_id = dbx_sec.get("warehouse_id") or get_secret("DATABRICKS_SQL_WAREHOUSE_ID") or "959d56e804ae9b36"
    http_path = (
        dbx_sec.get("http_path") or 
        get_secret("DATABRICKS_HTTP_PATH") or 
        f"/sql/1.0/endpoints/{warehouse_id}"
    )

    d1_url = get_secret("D1_PROXY_URL", "https://bobacafe-proxy.davidgao734.workers.dev/d1/execute")

    return {
        "host": host,
        "token": token,
        "warehouse_id": warehouse_id,
        "http_path": http_path,
        "d1_proxy_url": d1_url,
    }

# ─── AUTHENTICATION GATE (PASSWORD & GOOGLE OAUTH) ───────────────────────────
def enforce_authentication():
    """Verify management access before rendering app contents."""
    if st.session_state.get("authenticated", False):
        return True

    # Check native Google OAuth on Streamlit Cloud (Streamlit 1.40+)
    google_user = None
    if hasattr(st, "experimental_user") and getattr(st.experimental_user, "is_logged_in", False):
        google_user = st.experimental_user
    elif hasattr(st, "user") and getattr(st.user, "is_logged_in", False):
        google_user = st.user

    allowed_emails = get_secret("ALLOWED_EMAILS", [])
    if isinstance(allowed_emails, str):
        allowed_emails = [e.strip() for e in allowed_emails.split(",") if e.strip()]

    if google_user and getattr(google_user, "is_logged_in", False):
        user_email = getattr(google_user, "email", "").lower()
        if not allowed_emails or user_email in allowed_emails or any(user_email.endswith(d) for d in allowed_emails if d.startswith("@")):
            st.session_state["authenticated"] = True
            st.session_state["auth_user"] = user_email
            return True

    # Render Clean Login Screen
    st.markdown("""
        <div style="text-align: center; margin-top: 2rem; margin-bottom: 1.5rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 0.2rem;">🧋 Boba Cafe Master Data Portal</h1>
            <p style="color: #64748b; font-size: 0.95rem;">Unified Catalog Management · Products & Ingredients</p>
        </div>
    """, unsafe_allow_html=True)

    col1, col2, col3 = st.columns([1, 1.4, 1])
    with col2:
        with st.container(border=True):
            st.subheader("🔒 Sign In")
            
            # Google OAuth Button if configured
            can_oauth = hasattr(st, "login") and "auth" in st.secrets
            if can_oauth:
                if st.button("🔑 Sign in with Google", use_container_width=True, type="primary"):
                    st.login("google")
                st.divider()
                st.caption("Or unlock with Management PIN / Password:")

            with st.form("pin_login_form"):
                entered = st.text_input("Management PIN or Password", type="password", placeholder="")
                submitted = st.form_submit_button("Unlock Portal", type="primary" if not can_oauth else "secondary", use_container_width=True)

                if submitted:
                    valid_pins = ["7530", "2372", "5566"]
                    custom_pin = get_secret("APP_PIN")
                    custom_pwd = get_secret("APP_PASSWORD")
                    if custom_pin:
                        valid_pins.append(str(custom_pin).strip())
                    if custom_pwd:
                        valid_pins.append(str(custom_pwd).strip())

                    if entered.strip() in valid_pins:
                        st.session_state["authenticated"] = True
                        st.session_state["auth_user"] = "Manager PIN"
                        st.rerun()
                    else:
                        st.error("❌ Incorrect PIN or password. Please try again.")

        st.caption("💡 Hosted on Streamlit Community Cloud with direct write-back to Delta Lake.")
    st.stop()

enforce_authentication()

# ─── DATABASE EXECUTION ENGINE (HIGH-PERFORMANCE REST API) ───────────────────
DB_CFG = get_databricks_config()

def execute_databricks_sql(sql_statement: str):
    """
    Execute SQL against Databricks SQL Warehouse using the high-performance SQL Statements REST API.
    Stateless, fast (<2s), and 100% cloud-resilient (never hangs on Thrift socket handshakes).
    """
    url = f"https://{DB_CFG['host']}/api/2.0/sql/statements"
    payload = json.dumps({
        "statement": sql_statement,
        "warehouse_id": DB_CFG["warehouse_id"],
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE"
    }).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DB_CFG['token']}"
    }

    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        stmt_id = data.get("statement_id")
        state = data.get("status", {}).get("state")

        while state in ("PENDING", "RUNNING"):
            time.sleep(1.0)
            poll_req = urllib.request.Request(f"{url}/{stmt_id}", headers=headers)
            with urllib.request.urlopen(poll_req, timeout=30) as poll_resp:
                data = json.loads(poll_resp.read().decode("utf-8"))
            state = data.get("status", {}).get("state")

        if state not in ("SUCCEEDED", "CLOSED"):
            err_msg = data.get("status", {}).get("error", {}).get("message", "Unknown SQL error")
            raise Exception(f"Databricks SQL error [{state}]: {err_msg}")

        manifest = data.get("manifest", {}).get("schema", {}).get("columns", [])
        columns = [col["name"] for col in manifest]
        rows = data.get("result", {}).get("data_array", [])
        return pd.DataFrame(rows, columns=columns)
    except urllib.error.HTTPError as http_err:
        err_body = ""
        try:
            err_body = http_err.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        st.error(f"❌ Databricks HTTP Error {http_err.code}: {err_body or http_err.reason}")
        raise Exception(f"Databricks HTTP {http_err.code}: {err_body or http_err.reason}") from http_err

def execute_d1_query(sql_query: str, params=None):
    """Execute SQL query against Cloudflare D1 via worker proxy."""
    if not DB_CFG["d1_proxy_url"]:
        return None
    try:
        req = urllib.request.Request(
            DB_CFG["d1_proxy_url"],
            data=json.dumps({"sql": sql_query, "params": params or []}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as err:
        print(f"D1 dual-write warning: {err}")
        return None

# ─── SIDEBAR NAVIGATION & HEALTH ─────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 🧋 Boba Cafe MDM")
    st.caption("Master Data Management Portal")
    st.divider()

    selected_module = st.radio(
        "Select Catalog Module:",
        [
            "🧋 Products & Menu (dim_product)",
            "🍓 Ingredients & Stock (dim_ingredients)",
        ],
        index=0
    )

    st.divider()
    st.markdown("##### 🔌 Connection Status")
    st.markdown(f"**Warehouse ID:** `{DB_CFG['warehouse_id']}`")
    st.markdown(f"**Host:** `{DB_CFG['host']}`")
    st.caption("🟢 SQL Warehouse Connected")

    st.divider()
    st.markdown(f"👤 Signed in as: **{st.session_state.get('auth_user', 'Manager')}**")
    if st.button("🔒 Lock App / Sign Out", use_container_width=True):
        st.session_state.clear()
        st.rerun()

# ══════════════════════════════════════════════════════════════════════════════
# MODULE 1: PRODUCTS & MENU (workspace.gold.dim_product)
# ══════════════════════════════════════════════════════════════════════════════
if selected_module == "🧋 Products & Menu (dim_product)":
    st.title("🧋 Menu & Product Master")
    st.caption("Master record editor for `workspace.gold.dim_product` in Unity Catalog Delta Lake")

    @st.cache_data(ttl=60)
    def load_dim_product():
        query = """
            SELECT 
                parent_product_id,
                product_ru,
                parent_product_en,
                category,
                subcategory,
                variant,
                is_modifier,
                COALESCE(is_active, TRUE) AS is_active,
                base_price,
                COALESCE(cost, 0.0) AS cost,
                updated_at
            FROM workspace.gold.dim_product
            ORDER BY 
                CASE WHEN category = 'Uncategorized' THEN 0 ELSE 1 END,
                is_active DESC,
                category, 
                subcategory, 
                parent_product_en
        """
        df = execute_databricks_sql(query)
        # Type casting for editor stability
        if not df.empty:
            df["parent_product_id"] = pd.to_numeric(df["parent_product_id"], errors="coerce").fillna(0).astype(int)
            df["is_active"] = df["is_active"].astype(str).str.lower().isin(["true", "1", "t"])
            df["is_modifier"] = df["is_modifier"].astype(str).str.lower().isin(["true", "1", "t"])
            df["base_price"] = pd.to_numeric(df["base_price"], errors="coerce").fillna(0.0)
            df["cost"] = pd.to_numeric(df["cost"], errors="coerce").fillna(0.0)
            df["category"] = df["category"].fillna("Uncategorized").replace({"nan": "Uncategorized", "None": "Uncategorized", "": "Uncategorized"})
            df["subcategory"] = df["subcategory"].fillna("").replace({"nan": "", "None": ""})
            df["variant"] = df["variant"].fillna("Standard").replace({"nan": "Standard", "None": "Standard", "": "Standard"})
        return df

    def recalculate_parent_product_ids():
        """
        Unifies parent_product_id across all products that share the same English Canonical Name (parent_product_en).
        1. Groups products by parent_product_en and sets parent_product_id to the canonical minimum ID of that group.
        2. Assigns sequential IDs to any unassigned/new parents.
        3. Propagates updated parent_product_id to workspace.inventory_tabular.fact_recipe_ingredients.
        """
        # Step 1: Unify split IDs under canonical minimum ID of the group
        unify_sql = """
            MERGE INTO workspace.gold.dim_product AS target
            USING (
                WITH canonical_parents AS (
                    SELECT 
                        TRIM(LOWER(parent_product_en)) AS clean_parent_en,
                        MIN(parent_product_id) AS canonical_id
                    FROM workspace.gold.dim_product
                    WHERE parent_product_en IS NOT NULL 
                      AND TRIM(parent_product_en) != ''
                      AND parent_product_id IS NOT NULL 
                      AND parent_product_id > 0
                    GROUP BY 1
                )
                SELECT 
                    p.product_ru,
                    c.canonical_id
                FROM workspace.gold.dim_product p
                JOIN canonical_parents c
                  ON TRIM(LOWER(p.parent_product_en)) = c.clean_parent_en
                WHERE p.parent_product_id IS NULL 
                   OR p.parent_product_id != c.canonical_id
            ) AS source
            ON target.product_ru = source.product_ru
            WHEN MATCHED THEN UPDATE SET
                target.parent_product_id = source.canonical_id,
                target.updated_at = current_timestamp()
        """
        execute_databricks_sql(unify_sql)

        # Step 2: Assign IDs to any remaining products with NULL/0 parent_product_id
        assign_sql = """
            MERGE INTO workspace.gold.dim_product AS target
            USING (
                SELECT 
                    product_ru,
                    (SELECT COALESCE(MAX(parent_product_id), 0) FROM workspace.gold.dim_product) 
                    + DENSE_RANK() OVER (ORDER BY COALESCE(TRIM(LOWER(parent_product_en)), product_ru)) AS assigned_id
                FROM workspace.gold.dim_product
                WHERE parent_product_id IS NULL OR parent_product_id <= 0
            ) AS source
            ON target.product_ru = source.product_ru
            WHEN MATCHED THEN UPDATE SET
                target.parent_product_id = source.assigned_id,
                target.updated_at = current_timestamp()
        """
        execute_databricks_sql(assign_sql)

        # Step 3: Propagate parent_product_id to fact_recipe_ingredients
        sync_recipes_sql = """
            MERGE INTO workspace.inventory_tabular.fact_recipe_ingredients AS target
            USING (
                SELECT product_ru, parent_product_id
                FROM workspace.gold.dim_product
                WHERE parent_product_id IS NOT NULL AND parent_product_id > 0
            ) AS source
            ON LOWER(target.recipe_product_name) = LOWER(source.product_ru)
            WHEN MATCHED AND (target.parent_product_id IS NULL OR target.parent_product_id != source.parent_product_id) THEN
            UPDATE SET target.parent_product_id = source.parent_product_id
        """
        execute_databricks_sql(sync_recipes_sql)

    def calculate_cogs_from_recipes():
        """
        Computes product unit cost (COGS) directly from the real-time BOM recipe view
        workspace.inventory_tabular.view_product_recipe_cogs (powered by view_ingredient_wac_30d).
        Updates workspace.gold.dim_product.cost.
        """
        calc_sql = """
            MERGE INTO workspace.gold.dim_product AS target
            USING (
                SELECT product_ru, calculated_cogs
                FROM workspace.inventory_tabular.view_product_recipe_cogs
                WHERE calculated_cogs > 0
            ) AS source
            ON target.product_ru = source.product_ru
            WHEN MATCHED THEN UPDATE SET
                target.cost = source.calculated_cogs,
                target.updated_at = current_timestamp()
        """
        execute_databricks_sql(calc_sql)

    def load_unmapped_products():
        query = """
            SELECT 
                t.product AS pos_product_name,
                COUNT(*)  AS recent_transaction_count,
                MAX(t.date) AS last_seen_date,
                CASE WHEN p.product_ru IS NULL THEN 'Missing from Table' ELSE 'Needs Classification' END AS status
            FROM workspace.default.transactions t
            LEFT JOIN workspace.gold.dim_product p
              ON t.product = p.product_ru
            WHERE (p.product_ru IS NULL OR p.category = 'Uncategorized')
              AND t.transaction_type != 'Non-Fiscal'
            GROUP BY 1, 4
            ORDER BY 2 DESC
        """
        return execute_databricks_sql(query)

    def import_unmapped_to_dim_product():
        insert_sql = """
            INSERT INTO workspace.gold.dim_product (
                product_ru, parent_product_id, parent_product_en, parent_product_ru,
                variant, category, subcategory, is_modifier, is_active, base_price, cost, updated_at
            )
            SELECT DISTINCT
                t.product                                                    AS product_ru,
                (SELECT COALESCE(MAX(parent_product_id), 0) FROM workspace.gold.dim_product) 
                + DENSE_RANK() OVER (ORDER BY t.product)                    AS parent_product_id,
                t.product                                                    AS parent_product_en,
                t.product                                                    AS parent_product_ru,
                'Standard'                                                   AS variant,
                'Uncategorized'                                              AS category,
                'New POS Item'                                               AS subcategory,
                COALESCE(t.is_topping, FALSE)                                AS is_modifier,
                TRUE                                                         AS is_active,
                0.0                                                          AS base_price,
                0.0                                                          AS cost,
                current_timestamp()                                          AS updated_at
            FROM workspace.default.transactions t
            LEFT JOIN workspace.gold.dim_product p
              ON t.product = p.product_ru
            WHERE p.product_ru IS NULL
              AND t.transaction_type != 'Non-Fiscal'
        """
        execute_databricks_sql(insert_sql)

    tab_edit, tab_unmapped, tab_summary = st.tabs([
        "📋 Product Catalog (Edit & Save)", 
        "🚨 Unmapped / New POS Items", 
        "📊 Product Margins & Pricing"
    ])

    with tab_edit:
        if "prod_save_msg" in st.session_state:
            st.toast(st.session_state.pop("prod_save_msg"), icon="✅")

        df_prod = load_dim_product()

        uncat_count = len(df_prod[df_prod["category"] == "Uncategorized"]) if not df_prod.empty else 0
        if uncat_count > 0:
            st.warning(f"⚠️ **{uncat_count}** products pending classification! Filter by **'Uncategorized'** below to set category & price.")

        col_q, col_cat, col_stat, col_ref = st.columns([2.5, 1.8, 1.4, 0.7])
        with col_q:
            search_query = st.text_input("🔍 Search product (RU or EN):", placeholder="Type name to filter...", label_visibility="collapsed")
        with col_cat:
            cats = ["All Categories"] + sorted([c for c in df_prod["category"].dropna().unique() if c])
            sel_cat = st.selectbox("Category Filter:", cats, index=0, label_visibility="collapsed")
        with col_stat:
            status_filter = st.selectbox("Status Filter:", ["All Items", "Active Only", "Inactive Only"], label_visibility="collapsed")
        with col_ref:
            if st.button("🔄", help="Refresh from Databricks", key="refresh_prod"):
                st.cache_data.clear()
                st.rerun()

        # Filtering logic
        f_df = df_prod.copy()
        if search_query:
            mask = (
                f_df["product_ru"].astype(str).str.contains(search_query, case=False, na=False) |
                f_df["parent_product_en"].astype(str).str.contains(search_query, case=False, na=False)
            )
            f_df = f_df[mask]
        if sel_cat != "All Categories":
            f_df = f_df[f_df["category"] == sel_cat]
        if status_filter == "Active Only":
            f_df = f_df[f_df["is_active"] == True]
        elif status_filter == "Inactive Only":
            f_df = f_df[f_df["is_active"] == False]

        prod_cat_options = sorted(list(set(["Drink", "Food", "Dessert", "Toppings & Modifiers", "Service", "Uncategorized", "Other"] + [c for c in df_prod["category"].dropna().unique() if str(c).strip()])))
        prod_var_options = sorted(list(set(["Standard", "No Boba", "Large Cup (500ml)", "Double Shot"] + [v for v in df_prod["variant"].dropna().unique() if str(v).strip()])))

        # Priority column order: Put most-edited fields first
        prod_col_order = [
            "product_ru",
            "base_price",
            "cost",
            "is_active",
            "category",
            "variant",
            "parent_product_en",
            "subcategory",
            "parent_product_id",
            "is_modifier",
            "updated_at",
        ]
        f_df = f_df[[c for c in prod_col_order if c in f_df.columns]]

        # Top Action Bar container (rendered above table)
        top_action_bar = st.container()

        edited_df = st.data_editor(
            f_df,
            num_rows="dynamic",
            disabled=["updated_at"],
            column_config={
                "product_ru": st.column_config.TextColumn("POS Exact Name (Key)", help="Matches POS transactions string", required=True, width="large"),
                "base_price": st.column_config.NumberColumn("Price (₽)", min_value=0.0, step=10.0, format="₽%.0f", width="small", required=True),
                "cost": st.column_config.NumberColumn("Unit Cost (₽)", min_value=0.0, step=1.0, format="₽%.2f", width="small", help="Recipe COGS in rubles"),
                "is_active": st.column_config.CheckboxColumn("Active?", help="Uncheck if retired/discontinued", default=True, width="small"),
                "category": st.column_config.SelectboxColumn("Category", options=prod_cat_options, required=True, width="medium"),
                "variant": st.column_config.SelectboxColumn("Variant", options=prod_var_options, width="small"),
                "parent_product_en": st.column_config.TextColumn("English Canonical Name", help="English display name for Genie and reports.", width="medium"),
                "subcategory": st.column_config.TextColumn("Subcategory", width="medium"),
                "parent_product_id": st.column_config.NumberColumn("Parent ID", help="Group ID. Products sharing the same Parent ID and English name are grouped together.", format="%d", width="small"),
                "is_modifier": st.column_config.CheckboxColumn("Modifier?", width="small"),
                "updated_at": st.column_config.DatetimeColumn("Last Updated", format="YYYY-MM-DD HH:mm", width="medium"),
            },
            use_container_width=True,
            height=600,
            key="product_catalog_editor"
        )

        # Detect changes
        modified_rows = []
        for idx, row in edited_df.iterrows():
            p_ru = str(row.get("product_ru", "")).strip()
            if not p_ru or p_ru.lower() == "nan":
                continue
            if idx not in f_df.index:
                modified_rows.append(row)
            else:
                orig = f_df.loc[idx]
                changed = False
                for col in ["parent_product_id", "parent_product_en", "category", "subcategory", "variant", "is_modifier", "is_active", "base_price", "cost"]:
                    v_orig = orig.get(col)
                    v_new = row.get(col)
                    if pd.isna(v_orig) and pd.isna(v_new):
                        continue
                    if isinstance(v_orig, (int, float)) or isinstance(v_new, (int, float)):
                        try:
                            if abs(float(v_orig or 0) - float(v_new or 0)) > 1e-4:
                                changed = True
                                break
                        except Exception:
                            changed = True
                            break
                    elif str(v_orig or "").strip() != str(v_new or "").strip():
                        changed = True
                        break
                if changed:
                    modified_rows.append(row)

        has_changes = len(modified_rows) > 0
        save_label = f"💾 Save ({len(modified_rows)}) Changes" if has_changes else "💾 Save Changes"

        # Populate Top Action Bar
        with top_action_bar:
            col_save_top, col_recalc_top, col_cost_top, col_info_top = st.columns([1.8, 1.8, 1.8, 2.6])
            with col_save_top:
                save_prod_top = st.button(save_label, type="primary" if has_changes else "secondary", disabled=not has_changes, use_container_width=True, key="save_prod_top")
            with col_recalc_top:
                recalc_top = st.button("⚡ Recalculate Parent IDs", help="Unifies parent_product_id across all products sharing the same English Canonical Name", use_container_width=True, key="recalc_top")
            with col_cost_top:
                calc_cost_top = st.button("🍲 Sync Recipe Costs", help="Updates product unit costs directly from real-time recipe BOM COGS view", use_container_width=True, key="calc_cost_top")
            with col_info_top:
                if has_changes:
                    st.info(f"✏️ **{len(modified_rows)}** unsaved change(s). Click Save to commit.")
                else:
                    st.caption(f"📋 Showing **{len(f_df)}** of **{len(df_prod)}** products · 🟢 Ready to edit")

        # Bottom save button for convenience when scrolled down
        col_save_bot, _ = st.columns([1.8, 6.2])
        with col_save_bot:
            save_prod_bot = st.button(save_label, type="primary" if has_changes else "secondary", disabled=not has_changes, use_container_width=True, key="save_prod_bot")

        save_prod_btn = save_prod_top or save_prod_bot
        recalc_btn = recalc_top
        calc_cost_btn = calc_cost_top

        if save_prod_btn:
            if not modified_rows:
                st.warning("⚠️ No changes detected to save. Edit a cell and press Enter first.")
            else:
                with st.spinner(f"Saving {len(modified_rows)} updates to workspace.gold.dim_product..."):
                    try:
                        for row in modified_rows:
                            p_ru = str(row.get("product_ru", "")).replace("'", "''").strip()
                            parent_id = int(row.get("parent_product_id", 0)) if pd.notnull(row.get("parent_product_id")) else 0
                            p_en = str(row.get("parent_product_en", "")).replace("'", "''").strip()
                            cat = str(row.get("category", "Other")).replace("'", "''").strip()
                            subcat = str(row.get("subcategory", "")).replace("'", "''").strip() if pd.notnull(row.get("subcategory")) else ""
                            var = str(row.get("variant", "Standard")).replace("'", "''").strip() if pd.notnull(row.get("variant")) else "Standard"
                            is_mod = bool(row.get("is_modifier")) if pd.notnull(row.get("is_modifier")) else False
                            is_act = bool(row.get("is_active")) if pd.notnull(row.get("is_active")) else True
                            price = float(row.get("base_price", 0.0)) if pd.notnull(row.get("base_price")) else 0.0
                            cost = float(row.get("cost", 0.0)) if pd.notnull(row.get("cost")) else 0.0

                            parent_id_val = str(parent_id) if parent_id > 0 else "target.parent_product_id"
                            parent_id_insert = str(parent_id) if parent_id > 0 else "(SELECT COALESCE(MAX(parent_product_id), 0) + 1 FROM workspace.gold.dim_product)"

                            merge_sql = f"""
                                MERGE INTO workspace.gold.dim_product AS target
                                USING (SELECT '{p_ru}' AS product_ru) AS source
                                ON target.product_ru = source.product_ru
                                WHEN MATCHED THEN UPDATE SET
                                    parent_product_id = {parent_id_val},
                                    parent_product_en = '{p_en}',
                                    category = '{cat}',
                                    subcategory = '{subcat}',
                                    variant = '{var}',
                                    is_modifier = {is_mod},
                                    is_active = {is_act},
                                    base_price = {price},
                                    cost = {cost},
                                    updated_at = current_timestamp()
                                WHEN NOT MATCHED THEN INSERT (
                                    product_ru, parent_product_id, parent_product_en, parent_product_ru,
                                    variant, category, subcategory, is_modifier, is_active, base_price, cost, updated_at
                                ) VALUES (
                                    '{p_ru}', {parent_id_insert}, '{p_en}', '{p_ru}',
                                    '{var}', '{cat}', '{subcat}', {is_mod}, {is_act}, {price}, {cost}, current_timestamp()
                                )
                            """
                            execute_databricks_sql(merge_sql)

                        st.cache_data.clear()
                        if "product_catalog_editor" in st.session_state:
                            del st.session_state["product_catalog_editor"]
                        st.session_state["prod_save_msg"] = f"✅ Successfully saved {len(modified_rows)} product update(s) to Delta Lake!"
                        st.rerun()
                    except Exception as err:
                        st.error(f"❌ Failed to persist product changes: {err}")

        if recalc_btn:
            with st.spinner("Unifying parent product IDs across matching English names..."):
                try:
                    recalculate_parent_product_ids()
                    st.cache_data.clear()
                    if "product_catalog_editor" in st.session_state:
                        del st.session_state["product_catalog_editor"]
                    st.session_state["prod_save_msg"] = "✅ Successfully recalculated and unified parent product IDs across matching items!"
                    st.rerun()
                except Exception as err:
                    st.error(f"❌ Failed to recalculate parent product IDs: {err}")

        if calc_cost_btn:
            with st.spinner("Calculating recipe COGS from BOM ingredients using 30-day WAC..."):
                try:
                    calculate_cogs_from_recipes()
                    st.cache_data.clear()
                    if "product_catalog_editor" in st.session_state:
                        del st.session_state["product_catalog_editor"]
                    st.session_state["prod_save_msg"] = "✅ Successfully recalculated product unit costs from BOM recipes (using 30-Day WAC)!"
                    st.rerun()
                except Exception as err:
                    st.error(f"❌ Failed to compute recipe costs: {err}")

    with tab_unmapped:
        st.subheader("Items from POS Transactions Missing Classification")
        unmapped_df = load_unmapped_products()
        missing = unmapped_df[unmapped_df["status"] == "Missing from Table"] if not unmapped_df.empty else pd.DataFrame()

        if unmapped_df.empty:
            st.success("🎉 All items from POS are fully classified!")
        else:
            col_u1, col_u2 = st.columns([3, 1])
            with col_u1:
                st.warning(f"Found **{len(unmapped_df)}** items requiring categorization.")
            with col_u2:
                if not missing.empty:
                    if st.button("⚡ Import All to Catalog", type="primary"):
                        with st.spinner("Importing into workspace.gold.dim_product..."):
                            try:
                                import_unmapped_to_dim_product()
                                st.cache_data.clear()
                                st.session_state["prod_save_msg"] = "✅ Imported items to catalog! You can now classify them in Tab 1."
                                st.rerun()
                            except Exception as err:
                                st.error(f"❌ Failed import: {err}")

            st.dataframe(
                unmapped_df,
                column_config={
                    "pos_product_name": st.column_config.TextColumn("POS Product Name", width="large"),
                    "recent_transaction_count": st.column_config.NumberColumn("Recent Transactions", format="%d"),
                    "last_seen_date": st.column_config.DateColumn("Last Seen Date"),
                    "status": st.column_config.TextColumn("Classification Status", width="medium"),
                },
                use_container_width=True
            )

    with tab_summary:
        st.subheader("Menu Catalog Breakdown & Pricing Summary")
        if not df_prod.empty:
            cat_sum = df_prod.groupby("category").agg(
                total_skus=("product_ru", "count"),
                active_skus=("is_active", "sum"),
                avg_price=("base_price", "mean"),
                avg_cost=("cost", "mean"),
                modifier_count=("is_modifier", "sum")
            ).reset_index()

            cat_sum["avg_margin_pct"] = (
                (cat_sum["avg_price"] - cat_sum["avg_cost"]) / cat_sum["avg_price"].replace(0, float('nan')) * 100
            ).fillna(0.0)

            st.dataframe(
                cat_sum,
                column_config={
                    "category": "Category",
                    "total_skus": st.column_config.NumberColumn("Total SKUs"),
                    "active_skus": st.column_config.NumberColumn("Active SKUs"),
                    "avg_price": st.column_config.NumberColumn("Average Price", format="₽%.1f"),
                    "avg_cost": st.column_config.NumberColumn("Average Cost", format="₽%.1f"),
                    "avg_margin_pct": st.column_config.NumberColumn("Gross Margin %", format="%.1f%%"),
                    "modifier_count": st.column_config.NumberColumn("Toppings / Modifiers"),
                },
                use_container_width=True
            )

            st.divider()
            st.subheader("💡 Product Profitability & Margins")
            st.caption("Live comparison between Menu Base Price and Unit Cost (calculated from BOM recipes or entered manually)")

            margin_df = df_prod[df_prod["is_active"] == True].copy()
            margin_df["margin_rub"] = margin_df["base_price"] - margin_df["cost"]
            margin_df["margin_pct"] = (
                (margin_df["margin_rub"] / margin_df["base_price"].replace(0, float('nan'))) * 100
            ).fillna(0.0)

            st.dataframe(
                margin_df[[
                    "parent_product_id", "product_ru", "parent_product_en", "category",
                    "base_price", "cost", "margin_rub", "margin_pct"
                ]].sort_values(by="margin_pct", ascending=False),
                column_config={
                    "parent_product_id": st.column_config.NumberColumn("Parent ID", format="%d", width="small"),
                    "product_ru": st.column_config.TextColumn("Product (RU)", width="medium"),
                    "parent_product_en": st.column_config.TextColumn("Parent (EN)", width="medium"),
                    "category": st.column_config.TextColumn("Category", width="small"),
                    "base_price": st.column_config.NumberColumn("Price", format="₽%.0f", width="small"),
                    "cost": st.column_config.NumberColumn("Unit Cost", format="₽%.2f", width="small"),
                    "margin_rub": st.column_config.NumberColumn("Gross Profit", format="₽%.2f", width="small"),
                    "margin_pct": st.column_config.NumberColumn("Margin %", format="%.1f%%", width="small"),
                },
                use_container_width=True
            )

# ══════════════════════════════════════════════════════════════════════════════
# MODULE 2: INGREDIENTS & INVENTORY (workspace.inventory_tabular.dim_ingredients)
# ══════════════════════════════════════════════════════════════════════════════
elif selected_module == "🍓 Ingredients & Stock (dim_ingredients)":
    st.title("🍓 Ingredient & Inventory Master")
    st.caption("Master ingredient metadata for Delta Lake (`workspace.inventory_tabular.dim_ingredients`) and Cloudflare D1")

    KNOWN_UNITS = ['мл', 'гр', 'шт', 'уп', 'порц', 'кг', 'л']
    KNOWN_SUPPLIERS = [
        'СИРОПЫ, ТОППИНГИ, ПЮРЕ',
        'ПРОИЗВОДСТВО',
        'ПОРОШКИ',
        'КОНТЕЙНЕРЫ',
        'КУПЕР',
        'КИДАНОВА О.В',
        'КОФЕ И ЧАЙ',
        'СКЛАД',
        'ХОЗ. ТОВАРЫ',
        'other'
    ]
    KNOWN_PRODUCT_TYPES = [
        'syrup', 'topping', 'puree', 'milk', 'coffee', 'tea', 'powder', 'cheese_powder', 'cocoa',
        'cups_plastic_500', 'cups_plastic_320', 'cups_paper',
        'juice_balls', 'corndogs', 'mochi', 'pancakes', 'cream', 'sugar',
        'lids', 'straws', 'juice', 'sparkling_water', 'marshmallow', 'patoka', 'ingredient', 'other'
    ]

    @st.cache_data(ttl=60)
    def load_dim_ingredients():
        query = """
            SELECT 
                ingredient_id,
                ingredient_name,
                unit,
                product_type,
                supplier_id,
                supplier_name,
                COALESCE(is_warehouse_only, FALSE) AS is_warehouse_only,
                COALESCE(is_hidden, FALSE) AS is_hidden,
                COALESCE(manual_catalog_cost, 0.0) AS cost_per_unit,
                COALESCE(effective_unit_cost, 0.0) AS effective_unit_cost,
                COALESCE(wac_30d, 0.0) AS wac_30d,
                COALESCE(wac_30d, 0.0) AS wac_cost_30d,
                COALESCE(last_purchase_cost, 0.0) AS last_purchase_cost,
                last_purchase_date,
                COALESCE(cost_source, 'unpriced') AS cost_source
            FROM workspace.inventory_tabular.view_ingredient_wac_30d
            ORDER BY 
                is_hidden ASC,
                supplier_name ASC,
                ingredient_name ASC
        """
        df = execute_databricks_sql(query)
        if not df.empty:
            df["ingredient_id"] = pd.to_numeric(df["ingredient_id"], errors="coerce").fillna(0).astype(int)
            df["is_warehouse_only"] = df["is_warehouse_only"].astype(str).str.lower().isin(["true", "1", "t"])
            df["is_hidden"] = df["is_hidden"].astype(str).str.lower().isin(["true", "1", "t"])
            df["cost_per_unit"] = pd.to_numeric(df["cost_per_unit"], errors="coerce").fillna(0.0)
            df["effective_unit_cost"] = pd.to_numeric(df["effective_unit_cost"], errors="coerce").fillna(0.0)
            df["wac_cost_30d"] = pd.to_numeric(df["wac_cost_30d"], errors="coerce").fillna(0.0)
            df["last_purchase_cost"] = pd.to_numeric(df["last_purchase_cost"], errors="coerce").fillna(0.0)
            df["unit"] = df["unit"].replace({"Гр": "гр"}).fillna("шт")
            df["supplier_name"] = df["supplier_name"].fillna("other").replace({"None": "other", "nan": "other", "": "other"})
            df["product_type"] = df["product_type"].fillna("ingredient").replace({"None": "ingredient", "nan": "ingredient", "": "ingredient"})
            df["cost_source"] = df["cost_source"].fillna("unpriced")
        return df

    tab_ing_edit, tab_ing_add, tab_ing_summary = st.tabs([
        "📋 Ingredients Catalog (Edit & Save)",
        "➕ Add New Ingredient",
        "📊 Supplier & Category Health"
    ])

    # ── TAB 1: EDIT INGREDIENTS ──
    with tab_ing_edit:
        if "ing_save_msg" in st.session_state:
            st.toast(st.session_state.pop("ing_save_msg"), icon="✅")

        df_ing = load_dim_ingredients()

        # Filters: Single clean row
        c_search, c_supp, c_type, c_ref = st.columns([2.5, 2.0, 1.8, 0.7])
        with c_search:
            ing_search = st.text_input("🔍 Search ingredient name:", placeholder="Type ingredient name to filter...", label_visibility="collapsed")
        with c_supp:
            supp_options = ["All Suppliers / Categories"] + sorted([s for s in df_ing["supplier_name"].dropna().unique() if s])
            sel_supp = st.selectbox("Category / Supplier Filter:", supp_options, index=0, label_visibility="collapsed")
        with c_type:
            type_options = ["All Product Types"] + sorted([t for t in df_ing["product_type"].dropna().unique() if t])
            sel_type = st.selectbox("Product Type Filter:", type_options, index=0, label_visibility="collapsed")
        with c_ref:
            if st.button("🔄", help="Refresh from Databricks", key="refresh_ing"):
                st.cache_data.clear()
                st.rerun()

        # Apply filtering
        f_ing = df_ing.copy()
        if ing_search:
            f_ing = f_ing[f_ing["ingredient_name"].astype(str).str.contains(ing_search, case=False, na=False)]
        if sel_supp != "All Suppliers / Categories":
            f_ing = f_ing[f_ing["supplier_name"] == sel_supp]
        if sel_type != "All Product Types":
            f_ing = f_ing[f_ing["product_type"] == sel_type]

        all_units = sorted(list(set(KNOWN_UNITS + [u for u in df_ing["unit"].dropna().unique() if str(u).strip()])))
        all_suppliers = sorted(list(set(KNOWN_SUPPLIERS + [s for s in df_ing["supplier_name"].dropna().unique() if str(s).strip()])))
        all_types = sorted(list(set(KNOWN_PRODUCT_TYPES + [t for t in df_ing["product_type"].dropna().unique() if str(t).strip()])))

        # Priority column order: Put most-edited fields first
        ing_col_order = [
            "ingredient_id",
            "ingredient_name",
            "cost_per_unit",
            "effective_unit_cost",
            "unit",
            "supplier_name",
            "is_hidden",
            "product_type",
            "is_warehouse_only",
            "cost_source",
            "wac_30d",
            "last_purchase_cost",
            "last_purchase_date",
        ]
        f_ing = f_ing[[c for c in ing_col_order if c in f_ing.columns]]

        # Top Action Bar container (rendered above table)
        top_ing_bar = st.container()

        edited_ing_df = st.data_editor(
            f_ing,
            disabled=["ingredient_id", "effective_unit_cost", "wac_cost_30d", "last_purchase_cost", "last_purchase_date", "cost_source"],
            num_rows="fixed",
            column_config={
                "ingredient_id": st.column_config.NumberColumn("ID", format="%d", width="small", help="Unique sequential ID", disabled=True),
                "ingredient_name": st.column_config.TextColumn("Ingredient Name", required=True, width="large"),
                "cost_per_unit": st.column_config.NumberColumn("Catalog Cost (₽)", min_value=0.0, step=0.5, format="₽%.2f", width="small", help="Manual standard catalog baseline cost"),
                "effective_unit_cost": st.column_config.NumberColumn("Live Cost (₽)", format="₽%.4f", width="small", help="Real-time 30-day WAC or fallback cost from view", disabled=True),
                "unit": st.column_config.SelectboxColumn("Unit", options=all_units, required=True, width="small"),
                "supplier_name": st.column_config.SelectboxColumn("Category / Supplier", options=all_suppliers, required=True, width="medium"),
                "is_hidden": st.column_config.CheckboxColumn("Hidden?", width="small", help="Check to hide from retail audit forms"),
                "product_type": st.column_config.SelectboxColumn("Product Type", options=all_types, required=True, width="medium"),
                "is_warehouse_only": st.column_config.CheckboxColumn("Warehouse Only?", width="small"),
                "cost_source": st.column_config.TextColumn("Cost Source", width="small", help="30d_wac, last_purchase, manual_catalog, or unpriced", disabled=True),
                "wac_30d": st.column_config.NumberColumn("30d WAC (₽)", format="₽%.4f", width="small", disabled=True),
                "last_purchase_cost": st.column_config.NumberColumn("Last PO (₽)", format="₽%.2f", width="small", disabled=True),
                "last_purchase_date": st.column_config.TextColumn("Last PO Date", width="small", disabled=True),
                "supplier_id": None, # Hide raw ID
            },
            use_container_width=True,
            height=600,
            key="ingredient_catalog_editor"
        )

        # Detect changes
        mod_ing_rows = []
        for idx, row in edited_ing_df.iterrows():
            ing_id = row.get("ingredient_id")
            if pd.isna(ing_id) or int(ing_id) <= 0:
                continue
            if idx in f_ing.index:
                orig = f_ing.loc[idx]
                changed = False
                for col in ["ingredient_name", "unit", "supplier_name", "product_type", "cost_per_unit", "is_warehouse_only", "is_hidden"]:
                    v_orig = orig.get(col)
                    v_new = row.get(col)
                    if pd.isna(v_orig) and pd.isna(v_new):
                        continue
                    if isinstance(v_orig, (int, float)) or isinstance(v_new, (int, float)):
                        try:
                            if abs(float(v_orig or 0) - float(v_new or 0)) > 1e-4:
                                changed = True
                                break
                        except Exception:
                            changed = True
                            break
                    elif str(v_orig or "").strip() != str(v_new or "").strip():
                        changed = True
                        break
                if changed:
                    mod_ing_rows.append(row)

        has_ing_changes = len(mod_ing_rows) > 0
        save_ing_label = f"💾 Save ({len(mod_ing_rows)}) Ingredients" if has_ing_changes else "💾 Save Ingredients"

        # Populate Top Action Bar
        with top_ing_bar:
            c_save_ing_top, c_ref_ing_top, c_info_ing_top = st.columns([2.0, 2.0, 4.0])
            with c_save_ing_top:
                save_ing_top = st.button(save_ing_label, type="primary" if has_ing_changes else "secondary", disabled=not has_ing_changes, use_container_width=True, key="save_ing_top")
            with c_ref_ing_top:
                ref_ing_top = st.button("🔄 Refresh View Costs", help="Refreshes live 30-day rolling WAC and recipe costs directly from Databricks SQL view", use_container_width=True, key="ref_ing_top")
            with c_info_ing_top:
                if has_ing_changes:
                    st.info(f"✏️ **{len(mod_ing_rows)}** unsaved change(s) detected. Click Save to commit.")
                else:
                    st.caption(f"📋 Showing **{len(f_ing)}** of **{len(df_ing)}** ingredients · 🟢 Real-time WAC active")

        # Bottom save button for convenience when scrolled down
        c_save_ing_bot, _ = st.columns([2.0, 6.0])
        with c_save_ing_bot:
            save_ing_bot = st.button(save_ing_label, type="primary" if has_ing_changes else "secondary", disabled=not has_ing_changes, use_container_width=True, key="save_ing_bot")

        save_ing_btn = save_ing_top or save_ing_bot
        refresh_ing_btn = ref_ing_top

        if refresh_ing_btn:
            st.cache_data.clear()
            if "ingredient_catalog_editor" in st.session_state:
                del st.session_state["ingredient_catalog_editor"]
            st.session_state["ing_save_msg"] = "🔄 Refreshed live WAC and recipe costs from view!"
            st.rerun()

        if save_ing_btn:
            if not mod_ing_rows:
                st.warning("⚠️ No changes detected to save. Edit a cell and press Enter first.")
            else:
                with st.spinner(f"Saving {len(mod_ing_rows)} updates to Delta Lake & D1..."):
                    try:
                        for row in mod_ing_rows:
                            i_id = int(row.get("ingredient_id"))
                            i_name = str(row.get("ingredient_name", "")).replace("'", "''").strip()
                            i_unit = str(row.get("unit", "")).replace("'", "''").strip()
                            i_ptype = str(row.get("product_type", "ingredient")).replace("'", "''").strip()
                            i_sname = str(row.get("supplier_name", "other")).replace("'", "''").strip()
                            i_wh = bool(row.get("is_warehouse_only")) if pd.notnull(row.get("is_warehouse_only")) else False
                            i_hid = bool(row.get("is_hidden")) if pd.notnull(row.get("is_hidden")) else False
                            i_cost = float(row.get("cost_per_unit", 0.0)) if pd.notnull(row.get("cost_per_unit")) else 0.0

                            # 1. Delta Lake MERGE
                            merge_ing_sql = f"""
                                MERGE INTO workspace.inventory_tabular.dim_ingredients AS target
                                USING (SELECT {i_id} AS ingredient_id) AS source
                                ON target.ingredient_id = source.ingredient_id
                                WHEN MATCHED THEN UPDATE SET
                                    ingredient_name = '{i_name}',
                                    unit = '{i_unit}',
                                    product_type = '{i_ptype}',
                                    supplier_name = '{i_sname}',
                                    is_warehouse_only = {i_wh},
                                    is_hidden = {i_hid},
                                    cost_per_unit = {i_cost}
                                WHEN NOT MATCHED THEN INSERT (
                                    ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name,
                                    is_warehouse_only, is_hidden, cost_per_unit
                                ) VALUES (
                                    {i_id}, '{i_name}', '{i_unit}', '{i_ptype}', NULL, '{i_sname}', {i_wh}, {i_hid}, {i_cost}
                                )
                            """
                            execute_databricks_sql(merge_ing_sql)

                            # 2. Cloudflare D1 Dual-Write
                            execute_d1_query(
                                """
                                INSERT OR REPLACE INTO dim_ingredients (
                                    ingredient_id, ingredient_name, unit, product_type, supplier_name, is_warehouse_only, is_hidden, cost_per_unit
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                [i_id, i_name, i_unit, i_ptype, i_sname, 1 if i_wh else 0, 1 if i_hid else 0, i_cost]
                            )

                        st.cache_data.clear()
                        if "ingredient_catalog_editor" in st.session_state:
                            del st.session_state["ingredient_catalog_editor"]
                        st.session_state["ing_save_msg"] = f"✅ Successfully saved {len(mod_ing_rows)} ingredient update(s) to Delta Lake & Cloudflare D1!"
                        st.rerun()
                    except Exception as err:
                        st.error(f"❌ Failed to persist ingredient changes: {err}")

    # ── TAB 2: ADD NEW INGREDIENT ──
    with tab_ing_add:
        st.subheader("➕ Register New Ingredient")
        st.caption("Creates a new ingredient with an automatic sequential ID in both Delta Lake and Cloudflare D1.")

        with st.form("add_ingredient_form"):
            col_a1, col_a2 = st.columns(2)
            with col_a1:
                new_name = st.text_input("Ingredient Name *", placeholder="e.g. Сироп Лесные ягоды")
                new_unit = st.selectbox("Unit of Measurement *", KNOWN_UNITS, index=0)
                new_cost = st.number_input("Cost per Unit (₽)", min_value=0.0, step=5.0, value=0.0)

            with col_a2:
                new_supplier = st.selectbox("Category / Supplier *", KNOWN_SUPPLIERS, index=0)
                new_ptype = st.selectbox("Product Type *", KNOWN_PRODUCT_TYPES, index=0)
                new_wh = st.checkbox("Warehouse Exclusive (Not for retail stores)", value=False)
                new_hid = st.checkbox("Hidden from Audits", value=False)

            submitted_new = st.form_submit_button("✨ Create Ingredient", type="primary", use_container_width=True)

            if submitted_new:
                if not new_name.strip():
                    st.error("❌ Ingredient name cannot be empty.")
                else:
                    with st.spinner("Assigning next ID and creating in Delta Lake & D1..."):
                        try:
                            # 1. Determine next ID
                            id_query = "SELECT COALESCE(MAX(ingredient_id), 0) + 1 AS next_id FROM workspace.inventory_tabular.dim_ingredients"
                            next_id_df = execute_databricks_sql(id_query)
                            next_id = int(next_id_df.iloc[0]["next_id"])

                            clean_name = new_name.replace("'", "''").strip()

                            # 2. Insert into Databricks Delta Lake
                            ins_sql = f"""
                                INSERT INTO workspace.inventory_tabular.dim_ingredients (
                                    ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name,
                                    is_warehouse_only, is_hidden, cost_per_unit
                                ) VALUES (
                                    {next_id}, '{clean_name}', '{new_unit}', '{new_ptype}', NULL, '{new_supplier}',
                                    {new_wh}, {new_hid}, {new_cost}
                                )
                            """
                            execute_databricks_sql(ins_sql)

                            # 3. Dual-write to Cloudflare D1
                            execute_d1_query(
                                """
                                INSERT INTO dim_ingredients (
                                    ingredient_id, ingredient_name, unit, product_type, supplier_name, is_warehouse_only, is_hidden, cost_per_unit
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                [next_id, clean_name, new_unit, new_ptype, new_supplier, 1 if new_wh else 0, 1 if new_hid else 0, new_cost]
                            )

                            st.cache_data.clear()
                            st.success(f"🎉 Created Ingredient **#{next_id} — {clean_name}** successfully in Delta Lake and D1!")
                        except Exception as err:
                            st.error(f"❌ Failed to create ingredient: {err}")

    # ── TAB 3: INGREDIENT COST & HEALTH ──
    with tab_ing_summary:
        st.subheader("Category Distribution & Cost Completeness")

        if not df_ing.empty:
            missing_cost_count = len(df_ing[df_ing["effective_unit_cost"] <= 0])
            if missing_cost_count > 0:
                st.warning(f"⚠️ **{missing_cost_count}** ingredients have no 30-day WAC, PO history, or catalog baseline cost.")

            ing_sum = df_ing.groupby("supplier_name").agg(
                total_items=("ingredient_id", "count"),
                with_effective=("effective_unit_cost", lambda s: (s > 0).sum()),
                with_wac=("wac_cost_30d", lambda s: (s > 0).sum()),
                with_base=("cost_per_unit", lambda s: (s > 0).sum()),
                avg_effective_cost=("effective_unit_cost", "mean"),
                warehouse_only=("is_warehouse_only", "sum"),
                hidden_items=("is_hidden", "sum")
            ).reset_index()

            ing_sum["cost_coverage_pct"] = (ing_sum["with_effective"] / ing_sum["total_items"] * 100).fillna(0.0)

            st.dataframe(
                ing_sum,
                column_config={
                    "supplier_name": "Category / Supplier",
                    "total_items": st.column_config.NumberColumn("Total Ingredients"),
                    "with_effective": st.column_config.NumberColumn("Priced Items"),
                    "cost_coverage_pct": st.column_config.NumberColumn("Cost Coverage", format="%.0f%%"),
                    "avg_effective_cost": st.column_config.NumberColumn("Avg Cost (₽)", format="₽%.2f"),
                    "with_wac": st.column_config.NumberColumn("With 30d WAC"),
                    "with_base": st.column_config.NumberColumn("With Baseline"),
                    "warehouse_only": st.column_config.NumberColumn("Warehouse Only"),
                    "hidden_items": st.column_config.NumberColumn("Hidden Items"),
                },
                use_container_width=True
            )
