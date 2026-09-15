import streamlit as st
import pandas as pd
import datetime
import calendar
from data_access import get_envelope_cash, get_sbis_revenue
import plotly.express as px

st.set_page_config(page_title="Cash Reconciliation Dashboard", layout="wide", initial_sidebar_state="expanded")

# --- Custom CSS for Premium Aesthetics ---
st.markdown("""
<style>
    /* Dark sleek background and fonts */
    .stApp {
        background-color: #0E1117;
        font-family: 'Inter', 'Segoe UI', sans-serif;
    }
    
    /* Premium Headers */
    h1, h2, h3 {
        font-weight: 600 !important;
        letter-spacing: -0.5px;
    }
    
    /* Metrics Styling */
    div[data-testid="metric-container"] {
        background-color: #1A1C23;
        border: 1px solid #2B2E35;
        border-radius: 10px;
        padding: 20px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s ease;
    }
    div[data-testid="metric-container"]:hover {
        transform: translateY(-2px);
        border-color: #3B3E45;
    }
    
    /* Improve Sidebar styling */
    section[data-testid="stSidebar"] {
        background-color: #12141A;
        border-right: 1px solid #2B2E35;
    }
    
    /* Data table header */
    .stDataFrame {
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #2B2E35;
    }
</style>
""", unsafe_allow_html=True)

st.title("💸 Cash Reconciliation")
st.markdown("<p style='color: #8B8D97; font-size: 1.1rem; margin-top: -10px;'>Compare system cash sales (SBIS) with physical cash collected (Envelopes).</p>", unsafe_allow_html=True)

# --- Sidebar: Date Picker & Form ---
st.sidebar.header("🗓️ Reconcile Period")
mode = st.sidebar.radio("Select Mode", ["Monthly", "Custom Range"], horizontal=True)

# Generate a list of months (e.g., "September 2026", "August 2026")
today = datetime.date.today()
months_options = []
for i in range(12):
    m = today.month - i
    y = today.year
    if m <= 0:
        m += 12
        y -= 1
    months_options.append(f"{calendar.month_name[m]} {y}")

with st.sidebar.form("reconcile_form"):
    if mode == "Monthly":
        selected_month_str = st.selectbox("Select Month", months_options, help="Choose the month to reconcile.")
        month_name, year_str = selected_month_str.split(" ")
        month_num = list(calendar.month_name).index(month_name)
        year_num = int(year_str)

        _, last_day = calendar.monthrange(year_num, month_num)
        d_start = datetime.date(year_num, month_num, 1)
        d_end = datetime.date(year_num, month_num, last_day)
    else:
        end_date = datetime.date.today()
        start_date = end_date - datetime.timedelta(days=30)
        date_range = st.date_input("Date Range", [start_date, end_date])
        if len(date_range) == 2:
            d_start, d_end = date_range
        else:
            d_start, d_end = None, None

    submitted = st.form_submit_button("Reconcile", type="primary", use_container_width=True)

if mode == "Custom Range" and (d_start is None or d_end is None):
    if not submitted and "reconciled" not in st.session_state:
        st.info("👈 Please select a valid date range and click **'Reconcile'** in the sidebar to load the dashboard.")
    else:
        st.warning("Please select both a start and end date.")
    st.stop()

if not submitted and "reconciled" not in st.session_state:
    st.info("👈 Please select a month and click **'Reconcile'** in the sidebar to load the dashboard.")
    st.stop()

if submitted:
    st.session_state["reconciled"] = True
    if "selected_store" in st.session_state:
        del st.session_state["selected_store"]

# --- Fetch Data ---
try:
    with st.spinner("Fetching data from Databricks & Google Sheets..."):
        envelope_df = get_envelope_cash()
        sbis_df = get_sbis_revenue(d_start.strftime("%Y-%m-%d"), d_end.strftime("%Y-%m-%d"))
except Exception as e:
    import traceback
    traceback.print_exc()
    st.error(f"Error fetching data: {str(e)}")
    st.stop()

if envelope_df.empty or sbis_df.empty:
    if mode == "Monthly":
        st.warning(f"No data found for {selected_month_str}.")
    else:
        st.warning(f"No data found for the selected date range ({d_start} to {d_end}).")
    st.stop()

# --- Normalization & Merging ---
date_col_env = "За какое число конверт" if "За какое число конверт" in envelope_df.columns else envelope_df.columns[2]
store_col_env = "Какое Кафе" if "Какое Кафе" in envelope_df.columns else envelope_df.columns[1]
cash_col_env = "Сумма в конверте (без руб)" if "Сумма в конверте (без руб)" in envelope_df.columns else envelope_df.columns[3]
purchases_col_env = "Общая сумма покупок (без руб). Если нет то 0" if "Общая сумма покупок (без руб). Если нет то 0" in envelope_df.columns else envelope_df.columns[4]

def parse_gsheet_date(x):
    try:
        f = float(x)
        if f > 10000:
            return pd.to_datetime(f, unit='D', origin='1899-12-30').date()
    except (ValueError, TypeError):
        pass
    try:
        return pd.to_datetime(x).date()
    except:
        return pd.NaT

envelope_df[date_col_env] = envelope_df[date_col_env].apply(parse_gsheet_date)
envelope_df = envelope_df.dropna(subset=[date_col_env])
envelope_df[cash_col_env] = pd.to_numeric(envelope_df[cash_col_env], errors='coerce').fillna(0)
envelope_df[purchases_col_env] = pd.to_numeric(envelope_df[purchases_col_env], errors='coerce').fillna(0)

# Total envelope cash is cash + purchases
envelope_df['Total_Envelope_Cash'] = envelope_df[cash_col_env] + envelope_df[purchases_col_env]
envelope_df = envelope_df.groupby([date_col_env, store_col_env], as_index=False)['Total_Envelope_Cash'].sum()

# SBIS df parsing
sbis_df['date'] = pd.to_datetime(sbis_df['date'], errors='coerce').dt.date
sbis_df['revenue'] = pd.to_numeric(sbis_df['revenue'], errors='coerce').fillna(0)

# Normalize store names for merge
envelope_df['Store_Norm'] = envelope_df[store_col_env].astype(str).str.strip().str.lower()
sbis_df['Store_Norm'] = sbis_df['store'].astype(str).str.strip().str.lower()

merged_df = pd.merge(
    sbis_df, 
    envelope_df, 
    left_on=['date', 'Store_Norm'], 
    right_on=[date_col_env, 'Store_Norm'], 
    how='outer'
)

# Fill NaNs
merged_df['revenue'] = merged_df['revenue'].fillna(0)
merged_df['Total_Envelope_Cash'] = merged_df['Total_Envelope_Cash'].fillna(0)
merged_df['Difference'] = merged_df['Total_Envelope_Cash'] - merged_df['revenue']

display_df = merged_df[['date', 'store', 'revenue', 'Total_Envelope_Cash', 'Difference']].copy()
display_df.rename(columns={
    'date': 'Date',
    'store': 'Store',
    'revenue': 'SBIS Cash',
    'Total_Envelope_Cash': 'Envelope Cash'
}, inplace=True)
display_df['Store'] = display_df['Store'].fillna(merged_df[store_col_env])
display_df.dropna(subset=['Date'], inplace=True)

# Store filter in sidebar
store_list = sorted(display_df['Store'].dropna().unique().tolist())
st.sidebar.markdown("---")
selected_store = st.sidebar.selectbox("🏪 Filter by Store", ["All"] + store_list, key="selected_store")

if selected_store != "All":
    display_df = display_df[display_df['Store'] == selected_store]

# --- KPI Metrics Row ---
total_sbis = display_df['SBIS Cash'].sum()
total_env = display_df['Envelope Cash'].sum()
total_diff = display_df['Difference'].sum()

st.markdown("<br>", unsafe_allow_html=True)
col1, col2, col3 = st.columns(3)
with col1:
    st.metric("Total SBIS Cash", f"${total_sbis:,.2f}")
with col2:
    st.metric("Total Envelope Cash", f"${total_env:,.2f}")
with col3:
    # Color the difference metric based on value
    diff_color = "normal"
    if total_diff < 0:
        diff_color = "inverse"
    st.metric("Net Discrepancy", f"${total_diff:,.2f}", delta=f"${total_diff:,.2f}", delta_color=diff_color)

st.markdown("<br><hr style='border-color: #2B2E35;'><br>", unsafe_allow_html=True)

# --- Charts & Tables ---
st.subheader("📈 Cash Trends over Time")
chart_df = display_df.groupby('Date')[['SBIS Cash', 'Envelope Cash']].sum().reset_index()

fig = px.line(chart_df, x='Date', y=['SBIS Cash', 'Envelope Cash'], 
              labels={'value': 'Cash Amount', 'variable': 'Source', 'Date': ''},
              color_discrete_sequence=['#4F8BF9', '#1DFB3A'])

fig.update_traces(mode='lines+markers', line_shape='spline', hovertemplate='$%{y:,.2f}<extra></extra>')
fig.update_layout(
    plot_bgcolor='rgba(0,0,0,0)',
    paper_bgcolor='rgba(0,0,0,0)',
    font=dict(color='#8B8D97'),
    legend=dict(title='', orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1),
    margin=dict(l=0, r=0, t=30, b=0),
    xaxis=dict(showgrid=False, zeroline=False),
    yaxis=dict(showgrid=True, gridcolor='#2B2E35', zeroline=False, tickprefix='$')
)
st.plotly_chart(fig, use_container_width=True)

st.markdown("<br>", unsafe_allow_html=True)

st.subheader("📋 Reconciliation Details")
def color_diff(val):
    if val < 0:
        color = 'rgba(214, 69, 80, 0.4)' # Soft Red
    elif val > 0:
        color = 'rgba(29, 251, 58, 0.2)' # Soft Green
    else:
        color = 'transparent'
    return f'background-color: {color}'

display_df = display_df.sort_values(by=['Date', 'Store'], ascending=[False, True])

styled_df = display_df.style.applymap(color_diff, subset=['Difference']).format({
    'SBIS Cash': "${:,.2f}",
    'Envelope Cash': "${:,.2f}",
    'Difference': "${:,.2f}"
})

st.dataframe(styled_df, use_container_width=True, hide_index=True, height=400)
