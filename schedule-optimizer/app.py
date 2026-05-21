import asyncio
import sys
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import pandas as pd
import streamlit as st
from datetime import date

from config import (
    ALLOWED_EMAILS, COL_MONTH, COL_NAME, COL_STORES,
    DEFAULT_STORE_WEIGHTS, MONTHS_RU, SHIFT_LABEL,
)
from data_access import read_responses, write_schedule
from optimizer import get_stores_from_df, run_optimization, build_wide_table

st.set_page_config(page_title="Schedule Optimizer — Боба Кролик", layout="wide")

# ── Auth gate ─────────────────────────────────────────────────────────────────

if not getattr(st.user, 'is_logged_in', False):
    st.title("Schedule Optimizer — Боба Кролик")
    st.markdown("Оптимизация расписания сотрудников с помощью CP-SAT.")
    st.button("Sign in with Google", on_click=st.login, args=("google",), type="primary")
    st.stop()

if st.user.email not in ALLOWED_EMAILS:
    st.error("Доступ запрещён. Ваш аккаунт не авторизован.")
    st.button("Sign out", on_click=st.logout)
    st.stop()

# ── Sidebar ───────────────────────────────────────────────────────────────────

with st.sidebar:
    st.title("Боба Кролик")
    st.caption(st.user.email)
    st.button("Sign out", on_click=st.logout, use_container_width=True)
    st.divider()

    month_filter = st.selectbox(
        "Месяц",
        options=list(range(1, 13)),
        format_func=lambda m: f"{MONTHS_RU[m - 1]} ({m})",
        index=date.today().month - 1,
    )

    st.divider()

    with st.expander("Настройки солвера", expanded=False):
        max_shifts = st.number_input(
            "Макс. смен на сотрудника", min_value=1, max_value=62, value=32, step=1
        )
        time_limit = st.number_input(
            "Время решения (сек)", min_value=5, max_value=300, value=30, step=5
        )

    output_sheet = st.text_input(
        "Лист для записи в Sheets",
        value=f"Schedule_{MONTHS_RU[month_filter - 1]}",
    )

    st.divider()
    if st.button("Загрузить данные", use_container_width=True, type="primary"):
        with st.spinner("Загружаем из Google Sheets..."):
            try:
                records = read_responses()
                st.session_state.raw_df = pd.DataFrame(records)
                st.session_state.schedule_result = None
                st.toast("Данные загружены!", icon="✅")
            except Exception as e:
                st.error(f"Ошибка загрузки: {e}")

# ── Main ──────────────────────────────────────────────────────────────────────

st.title("Оптимизация расписания")

if "raw_df" not in st.session_state:
    st.info("Нажмите «Загрузить данные» в боковой панели для начала работы.")
    st.stop()

raw_df: pd.DataFrame = st.session_state.raw_df

if COL_MONTH not in raw_df.columns:
    st.error(f"Столбец «{COL_MONTH}» не найден. Проверьте структуру таблицы.")
    st.stop()

month_df = raw_df[raw_df[COL_MONTH] == month_filter]
detected_stores = get_stores_from_df(month_df)

col1, col2, col3 = st.columns(3)
col1.metric("Ответов за месяц", len(month_df))
col2.metric("Сотрудников", month_df[COL_NAME].nunique() if COL_NAME in month_df.columns else 0)
col3.metric("Кафе", len(detected_stores))

if not detected_stores:
    st.warning(f"Нет данных за {MONTHS_RU[month_filter - 1]}. Выберите другой месяц или перезагрузите данные.")
    st.stop()

# ── Store configuration table ─────────────────────────────────────────────────

st.subheader("Настройки кафе")
st.caption("Измените вес приоритета и количество сотрудников на смену для каждого кафе.")

init_rows = [
    {
        "Кафе": s,
        "Вес": DEFAULT_STORE_WEIGHTS.get(s, 1.0),
        "Утро (чел.)": 1,
        "Вечер (чел.)": 1,
    }
    for s in detected_stores
]
store_config_df = pd.DataFrame(init_rows)

edited = st.data_editor(
    store_config_df,
    column_config={
        "Кафе": st.column_config.TextColumn(disabled=True, width="large"),
        "Вес": st.column_config.NumberColumn(
            help="Приоритет кафе в оптимизации (выше = важнее заполнить)",
            min_value=0.0, max_value=5.0, step=0.5, format="%.1f",
        ),
        "Утро (чел.)": st.column_config.NumberColumn(
            help="Сколько сотрудников нужно на утреннюю смену",
            min_value=0, max_value=10, step=1,
        ),
        "Вечер (чел.)": st.column_config.NumberColumn(
            help="Сколько сотрудников нужно на вечернюю смену",
            min_value=0, max_value=10, step=1,
        ),
    },
    hide_index=True,
    use_container_width=True,
    key="store_editor",
)

store_weights = dict(zip(edited["Кафе"], edited["Вес"].astype(float)))
store_need = {
    row["Кафе"]: {"Утро": int(row["Утро (чел.)"]), "Вечер": int(row["Вечер (чел.)"])}
    for _, row in edited.iterrows()
}

# ── Run optimization ──────────────────────────────────────────────────────────

st.divider()

if st.button("Запустить оптимизацию", type="primary", use_container_width=True):
    with st.spinner(f"Решаем задачу (до {time_limit} сек)..."):
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
            st.error(f"Ошибка оптимизации: {e}")

# ── Results ───────────────────────────────────────────────────────────────────

if not st.session_state.get("schedule_result"):
    st.stop()

schedule_df, coverage_df, status_str, stats = st.session_state.schedule_result

status_color = {"OPTIMAL": "green", "FEASIBLE": "orange"}.get(status_str, "red")
st.markdown(f"### Статус: :{status_color}[{status_str}]")

c1, c2, c3 = st.columns(3)
c1.metric("Требуется смен", stats["total_required"])
c2.metric("Заполнено", stats["total_filled"])
c3.metric("Не заполнено", stats["missing"],
          delta=f"-{stats['missing']}" if stats["missing"] else None,
          delta_color="inverse")

# Coverage heatmap
st.subheader("Покрытие по дням и кафе")
year, month_num = stats["year"], stats["month"]
DAYS, STORES, NEED = stats["days"], stats["stores"], stats["need"]

# Build (date, store) → "covered/required" string
cov_index = {}
if coverage_df is not None and not coverage_df.empty:
    for _, row in coverage_df.iterrows():
        key = (int(row["День"]), row["Кафе"])
        prev_c, prev_n = cov_index.get(key, (0, 0))
        cov_index[key] = (prev_c + int(row["Покрыто"]), prev_n + int(row["Нужно"]))

grid_rows = []
for d in DAYS:
    row_data = {"Дата": date(year, month_num, d)}
    for s in STORES:
        covered, needed = cov_index.get((d, s), (0, 0))
        row_data[s] = f"{covered}/{needed}"
    grid_rows.append(row_data)

grid_df = pd.DataFrame(grid_rows).set_index("Дата")


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
st.subheader("Распределение смен по сотрудникам")
avg = stats["avg_shifts"]
emp_rows = [
    {"Сотрудник": e, "Смен назначено": v, "Отклонение от среднего": round(v - avg, 1)}
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
    emp_df.style.map(_color_deviation, subset=["Отклонение от среднего"]),
    hide_index=True,
    use_container_width=True,
)

# ── Save to Sheets ────────────────────────────────────────────────────────────

st.divider()
col_save, col_dl = st.columns([2, 1])

with col_save:
    if st.button(f"Сохранить в Google Sheets → «{output_sheet}»",
                 use_container_width=True, type="secondary"):
        with st.spinner("Записываем..."):
            try:
                wide = build_wide_table(schedule_df, year, month_num, DAYS)
                header_row = ["Дата"] + [f"{c[0]} - {c[1]}" for c in wide.columns]
                data_out = wide.reset_index()
                data_out["Дата"] = pd.to_datetime(data_out["Дата"]).dt.strftime("%Y-%m-%d")
                data_rows = data_out.fillna("—").values.tolist()
                write_schedule(output_sheet, header_row, data_rows)
                st.success(f"Записано в лист «{output_sheet}»!")
            except Exception as e:
                st.error(f"Ошибка записи: {e}")

with col_dl:
    csv_bytes = schedule_df.to_csv(index=False).encode("utf-8-sig")
    st.download_button(
        "Скачать CSV",
        data=csv_bytes,
        file_name=f"schedule_{year}_{month_num:02d}.csv",
        mime="text/csv",
        use_container_width=True,
    )
