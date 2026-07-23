import io
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(page_title="Boba Café · Bank Statement", layout="wide")

# ── Translations ──────────────────────────────────────────────────────────────
STRINGS = {
    "en": {
        # Streamlit UI
        "app_title":    "Boba Café — Bank Statement Analyser",
        "caption":      "Select a bank, upload the statement file, then click Run.",
        "step1":        "1  Select bank",
        "step2":        "2  Upload statement",
        "upload_label": "Drop the statement file here (Excel or CSV)",
        "step3":        "3  Run",
        "run_btn":      "▶  Generate report",
        "selected":     "Selected: **{bank}**",
        "step4":        "4  Report",
        "download":     "⬇  Download HTML",
        "processing":   "Processing…",
        "error":        "Error processing file: {e}",
        "lang_btn":     "🇷🇺 Русский",
        # HTML report chrome
        "monthly_summary":  "Monthly Summary",
        "report_subtitle":  "Source: {bank} statement · Currency: RUB · Click a row to expand by receiver",
        "money_in":    "Money in",
        "money_out":   "Money out",
        "col_type":    "Type",
        "col_total":   "Total",
        "footer_total": "Net Total",
        # Transaction type labels
        "pos card":       "POS Card Sales",
        "pos commission": "POS Commission",
        "yandex food":    "Yandex.Food",
        "salary":         "Salary",
        "purchase":       "Purchase",
        "return":         "Return",
        "rent":           "Rent",
        "tax":            "Tax",
        "other payments": "Other Payments",
        "bank fee":       "Bank Fee",
        "ozon orders":    "Ozon Orders",
        # Notes
        "note_sber": (
            '<strong>POS Card Sales</strong>: "Зачисление средств по операциям эквайринга" — positive (income, net after fee).<br>'
            '<strong>POS Commission</strong>: fee extracted from description ("Комиссия …") — negative (cash out).<br>'
            '<strong>Yandex.Food</strong>: sender INN 9705114405 (ООО Яндекс.Еда) — positive (income).<br>'
            '<strong>Salary</strong>: "Заработная плата по реестру" — negative (cash out).<br>'
            '<strong>Purchase</strong>: card purchases (PURCHASE_CB) — negative (cash out).<br>'
            '<strong>Return</strong>: purchase returns/cancellations — positive (income).<br>'
            '<strong>Rent</strong>: description contains "аренд" — negative (cash out).<br>'
            '<strong>Tax</strong>: "Единый налоговый платеж" or "ЕНП" — negative (cash out).<br>'
            '<strong>Other Payments</strong>: description contains "Оплат" (rent takes priority if both match) — negative (cash out).'
        ),
        "note_ozon": (
            '<strong>Ozon Orders</strong>: "Оплата по заказу" — negative (cash out).<br>'
            '<strong>Purchase</strong>: business card transactions ("бизнес карте") — negative (cash out).<br>'
            '<strong>Return</strong>: "Возврат" — positive (income).<br>'
            '<strong>Rent</strong>: description contains "аренд" — negative (cash out).<br>'
            '<strong>Bank Fee</strong>: "Комиссия за исполнение" — negative (cash out).<br>'
            '<strong>Other Payments</strong>: description contains "Оплат" (rent takes priority) — negative (cash out).'
        ),
    },
    "ru": {
        # Streamlit UI
        "app_title":    "Boba Café — Анализатор банковской выписки",
        "caption":      "Выберите банк, загрузите файл выписки, затем нажмите «Запуск».",
        "step1":        "1  Выберите банк",
        "step2":        "2  Загрузите выписку",
        "upload_label": "Перетащите файл выписки сюда (Excel или CSV)",
        "step3":        "3  Запуск",
        "run_btn":      "▶  Сформировать отчёт",
        "selected":     "Выбран: **{bank}**",
        "step4":        "4  Отчёт",
        "download":     "⬇  Скачать HTML",
        "processing":   "Обработка…",
        "error":        "Ошибка обработки файла: {e}",
        "lang_btn":     "🇬🇧 English",
        # HTML report chrome
        "monthly_summary":  "Ежемесячный отчёт",
        "report_subtitle":  "Источник: выписка {bank} · Валюта: RUB · Нажмите строку для раскрытия деталей",
        "money_in":    "Приход",
        "money_out":   "Расход",
        "col_type":    "Тип",
        "col_total":   "Итого",
        "footer_total": "Итого нетто",
        # Transaction type labels
        "pos card":       "Продажи через терминал",
        "pos commission": "Комиссия за терминал",
        "yandex food":    "Яндекс.Еда",
        "salary":         "Зарплата",
        "purchase":       "Покупки",
        "return":         "Возвраты",
        "rent":           "Аренда",
        "tax":            "Налоги",
        "other payments": "Прочие платежи",
        "bank fee":       "Комиссия банка",
        "ozon orders":    "Заказы Ozon",
        # Notes
        "note_sber": (
            '<strong>Продажи через терминал</strong>: «Зачисление средств по операциям эквайринга» — положительное (доход, за вычетом комиссии).<br>'
            '<strong>Комиссия за терминал</strong>: комиссия извлекается из описания («Комиссия …») — отрицательное (расход).<br>'
            '<strong>Яндекс.Еда</strong>: отправитель ИНН 9705114405 (ООО Яндекс.Еда) — положительное (доход).<br>'
            '<strong>Зарплата</strong>: «Заработная плата по реестру» — отрицательное (расход).<br>'
            '<strong>Покупки</strong>: покупки по карте (PURCHASE_CB) — отрицательное (расход).<br>'
            '<strong>Возвраты</strong>: возврат/отмена покупок — положительное (доход).<br>'
            '<strong>Аренда</strong>: описание содержит «аренд» — отрицательное (расход).<br>'
            '<strong>Налоги</strong>: «Единый налоговый платеж» или «ЕНП» — отрицательное (расход).<br>'
            '<strong>Прочие платежи</strong>: описание содержит «Оплат» (аренда имеет приоритет) — отрицательное (расход).'
        ),
        "note_ozon": (
            '<strong>Заказы Ozon</strong>: «Оплата по заказу» — отрицательное (расход).<br>'
            '<strong>Покупки</strong>: операции по бизнес-карте («бизнес карте») — отрицательное (расход).<br>'
            '<strong>Возвраты</strong>: «Возврат» — положительное (доход).<br>'
            '<strong>Аренда</strong>: описание содержит «аренд» — отрицательное (расход).<br>'
            '<strong>Комиссия банка</strong>: «Комиссия за исполнение» — отрицательное (расход).<br>'
            '<strong>Прочие платежи</strong>: описание содержит «Оплат» (аренда имеет приоритет) — отрицательное (расход).'
        ),
    },
}

_MONTHS_RU = {
    1: "Январь", 2: "Февраль", 3: "Март", 4: "Апрель",
    5: "Май", 6: "Июнь", 7: "Июль", 8: "Август",
    9: "Сентябрь", 10: "Октябрь", 11: "Ноябрь", 12: "Декабрь",
}

def _month_label(period, lang):
    if lang == "ru":
        return f"{_MONTHS_RU[period.month]} {period.year}"
    return period.strftime("%B %Y")

# ── Tile CSS ──────────────────────────────────────────────────────────────────
st.markdown("""
<style>
  div[data-testid="stHorizontalBlock"] button {
    height: 110px !important;
    border-radius: 14px !important;
    font-size: 1.1rem !important;
    font-weight: 700 !important;
  }
  .bank-label { font-size: 0.75rem; color: #6b7280; margin-top: 4px; text-align: center; }
</style>
""", unsafe_allow_html=True)

# ── State ─────────────────────────────────────────────────────────────────────
if "bank" not in st.session_state:
    st.session_state.bank = None
if "lang" not in st.session_state:
    st.session_state.lang = "ru"

t = STRINGS[st.session_state.lang]

# ── Header + language toggle ───────────────────────────────────────────────────
col_title, col_lang = st.columns([9, 1])
with col_title:
    st.title(t["app_title"])
with col_lang:
    st.write("")
    if st.button(t["lang_btn"], key="lang_toggle", use_container_width=True):
        st.session_state.lang = "ru" if st.session_state.lang == "en" else "en"
        st.rerun()

st.caption(t["caption"])
st.divider()

# ── Bank selector tiles ───────────────────────────────────────────────────────
st.subheader(t["step1"])
col1, col2, col3 = st.columns([1, 1, 3])

with col1:
    sber_type = "primary" if st.session_state.bank == "sber" else "secondary"
    if st.button("🏦  Sberbank", use_container_width=True, type=sber_type, key="btn_sber"):
        st.session_state.bank = "sber"
        st.rerun()

with col2:
    ozon_type = "primary" if st.session_state.bank == "ozon" else "secondary"
    if st.button("🟠  Ozon Bank", use_container_width=True, type=ozon_type, key="btn_ozon"):
        st.session_state.bank = "ozon"
        st.rerun()

if st.session_state.bank:
    bank_name = "Sberbank" if st.session_state.bank == "sber" else "Ozon Bank"
    st.success(t["selected"].format(bank=bank_name))

st.divider()

# ── File upload ───────────────────────────────────────────────────────────────
st.subheader(t["step2"])
uploaded = st.file_uploader(
    t["upload_label"],
    type=["xlsx", "xls", "csv"],
    disabled=st.session_state.bank is None,
)

st.divider()

# ── Run ───────────────────────────────────────────────────────────────────────
st.subheader(t["step3"])
run = st.button(
    t["run_btn"],
    type="primary",
    disabled=(st.session_state.bank is None or uploaded is None),
)

# ── Processing functions ──────────────────────────────────────────────────────

def fmt(v):
    if not v:
        return "—"
    return f"+{v:,.2f}" if v > 0 else f"{v:,.2f}"


def _detail_rows_html(df, type_key, months, row_id, val_class):
    """Generate hidden detail rows for a type, grouped by receiver, sorted by total desc."""
    type_df = df[
        (df["type"] == type_key) &
        df["value"].notna() &
        df["receiver"].notna() &
        (df["receiver"] != "") &
        (df["receiver"].astype(str).str.strip() != "nan")
    ].copy()
    if type_df.empty:
        return ""

    type_df["receiver"] = type_df["receiver"].astype(str).str.strip()
    recv_month = type_df.groupby(["receiver", "month"])["value"].sum()
    recv_totals = type_df.groupby("receiver")["value"].sum().sort_values(key=lambda x: x.abs(), ascending=False)

    html = ""
    for receiver, _ in recv_totals.items():
        recv_vals = [recv_month.get((receiver, m), 0) for m in months]
        recv_total = sum(recv_vals)
        if recv_total == 0:
            continue
        recv_cells = "".join(f'<td class="{val_class}">{fmt(v)}</td>' for v in recv_vals)
        label = receiver[:90] + ("…" if len(receiver) > 90 else "")
        html += f"""
      <tr class="detail-row" data-parent="{row_id}" style="display:none">
        <td class="detail-label">{label}</td>
        {recv_cells}
        <td class="{val_class} total-col">{fmt(recv_total)}</td>
      </tr>"""
    return html


def process_sber(file_buf, lang) -> str:
    tr = STRINGS[lang]
    raw = pd.read_excel(file_buf, header=None)
    data = raw.iloc[11:].copy().reset_index(drop=True)

    df = pd.DataFrame({
        "date":        data[1],
        "debit_acct":  data[4],
        "credit_acct": data[8],
        "debit":       pd.to_numeric(data[9],  errors="coerce"),
        "credit":      pd.to_numeric(data[13], errors="coerce"),
        "doc_num":     data[14],
        "vo":          data[16],
        "bank":        data[17],
        "description": data[20],
    })

    df = df[df["date"].notna() & (df["debit"].notna() | df["credit"].notna())].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df[df["date"].notna()].copy()

    desc = df["description"].astype(str)

    is_pos      = desc.str.contains("Зачисление средств по операциям эквайринга", case=False, na=False)
    is_yandex   = df["debit_acct"].astype(str).str.contains(r"9705114405|Яндекс\.Еда", case=False, na=False)
    is_salary   = desc.str.contains("Заработная плата по реестру", case=False, na=False)
    is_purchase = desc.str.contains("PURCHASE", case=False, na=False) & df["debit"].notna()
    is_return   = desc.str.contains("PURCHASE", case=False, na=False) & df["credit"].notna()
    is_rent     = desc.str.contains("аренд", case=False, na=False)
    is_tax      = desc.str.contains("Единый налоговый платеж|ЕНП|Взносы на обязательное страхование", case=False, na=False)
    is_other    = desc.str.contains("Оплат", case=False, na=False)
    is_bankfee  = desc.str.contains("Комиссия в другие банки", case=False, na=False)

    df["commission"] = -pd.to_numeric(
        desc.str.extract(r"Комиссия\s+([\d.]+?)\.")[0], errors="coerce"
    )
    df.loc[~is_pos, "commission"] = None

    df["type"] = None
    df.loc[is_pos,      "type"] = "pos card"
    df.loc[is_yandex,   "type"] = "yandex food"
    df.loc[is_salary,   "type"] = "salary"
    df.loc[is_purchase, "type"] = "purchase"
    df.loc[is_return,   "type"] = "return"
    df.loc[is_rent,     "type"] = "rent"
    df.loc[is_tax,      "type"] = "tax"
    df.loc[is_other & df["type"].isna(), "type"] = "other payments"
    df.loc[is_bankfee,  "type"] = "bank fee"

    df["value"] = None
    df.loc[is_pos,      "value"] =  df.loc[is_pos,      "credit"]
    df.loc[is_yandex,   "value"] =  df.loc[is_yandex,   "credit"]
    df.loc[is_salary,   "value"] = -df.loc[is_salary,   "debit"]
    df.loc[is_purchase, "value"] = -df.loc[is_purchase, "debit"]
    df.loc[is_return,   "value"] =  df.loc[is_return,   "credit"]
    df.loc[is_rent,     "value"] = -df.loc[is_rent,     "debit"]
    df.loc[is_tax,      "value"] = -df.loc[is_tax,      "debit"]
    df.loc[df["type"] == "other payments", "value"] = -df.loc[df["type"] == "other payments", "debit"]
    df.loc[is_bankfee,  "value"] = -df.loc[is_bankfee,  "debit"]

    df["receiver"] = (
        df["credit_acct"].astype(str)
        .str.strip()
        .str.replace(r'^[^А-ЯЁа-яё]+', '', regex=True)
        .str.strip()
    )

    df["month"] = df["date"].dt.to_period("M")
    months = sorted(df["month"].dropna().unique())
    month_labels = {str(m): _month_label(m, lang) for m in months}

    types_config = [
        ("pos card",       tr["pos card"],       "#d1fae5", "#065f46", "#10b981", "in"),
        ("pos commission", tr["pos commission"], "#fee2e2", "#991b1b", "#ef4444", "out"),
        ("yandex food",    tr["yandex food"],    "#fef3c7", "#92400e", "#f59e0b", "in"),
        ("salary",         tr["salary"],         "#eef2ff", "#3730a3", "#6366f1", "out"),
        ("purchase",       tr["purchase"],       "#fce7f3", "#9d174d", "#ec4899", "out"),
        ("return",         tr["return"],         "#f0fdf4", "#166534", "#22c55e", "in"),
        ("rent",           tr["rent"],           "#fff7ed", "#9a3412", "#f97316", "out"),
        ("tax",            tr["tax"],            "#f1f5f9", "#334155", "#64748b", "out"),
        ("other payments", tr["other payments"], "#faf5ff", "#6b21a8", "#a855f7", "out"),
        ("bank fee",       tr["bank fee"],       "#fefce8", "#713f12", "#eab308", "out"),
    ]

    summary = df[df["type"].notna()].groupby(["month", "type"])["value"].sum().unstack(fill_value=0)
    commission_summary = df[is_pos].groupby("month")["commission"].sum()
    typed_net = df[df["type"].notna()].groupby("month")["value"].sum()
    totals = {str(m): typed_net.get(m, 0) + commission_summary.get(m, 0) for m in months}

    rows_html = ""
    for i, (type_key, label, bg, color, dot, flow) in enumerate(types_config):
        if type_key == "pos commission":
            vals = [commission_summary.get(m, 0) for m in months]
        else:
            vals = [summary.get(type_key, pd.Series(dtype=float)).get(m, 0) for m in months]
        total = sum(vals)
        if total == 0:
            continue
        row_class = "row-in" if flow == "in" else "row-out"
        val_class = "val-in" if flow == "in" else "val-out"
        cells = "".join(f'<td class="{val_class}">{fmt(v)}</td>' for v in vals)
        row_id = f"grp-{i}"

        rows_html += f"""
      <tr class="{row_class} summary-row" data-id="{row_id}">
        <td>
          <span class="toggle-arrow">&#9654;</span>
          <span class="badge" style="background:{bg};color:{color}">
            <span class="dot" style="background:{dot}"></span>{label}
          </span>
        </td>
        {cells}
        <td class="{val_class} total-col">{fmt(total)}</td>
      </tr>"""

        if type_key != "pos commission":
            rows_html += _detail_rows_html(df, type_key, months, row_id, val_class)

    month_headers = "".join(f"<th>{month_labels[str(m)]}</th>" for m in months)
    total_cells   = "".join(f"<td>{fmt(totals[str(m)])}</td>" for m in months)
    grand_total   = fmt(sum(totals.values()))

    return _build_html("Sberbank", month_headers, rows_html, total_cells, grand_total, tr["note_sber"], tr)


def process_ozon(file_buf, lang) -> str:
    tr = STRINGS[lang]
    raw = pd.read_excel(file_buf, header=None)
    data = raw.iloc[13:].copy().reset_index(drop=True)

    df = pd.DataFrame({
        "date":         data[1],
        "doc_num":      data[2],
        "debit":        pd.to_numeric(data[3], errors="coerce"),
        "credit":       pd.to_numeric(data[4], errors="coerce"),
        "counterparty": data[5],
        "account":      data[6],
        "description":  data[8],
    })

    df = df[df["date"].notna() & (df["debit"].notna() ^ df["credit"].notna())].copy()
    df["date"] = pd.to_datetime(df["date"], dayfirst=True, errors="coerce")
    df = df[df["date"].notna()].copy()

    desc = df["description"].astype(str)

    is_ozon_orders = desc.str.contains("Оплата по заказу", case=False, na=False)
    is_purchase    = desc.str.contains("бизнес карте", case=False, na=False)
    is_return      = desc.str.contains("Возврат", case=False, na=False)
    is_rent        = desc.str.contains("аренд", case=False, na=False)
    is_bankfee     = desc.str.contains("Комиссия за исполнение", case=False, na=False)
    is_other       = desc.str.contains("Оплат|Услуги по доставке воды", case=False, na=False)

    df["type"] = None
    df.loc[is_ozon_orders, "type"] = "ozon orders"
    df.loc[is_purchase,    "type"] = "purchase"
    df.loc[is_return,      "type"] = "return"
    df.loc[is_rent,        "type"] = "rent"
    df.loc[is_bankfee,     "type"] = "bank fee"
    df.loc[is_other & df["type"].isna(), "type"] = "other payments"

    df["value"] = None
    df.loc[df["type"] == "ozon orders",    "value"] = -df.loc[df["type"] == "ozon orders",    "debit"]
    df.loc[df["type"] == "purchase",       "value"] = -df.loc[df["type"] == "purchase",       "debit"]
    df.loc[df["type"] == "return",         "value"] =  df.loc[df["type"] == "return",         "credit"]
    df.loc[df["type"] == "rent",           "value"] = -df.loc[df["type"] == "rent",           "debit"]
    df.loc[df["type"] == "bank fee",       "value"] = -df.loc[df["type"] == "bank fee",       "debit"]
    df.loc[df["type"] == "other payments", "value"] = -df.loc[df["type"] == "other payments", "debit"]

    df["receiver"] = df["counterparty"].astype(str).str.strip()

    df["month"] = df["date"].dt.to_period("M")
    months = sorted(df["month"].dropna().unique())
    month_labels = {str(m): _month_label(m, lang) for m in months}

    types_config = [
        ("ozon orders",   tr["ozon orders"],    "#e0f2fe", "#075985", "#0ea5e9", "out"),
        ("purchase",      tr["purchase"],        "#fce7f3", "#9d174d", "#ec4899", "out"),
        ("return",        tr["return"],          "#f0fdf4", "#166534", "#22c55e", "in"),
        ("rent",          tr["rent"],            "#fff7ed", "#9a3412", "#f97316", "out"),
        ("bank fee",      tr["bank fee"],        "#fefce8", "#713f12", "#eab308", "out"),
        ("other payments",tr["other payments"],  "#faf5ff", "#6b21a8", "#a855f7", "out"),
    ]

    summary = df[df["type"].notna()].groupby(["month", "type"])["value"].sum().unstack(fill_value=0)
    typed_net = df[df["type"].notna()].groupby("month")["value"].sum()
    totals = {str(m): typed_net.get(m, 0) for m in months}

    rows_html = ""
    for i, (type_key, label, bg, color, dot, flow) in enumerate(types_config):
        vals  = [summary.get(type_key, pd.Series(dtype=float)).get(m, 0) for m in months]
        total = sum(vals)
        if total == 0:
            continue
        row_class = "row-in" if flow == "in" else "row-out"
        val_class = "val-in" if flow == "in" else "val-out"
        cells = "".join(f'<td class="{val_class}">{fmt(v)}</td>' for v in vals)
        row_id = f"grp-{i}"

        rows_html += f"""
      <tr class="{row_class} summary-row" data-id="{row_id}">
        <td>
          <span class="toggle-arrow">&#9654;</span>
          <span class="badge" style="background:{bg};color:{color}">
            <span class="dot" style="background:{dot}"></span>{label}
          </span>
        </td>
        {cells}
        <td class="{val_class} total-col">{fmt(total)}</td>
      </tr>"""

        rows_html += _detail_rows_html(df, type_key, months, row_id, val_class)

    month_headers = "".join(f"<th>{month_labels[str(m)]}</th>" for m in months)
    total_cells   = "".join(f"<td>{fmt(totals[str(m)])}</td>" for m in months)
    grand_total   = fmt(sum(totals.values()))

    return _build_html("Ozon Bank", month_headers, rows_html, total_cells, grand_total, tr["note_ozon"], tr)


def _build_html(bank_name, month_headers, rows_html, total_cells, grand_total, note, tr) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #f4f6f9; color: #1a1a2e; padding: 32px 20px;
    }}
    header {{ max-width: 900px; margin: 0 auto 28px; }}
    header h1 {{ font-size: 1.6rem; font-weight: 700; }}
    header p {{ font-size: 0.88rem; color: #6b7280; margin-top: 4px; }}
    .legend {{ max-width: 900px; margin: 0 auto 20px; display: flex; gap: 20px; font-size: 0.82rem; color: #6b7280; }}
    .legend span {{ display: flex; align-items: center; gap: 6px; }}
    .legend-bar {{ width: 12px; height: 12px; border-radius: 2px; }}
    .table-wrap {{
      max-width: 900px; margin: 0 auto 40px; background: #fff;
      border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden;
    }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.88rem; }}
    thead tr {{ background: #1a1a2e; color: #fff; }}
    thead th {{
      padding: 12px 18px; text-align: left; font-weight: 600;
      font-size: 0.76rem; text-transform: uppercase; letter-spacing: .05em;
    }}
    thead th:not(:first-child) {{ text-align: right; }}
    tbody td {{ padding: 12px 18px; border-bottom: 1px solid #f0f0f0; }}
    tbody td:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
    tfoot tr {{ background: #1a1a2e; color: #fff; }}
    tfoot td {{ padding: 13px 18px; font-weight: 700; font-size: 0.88rem; }}
    tfoot td:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .row-in  {{ border-left: 3px solid #10b981; }}
    .row-out {{ border-left: 3px solid #ef4444; }}
    .val-in  {{ color: #065f46; font-weight: 600; }}
    .val-out {{ color: #991b1b; font-weight: 600; }}
    .total-col {{ font-weight: 700; }}
    .badge {{
      display: inline-flex; align-items: center; gap: 6px;
      border-radius: 6px; padding: 3px 10px; font-size: 0.76rem; font-weight: 600;
    }}
    .dot {{ width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }}
    .note {{ max-width: 900px; margin: -28px auto 0; font-size: 0.78rem; color: #9ca3af; line-height: 1.8; }}
    /* ── Expandable rows ── */
    .summary-row {{ cursor: pointer; user-select: none; }}
    .summary-row:hover {{ background: #f0f4ff; }}
    .toggle-arrow {{
      display: inline-block;
      font-size: 0.6rem;
      color: #9ca3af;
      margin-right: 6px;
      transition: transform 0.18s ease;
      vertical-align: middle;
    }}
    .summary-row.expanded .toggle-arrow {{ transform: rotate(90deg); }}
    .detail-row {{ background: #fafbff; }}
    .detail-row:hover {{ background: #f0f4ff; }}
    .detail-label {{
      padding-left: 48px !important;
      font-size: 0.82rem;
      color: #374151;
      max-width: 320px;
      word-break: break-word;
    }}
  </style>
</head>
<body>
<header>
  <h1>{bank_name} — {tr["monthly_summary"]}</h1>
  <p>{tr["report_subtitle"].format(bank=bank_name)}</p>
</header>
<div class="legend">
  <span><span class="legend-bar" style="background:#10b981"></span>{tr["money_in"]}</span>
  <span><span class="legend-bar" style="background:#ef4444"></span>{tr["money_out"]}</span>
</div>
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>{tr["col_type"]}</th>
        {month_headers}
        <th>{tr["col_total"]}</th>
      </tr>
    </thead>
    <tbody>{rows_html}
    </tbody>
    <tfoot>
      <tr>
        <td>{tr["footer_total"]}</td>
        {total_cells}
        <td>{grand_total}</td>
      </tr>
    </tfoot>
  </table>
</div>
<p class="note">{note}</p>

<script>
  document.querySelectorAll('.summary-row').forEach(function(row) {{
    row.addEventListener('click', function() {{
      var id = this.dataset.id;
      var expanded = this.classList.toggle('expanded');
      document.querySelectorAll('.detail-row[data-parent="' + id + '"]').forEach(function(r) {{
        r.style.display = expanded ? '' : 'none';
      }});
    }});
  }});
</script>
</body>
</html>"""


# ── Run & render ──────────────────────────────────────────────────────────────
if run:
    st.divider()
    with st.spinner(t["processing"]):
        try:
            buf = io.BytesIO(uploaded.read())
            lang = st.session_state.lang
            if st.session_state.bank == "sber":
                html_out = process_sber(buf, lang)
            else:
                html_out = process_ozon(buf, lang)

            st.subheader(t["step4"])
            col_dl, _ = st.columns([1, 4])
            with col_dl:
                bank_slug = "sber" if st.session_state.bank == "sber" else "ozon"
                st.download_button(
                    t["download"],
                    data=html_out.encode("utf-8"),
                    file_name=f"{bank_slug}_monthly.html",
                    mime="text/html",
                )
            components.html(html_out, height=700, scrolling=True)

        except Exception as e:
            st.error(t["error"].format(e=e))
            st.exception(e)
