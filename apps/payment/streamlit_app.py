import csv
import io

import streamlit as st

import config
from data_access import (read_bonuses_raw, read_employees_raw, read_paid_raw,
                          read_salary_raw, read_schedule_raw)
from payroll import (build_payment_rows, build_verification_rows,
                     calculate_payroll, calculate_verification,
                     enrich_shifts, parse_bonus_data, parse_paid_data,
                     parse_schedule_data, build_employee_map, build_salary_map,
                     build_difference_waterfall, build_store_audit, build_employee_audit)
from pdf_generator import generate_single_pdf
from tests import run_all_tests

st.set_page_config(page_title='Boba Rabbit — Payroll', layout='wide')

# ── Auth gate ─────────────────────────────────────────────────────────────────

if 'auth_ok' not in st.session_state:
    st.title('Boba Rabbit — Payroll Calculator')
    
    with st.form("login_form"):
        pwd = st.text_input('Enter PIN', type='password')
        submitted = st.form_submit_button('Unlock')
        if submitted:
            # Multiple valid PINs (Manager: 2372, Master: 7530, Legacy: 5566)
            valid_pins = ["2372", "5566", "7530"]
            if st.secrets.get("APP_PIN"):
                valid_pins.append(st.secrets.get("APP_PIN"))
                
            if pwd in valid_pins:
                st.session_state['auth_ok'] = True
                st.rerun()
            else:
                st.error('Incorrect PIN')
    st.stop()

# ── Sidebar ───────────────────────────────────────────────────────────────────

MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December']

from datetime import date as _date
_today = _date.today()

with st.sidebar:
    st.title('Boba Rabbit')
    st.divider()
    month = st.selectbox('Month', range(1, 13),
                          format_func=lambda m: MONTHS[m - 1],
                          index=_today.month - 1)
    year = st.number_input('Year', min_value=2020, max_value=2100,
                            value=_today.year, step=1)
    st.divider()
    calc_btn      = st.button('Calculate', type='primary', use_container_width=True)
    run_tests_btn = st.button('Run Tests', use_container_width=True)
    st.divider()
    with st.expander('Data sources'):
        for label, url in config.SHEET_LINKS.items():
            st.markdown(f'[{label}]({url})')
    st.divider()
    if st.button('Lock App', use_container_width=True):
        st.session_state.pop('auth_ok', None)
        st.rerun()

# ── Header ────────────────────────────────────────────────────────────────────

st.title('Payroll Calculator')

# ── Tests ─────────────────────────────────────────────────────────────────────

if run_tests_btn:
    with st.spinner('Running tests...'):
        results = run_all_tests()
    passed = sum(1 for r in results if r['passed'])
    if passed == len(results):
        st.success(f'Tests: {passed}/{len(results)} passed')
    else:
        st.error(f'Tests: {passed}/{len(results)} passed')
    for r in results:
        icon = '✅' if r['passed'] else '❌'
        st.write(f'{icon} **{r["name"]}**')
        for d in r.get('details', []):
            st.caption(f'  {d}')

# ── Calculate ─────────────────────────────────────────────────────────────────

if calc_btn:
    with st.spinner('Loading data and calculating...'):
        try:
            raw_schedule  = read_schedule_raw()
            raw_employees = read_employees_raw()
            raw_salary    = read_salary_raw()
            raw_bonuses   = read_bonuses_raw()
            raw_paid      = read_paid_raw()

            shifts, warnings = parse_schedule_data(raw_schedule, int(month), int(year))
            employee_map, emp_warnings = build_employee_map(raw_employees)
            warnings.extend(emp_warnings)
            salary_map       = build_salary_map(raw_salary)
            enriched         = enrich_shifts(shifts, employee_map, salary_map)
            unmatched        = [s for s in enriched if not s['matched']]
            bonuses          = parse_bonus_data(raw_bonuses, int(month), int(year))
            paid             = parse_paid_data(raw_paid, int(month))
            summaries        = calculate_payroll(enriched, bonuses, paid)
            verification     = calculate_verification(enriched, summaries)
            waterfall        = build_difference_waterfall(enriched, summaries, bonuses, unmatched)
            store_audit      = build_store_audit(enriched, summaries)
            employee_audit   = build_employee_audit(enriched, summaries)

            st.session_state['calc'] = {
                'shifts': shifts, 'warnings': warnings,
                'employee_map': employee_map,
                'enriched': enriched, 'unmatched': unmatched,
                'bonuses': bonuses, 'paid': paid,
                'summaries': summaries, 'verification': verification,
                'waterfall': waterfall, 'store_audit': store_audit, 'employee_audit': employee_audit,
                'month': int(month), 'year': int(year),
            }
        except Exception as e:
            import traceback
            st.error(f'Error: {e}')
            st.code(traceback.format_exc())

# ── Results ───────────────────────────────────────────────────────────────────

if 'calc' not in st.session_state:
    st.stop()

c = st.session_state['calc']
warn_count = len(c['warnings']) + len(c['unmatched'])

if warn_count:
    st.info(f"Done: {len(c['summaries'])} employees, {warn_count} warning(s)")
else:
    st.success(f"Done: {len(c['summaries'])} employees, no warnings")

# Panel 1 — Schedule
h1_count = sum(1 for s in c['shifts'] if s['half'] == 1)
h2_count = sum(1 for s in c['shifts'] if s['half'] == 2)
with st.expander(f"1 · Schedule — {len(c['shifts'])} shifts (H1: {h1_count}, H2: {h2_count})"):
    if c['warnings']:
        st.warning('\n'.join(c['warnings']))
    st.dataframe(c['shifts'], use_container_width=True)

# Panel 2 — Matching
with st.expander(f"2 · Data Matching — {len(c['employee_map'])} employees in DB, {len(c['unmatched'])} unmatched",
                  expanded=len(c['unmatched']) > 0):
    if c['unmatched']:
        st.error(f"Not found in database ({len(c['unmatched'])}):")
        st.dataframe(c['unmatched'], use_container_width=True)
        st.divider()
    col_b, col_p = st.columns(2)
    with col_b:
        st.write(f"**Bonuses / Penalties ({len(c['bonuses'])})**")
        st.dataframe(c['bonuses'] if c['bonuses'] else [], use_container_width=True)
    with col_p:
        st.write(f"**Already Paid ({len(c['paid'])})**")
        st.dataframe(c['paid'] if c['paid'] else [], use_container_width=True)

# Panel 3 — H1
total_h1 = sum(e['toPayH1'] for e in c['summaries'])
with st.expander(f"3 · First Half (days 1–15) — To pay: {total_h1:,.0f}"):
    st.dataframe([{
        'Name': e['name'], 'Store': e['preferableStore'], 'Role': e['role'],
        'Half': e['halfShiftsH1'], 'Full': e['fullShiftsH1'], 'Helper': e['helperShiftsH1'],
        'Base H1': e['baseH1'], 'Residual H1': e['residualH1'],
        'Bonus': e['bonusTotal'], 'Penalty': e['penaltyTotal'],
        'TO PAY H1': e['toPayH1'],
    } for e in c['summaries']], use_container_width=True)

# Panel 4 — H2
total_h2  = sum(e['toPayH2'] for e in c['summaries'])
total_ove = sum(e['overpayment'] for e in c['summaries'])
h2_label  = f"4 · Second Half (days 16–end) — To pay: {total_h2:,.0f}"
if total_ove:
    h2_label += f"  ·  Overpayment: {total_ove:,.0f}"
with st.expander(h2_label):
    st.dataframe([{
        'Name': e['name'], 'Store': e['preferableStore'],
        'Base H2': e['baseH2'], 'Residual H2': e['residualH2'], 'Residual H1': e['residualH1'],
        'Earned': e['monthlyEarned'], 'Total (adj.)': e['monthlyTotal'],
        'Already Paid': e['paidAlready'], 'TO PAY H2': e['toPayH2'],
        'Overpayment': e['overpayment'],
    } for e in c['summaries']], use_container_width=True)

# Panel 5 — Verification
v        = c['verification']
t        = v['totals']
has_diff = t['diff'] != 0
v_label  = f"5 · Verification — Schedule: {t['scheduleCost']:,.0f}  ·  Employees: {t['employeeCost']:,.0f}"
if has_diff:
    v_label += f"  ·  Diff: {t['diff']:,.0f}"
with st.expander(v_label, expanded=has_diff):
    col1, col2, col3 = st.columns(3)
    col1.metric('By Schedule', f"{t['scheduleCost']:,.0f}")
    col2.metric('By Employee', f"{t['employeeCost']:,.0f}")
    col3.metric('Adjustment', f"{t['diff']:,.0f}", delta_color='inverse' if t['diff'] != 0 else 'off')

# Panel 6 — Difference Waterfall
w = c['waterfall']
with st.expander("6 · Difference Breakdown"):
    st.write("**Where the difference comes from:**")
    col1, col2 = st.columns(2)
    with col1:
        st.metric('Schedule Cost', f"{w['schedule_cost']:,.0f}")
        st.metric('+ Bonuses', f"{w['bonuses']:,.0f}")
        st.metric('- Penalties', f"{w['penalties']:,.0f}")
    with col2:
        subtotal = w['schedule_cost'] + w['bonuses'] - w['penalties']
        st.metric('= Subtotal', f"{subtotal:,.0f}")
        st.metric('+ Unmatched', f"{w['unmatched_cost']:,.0f}")

    st.divider()
    col1, col2 = st.columns(2)
    with col1:
        st.metric('Schedule + Bonuses', f"{subtotal:,.0f}")
    with col2:
        st.metric('Employee Cost', f"{w['employee_cost']:,.0f}")

    if abs(subtotal - w['employee_cost']) < 0.01:
        st.success('✓ Calculations match perfectly')
    else:
        diff = w['employee_cost'] - subtotal
        st.warning(f"Difference: {diff:,.0f}")

# Panel 7 — Detailed Verification
with st.expander("7 · Detailed Verification by Store"):
    audit_data = []
    for store_info in c['store_audit']:
        store = store_info['store']
        v_row = next((r for r in c['verification']['rows'] if r['store'] == store), None)
        if v_row:
            scheduled = v_row['scheduleCost']
            employee_total = v_row['employeeCost']
            bonus_total = sum(e['bonus'] for e in store_info['employees'])
            scheduled_plus_bonus = scheduled + bonus_total
            audit_data.append({
                'Store': store,
                'Scheduled': f"{scheduled:,.0f}",
                'Bonus': f"{bonus_total:,.0f}",
                'Scheduled+Bonus': f"{scheduled_plus_bonus:,.0f}",
                'Employee Total': f"{employee_total:,.0f}",
                'Difference': f"{employee_total - scheduled_plus_bonus:,.0f}",
            })
    if audit_data:
        st.dataframe(audit_data, use_container_width=True)

# Panel 8 — Per-Store Audit
with st.expander("8 · Store Breakdown (Employees by Store)"):
    store_select = st.selectbox('Select Store', [s['store'] for s in c['store_audit']], key='store_select')
    store_info = next((s for s in c['store_audit'] if s['store'] == store_select), None)
    if store_info:
        st.write(f"**{store_select}** — {len(store_info['employees'])} employees")
        emp_data = [{
            'Name': e['name'],
            'Scheduled': f"{e['scheduled']:,.0f}",
            'Bonus': f"{e['bonus']:,.0f}",
            'Scheduled+Bonus': f"{e['scheduled_plus_bonus']:,.0f}",
            'Employee Total': f"{e['employee_total']:,.0f}",
            'Difference': f"{e['difference']:,.0f}",
        } for e in store_info['employees']]
        st.dataframe(emp_data, use_container_width=True)

# Panel 9 — Employee Detail
with st.expander("9 · Employee Detail"):
    emp_select = st.selectbox('Select Employee', [e['name'] for e in c['employee_audit']], key='emp_select')
    emp_info = next((e for e in c['employee_audit'] if e['name'] == emp_select), None)
    if emp_info:
        col1, col2 = st.columns(2)
        with col1:
            st.metric('Role', emp_info['role'])
            col_a, col_b = st.columns(2)
            col_a.metric('Scheduled', f"{emp_info['scheduled']:,.0f}")
            col_b.metric('Bonus', f"{emp_info['bonus']:,.0f}")
        with col2:
            col_c, col_d = st.columns(2)
            col_c.metric('Scheduled+Bonus', f"{emp_info['scheduled_plus_bonus']:,.0f}")
            col_d.metric('Employee Total', f"{emp_info['employee_total']:,.0f}")

        if abs(emp_info['difference']) > 0.01:
            st.warning(f"Difference: {emp_info['difference']:,.0f}")
        else:
            st.success("✓ Matches")

        st.subheader('Shifts by Store')
        store_breakdown = []
        for store, cost in sorted(emp_info['shift_cost_by_store'].items(), key=lambda x: x[1], reverse=True):
            store_breakdown.append({
                'Store': store,
                'Scheduled': f"{cost:,.0f}",
                '% of Total': f"{(cost/emp_info['scheduled']*100) if emp_info['scheduled'] else 0:.1f}%",
            })
        if store_breakdown:
            st.dataframe(store_breakdown, use_container_width=True)

        st.subheader('Individual Shifts')
        if emp_info['shifts']:
            st.dataframe([{
                'Date': s['date'],
                'Store': s['store'],
                'Type': s['type'],
                'Base': f"{s['base']:,.0f}",
                'Residual': f"{s['residual']:,.0f}",
            } for s in emp_info['shifts']], use_container_width=True)

# Panel 10 — Manager Printouts
with st.expander("10 · Manager Payout Sheets (PDF)"):
    st.write("**Generate printable PDFs for managers to dispense cash.**")
    
    half_choice = st.radio("Select which half to generate payouts for:", ["H1 (Days 1-15)", "H2 (Days 16-end)"], horizontal=True)
    target_half = 1 if "H1" in half_choice else 2
    
    pdf_bytes = generate_single_pdf(c['summaries'], target_half)
    st.download_button(
        label=f'⬇️ Download Payout PDF ({half_choice})',
        data=pdf_bytes,
        file_name=f'Manager_Payouts_H{target_half}_{c["year"]}_{c["month"]:02d}.pdf',
        mime='application/pdf'
    )

# ── Downloads ─────────────────────────────────────────────────────────────────

def _to_csv(rows):
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return buf.getvalue().encode('utf-8-sig')

m, y = c['month'], c['year']
payment_csv      = _to_csv(build_payment_rows(c['summaries']))
verification_csv = _to_csv(build_verification_rows(c['verification']))

st.divider()
dl1, dl2 = st.columns(2)
with dl1:
    st.download_button('Download Payment CSV', payment_csv,
                        file_name=f'payment_{y}_{m:02d}.csv', mime='text/csv')
with dl2:
    st.download_button('Download Verification CSV', verification_csv,
                        file_name=f'verification_{y}_{m:02d}.csv', mime='text/csv')
