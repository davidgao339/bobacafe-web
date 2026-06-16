"""
Tapioca cooking plan with Databricks integration.
Run: streamlit run streamlit_app.py
"""
import streamlit as st
import pandas as pd
import numpy as np
import math
from databricks import sql
import os
from datetime import datetime

st.set_page_config(
    page_title="Tapioca Cooking Plan",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Databricks credentials from environment
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST")
DATABRICKS_HTTP_PATH = os.getenv("DATABRICKS_HTTP_PATH")

SLOT_ORDER = ["9:30 AM", "2:00 PM", "6:00 PM"]
PERCENTILES = {"Avg": None, "p75": 75, "p90": 90, "p95": 95, "Max": 100}

@st.cache_data(ttl=3600)
def fetch_data():
    """Fetch tapioca sales data from Databricks."""
    try:
        with sql.connect(
            server_hostname=DATABRICKS_HOST,
            http_path=DATABRICKS_HTTP_PATH,
            auth_type="pat",
            token=DATABRICKS_TOKEN,
            session_configuration={"sql_session_max_idle_timeout": "30m"}
        ) as connection:
            cursor = connection.cursor()
            # Try to fetch from tapioca_sales, fallback to other names
            # Query transactions table - adjust WHERE clause as needed
            cursor.execute("""
                SELECT
                    datetime, date, store_name, qty, transaction_type, is_return
                FROM workspace.default.transactions
                ORDER BY datetime DESC
                LIMIT 50000
            """)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            df = pd.DataFrame(rows, columns=columns)
            return df
    except Exception as e:
        st.error(f"Connection error: {str(e)}")
        st.info("**Troubleshooting:**\n"
                "1. Check DATABRICKS_TOKEN is set in Streamlit secrets\n"
                "2. Check DATABRICKS_HOST is correct\n"
                "3. Check DATABRICKS_HTTP_PATH is correct\n"
                "4. Verify the table name is 'tapioca_sales'\n"
                "5. Make sure your SQL warehouse is running")
        raise

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

# UI
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
        help="Use the last N days of sales data to compute recommendations"
    )

    percentile = st.radio(
        "Percentile standard",
        ["Avg", "p75", "p90", "p90 (recommended)", "p95", "Max"],
        index=2,
        help="Choose risk tolerance for stockouts vs waste"
    )
    percentile_key = percentile.split()[0]  # Remove "(recommended)" suffix

    grams_per_portion = st.number_input(
        "Grams per portion",
        min_value=1,
        max_value=200,
        value=50,
        step=1,
        help="Weight of dry tapioca pearls per drink"
    )

    if st.button("🔄 Refresh Data", type="primary", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

# Load data
try:
    with st.spinner("Fetching data from Databricks..."):
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
    st.caption(f"Recommendations based on {percentile_key} percentile, last {rolling_days} days")

    recs_df = processed["recs"][percentile_key].copy()

    # Display by store
    for store in processed["stores"]:
        with st.expander(f"📍 {store}", expanded=True):
            store_recs = recs_df[recs_df["store_name"] == store]

            plan_data = []
            for _, row in store_recs.iterrows():
                slot = row["slot"]
                day_type = row["day_type"]
                portions = row["recommended"]
                grams = int(portions * grams_per_portion)

                plan_data.append({
                    "Slot": slot,
                    "Day Type": day_type,
                    "Portions": portions,
                    "Grams": f"{grams} g"
                })

            plan_display = pd.DataFrame(plan_data)
            st.dataframe(plan_display, use_container_width=True, hide_index=True)

    st.divider()

    # Backtest
    st.header("Backtest — Days the recommendation falls short")
    st.caption(f"How often did {percentile_key} fall short on actual demand?")

    backtest_df = processed["backtests"][percentile_key].copy()

    # Color code severity
    def severity_color(pct):
        if pct >= 30:
            return "🔴"
        elif pct >= 15:
            return "🟡"
        else:
            return "🟢"

    backtest_df["Severity"] = backtest_df["pct_under"].apply(severity_color)
    backtest_df = backtest_df[["store_name", "slot", "day_type", "recommended", "total_days", "days_under", "pct_under", "avg_shortfall", "max_shortfall"]]
    backtest_df.columns = ["Store", "Slot", "Day Type", "Recommended", "Total Days", "Days Short", "% Short", "Avg Shortfall", "Max Shortfall"]

    st.dataframe(backtest_df, use_container_width=True, hide_index=True)

except Exception as e:
    st.error(f"Error: {e}")
    st.info("Make sure DATABRICKS_TOKEN, DATABRICKS_HOST, and DATABRICKS_HTTP_PATH are set.")
