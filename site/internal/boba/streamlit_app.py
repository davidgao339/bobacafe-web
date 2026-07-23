"""
Tapioca cooking plan with Databricks integration.
Run: streamlit run streamlit_app.py
"""
import streamlit as st
import pandas as pd
import math
from databricks import sql
import os

st.set_page_config(
    page_title="Tapioca Cooking Plan",
    layout="wide",
)

# Databricks credentials from environment
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST")
DATABRICKS_HTTP_PATH = os.getenv("DATABRICKS_HTTP_PATH")

SLOT_ORDER = ["9:30 AM", "2:00 PM", "6:00 PM"]
PERCENTILES = {"Avg": None, "p75": 75, "p90": 90, "p95": 95, "Max": 100}

def fetch_data():
    """Fetch tapioca sales data from Databricks."""
    try:
        st.write("🔗 Connecting to Databricks warehouse...")
        connection = sql.connect(
            server_hostname=DATABRICKS_HOST,
            http_path=DATABRICKS_HTTP_PATH,
            auth_type="pat",
            token=DATABRICKS_TOKEN,
        )
        st.write("✅ Connected!")

        cursor = connection.cursor()
        st.write("📊 Fetching transactions...")

        # Query tapioca transactions from past 90 days
        # Adjust WHERE clause if needed based on actual column names
        cursor.execute("""
            SELECT
                datetime, date, store_name, qty, transaction_type, is_return
            FROM workspace.default.transactions
            WHERE date >= CURRENT_DATE() - 90
            ORDER BY datetime DESC
        """)

        st.write("✅ Query executed. Processing rows...")
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        st.write(f"✅ Got {len(rows)} rows")

        connection.close()

        df = pd.DataFrame(rows, columns=columns)
        return df

    except Exception as e:
        st.error(f"❌ Error: {str(e)}")
        st.error(f"Error type: {type(e).__name__}")
        st.warning("""
        **Try these steps:**
        1. In Streamlit Cloud settings → Secrets, verify all 3 are set
        2. Check your SQL warehouse is RUNNING (not paused)
        3. Run this in Databricks to test:
        ```sql
        SELECT COUNT(*) FROM workspace.default.transactions LIMIT 1;
        ```
        4. If table doesn't exist, check the schema and catalog name
        """)
        st.stop()

def process_data(df, rolling_days):
    """Process raw data and compute recommendations."""
    df["local_dt"] = pd.to_datetime(df["datetime"])
    df["local_hour"] = df["local_dt"].dt.hour + df["local_dt"].dt.minute / 60
    df["date"] = pd.to_datetime(df["date"]).dt.date

    df = df[df["transaction_type"] != "Non-Fiscal"].copy()

    sign = df["is_return"].apply(lambda x: -1 if x else 1)
    df["net_qty"] = df["qty"].abs() * sign

    def assign_slot(h):
        if h < 2 or h >= 20:
            return "6:00 PM"
        elif h < 16:
            return "9:30 AM"
        else:
            return "2:00 PM"

    df["slot"] = df["local_hour"].apply(assign_slot)
    df["day_type"] = df["local_dt"].dt.dayofweek.apply(
        lambda d: "Weekend" if d >= 5 else "Weekday"
    )

    daily = (
        df.groupby(["store_name", "date", "day_type", "slot"])["net_qty"]
        .sum()
        .reset_index()
        .rename(columns={"net_qty": "actual"})
    )

    # Filter to rolling window
    max_date = daily["date"].max()
    min_date = max_date - pd.Timedelta(days=rolling_days)
    daily_filtered = daily[daily["date"] >= min_date].copy()

    stores = sorted(daily["store_name"].unique())

    def compute_rec(daily_to_use, pct):
        if pct is None:
            agg = daily_to_use.groupby(["store_name", "slot", "day_type"])["actual"].mean()
        elif pct == 100:
            agg = daily_to_use.groupby(["store_name", "slot", "day_type"])["actual"].max()
        else:
            agg = daily_to_use.groupby(["store_name", "slot", "day_type"])["actual"].quantile(pct / 100)
        return agg.apply(math.ceil).reset_index().rename(columns={"actual": "recommended"})

    recs = {k: compute_rec(daily_filtered, v) for k, v in PERCENTILES.items()}

    def compute_backtest(daily, rec_df):
        bt = daily.merge(rec_df, on=["store_name", "slot", "day_type"])
        bt["under"] = bt["actual"] > bt["recommended"]
        bt["shortfall"] = (bt["actual"] - bt["recommended"]).clip(lower=0)
        result = (
            bt.groupby(["store_name", "slot", "day_type"])
            .agg(
                recommended=("recommended", "first"),
                total_days=("actual", "count"),
                days_under=("under", "sum"),
                avg_shortfall=("shortfall", lambda x: x[x > 0].mean() if (x > 0).any() else 0),
                max_shortfall=("shortfall", "max"),
            )
            .reset_index()
        )
        result["pct_under"] = (result["days_under"] / result["total_days"] * 100).round(1)
        result["avg_shortfall"] = result["avg_shortfall"].apply(
            lambda x: math.ceil(x) if x > 0 else 0
        )
        result["max_shortfall"] = result["max_shortfall"].astype(int)
        return result

    backtests = {k: compute_backtest(daily, recs[k]) for k in PERCENTILES}

    return {
        "daily_filtered": daily_filtered,
        "recs": recs,
        "backtests": backtests,
        "stores": stores,
        "max_date": max_date,
        "min_date": min_date,
    }

# ─────────────────── UI ───────────────────────

st.title("🧋 Tapioca Cooking Plan")

# Sidebar controls
with st.sidebar:
    st.header("⚙️ Settings")

    rolling_days = st.slider(
        "Rolling average days",
        min_value=7,
        max_value=180,
        value=90,
        step=1,
    )

    percentile = st.radio(
        "Percentile standard",
        ["Avg", "p75", "p90", "p95", "Max"],
        index=2,
    )

    grams_per_portion = st.number_input(
        "Grams per portion",
        min_value=1,
        max_value=200,
        value=50,
        step=1,
    )

    if st.button("🔄 Refresh Data", type="primary", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

# Load data
try:
    with st.spinner("Fetching data..."):
        raw_df = fetch_data()
        processed = process_data(raw_df, rolling_days)

    st.success(f"✅ Data loaded: {processed['min_date']} to {processed['max_date']}")

    # Display info
    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Stores", len(processed["stores"]))
    with col2:
        st.metric("Days in window", rolling_days)
    with col3:
        st.metric("Last updated", processed["max_date"].strftime("%b %d, %Y"))

    st.divider()

    # Cooking plan
    st.header("Cooking Plan")

    recs_df = processed["recs"][percentile].copy()

    for store in processed["stores"]:
        with st.expander(f"📍 {store}", expanded=True):
            store_recs = recs_df[recs_df["store_name"] == store]

            plan_data = []
            for _, row in store_recs.iterrows():
                portions = row["recommended"]
                grams = int(portions * grams_per_portion)

                plan_data.append({
                    "Slot": row["slot"],
                    "Day Type": row["day_type"],
                    "Portions": portions,
                    "Grams": f"{grams} g"
                })

            plan_display = pd.DataFrame(plan_data)
            st.dataframe(plan_display, use_container_width=True, hide_index=True)

except Exception as e:
    st.stop()
