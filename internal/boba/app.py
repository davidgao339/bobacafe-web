"""
Tapioca cooking plan Flask server with Databricks integration and refresh endpoint.
"""
import sys
import os
sys.stdout.reconfigure(encoding="utf-8")

from flask import Flask, jsonify, render_template_string
from flask_cors import CORS
import math
import json
import pandas as pd
from databricks import sql
import logging

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)

# Databricks credentials (from environment variables)
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST")
DATABRICKS_HTTP_PATH = os.getenv("DATABRICKS_HTTP_PATH")

if not all([DATABRICKS_TOKEN, DATABRICKS_HOST, DATABRICKS_HTTP_PATH]):
    raise ValueError(
        "Missing Databricks configuration. Set DATABRICKS_TOKEN, DATABRICKS_HOST, "
        "and DATABRICKS_HTTP_PATH environment variables."
    )

# Configuration
SLOT_ORDER = ["9:30 AM", "2:00 PM", "6:00 PM"]
PERCENTILES = {"avg": None, "p75": 75, "p90": 90, "p95": 95, "max": 100}
ROLLING_DAYS_DEFAULT = 90

def fetch_data_from_databricks():
    """Fetch tapioca sales data from Databricks SQL warehouse."""
    try:
        with sql.connect(
            host=DATABRICKS_HOST,
            http_path=DATABRICKS_HTTP_PATH,
            auth_type="pat",
            token=DATABRICKS_TOKEN,
        ) as connection:
            cursor = connection.cursor()
            cursor.execute("""
                SELECT
                    datetime, date, store_name, qty, transaction_type, is_return
                FROM tapioca_sales
                ORDER BY datetime DESC
                LIMIT 100000
            """)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            df = pd.DataFrame(rows, columns=columns)
            logging.info(f"Fetched {len(df)} rows from Databricks")
            return df
    except Exception as e:
        logging.error(f"Error fetching from Databricks: {e}")
        raise

def process_data(df):
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
    min_date = max_date - pd.Timedelta(days=ROLLING_DAYS_DEFAULT)
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

    # Build data structures
    plan_data = {}
    bt_data = {}

    for store in stores:
        plan_data[store] = {}
        bt_data[store] = {}
        for slot in SLOT_ORDER:
            plan_data[store][slot] = {}
            bt_data[store][slot] = {}
            for day_type in ["Weekday", "Weekend"]:
                plan_data[store][slot][day_type] = {}
                bt_data[store][slot][day_type] = {}
                for key, rec_df in recs.items():
                    r = rec_df.loc[
                        (rec_df.store_name == store)
                        & (rec_df.slot == slot)
                        & (rec_df.day_type == day_type),
                        "recommended",
                    ]
                    rec_val = int(r.iloc[0]) if len(r) else 0
                    plan_data[store][slot][day_type][key] = rec_val

                    bt = backtests[key]
                    row = bt.loc[
                        (bt.store_name == store)
                        & (bt.slot == slot)
                        & (bt.day_type == day_type)
                    ]
                    if row.empty:
                        bt_data[store][slot][day_type][key] = {}
                    else:
                        rw = row.iloc[0]
                        bt_data[store][slot][day_type][key] = {
                            "recommended": rec_val,
                            "total_days": int(rw["total_days"]),
                            "days_under": int(rw["days_under"]),
                            "pct_under": float(rw["pct_under"]),
                            "avg_shortfall": int(rw["avg_shortfall"]),
                            "max_shortfall": int(rw["max_shortfall"]),
                        }

    return {
        "plan_data": plan_data,
        "bt_data": bt_data,
        "stores": stores,
        "rolling_days": ROLLING_DAYS_DEFAULT,
        "last_updated": str(max_date),
    }

@app.route("/api/data", methods=["GET"])
def get_data():
    """Fetch and return tapioca cooking plan data."""
    try:
        df = fetch_data_from_databricks()
        data = process_data(df)
        return jsonify({"status": "success", "data": data})
    except Exception as e:
        logging.error(f"Error in /api/data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/", methods=["GET"])
def index():
    """Serve the tapioca cooking plan HTML."""
    html_template = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tapioca Cooking Plan</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f5f5f5; color: #222; padding: 32px 24px; }
  h1  { font-size: 1.6rem; margin-bottom: 4px; }
  h3  { font-size: 1.05rem; font-weight: 700; margin: 36px 0 14px; color: #333; }
  .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 20px; }

  .lang-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 22px; }
  .lang-bar span { font-size: 0.8rem; color: #999; }
  .lang-seg { display: flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
  .lang-seg button { padding: 4px 12px; border: none; background: #fff; cursor: pointer;
                     font-size: 0.82rem; font-weight: 600; color: #555;
                     border-right: 1px solid #ccc; transition: background .15s; }
  .lang-seg button:last-child { border-right: none; }
  .lang-seg button.active { background: #3b5bdb; color: #fff; }
  .lang-ru { display: none; }

  .toolbar { display: flex; flex-wrap: wrap; gap: 20px; align-items: center;
             background: #fff; border-radius: 10px; padding: 16px 22px;
             box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 28px; }
  .toolbar label { font-weight: 600; white-space: nowrap; font-size: 0.9rem; }
  .toolbar input { width: 80px; padding: 5px 9px; border: 1px solid #ccc;
                   border-radius: 6px; font-size: 0.95rem; }
  .seg { display: flex; border: 1px solid #ccc; border-radius: 7px; overflow: hidden; }
  .seg button { padding: 6px 14px; border: none; background: #fff; cursor: pointer;
                font-size: 0.88rem; font-weight: 600; color: #555;
                border-right: 1px solid #ccc; transition: background .15s; }
  .seg button:last-child { border-right: none; }
  .seg button.active { background: #2d6a4f; color: #fff; }
  .seg button:hover:not(.active) { background: #f0f0f0; }

  .refresh-btn { padding: 8px 16px; background: #3b5bdb; color: #fff; border: none;
                 border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.9rem;
                 transition: background .15s; }
  .refresh-btn:hover { background: #2a3fb5; }
  .refresh-btn:disabled { background: #ccc; cursor: not-allowed; }

  .loading { display: none; color: #666; font-size: 0.85rem; margin-left: 12px; }
  .loading.active { display: inline; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 18px; }
  .store-card { background: #fff; border-radius: 10px; padding: 18px 22px;
                box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .store-card h2 { font-size: 0.95rem; font-weight: 700; margin-bottom: 10px;
                   color: #444; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
  thead tr { background: #f0f0f0; }
  th { padding: 7px 11px; text-align: center; font-weight: 600;
       border-bottom: 2px solid #ddd; line-height: 1.3; }
  th:first-child { text-align: left; }
  td { padding: 7px 11px; border-bottom: 1px solid #eee; }
  td.slot { font-weight: 600; color: #555; white-space: nowrap; }
  td.num { text-align: center; }
  td.grams { color: #c84b31; font-weight: 600; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafafa; }

  .last-updated { color: #999; font-size: 0.8rem; margin-top: 12px; }
</style>
</head>
<body>

<h1>
  <span class="lang-en">Tapioca Cooking Plan</span>
  <span class="lang-ru">План варки тапиоки</span>
</h1>
<p class="subtitle">
  <span class="lang-en" id="subtitle-en">Loading data...</span>
  <span class="lang-ru" id="subtitle-ru">Загрузка данных...</span>
</p>

<div class="lang-bar">
  <span>🌐</span>
  <div class="lang-seg">
    <button id="lang-en" class="active" onclick="setLang('en')">EN</button>
    <button id="lang-ru" onclick="setLang('ru')">RU</button>
  </div>
</div>

<div class="toolbar">
  <div>
    <label>
      <span class="lang-en">Percentile standard:</span>
      <span class="lang-ru">Уровень перцентиля:</span>
    </label><br>
    <div class="seg" style="margin-top:6px">
      <button onclick="setMode('avg')" id="btn-avg">Avg</button>
      <button onclick="setMode('p75')" id="btn-p75">p75</button>
      <button onclick="setMode('p90')" id="btn-p90" class="active">p90</button>
      <button onclick="setMode('p95')" id="btn-p95">p95</button>
      <button onclick="setMode('max')" id="btn-max">Max</button>
    </div>
  </div>
  <div>
    <label for="gpWeight">
      <span class="lang-en">Grams per portion:</span>
      <span class="lang-ru">Граммов на порцию:</span>
    </label><br>
    <input type="number" id="gpWeight" value="50" min="1" step="1" style="margin-top:6px">
  </div>
  <div>
    <button class="refresh-btn" onclick="refreshData()" id="refresh-btn">
      <span class="lang-en">🔄 Refresh</span>
      <span class="lang-ru">🔄 Обновить</span>
    </button>
    <span class="loading" id="loading">
      <span class="lang-en">Fetching data...</span>
      <span class="lang-ru">Получение данных...</span>
    </span>
  </div>
  <div id="last-updated" class="last-updated"></div>
</div>

<h3>
  <span class="lang-en">Cooking Plan</span>
  <span class="lang-ru">План варки</span>
</h3>
<div class="grid" id="plan-grid">
  <p><span class="lang-en">Loading...</span><span class="lang-ru">Загрузка...</span></p>
</div>

<script>
let currentData = null;
let currentMode = 'p90';
let gramsPerPortion = 50;
let currentLang = 'en';

async function loadData() {
  try {
    const response = await fetch('/api/data');
    const result = await response.json();
    if (result.status === 'success') {
      currentData = result.data;
      render();
      document.getElementById('last-updated').textContent =
        (currentLang === 'en' ? 'Last updated: ' : 'Обновлено: ') + currentData.last_updated;
    }
  } catch (e) {
    console.error('Error loading data:', e);
    document.getElementById('plan-grid').innerHTML = '<p>Error loading data. Please try again.</p>';
  }
}

async function refreshData() {
  const btn = document.getElementById('refresh-btn');
  const loading = document.getElementById('loading');
  btn.disabled = true;
  loading.classList.add('active');

  await loadData();

  btn.disabled = false;
  loading.classList.remove('active');
}

function setLang(lang) {
  currentLang = lang;
  document.querySelectorAll('.lang-en, .lang-ru').forEach(el => {
    const show = el.classList.contains('lang-' + lang);
    el.style.display = show ? (el.tagName === 'SPAN' ? 'inline' : 'block') : 'none';
  });
  document.getElementById('lang-en').classList.toggle('active', lang === 'en');
  document.getElementById('lang-ru').classList.toggle('active', lang === 'ru');
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.seg button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + mode).classList.add('active');
  render();
}

function render() {
  if (!currentData) return;

  const plan = currentData.plan_data;
  const stores = currentData.stores;
  const g = gramsPerPortion;
  const m = currentMode;

  let html = '';
  for (const store of stores) {
    let rows = '';
    for (const slot of ['9:30 AM', '2:00 PM', '6:00 PM']) {
      rows += `<tr>
        <td class="slot">${slot}</td>
        <td class="num">${plan[store]?.[slot]?.['Weekday']?.[m] || 0}</td>
        <td class="num grams">${((plan[store]?.[slot]?.['Weekday']?.[m] || 0) * g).toFixed(0)} g</td>
        <td class="num">${plan[store]?.[slot]?.['Weekend']?.[m] || 0}</td>
        <td class="num grams">${((plan[store]?.[slot]?.['Weekend']?.[m] || 0) * g).toFixed(0)} g</td>
      </tr>`;
    }
    html += `<div class="store-card">
      <h2>${store}</h2>
      <table>
        <thead><tr>
          <th style="text-align: left;">Slot</th>
          <th>Weekday</th>
          <th>Grams</th>
          <th>Weekend</th>
          <th>Grams</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  document.getElementById('plan-grid').innerHTML = html;
}

document.getElementById('gpWeight').addEventListener('input', e => {
  gramsPerPortion = parseFloat(e.target.value) || 0;
  render();
});

// Load data on page load
loadData();
setLang('en');
</script>
</body>
</html>"""
    return render_template_string(html_template)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
