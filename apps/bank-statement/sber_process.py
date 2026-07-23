import pandas as pd

# ── Load ──────────────────────────────────────────────────────────────────────
raw = pd.read_excel('bank_statement.csv', header=None)
data = raw.iloc[11:].copy().reset_index(drop=True)

# ── Build clean dataframe ─────────────────────────────────────────────────────
df = pd.DataFrame({
    'date':        data[1],
    'debit_acct':  data[4],
    'credit_acct': data[8],
    'debit':       pd.to_numeric(data[9],  errors='coerce'),
    'credit':      pd.to_numeric(data[13], errors='coerce'),
    'doc_num':     data[14],
    'vo':          data[16],
    'bank':        data[17],
    'description': data[20],
})

df = df[df['date'].notna() & (df['debit'].notna() | df['credit'].notna())].copy()
df['date'] = pd.to_datetime(df['date'], errors='coerce')
df = df[df['date'].notna()].copy()

desc = df['description'].astype(str)

# ── Classify types ────────────────────────────────────────────────────────────
is_pos      = desc.str.contains('Зачисление средств по операциям эквайринга', case=False, na=False)
is_yandex   = df['debit_acct'].astype(str).str.contains(r'9705114405|Яндекс\.Еда', case=False, na=False)
is_salary   = desc.str.contains('Заработная плата по реестру', case=False, na=False)
is_purchase = desc.str.contains('PURCHASE', case=False, na=False) & df['debit'].notna()
is_return   = desc.str.contains('PURCHASE', case=False, na=False) & df['credit'].notna()
is_rent     = desc.str.contains('аренд', case=False, na=False)
is_tax      = desc.str.contains('Единый налоговый платеж|ЕНП|Взносы на обязательное страхование', case=False, na=False)
is_other    = desc.str.contains('Оплат', case=False, na=False)
is_bankfee  = desc.str.contains('Комиссия в другие банки', case=False, na=False)

# commission extracted from POS descriptions ("Комиссия 3.33.")
df['commission'] = pd.to_numeric(
    desc.str.extract(r'Комиссия\s+([\d.]+?)\.')[0], errors='coerce'
)
df.loc[~is_pos, 'commission'] = None

df['type'] = None
df.loc[is_pos,      'type'] = 'pos card'
df.loc[is_yandex,   'type'] = 'yandex food'
df.loc[is_salary,   'type'] = 'salary'
df.loc[is_purchase, 'type'] = 'purchase'
df.loc[is_return,   'type'] = 'return'
df.loc[is_rent,     'type'] = 'rent'
df.loc[is_tax,      'type'] = 'tax'
df.loc[is_other & df['type'].isna(), 'type'] = 'other payments'
df.loc[is_bankfee, 'type'] = 'bank fee'

df['value'] = None
df.loc[is_pos,      'value'] = df.loc[is_pos,      'credit']
df.loc[is_yandex,   'value'] = df.loc[is_yandex,   'credit']
df.loc[is_salary,   'value'] = df.loc[is_salary,   'debit']
df.loc[is_purchase, 'value'] = df.loc[is_purchase, 'debit']
df.loc[is_return,   'value'] = df.loc[is_return,   'credit']
df.loc[is_rent,     'value'] = df.loc[is_rent,     'debit']
df.loc[is_tax,      'value'] = df.loc[is_tax,      'debit']
df.loc[df['type'] == 'other payments', 'value'] = df.loc[df['type'] == 'other payments', 'debit']
df.loc[is_bankfee, 'value'] = df.loc[is_bankfee, 'debit']

# ── Save CSV ──────────────────────────────────────────────────────────────────
df.to_csv('sber_clean.csv', index=False, encoding='utf-8-sig')
print(f'Saved sber_clean.csv — {len(df)} rows')
print(df['type'].value_counts(dropna=False).to_string())

# ── Monthly summary ───────────────────────────────────────────────────────────
df['month'] = df['date'].dt.to_period('M')
months = sorted(df['month'].dropna().unique())
month_labels = {str(m): m.strftime('%B %Y') for m in months}

types_config = [
    # (type_key,         label,            bg,       color,    dot,       flow)
    # flow: 'in' = money received, 'out' = money spent
    ('pos card',       'POS Card Sales',  '#d1fae5', '#065f46', '#10b981', 'in'),
    ('pos commission', 'POS Commission',  '#fee2e2', '#991b1b', '#ef4444', 'out'),
    ('yandex food',    'Yandex.Food',     '#fef3c7', '#92400e', '#f59e0b', 'in'),
    ('salary',         'Salary',          '#eef2ff', '#3730a3', '#6366f1', 'out'),
    ('purchase',       'Purchase',        '#fce7f3', '#9d174d', '#ec4899', 'out'),
    ('return',         'Return',          '#f0fdf4', '#166534', '#22c55e', 'in'),
    ('rent',           'Rent',            '#fff7ed', '#9a3412', '#f97316', 'out'),
    ('tax',            'Tax',             '#f1f5f9', '#334155', '#64748b', 'out'),
    ('other payments', 'Other Payments',  '#faf5ff', '#6b21a8', '#a855f7', 'out'),
    ('bank fee',       'Bank Fee',        '#fefce8', '#713f12', '#eab308', 'out'),
]

# monthly value sums per type (commission is separate)
summary = df[df['type'].notna()].groupby(['month', 'type'])['value'].sum().unstack(fill_value=0)
commission_summary = df[is_pos].groupby('month')['commission'].sum()

def fmt(v):
    return f'{v:,.2f}' if v else '—'

# ── Build HTML rows ───────────────────────────────────────────────────────────
rows_html = ''
totals = {str(m): df[df['month'] == m]['credit'].sum() for m in months}

for type_key, label, bg, color, dot, flow in types_config:
    if type_key == 'pos commission':
        vals = [commission_summary.get(m, 0) for m in months]
    else:
        vals = [summary.get(type_key, pd.Series(dtype=float)).get(m, 0) for m in months]

    total = sum(vals)
    if total == 0:
        continue

    row_class = 'row-in' if flow == 'in' else 'row-out'
    val_class = 'val-in' if flow == 'in' else 'val-out'
    cells = ''.join(f'<td class="{val_class}">{fmt(v)}</td>' for v in vals)
    rows_html += f'''
      <tr class="{row_class}">
        <td><span class="badge" style="background:{bg};color:{color}">
          <span class="dot" style="background:{dot}"></span>{label}
        </span></td>
        {cells}
        <td class="{val_class} total-col">{fmt(total)}</td>
      </tr>'''

month_headers = ''.join(f'<th>{month_labels[str(m)]}</th>' for m in months)
total_cells   = ''.join(f'<td>{fmt(totals[str(m)])}</td>' for m in months)
grand_total   = fmt(sum(totals.values()))

# ── Write HTML ────────────────────────────────────────────────────────────────
html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sberbank Monthly Summary — Boba Café</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #f4f6f9; color: #1a1a2e; padding: 40px 24px;
    }}
    header {{ max-width: 860px; margin: 0 auto 36px; }}
    header h1 {{ font-size: 1.75rem; font-weight: 700; }}
    header p {{ font-size: 0.9rem; color: #6b7280; margin-top: 4px; }}
    .table-wrap {{
      max-width: 860px; margin: 0 auto 48px; background: #fff;
      border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden;
    }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.9rem; }}
    thead tr {{ background: #1a1a2e; color: #fff; }}
    thead th {{
      padding: 13px 20px; text-align: left; font-weight: 600;
      font-size: 0.78rem; text-transform: uppercase; letter-spacing: .05em;
    }}
    thead th:not(:first-child) {{ text-align: right; }}
    tbody tr:hover {{ background: #f0f4ff; }}
    tbody td {{ padding: 13px 20px; border-bottom: 1px solid #f0f0f0; }}
    tbody td:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .row-in  {{ border-left: 3px solid #10b981; }}
    .row-out {{ border-left: 3px solid #ef4444; }}
    .val-in  {{ color: #065f46; font-weight: 600; }}
    .val-out {{ color: #991b1b; font-weight: 600; }}
    .total-col {{ font-weight: 700; }}
    .legend {{ max-width: 860px; margin: 0 auto 24px; display: flex; gap: 20px; font-size: 0.82rem; color: #6b7280; }}
    .legend span {{ display: flex; align-items: center; gap: 6px; }}
    .legend-bar {{ width: 12px; height: 12px; border-radius: 2px; }}
    tfoot tr {{ background: #1a1a2e; color: #fff; }}
    tfoot td {{ padding: 14px 20px; font-weight: 700; font-size: 0.9rem; }}
    tfoot td:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .badge {{
      display: inline-flex; align-items: center; gap: 6px;
      border-radius: 6px; padding: 3px 10px; font-size: 0.78rem; font-weight: 600;
    }}
    .dot {{ width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }}
    .note {{ max-width: 860px; margin: -36px auto 0; font-size: 0.8rem; color: #9ca3af; line-height: 1.7; }}
  </style>
</head>
<body>
<header>
  <h1>Sberbank — Monthly Summary</h1>
  <p>Source: Sberbank statement · Currency: RUB</p>
</header>
<div class="legend">
  <span><span class="legend-bar" style="background:#10b981"></span>Money in</span>
  <span><span class="legend-bar" style="background:#ef4444"></span>Money out</span>
</div>
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Type</th>
        {month_headers}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>{rows_html}
    </tbody>
    <tfoot>
      <tr>
        <td>Total Received</td>
        {total_cells}
        <td>{grand_total}</td>
      </tr>
    </tfoot>
  </table>
</div>
<p class="note">
  <strong>POS Card Sales</strong>: "Зачисление средств по операциям эквайринга" — value = credit (net after fee).<br>
  <strong>POS Commission</strong>: fee extracted from description ("Комиссия …").<br>
  <strong>Yandex.Food</strong>: sender INN 9705114405 (ООО Яндекс.Еда) — value = credit.<br>
  <strong>Salary</strong>: "Заработная плата по реестру" — value = debit.<br>
  <strong>Purchase</strong>: card purchases (PURCHASE_CB) — value = debit.<br>
  <strong>Return</strong>: purchase returns/cancellations — value = credit.<br>
  <strong>Rent</strong>: description contains "аренд" — value = debit.<br>
  <strong>Tax</strong>: "Единый налоговый платеж" or "ЕНП" — value = debit.<br>
  <strong>Other Payments</strong>: description contains "Оплат" (rent takes priority if both match) — value = debit.
</p>
</body>
</html>'''

with open('sber_monthly.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Saved sber_monthly.html')
