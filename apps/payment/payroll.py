from datetime import datetime, timedelta

# Google Sheets stores dates as days since Dec 30, 1899
_SHEETS_EPOCH = datetime(1899, 12, 30)


def _parse_date(val):
    if isinstance(val, datetime):
        return val
    # Serial number from UNFORMATTED_VALUE (Google Sheets date)
    if isinstance(val, (int, float)) and val > 0:
        return _SHEETS_EPOCH + timedelta(days=int(val))
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%d.%m.%Y', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d'):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    try:
        from dateutil import parser as dparser
        return dparser.parse(s, dayfirst=True)
    except Exception:
        return None


def _fmt_date(dt):
    return dt.strftime('%Y-%m-%d')


def _norm_name(val):
    # Collapses stray double spaces / trailing whitespace from sheet formulas
    # (e.g. full_name built from "last " + "first ") so lookups aren't case-sensitive
    # to spreadsheet formatting.
    return ' '.join(str(val or '').split())


def _num(val):
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(str(val or '').strip().replace(',', ''))
    except ValueError:
        return 0.0


def _parse_int(val):
    try:
        return int(str(val).strip())
    except (TypeError, ValueError):
        return None


def _parse_month(val):
    digits = ''.join(c for c in str(val or '') if c.isdigit())
    if not digits:
        return None
    m = int(digits)
    return m if 1 <= m <= 12 else None


def _make_empty_employee(name, role, preferable_store):
    return {
        'name': name, 'role': role, 'preferableStore': preferable_store,
        'halfShiftsH1': 0, 'fullShiftsH1': 0, 'helperShiftsH1': 0,
        'halfShiftsH2': 0, 'fullShiftsH2': 0, 'helperShiftsH2': 0,
        'baseH1': 0.0, 'residualH1': 0.0,
        'baseH2': 0.0, 'residualH2': 0.0,
        'bonusLines': [],
        'bonusTotal': 0.0, 'penaltyTotal': 0.0, 'advances': 0.0,
        'toPayH1': 0.0, 'monthlyEarned': 0.0, 'monthlyTotal': 0.0,
        'paidAlready': 0.0, 'toPayH2': 0.0, 'overpayment': 0.0,
    }


# ── Step 1 ────────────────────────────────────────────────────────────────────

def parse_schedule_data(raw_data, month, year):
    headers = raw_data[0]
    shifts = []
    warnings = []

    for r in range(1, len(raw_data)):
        row = raw_data[r]
        raw_date = row[0] if row else None
        if not raw_date and raw_date != 0:
            continue

        date = _parse_date(raw_date)
        if date is None:
            warnings.append(f'Row {r + 1}: unparseable date "{raw_date}"')
            continue
        if date.month != month or date.year != year:
            continue

        day = date.day
        date_str = _fmt_date(date)

        for c in range(1, len(headers)):
            header = str(headers[c] or '').strip()
            if not header:
                continue

            cell = str(row[c] if c < len(row) else '').strip()
            if not cell or cell.lower() in {v.lower() for v in ['—', '-', 'вых', 'off', 'точка не работает']}:
                continue

            sep = header.rfind(' - ')
            sep_len = 3
            if sep == -1:
                sep = header.rfind('- ')
                sep_len = 2
            if sep == -1:
                warnings.append(f'Col {c + 1}: header "{header}" has no separator')
                continue

            shifts.append({
                'name':      _norm_name(cell),
                'dateStr':   date_str,
                'day':       day,
                'store':     header[:sep].strip(),
                'shiftType': header[sep + sep_len:].strip(),
                'half':      1 if day <= 15 else 2,
            })

    return shifts, warnings


# ── Step 2a ───────────────────────────────────────────────────────────────────

def build_employee_map(raw_data):
    headers = [str(h).strip().lower() for h in raw_data[0]]
    result = {}
    for r in range(1, len(raw_data)):
        obj = {headers[i]: raw_data[r][i] for i in range(min(len(headers), len(raw_data[r])))}
        name = _norm_name(obj.get('full_name', ''))
        if not name:
            # full_name formula/entry sometimes isn't filled in for newly added rows;
            # fall back to last_name + first_name so those employees still match.
            name = _norm_name(f"{obj.get('last_name', '')} {obj.get('first_name', '')}")
        if name:
            result[name] = obj
    return result


# ── Step 2b ───────────────────────────────────────────────────────────────────

def build_salary_map(raw_data):
    result = {}
    for r in range(1, len(raw_data)):
        row = raw_data[r]
        if len(row) < 4:
            continue
        role = str(row[0] or '').strip().lower()
        if not role:
            continue
        result[role] = {
            'baseHalf':     _num(row[1]),
            'residualHalf': _num(row[2]),
            'helper':       _num(row[3]),
        }
    return result


# ── Step 3 ────────────────────────────────────────────────────────────────────

def enrich_shifts(shifts, employee_map, salary_map):
    result = []
    for shift in shifts:
        emp = employee_map.get(shift['name'])
        if emp is None:
            result.append({**shift, 'matched': False, 'error': 'NOT_IN_DB'})
            continue

        role = str(emp.get('role', '') or '').strip().lower()
        rates = salary_map.get(role)
        if not rates or (rates['baseHalf'] == 0 and rates['helper'] == 0):
            result.append({**shift, 'matched': False, 'role': role, 'error': f'NO_RATES:{role}'})
            continue

        st = shift['shiftType'].lower()
        if st == 'помощь':
            base_pay, residual_pay, category = rates['helper'], 0.0, 'helper'
        elif st == 'полная смена':
            base_pay = rates['baseHalf'] * 2
            residual_pay = rates['residualHalf'] * 2
            category = 'full'
        else:
            base_pay, residual_pay, category = rates['baseHalf'], rates['residualHalf'], 'half'

        result.append({
            **shift,
            'matched':        True,
            'role':           role,
            'preferableStore': str(emp.get('preferable_store', '') or '').strip(),
            'shiftCategory':  category,
            'basePay':        base_pay,
            'residualPay':    residual_pay,
        })
    return result


# ── Step 4 ────────────────────────────────────────────────────────────────────

def parse_bonus_data(raw_data, month, year):
    result = []
    for r in range(1, len(raw_data)):
        row = raw_data[r]
        if len(row) < 6:
            continue
        timestamp  = row[0]
        name       = _norm_name(row[1])
        b_month    = _parse_month(row[2])
        bonus_type = str(row[3] or '').strip().lower()
        amount     = abs(_num(row[4]))
        comment    = str(row[5] or '').strip()

        if not name or not b_month or not amount:
            continue

        ts_date = _parse_date(timestamp)
        ts_year = ts_date.year if ts_date else year

        if b_month != month or ts_year != year:
            continue

        result.append({
            'name':    name,
            'month':   b_month,
            'year':    ts_year,
            'type':    bonus_type,
            'amount':  amount,
            'comment': comment,
        })
    return result


# ── Step 5 ────────────────────────────────────────────────────────────────────

def parse_paid_data(raw_data, month):
    result = []
    for r in range(1, len(raw_data)):
        row = raw_data[r]
        if len(row) < 5:
            continue
        name    = _norm_name(row[0])
        store   = str(row[1] or '').strip()
        amount  = _num(row[2])
        r_month = _parse_int(row[3])
        half    = str(row[4] or '').strip().lower()

        if not name or r_month != month:
            continue
        result.append({'name': name, 'store': store, 'amount': amount, 'month': r_month, 'half': half})
    return result


# ── Step 6 ────────────────────────────────────────────────────────────────────

def calculate_payroll(enriched_shifts, bonuses, paid_records):
    emp = {}

    for s in enriched_shifts:
        if not s['matched']:
            continue
        if s['name'] not in emp:
            emp[s['name']] = _make_empty_employee(s['name'], s['role'], s['preferableStore'])
        e = emp[s['name']]

        if s['half'] == 1:
            if   s['shiftCategory'] == 'half':   e['halfShiftsH1']   += 1
            elif s['shiftCategory'] == 'full':   e['fullShiftsH1']   += 1
            elif s['shiftCategory'] == 'helper': e['helperShiftsH1'] += 1
            e['baseH1']     += s['basePay']
            e['residualH1'] += s['residualPay']
        else:
            if   s['shiftCategory'] == 'half':   e['halfShiftsH2']   += 1
            elif s['shiftCategory'] == 'full':   e['fullShiftsH2']   += 1
            elif s['shiftCategory'] == 'helper': e['helperShiftsH2'] += 1
            e['baseH2']     += s['basePay']
            e['residualH2'] += s['residualPay']

    for b in bonuses:
        if b['name'] not in emp:
            emp[b['name']] = _make_empty_employee(b['name'], '', '')
        emp[b['name']]['bonusLines'].append(b)

    for e in emp.values():
        e['bonusTotal']   = sum(b['amount'] for b in e['bonusLines'] if b['type'] == 'добавка')
        e['penaltyTotal'] = sum(b['amount'] for b in e['bonusLines'] if b['type'] == 'вычет')
        e['advances']     = sum(b['amount'] for b in e['bonusLines'] if b['type'] == 'выплатили?')

        e['toPayH1']       = e['baseH1'] + e['bonusTotal'] - e['penaltyTotal']
        e['monthlyEarned'] = e['baseH1'] + e['residualH1'] + e['baseH2'] + e['residualH2']
        e['monthlyTotal']  = e['monthlyEarned'] + e['bonusTotal'] - e['penaltyTotal']

        e['paidAlready']   = sum(p['amount'] for p in paid_records if p['name'] == e['name'])
        total_out          = e['paidAlready'] + e['advances']
        e['toPayH2']       = max(0.0, e['monthlyTotal'] - total_out)
        e['overpayment']   = total_out - e['monthlyTotal'] if total_out > e['monthlyTotal'] else 0.0

    return sorted(emp.values(), key=lambda e: e['name'])


# ── Step 7 ────────────────────────────────────────────────────────────────────

def calculate_verification(enriched_shifts, employee_summaries):
    sched_map = {}
    for s in enriched_shifts:
        if not s['matched']:
            continue
        sched_map[s['store']] = sched_map.get(s['store'], 0.0) + s['basePay'] + s['residualPay']

    emp_shifts_by_store = {}
    for s in enriched_shifts:
        if not s['matched']:
            continue
        emp_shifts_by_store.setdefault(s['name'], {})[s['store']] = emp_shifts_by_store.get(s['name'], {}).get(s['store'], 0.0) + s['basePay'] + s['residualPay']

    emp_map = {}
    for e in employee_summaries:
        emp_shifts = emp_shifts_by_store.get(e['name'], {})
        ratio_by_store = {store: cost / e['monthlyEarned'] if e['monthlyEarned'] else 0 for store, cost in emp_shifts.items()}
        for store, ratio in ratio_by_store.items():
            emp_map[store] = emp_map.get(store, 0.0) + e['monthlyTotal'] * ratio
        if not emp_shifts:
            store = '—'
            emp_map[store] = emp_map.get(store, 0.0) + e['monthlyTotal']

    stores = sorted(set(list(sched_map) + list(emp_map)))
    rows = [{
        'store':        store,
        'scheduleCost': sched_map.get(store, 0.0),
        'employeeCost': emp_map.get(store, 0.0),
        'diff':         sched_map.get(store, 0.0) - emp_map.get(store, 0.0),
    } for store in stores]

    totals = {
        'scheduleCost': sum(r['scheduleCost'] for r in rows),
        'employeeCost': sum(r['employeeCost'] for r in rows),
        'diff':         sum(r['diff'] for r in rows),
    }
    return {'rows': rows, 'totals': totals}


# ── Output formatting ─────────────────────────────────────────────────────────

def build_payment_rows(summaries):
    headers = [
        'Имя', 'Филиал', 'Роль',
        'Полных смен H1', 'Полусмен H1', 'Помощь H1',
        'База H1', 'Резидуал H1', 'Бонус', 'Штраф', 'К выплате H1',
        'Полных смен H2', 'Полусмен H2', 'Помощь H2',
        'База H2', 'Резидуал H2',
        'Заработано всего', 'Итого с корр.', 'Уже выплачено', 'К выплате H2', 'Переплата',
    ]
    rows = [[
        e['name'], e['preferableStore'], e['role'],
        e['fullShiftsH1'], e['halfShiftsH1'], e['helperShiftsH1'],
        e['baseH1'], e['residualH1'], e['bonusTotal'], e['penaltyTotal'], e['toPayH1'],
        e['fullShiftsH2'], e['halfShiftsH2'], e['helperShiftsH2'],
        e['baseH2'], e['residualH2'],
        e['monthlyEarned'], e['monthlyTotal'], e['paidAlready'], e['toPayH2'], e['overpayment'],
    ] for e in summaries]
    return [headers] + rows


def build_verification_rows(verification):
    headers = ['Филиал', 'Стоимость по графику', 'Стоимость по сотрудникам', 'Разница']
    rows    = [[r['store'], r['scheduleCost'], r['employeeCost'], r['diff']] for r in verification['rows']]
    totals  = ['ИТОГО', verification['totals']['scheduleCost'], verification['totals']['employeeCost'], verification['totals']['diff']]
    return [headers] + rows + [totals]


# ── Breakdown analysis functions ──────────────────────────────────────────────

def build_difference_waterfall(enriched_shifts, employee_summaries, bonuses, unmatched_shifts):
    schedule_cost = sum(s['basePay'] + s['residualPay'] for s in enriched_shifts if s['matched'])
    total_bonuses = sum(e['bonusTotal'] for e in employee_summaries)
    total_penalties = sum(e['penaltyTotal'] for e in employee_summaries)
    unmatched_cost = sum(s.get('basePay', 0) + s.get('residualPay', 0) for s in unmatched_shifts)
    employee_cost = sum(e['monthlyTotal'] for e in employee_summaries)

    return {
        'schedule_cost': schedule_cost,
        'bonuses': total_bonuses,
        'penalties': total_penalties,
        'unmatched_cost': unmatched_cost,
        'employee_cost': employee_cost,
    }


def build_store_audit(enriched_shifts, employee_summaries):
    emp_shifts_by_store = {}
    for s in enriched_shifts:
        if not s['matched']:
            continue
        emp_shifts_by_store.setdefault(s['name'], {})[s['store']] = emp_shifts_by_store.get(s['name'], {}).get(s['store'], 0.0) + s['basePay'] + s['residualPay']

    store_employees = {}
    for e in employee_summaries:
        emp_shifts = emp_shifts_by_store.get(e['name'], {})
        for store, shift_cost in emp_shifts.items():
            if store not in store_employees:
                store_employees[store] = []
            ratio = (shift_cost / e['monthlyEarned']) if e['monthlyEarned'] else 0
            scheduled = shift_cost
            bonus = e['bonusTotal'] * ratio
            employee_total = e['monthlyTotal'] * ratio
            store_employees[store].append({
                'name': e['name'],
                'scheduled': scheduled,
                'bonus': bonus,
                'scheduled_plus_bonus': scheduled + bonus,
                'employee_total': employee_total,
                'difference': employee_total - (scheduled + bonus),
            })

    result = []
    for store in sorted(store_employees.keys()):
        employees = sorted(store_employees[store], key=lambda x: x['employee_total'], reverse=True)
        result.append({'store': store, 'employees': employees})

    return result


def build_employee_audit(enriched_shifts, employee_summaries):
    emp_shifts_by_store = {}
    for s in enriched_shifts:
        if not s['matched']:
            continue
        if s['name'] not in emp_shifts_by_store:
            emp_shifts_by_store[s['name']] = {}
        emp_shifts_by_store[s['name']][s['store']] = emp_shifts_by_store[s['name']].get(s['store'], [])
        emp_shifts_by_store[s['name']][s['store']].append({
            'date': s['dateStr'],
            'store': s['store'],
            'type': s['shiftType'],
            'base': s['basePay'],
            'residual': s['residualPay'],
        })

    result = []
    for e in employee_summaries:
        shifts = []
        emp_shifts = emp_shifts_by_store.get(e['name'], {})
        for store, store_shifts in emp_shifts.items():
            shifts.extend(store_shifts)

        shift_cost_by_store = {store: sum(s['base'] + s['residual'] for s in shifts_list)
                               for store, shifts_list in emp_shifts.items()}
        total_shift_cost = sum(shift_cost_by_store.values())
        scheduled_plus_bonus = total_shift_cost + e['bonusTotal'] - e['penaltyTotal']

        result.append({
            'name': e['name'],
            'role': e['role'],
            'shifts': sorted(shifts, key=lambda x: x['date']),
            'shift_cost_by_store': shift_cost_by_store,
            'scheduled': total_shift_cost,
            'bonus': e['bonusTotal'],
            'penalty': e['penaltyTotal'],
            'scheduled_plus_bonus': scheduled_plus_bonus,
            'employee_total': e['monthlyTotal'],
            'difference': e['monthlyTotal'] - scheduled_plus_bonus,
        })

    return result
