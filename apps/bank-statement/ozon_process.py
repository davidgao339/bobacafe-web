import pandas as pd

# ── Load ──────────────────────────────────────────────────────────────────────
raw = pd.read_excel('ozon_statement.xlsx', header=None)
data = raw.iloc[13:].copy().reset_index(drop=True)

# ── Build clean dataframe ─────────────────────────────────────────────────────
# col3 = Дебет (outgoing), col4 = Кредит (incoming)
df = pd.DataFrame({
    'date':         data[1],
    'doc_num':      data[2],
    'debit':        pd.to_numeric(data[3], errors='coerce'),
    'credit':       pd.to_numeric(data[4], errors='coerce'),
    'counterparty': data[5],
    'account':      data[6],
    'description':  data[8],
})

# drop summary rows (both cols filled) and rows with no amount
df = df[df['date'].notna() & (df['debit'].notna() ^ df['credit'].notna())].copy()
df['date'] = pd.to_datetime(df['date'], dayfirst=True, errors='coerce')
df = df[df['date'].notna()].copy()

desc = df['description'].astype(str)

# ── Classify types ────────────────────────────────────────────────────────────
is_ozon_orders = desc.str.contains('Оплата по заказу', case=False, na=False)
is_purchase    = desc.str.contains('бизнес карте', case=False, na=False)
is_return      = desc.str.contains('Возврат', case=False, na=False)
is_rent        = desc.str.contains('аренд', case=False, na=False)
is_bankfee     = desc.str.contains('Комиссия за исполнение', case=False, na=False)
is_other       = desc.str.contains('Оплат|Услуги по доставке воды', case=False, na=False)

df['type'] = None
df.loc[is_ozon_orders, 'type'] = 'ozon orders'
df.loc[is_purchase,    'type'] = 'purchase'
df.loc[is_return,      'type'] = 'return'
df.loc[is_rent,        'type'] = 'rent'
df.loc[is_bankfee,     'type'] = 'bank fee'
df.loc[is_other & df['type'].isna(), 'type'] = 'other payments'

df['value'] = None
df.loc[df['type'] == 'ozon orders',    'value'] = df.loc[df['type'] == 'ozon orders',    'debit']
df.loc[df['type'] == 'purchase',       'value'] = df.loc[df['type'] == 'purchase',       'debit']
df.loc[df['type'] == 'return',         'value'] = df.loc[df['type'] == 'return',         'credit']
df.loc[df['type'] == 'rent',           'value'] = df.loc[df['type'] == 'rent',           'debit']
df.loc[df['type'] == 'bank fee',       'value'] = df.loc[df['type'] == 'bank fee',       'debit']
df.loc[df['type'] == 'other payments', 'value'] = df.loc[df['type'] == 'other payments', 'debit']

# ── Save CSV ──────────────────────────────────────────────────────────────────
df.to_csv('ozon_clean.csv', index=False, encoding='utf-8-sig')
print(f'Saved ozon_clean.csv — {len(df)} rows')
print(df['type'].value_counts(dropna=False).to_string())

# ── Monthly summary ───────────────────────────────────────────────────────────
df['month'] = df['date'].dt.to_period('M')
months = sorted(df['month'].dropna().unique())
month_labels = {str(m): m.strftime('%B %Y') for m in months}

types_config = [
    # (type_key,       label,            bg,       color,    dot,       flow)
    ('ozon orders',  'Ozon Orders',    '#e0f2fe', '#075985', '#0ea5e9', 'out'),
    ('purchase',     'Purchase',       '#fce7f3', '#9d174d', '#ec4899', 'out'),
    ('return',       'Return',         '#f0fdf4', '#166534', '#22c55e', 'in'),
    ('rent',         'Rent',           '#fff7ed', '#9a3412', '#f97316', 'out'),
    ('bank fee',     'Bank Fee',       '#fefce8', '#713f12', '#eab308', 'out'),
    ('other payments','Other Payments','#faf5ff', '#6b21a8', '#a855f7', 'out'),
]

summary = df[df['type'].notna()].groupby(['month', 'type'])['value'].sum().unstack(fill_value=0)
totals  = {str(m): df[df['month'] == m]['credit'].sum() for m in months}

def fmt(v):
    return f'{v:,.2f}' if v else '—'

# ── Build HTML rows ───────────────────────────────────────────────────────────
rows_html = ''
for type_key, label, bg, color, dot, flow in types_config:
    vals  = [summary.get(type_key, pd.Series(dtype=float)).get(m, 0) for m in months]
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
  <title>Ozon Bank — Monthly Summary</title>
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
    tfoot tr {{ background: #1a1a2e; color: #fff; }}
    tfoot td {{ padding: 14px 20px; font-weight: 700; font-size: 0.9rem; }}
    tfoot td:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .badge {{
      display: inline-flex; align-items: center; gap: 6px;
      border-radius: 6px; padding: 3px 10px; font-size: 0.78rem; font-weight: 600;
    }}
    .dot {{ width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }}
    .row-in  {{ border-left: 3px solid #10b981; }}
    .row-out {{ border-left: 3px solid #ef4444; }}
    .val-in  {{ color: #065f46; font-weight: 600; }}
    .val-out {{ color: #991b1b; font-weight: 600; }}
    .total-col {{ font-weight: 700; }}
    .legend {{ max-width: 860px; margin: 0 auto 24px; display: flex; gap: 20px; font-size: 0.82rem; color: #6b7280; }}
    .legend span {{ display: flex; align-items: center; gap: 6px; }}
    .legend-bar {{ width: 12px; height: 12px; border-radius: 2px; }}
    .note {{ max-width: 860px; margin: -36px auto 0; font-size: 0.8rem; color: #9ca3af; line-height: 1.7; }}
  </style>
</head>
<body>
<header>
  <h1>Ozon Bank — Monthly Summary</h1>
  <p>Source: Ozon Bank statement · Currency: RUB</p>
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
  <strong>Ozon Orders</strong>: "Оплата по заказу" — value = debit.<br>
  <strong>Purchase</strong>: business card transactions ("бизнес карте") — value = debit.<br>
  <strong>Return</strong>: "Возврат" — value = credit.<br>
  <strong>Rent</strong>: description contains "аренд" — value = debit.<br>
  <strong>Bank Fee</strong>: "Комиссия за исполнение" — value = debit.<br>
  <strong>Other Payments</strong>: description contains "Оплат" (rent takes priority) — value = debit.
</p>
</body>
</html>'''

with open('ozon_monthly.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Saved ozon_monthly.html')
