import re
import pandas as pd
from ortools.sat.python import cp_model
from datetime import date, datetime
from dateutil.relativedelta import relativedelta
from collections import defaultdict

from config import (
    COL_TS, COL_MONTH, COL_YEAR, COL_NAME,
    COL_MORN, COL_EVE, COL_STORES,
    SHIFTS, SHIFT_LABEL,
)


def norm_space(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ").replace(" ", " ").strip())


def parse_days(cell) -> set:
    if pd.isna(cell):
        return set()
    out = set()
    for p in str(cell).replace(";", ",").split(","):
        digits = "".join(ch for ch in p if ch.isdigit())
        if digits:
            out.add(int(digits))
    return out


def parse_stores(cell) -> list:
    if pd.isna(cell):
        return []
    return [norm_space(p) for p in str(cell).replace(";", ",").split(",") if norm_space(p)]


def parse_ts(val) -> datetime | None:
    if pd.isna(val) or val is None or str(val).strip() == "":
        return None
    s = str(val).strip()
    try:
        dt = pd.to_datetime(s, dayfirst=True)
        if pd.notna(dt):
            return dt
    except Exception:
        pass
    try:
        dt = pd.to_datetime(s, dayfirst=False)
        if pd.notna(dt):
            return dt
    except Exception:
        pass
    m = re.search(r"\b(20\d\d)\b", s)
    if m:
        try:
            return datetime(int(m.group(1)), 1, 1)
        except Exception:
            pass
    return None


def extract_month_num(val) -> int | None:
    if pd.isna(val) or val is None or str(val).strip() == "":
        return None
    try:
        m = int(float(str(val).strip()))
        if 1 <= m <= 12:
            return m
    except (ValueError, TypeError):
        pass

    val_str = str(val).strip().lower()
    months_ru = ["январ", "феврал", "март", "апрел", "ма", "июн",
                 "июл", "август", "сентябр", "октябр", "ноябр", "декабр"]
    for idx, prefix in enumerate(months_ru, 1):
        if val_str.startswith(prefix):
            return idx
    months_en = ["jan", "feb", "mar", "apr", "may", "jun",
                 "jul", "aug", "sep", "oct", "nov", "dec"]
    for idx, prefix in enumerate(months_en, 1):
        if val_str.startswith(prefix):
            return idx
    return None


def extract_year_and_month(row: pd.Series | dict) -> tuple[int | None, int | None]:
    """
    Extracts (target_year, target_month) from a response row.
    If the sheet does not have an explicit year column, infers target_year from Timestamp.
    """
    month = extract_month_num(row.get(COL_MONTH))
    if month is None:
        return None, None

    # Check for explicit Year column (e.g. 'Год', 'Year', COL_YEAR)
    for col in [COL_YEAR, "Год", "год", "Year", "year"]:
        if col in row and pd.notna(row.get(col)):
            try:
                y = int(float(str(row[col]).strip()))
                if 2000 <= y <= 2100:
                    return y, month
            except (ValueError, TypeError):
                pass

    # Infer from Timestamp column
    ts_val = None
    for col in [COL_TS, "Timestamp", "timestamp", "Отметка времени", "отметка времени"]:
        if col in row and pd.notna(row.get(col)) and str(row.get(col)).strip():
            ts_val = row.get(col)
            break

    if ts_val is not None:
        ts = parse_ts(ts_val)
        if ts is not None:
            sub_year = ts.year
            sub_month = ts.month

            # Submissions for target_month are typically filled out shortly before or during the month.
            # If target_month is Jan/Feb/Mar (1, 2, 3) and sub_month is Oct/Nov/Dec (10, 11, 12),
            # the submission is for the following year.
            # If target_month is Nov/Dec (11, 12) and sub_month is Jan/Feb (1, 2),
            # it's a late submission for the previous year.
            diff = (month - sub_month) % 12
            if diff in [1, 2, 3, 4] and month < sub_month:
                target_year = sub_year + 1
            elif diff in [10, 11] and month > sub_month:
                target_year = sub_year - 1
            else:
                target_year = sub_year
            return target_year, month

    return None, month


def filter_df_by_year_month(df: pd.DataFrame, target_year: int | None, target_month: int) -> pd.DataFrame:
    """
    Filter DataFrame for responses matching target_month and target_year.
    If target_year is None, returns rows matching target_month.
    """
    if df.empty:
        return df.copy()

    matching_indices = []
    current_year = datetime.today().year
    for idx, row in df.iterrows():
        y, m = extract_year_and_month(row)
        if m == target_month:
            row_year = y if y is not None else current_year
            if target_year is None or row_year == target_year:
                matching_indices.append(idx)

    return df.loc[matching_indices].copy()


def get_available_years_from_df(df: pd.DataFrame) -> list[int]:
    """Return sorted list of unique years inferred from form responses."""
    if df.empty:
        return []
    years = set()
    for _, row in df.iterrows():
        y, _ = extract_year_and_month(row)
        if y is not None:
            years.add(y)
    return sorted(years)


def get_stores_from_df(df: pd.DataFrame) -> list[str]:
    """Return sorted list of unique stores found in a dataframe."""
    stores = set()
    for _, r in df.iterrows():
        for s in parse_stores(r.get(COL_STORES, "")):
            stores.add(s)
    return sorted(stores)


def _prepare_inputs(df: pd.DataFrame, target_year: int | None = None, target_month: int | None = None):
    acc = defaultdict(lambda: {"name": None, "by_store": defaultdict(lambda: {"m": set(), "v": set()})})
    for _, r in df.iterrows():
        name = norm_space(r.get(COL_NAME, ""))
        if not name:
            continue
        stores = parse_stores(r.get(COL_STORES, ""))
        if not stores:
            continue
        m = parse_days(r.get(COL_MORN, ""))
        v = parse_days(r.get(COL_EVE, ""))
        acc[name]["name"] = name
        for st in stores:
            acc[name]["by_store"][st]["m"] |= m
            acc[name]["by_store"][st]["v"] |= v

    records = [{"name": n, "stores": set(rec["by_store"]), "by_store": rec["by_store"]}
               for n, rec in acc.items()]
    people = sorted(acc.keys())
    stores_list = sorted({st for rec in records for st in rec["stores"]})
    rec_by_name = {rec["name"]: rec for rec in records}

    if target_month is not None:
        month = int(target_month)
    else:
        month = None
        for _, r in df.iterrows():
            m = extract_month_num(r.get(COL_MONTH))
            if m is not None:
                month = m
                break
        if month is None:
            raise ValueError("Column 'Месяц' is missing, empty, or has invalid values.")

    year = target_year
    if year is None:
        for _, r in df.iterrows():
            y, _ = extract_year_and_month(r)
            if y is not None:
                year = y
                break
    if year is None:
        year = datetime.today().year

    first_day = date(year, month, 1)
    days = list(range(1, (first_day + relativedelta(months=1) - first_day).days + 1))

    if not stores_list:
        raise ValueError(f"No stores found in column '{COL_STORES}'.")

    return records, people, stores_list, year, month, days, rec_by_name


def run_optimization(
    df: pd.DataFrame,
    month_filter: int,
    store_weights: dict,
    store_need: dict,    # {"StoreName": {"Утро": n, "Вечер": n}}
    default_need: dict,  # {"Утро": 1, "Вечер": 1}
    max_shifts: int = 32,
    time_limit: int = 30,
    year_filter: int | None = None,
) -> tuple:
    """
    Returns (schedule_df, coverage_df, status_str, stats) or raises on bad input.
    schedule_df: one row per assigned slot.
    coverage_df: filled vs required per slot.
    stats: dict with summary metrics and raw data needed for the UI.
    """
    filtered = filter_df_by_year_month(df, year_filter, month_filter)
    if filtered.empty:
        year_str = f" and year {year_filter}" if year_filter else ""
        raise ValueError(f"No responses for month {month_filter}{year_str}.")

    records, people, STORES, year, month, DAYS, rec_by_name = _prepare_inputs(
        filtered, target_year=year_filter, target_month=month_filter
    )

    def eligible(employee, day, store, shift):
        rec = rec_by_name.get(employee)
        if not rec:
            return False
        key = "m" if shift == "Утро" else "v"
        return day in rec["by_store"].get(store, {}).get(key, set())

    def staffing_need(store, day, shift):
        if store in store_need and shift in store_need[store]:
            return store_need[store][shift]
        return default_need.get(shift, 0)

    # ── Build model ──────────────────────────────────────────────────────────────
    model = cp_model.CpModel()
    NEED = {(d, s, sh): staffing_need(s, d, sh) for d in DAYS for s in STORES for sh in SHIFTS}

    x = {}
    slot_vars = {(d, s, sh): [] for d in DAYS for s in STORES for sh in SHIFTS}
    emp_day_vars = {(e, d): [] for e in people for d in DAYS}
    emp_day_store_vars = {}

    for e in people:
        for d in DAYS:
            for s in STORES:
                for sh in SHIFTS:
                    if NEED[(d, s, sh)] == 0 or not eligible(e, d, s, sh):
                        continue
                    v = model.NewBoolVar(f"x_{e}_{d}_{s}_{sh}")
                    x[(e, d, s, sh)] = v
                    slot_vars[(d, s, sh)].append(v)
                    emp_day_vars[(e, d)].append(v)
                    emp_day_store_vars.setdefault((e, d, s), []).append(v)

    # y[e,d,s] = 1 if employee works any shift at store s on day d
    y = {}
    for (e, d, s), vars_here in emp_day_store_vars.items():
        yy = model.NewBoolVar(f"y_{e}_{d}_{s}")
        y[(e, d, s)] = yy
        model.Add(sum(vars_here) >= yy)
        for v in vars_here:
            model.Add(v <= yy)

    # ── Constraints ──────────────────────────────────────────────────────────────
    # C1: slot capacity
    for (d, s, sh), need in NEED.items():
        vs = slot_vars[(d, s, sh)]
        if vs:
            model.Add(sum(vs) <= need)

    # C2: one store per employee per day
    for e in people:
        for d in DAYS:
            ys = [y[(e, d, s)] for s in STORES if (e, d, s) in y]
            if ys:
                model.Add(sum(ys) <= 1)

    # C3: max two shifts per employee per day
    for e in people:
        for d in DAYS:
            vs = emp_day_vars[(e, d)]
            if vs:
                model.Add(sum(vs) <= 2)

    # C4: pairing bonus variable (both shifts same store/day)
    pair = []
    for e in people:
        for d in DAYS:
            for s in STORES:
                xm = x.get((e, d, s, "Утро"))
                xv = x.get((e, d, s, "Вечер"))
                if xm is not None and xv is not None:
                    p = model.NewBoolVar(f"pair_{e}_{d}_{s}")
                    model.Add(p <= xm)
                    model.Add(p <= xv)
                    model.Add(p >= xm + xv - 1)
                    pair.append(p)

    # C5: max shifts per employee
    for e in people:
        emp_x = [v for (ee, d, s, sh), v in x.items() if ee == e]
        if emp_x:
            model.Add(sum(emp_x) <= max_shifts)

    # ── Fairness ─────────────────────────────────────────────────────────────────
    total_required = sum(NEED.values())
    avg = total_required / len(people) if people else 0

    emp_total = {}
    for e in people:
        emp_x = [v for (ee, d, s, sh), v in x.items() if ee == e]
        t = model.NewIntVar(0, len(DAYS) * len(STORES) * len(SHIFTS), f"ets_{e}")
        model.Add(t == (sum(emp_x) if emp_x else 0))
        emp_total[e] = t

    dev_pos, dev_neg = {}, {}
    for e in people:
        dp = model.NewIntVar(0, len(DAYS) * len(STORES) * len(SHIFTS), f"dp_{e}")
        dn = model.NewIntVar(0, len(DAYS) * len(STORES) * len(SHIFTS), f"dn_{e}")
        model.Add(emp_total[e] - round(avg) == dp - dn)
        dev_pos[e], dev_neg[e] = dp, dn

    # ── Objective ────────────────────────────────────────────────────────────────
    model.Maximize(
        10000 * sum(v * round(store_weights.get(s, 1.0) * 10) for (e, d, s, sh), v in x.items())
        + 2 * (sum(pair) if pair else 0)
        - (sum(dev_pos.values()) + sum(dev_neg.values()))
    )

    # ── Solve ────────────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    status_map = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }
    status_str = status_map.get(status, str(status))

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, None, status_str, {}

    # ── Extract results ───────────────────────────────────────────────────────────
    rows = []
    for (e, d, s, sh), var in x.items():
        if solver.Value(var) == 1:
            rows.append({"Сотрудник": e, "День": d, "Кафе": s, "Смена": sh,
                         "Нужен персонал": NEED[(d, s, sh)]})
    schedule_df = pd.DataFrame(rows).sort_values(["Сотрудник", "День", "Кафе", "Смена"])

    slot_rows = []
    for (d, s, sh), need in NEED.items():
        covered = sum(solver.Value(v) for v in slot_vars[(d, s, sh)])
        slot_rows.append({
            "День": d, "Кафе": s, "Смена": sh,
            "Нужно": need, "Покрыто": covered,
            "Заполнено %": 0 if need == 0 else round(100 * covered / need, 1),
        })
    coverage_df = pd.DataFrame(slot_rows).sort_values(["День", "Кафе", "Смена"])

    total_filled = sum(solver.Value(v) for v in x.values())

    stats = {
        "year": year,
        "month": month,
        "days": DAYS,
        "stores": STORES,
        "need": NEED,
        "total_required": total_required,
        "total_filled": total_filled,
        "missing": total_required - total_filled,
        "avg_shifts": avg,
        "emp_dist": {e: solver.Value(emp_total[e]) for e in people},
    }

    return schedule_df, coverage_df, status_str, stats


def build_wide_table(schedule_df: pd.DataFrame, year: int, month: int, days: list) -> pd.DataFrame:
    """Pivot schedule into a wide date × (store, shift) table for Sheets export."""
    tmp = schedule_df.copy()
    tmp["Дата"] = tmp["День"].apply(lambda d: date(year, month, int(d)))
    tmp["Смена2"] = tmp["Смена"].map(SHIFT_LABEL).fillna(tmp["Смена"])

    pivot = tmp.pivot_table(
        index="Дата",
        columns=["Кафе", "Смена2"],
        values="Сотрудник",
        aggfunc=lambda s: "/".join(sorted(set(s))),
        sort=False,
    )

    full_idx = pd.Index([date(year, month, d) for d in days], name="Дата")
    pivot = pivot.reindex(index=full_idx).fillna("—")
    return pivot
