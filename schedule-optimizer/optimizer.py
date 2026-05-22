import re
import pandas as pd
from ortools.sat.python import cp_model
from datetime import date, datetime
from dateutil.relativedelta import relativedelta
from collections import defaultdict

from config import COL_TS, COL_MONTH, COL_NAME, COL_MORN, COL_EVE, COL_STORES, SHIFTS, SHIFT_LABEL


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


def get_stores_from_df(df: pd.DataFrame) -> list[str]:
    """Return sorted list of unique stores found in a dataframe."""
    stores = set()
    for _, r in df.iterrows():
        for s in parse_stores(r.get(COL_STORES, "")):
            stores.add(s)
    return sorted(stores)


def _prepare_inputs(df: pd.DataFrame):
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

    if COL_MONTH in df and df[COL_MONTH].notna().any():
        month = int(df[COL_MONTH].dropna().iloc[0])
    else:
        raise ValueError("Column 'Месяц' is missing or empty.")

    year = None
    if COL_TS in df and df[COL_TS].notna().any():
        try:
            year = int(pd.to_datetime(df[COL_TS].dropna().iloc[0]).year)
        except Exception:
            pass
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
) -> tuple:
    """
    Returns (schedule_df, coverage_df, status_str, stats) or raises on bad input.
    schedule_df: one row per assigned slot.
    coverage_df: filled vs required per slot.
    stats: dict with summary metrics and raw data needed for the UI.
    """
    filtered = df[df[COL_MONTH] == month_filter].copy()
    if filtered.empty:
        raise ValueError(f"No responses for month {month_filter}.")

    records, people, STORES, year, month, DAYS, rec_by_name = _prepare_inputs(filtered)

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
