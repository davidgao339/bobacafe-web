import asyncio
import sys
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pandas as pd
import streamlit as st
from datetime import date

from config import (
    ALLOWED_EMAILS, COL_MONTH, COL_NAME,
    DEFAULT_STORE_WEIGHTS, SCHEDULE_SHEET_GID, STRINGS,
)
from data_access import read_responses, write_schedule
from optimizer import get_stores_from_df, run_optimization, build_wide_table

st.set_page_config(page_title="Schedule Optimizer — Боба Кролик", layout="wide")

# ── Language ──────────────────────────────────────────────────────────────────
if "lang" not in st.session_state:
    st.session_state.lang = "ru"
T = STRINGS[st.session_state.lang]

# ── Auth gate ─────────────────────────────────────────────────────────────────
if not getattr(st.user, 'is_logged_in', False):
    st.title(T["app_title"])
    st.markdown(T["sign_in_desc"])
    st.button(T["sign_in_btn"], on_click=st.login, args=("google",), type="primary")
    st.stop()

if st.user.email not in ALLOWED_EMAILS:
    st.error(T["access_denied"])
    st.button(T["sign_out"], on_click=st.logout)
    st.stop()

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("Боба Кролик")
    st.caption(st.user.email)

    lang_choice = st.radio(
        "Language", ["RU", "EN"], horizontal=True,
        index=0 if st.session_state.lang == "ru" else 1,
        key="lang_toggle",
        label_visibility="collapsed",
    )
    new_lang = "ru" if lang_choice == "RU" else "en"
    if new_lang != st.session_state.lang:
        st.session_state.lang = new_lang
        st.rerun()

    st.button(T["sign_out"], on_click=st.logout, use_container_width=True)
    st.divider()

    month_filter = st.selectbox(
        T["month_label"],
        options=list(range(1, 13)),
        format_func=lambda m: f"{T['months'][m - 1]} ({m})",
        index=date.today().month - 1,
    )

    st.divider()

    with st.expander(T["solver_expander"], expanded=False):
        max_shifts = st.number_input(
            T["max_shifts_label"], min_value=1, max_value=62, value=32, step=1
        )
        time_limit = st.number_input(
            T["time_limit_label"], min_value=5, max_value=300, value=30, step=5
        )

    st.divider()
    if st.button(T["load_btn"], use_container_width=True, type="primary"):
        with st.spinner(T["loading_msg"]):
            try:
                records = read_responses()
                st.session_state.raw_df = pd.DataFrame(records)
                st.session_state.schedule_result = None
                st.toast(T["loaded_toast"], icon="✅")
            except Exception as e:
                st.error(T["load_error"].format(err=f"{type(e).__name__}: {e}"))

# ── Main ──────────────────────────────────────────────────────────────────────
st.title(T["page_title"])

with st.expander(T["guide_expander"], expanded="raw_df" not in st.session_state):
    st.markdown(T["guide_body"])

if "raw_df" not in st.session_state:
    st.info(T["no_data_info"])
    st.stop()

raw_df: pd.DataFrame = st.session_state.raw_df

if COL_MONTH not in raw_df.columns:
    st.error(T["col_missing_error"].format(col=COL_MONTH))
    st.stop()

month_df = raw_df[raw_df[COL_MONTH] == month_filter]
detected_stores = get_stores_from_df(month_df)

col1, col2, col3 = st.columns(3)
col1.metric(T["metric_responses"], len(month_df))
col2.metric(T["metric_employees"], month_df[COL_NAME].nunique() if COL_NAME in month_df.columns else 0)
col3.metric(T["metric_cafes"], len(detected_stores))

if not detected_stores:
    st.warning(T["no_month_warning"].format(month=T["months"][month_filter - 1]))
    st.stop()

# ── Store configuration table ─────────────────────────────────────────────────
st.subheader(T["store_settings_header"])
st.caption(T["store_settings_caption"])

init_rows = [
    {"_store": s, "_weight": DEFAULT_STORE_WEIGHTS.get(s, 1.0), "_morning": 1, "_evening": 1}
    for s in detected_stores
]
store_config_df = pd.DataFrame(init_rows)

edited = st.data_editor(
    store_config_df,
    column_config={
        "_store": st.column_config.TextColumn(T["col_store"], disabled=True, width="large"),
        "_weight": st.column_config.NumberColumn(
            T["col_weight"],
            help=T["weight_help"],
            min_value=0.0, max_value=5.0, step=0.5, format="%.1f",
        ),
        "_morning": st.column_config.NumberColumn(
            T["col_morning"],
            help=T["morning_help"],
            min_value=0, max_value=10, step=1,
        ),
        "_evening": st.column_config.NumberColumn(
            T["col_evening"],
            help=T["evening_help"],
            min_value=0, max_value=10, step=1,
        ),
    },
    hide_index=True,
    use_container_width=True,
    key="store_editor",
)

store_weights = dict(zip(edited["_store"], edited["_weight"].astype(float)))
store_need = {
    row["_store"]: {"Утро": int(row["_morning"]), "Вечер": int(row["_evening"])}
    for _, row in edited.iterrows()
}

# ── Run optimization ──────────────────────────────────────────────────────────
st.divider()

if not st.session_state.get("awaiting_confirm"):
    if st.button(T["run_btn"], type="primary", use_container_width=True):
        st.session_state.awaiting_confirm = True
        st.rerun()
else:
    with st.container(border=True):
        st.subheader(T["confirm_title"])
        st.caption(T["confirm_intro"])

        st.markdown(T["confirm_weight_explain"])
        st.markdown(T["confirm_morning_explain"])
        st.markdown(T["confirm_evening_explain"])

        st.dataframe(
            edited.rename(columns={
                "_store": T["col_store"],
                "_weight": T["col_weight"],
                "_morning": T["col_morning"],
                "_evening": T["col_evening"],
            }),
            hide_index=True,
            use_container_width=True,
        )

        col_ok, col_cancel = st.columns([2, 1])
        if col_ok.button(T["confirm_run"], type="primary", use_container_width=True):
            st.session_state.awaiting_confirm = False
            with st.spinner(T["solving_spinner"].format(sec=time_limit)):
                try:
                    result = run_optimization(
                        raw_df,
                        month_filter=month_filter,
                        store_weights=store_weights,
                        store_need=store_need,
                        default_need={"Утро": 1, "Вечер": 1},
                        max_shifts=int(max_shifts),
                        time_limit=int(time_limit),
                    )
                    st.session_state.schedule_result = result
                except Exception as e:
                    st.error(T["opt_error"].format(err=e))
        if col_cancel.button(T["confirm_cancel"], use_container_width=True):
            st.session_state.awaiting_confirm = False
            st.rerun()

# ── Results ───────────────────────────────────────────────────────────────────
if not st.session_state.get("schedule_result"):
    st.stop()

schedule_df, coverage_df, status_str, stats = st.session_state.schedule_result

status_color = {"OPTIMAL": "green", "FEASIBLE": "orange"}.get(status_str, "red")
st.markdown(f"### {T['status_label']}: :{status_color}[{status_str}]")

c1, c2, c3 = st.columns(3)
c1.metric(T["metric_required"], stats["total_required"])
c2.metric(T["metric_filled"], stats["total_filled"])
c3.metric(T["metric_missing"], stats["missing"],
          delta=f"-{stats['missing']}" if stats["missing"] else None,
          delta_color="inverse")

# Coverage heatmap
st.subheader(T["coverage_header"])
year, month_num = stats["year"], stats["month"]
DAYS, STORES, NEED = stats["days"], stats["stores"], stats["need"]

cov_index = {}
if coverage_df is not None and not coverage_df.empty:
    for _, row in coverage_df.iterrows():
        key = (int(row["День"]), row["Кафе"])
        prev_c, prev_n = cov_index.get(key, (0, 0))
        cov_index[key] = (prev_c + int(row["Покрыто"]), prev_n + int(row["Нужно"]))

grid_rows = []
for d in DAYS:
    row_data = {T["date_col"]: date(year, month_num, d)}
    for s in STORES:
        covered, needed = cov_index.get((d, s), (0, 0))
        row_data[s] = f"{covered}/{needed}"
    grid_rows.append(row_data)

grid_df = pd.DataFrame(grid_rows).set_index(T["date_col"])


def _color_cell(val: str) -> str:
    try:
        c, n = map(int, val.split("/"))
        if n == 0:
            return ""
        ratio = c / n
        if ratio >= 1.0:
            return "background-color: #c6efce; color: #276221"
        if ratio >= 0.5:
            return "background-color: #ffeb9c; color: #7d6608"
        return "background-color: #ffc7ce; color: #9c0006"
    except Exception:
        return ""


st.dataframe(
    grid_df.style.map(_color_cell),
    use_container_width=True,
    height=min(40 + len(DAYS) * 35, 600),
)

# Employee distribution
st.subheader(T["emp_dist_header"])
avg = stats["avg_shifts"]
dev_col = T["deviation_col"]
emp_rows = [
    {T["emp_col"]: e, T["shifts_col"]: v, dev_col: round(v - avg, 1)}
    for e, v in sorted(stats["emp_dist"].items())
]
emp_df = pd.DataFrame(emp_rows)


def _color_deviation(val):
    if val > 3:
        return "color: #9c0006"
    if val < -3:
        return "color: #276221"
    return ""


st.dataframe(
    emp_df.style.map(_color_deviation, subset=[dev_col]),
    hide_index=True,
    use_container_width=True,
)

# ── Save to Sheets ────────────────────────────────────────────────────────────
st.divider()
col_save, col_dl = st.columns([2, 1])

with col_save:
    if st.button(T["save_btn"], use_container_width=True, type="secondary"):
        with st.spinner(T["saving_spinner"]):
            try:
                wide = build_wide_table(schedule_df, year, month_num, DAYS)
                header_row = ["Дата"] + [f"{c[0]} - {c[1]}" for c in wide.columns]
                data_out = wide.reset_index()
                data_out["Дата"] = pd.to_datetime(data_out["Дата"]).dt.strftime("%Y-%m-%d")
                data_rows = data_out.fillna("—").values.tolist()
                write_schedule(SCHEDULE_SHEET_GID, header_row, data_rows)
                st.success(T["save_success"])
            except Exception as e:
                st.error(T["save_error"].format(err=f"{type(e).__name__}: {e}"))

with col_dl:
    wide_csv = build_wide_table(schedule_df, year, month_num, DAYS)
    wide_csv.columns = [f"{c[0]} - {c[1]}" for c in wide_csv.columns]
    wide_csv = wide_csv.reset_index()
    wide_csv["Дата"] = pd.to_datetime(wide_csv["Дата"]).dt.strftime("%Y-%m-%d")
    wide_csv = wide_csv.fillna("—")
    csv_bytes = wide_csv.to_csv(index=False).encode("utf-8-sig")
    st.download_button(
        T["download_btn"],
        data=csv_bytes,
        file_name=f"schedule_{year}_{month_num:02d}.csv",
        mime="text/csv",
        use_container_width=True,
    )
