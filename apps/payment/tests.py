from datetime import datetime
from payroll import (
    parse_schedule_data, build_employee_map, build_salary_map,
    enrich_shifts, parse_bonus_data, parse_paid_data,
    calculate_payroll, calculate_verification,
)

# ── Sample data ───────────────────────────────────────────────────────────────
# Dates as strings (ISO) — matches what gspread returns after UNFORMATTED serial conversion

T_SCHEDULE = [
    ['Дата', 'Бон Пассаж - День', 'Бон Пассаж - Ночь', 'Советов - День', 'Советов - Ночь', 'Советов - Помощь'],
    ['2026-04-01', 'Бучнева Мария',  'Бучнева Мария',        'Нарожняя Ангелина',     'Могильников Александр', ''],
    ['2026-04-02', 'Скворцова Мария', '',                     'Нарожняя Ангелина',     'Могильников Александр', 'Скворцова Мария'],
    ['2026-04-03', '—',              '',                      'Нарожняя Ангелина',     '',                      ''],
    ['2026-04-16', 'Бучнева Мария',  '',                     'Нарожняя Ангелина',     '',                      ''],
    ['2026-04-17', 'Бучнева Мария',  'Бучнева Мария',        'Могильников Александр', '',                      ''],
]

T_EMPLOYEES = [
    ['full_name',              'preferable_store', 'role'],
    ['Бучнева Мария',          'Бон Пассаж',       'бариста'],
    ['Нарожняя Ангелина',      'Советов',          'бариста'],
    ['Могильников Александр',  'Советов',          'бариста'],
    ['Скворцова Мария',        'Бон Пассаж',       'бариста'],
]

T_SALARY = [
    ['role',    'base half', 'residual half', 'helper'],
    ['бариста', 650,          250,             800],
]

T_BONUSES = [
    ['Timestamp',         'Имя сотрудника',      'За какой месяц', 'Тип',      'Сумма', 'Комментарий'],
    ['2026-04-05 10:00', 'Нарожняя Ангелина',   '04',              'добавка',   500,    'Тест бонус'],
    ['2026-04-05 10:01', 'Скворцова Мария',      '04',              'вычет',     100,    'Тест штраф'],
]

T_PAID = [
    ['имя',             'кафе',       'сумма', 'месяц', 'half'],
    ['Бучнева Мария',   'Бон Пассаж', 1950,    4,       'first'],
]


# ── Test runner ───────────────────────────────────────────────────────────────

def run_all_tests():
    suite = [
        test_parse_schedule,
        test_build_employee_map,
        test_build_salary_map,
        test_enrich_shifts_matched,
        test_enrich_shifts_unmatched,
        test_parse_bonus_data,
        test_parse_paid_data,
        test_h1_calculation,
        test_h2_calculation,
        test_verification,
    ]

    results = []
    for fn in suite:
        try:
            results.append(fn())
        except Exception as e:
            results.append({'name': fn.__name__, 'passed': False, 'details': [str(e)]})

    passed = sum(1 for r in results if r['passed'])
    print(f'\n=== {passed}/{len(results)} tests passed ===\n')
    for r in results:
        print(f"{'✓' if r['passed'] else '✗'} {r['name']}")
        for d in r.get('details', []):
            print(f'    {d}')

    return results


def _assert(name, checks):
    failed = [msg for ok, msg in checks if not ok]
    return {'name': name, 'passed': len(failed) == 0, 'details': failed}


# ── Individual tests ──────────────────────────────────────────────────────────

def test_parse_schedule():
    shifts, warnings = parse_schedule_data(T_SCHEDULE, 4, 2026)
    h1 = [s for s in shifts if s['half'] == 1]
    h2 = [s for s in shifts if s['half'] == 2]
    return _assert('test_parse_schedule', [
        (len(shifts) == 14,              f'expected 14 shifts, got {len(shifts)}'),
        (len(h1) == 9,                   f'expected 9 H1, got {len(h1)}'),
        (len(h2) == 5,                   f'expected 5 H2, got {len(h2)}'),
        (not any(s['name'] == '—' for s in shifts), 'skip value — must not appear'),
        (any(s['shiftType'] == 'Помощь' for s in shifts), 'Помощь shifts should be present'),
        (all(s['store'] and s['shiftType'] for s in shifts), 'every shift must have store and shiftType'),
    ])


def test_build_employee_map():
    m = build_employee_map(T_EMPLOYEES)
    return _assert('test_build_employee_map', [
        (len(m) == 4,                                    'expected 4 employees'),
        (m['Бучнева Мария']['role'] == 'бариста',        'Бучнева role'),
        (m['Бучнева Мария']['preferable_store'] == 'Бон Пассаж', 'Бучнева store'),
        ('' not in m,                                    'empty key must not exist'),
    ])


def test_build_salary_map():
    m = build_salary_map(T_SALARY)
    return _assert('test_build_salary_map', [
        ('бариста' in m,                  'бариста rate exists'),
        (m['бариста']['baseHalf'] == 650, 'бариста baseHalf'),
        (m['бариста']['residualHalf'] == 250, 'бариста residualHalf'),
        (m['бариста']['helper'] == 800,   'бариста helper'),
    ])


def test_enrich_shifts_matched():
    shifts   = parse_schedule_data(T_SCHEDULE, 4, 2026)[0]
    enriched = enrich_shifts(shifts, build_employee_map(T_EMPLOYEES), build_salary_map(T_SALARY))
    helpers  = [s for s in enriched if s.get('shiftCategory') == 'helper']
    halves   = [s for s in enriched if s.get('shiftCategory') == 'half']
    return _assert('test_enrich_shifts_matched', [
        (all(s['matched'] for s in enriched),  'all sample shifts should match'),
        (len(helpers) == 1,                    f'expected 1 helper, got {len(helpers)}'),
        (helpers[0]['basePay'] == 800,         'helper basePay = 800'),
        (helpers[0]['residualPay'] == 0,       'helper residualPay = 0'),
        (halves[0]['basePay'] == 650,          'half basePay = 650'),
        (halves[0]['residualPay'] == 250,      'half residualPay = 250'),
    ])


def test_enrich_shifts_unmatched():
    unknown = [{'name': 'Неизвестный Сотрудник', 'dateStr': '2026-04-01', 'day': 1,
                'store': 'X', 'shiftType': 'День', 'half': 1}]
    result = enrich_shifts(unknown, build_employee_map(T_EMPLOYEES), build_salary_map(T_SALARY))
    return _assert('test_enrich_shifts_unmatched', [
        (result[0]['matched'] == False,      'unknown employee should not match'),
        (result[0]['error'] == 'NOT_IN_DB',  'error should be NOT_IN_DB'),
    ])


def test_parse_bonus_data():
    bonuses = parse_bonus_data(T_BONUSES, 4, 2026)
    wrong   = parse_bonus_data(T_BONUSES, 3, 2026)
    return _assert('test_parse_bonus_data', [
        (len(bonuses) == 2,                 'expected 2 bonus entries'),
        (bonuses[0]['type'] == 'добавка',   'first entry type'),
        (bonuses[0]['amount'] == 500,       'first entry amount'),
        (bonuses[1]['type'] == 'вычет',     'second entry type'),
        (bonuses[1]['amount'] == 100,       'second entry amount'),
        (len(wrong) == 0,                   'wrong month returns empty'),
    ])


def test_parse_paid_data():
    paid  = parse_paid_data(T_PAID, 4)
    wrong = parse_paid_data(T_PAID, 3)
    return _assert('test_parse_paid_data', [
        (len(paid) == 1,                          'expected 1 paid record'),
        (paid[0]['name'] == 'Бучнева Мария',      'paid name'),
        (paid[0]['amount'] == 1950,               'paid amount'),
        (len(wrong) == 0,                         'wrong month returns empty'),
    ])


def test_h1_calculation():
    shifts    = parse_schedule_data(T_SCHEDULE, 4, 2026)[0]
    enriched  = enrich_shifts(shifts, build_employee_map(T_EMPLOYEES), build_salary_map(T_SALARY))
    bonuses   = parse_bonus_data(T_BONUSES, 4, 2026)
    summaries = calculate_payroll(enriched, bonuses, [])
    by_name   = {e['name']: e for e in summaries}
    return _assert('test_h1_calculation', [
        (by_name['Бучнева Мария']['baseH1']            == 1300, f"Бучнева baseH1: {by_name['Бучнева Мария']['baseH1']}"),
        (by_name['Бучнева Мария']['toPayH1']           == 1300, f"Бучнева toPayH1: {by_name['Бучнева Мария']['toPayH1']}"),
        (by_name['Нарожняя Ангелина']['baseH1']        == 1950, f"Нарожняя baseH1: {by_name['Нарожняя Ангелина']['baseH1']}"),
        (by_name['Нарожняя Ангелина']['toPayH1']       == 2450, f"Нарожняя toPayH1: {by_name['Нарожняя Ангелина']['toPayH1']}"),
        (by_name['Могильников Александр']['toPayH1']   == 1300, f"Могильников toPayH1: {by_name['Могильников Александр']['toPayH1']}"),
        (by_name['Скворцова Мария']['baseH1']          == 1450, f"Скворцова baseH1: {by_name['Скворцова Мария']['baseH1']}"),
        (by_name['Скворцова Мария']['toPayH1']         == 1350, f"Скворцова toPayH1: {by_name['Скворцова Мария']['toPayH1']}"),
    ])


def test_h2_calculation():
    shifts    = parse_schedule_data(T_SCHEDULE, 4, 2026)[0]
    enriched  = enrich_shifts(shifts, build_employee_map(T_EMPLOYEES), build_salary_map(T_SALARY))
    bonuses   = parse_bonus_data(T_BONUSES, 4, 2026)
    paid      = parse_paid_data(T_PAID, 4)
    summaries = calculate_payroll(enriched, bonuses, paid)
    by_name   = {e['name']: e for e in summaries}
    return _assert('test_h2_calculation', [
        (by_name['Бучнева Мария']['toPayH2']         == 2550, f"Бучнева toPayH2: {by_name['Бучнева Мария']['toPayH2']}"),
        (by_name['Бучнева Мария']['monthlyTotal']    == 4500, f"Бучнева monthly: {by_name['Бучнева Мария']['monthlyTotal']}"),
        (by_name['Нарожняя Ангелина']['toPayH2']     == 4100, f"Нарожняя toPayH2: {by_name['Нарожняя Ангелина']['toPayH2']}"),
        (by_name['Могильников Александр']['toPayH2'] == 2700, f"Могильников toPayH2: {by_name['Могильников Александр']['toPayH2']}"),
        (by_name['Скворцова Мария']['toPayH2']       == 1600, f"Скворцова toPayH2: {by_name['Скворцова Мария']['toPayH2']}"),
        (by_name['Бучнева Мария']['overpayment']     == 0,    'Бучнева no overpayment'),
    ])


def test_verification():
    shifts    = parse_schedule_data(T_SCHEDULE, 4, 2026)[0]
    enriched  = enrich_shifts(shifts, build_employee_map(T_EMPLOYEES), build_salary_map(T_SALARY))
    summaries = calculate_payroll(enriched, parse_bonus_data(T_BONUSES, 4, 2026), [])
    result    = calculate_verification(enriched, summaries)
    by_store  = {r['store']: r for r in result['rows']}
    totals    = result['totals']
    return _assert('test_verification', [
        (by_store['Бон Пассаж']['scheduleCost'] == 5400, f"Бон Пассаж schedule: {by_store['Бон Пассаж']['scheduleCost']}"),
        (by_store['Советов']['scheduleCost']    == 7100, f"Советов schedule: {by_store['Советов']['scheduleCost']}"),
        (by_store['Бон Пассаж']['employeeCost'] == 6100, f"Бон Пассаж employee: {by_store['Бон Пассаж']['employeeCost']}"),
        (by_store['Советов']['employeeCost']    == 6800, f"Советов employee: {by_store['Советов']['employeeCost']}"),
        (totals['scheduleCost'] == 12500,                f"total schedule: {totals['scheduleCost']}"),
        (totals['employeeCost'] == 12900,                f"total employee: {totals['employeeCost']}"),
    ])


if __name__ == '__main__':
    run_all_tests()
