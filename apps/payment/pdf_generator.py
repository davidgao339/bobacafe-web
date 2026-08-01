import io
import zipfile
from fpdf import FPDF
import os

FONT_PATH = os.path.join(os.path.dirname(__file__), 'fonts', 'Roboto-Regular.ttf')

def _get_city(store_name):
    s = store_name.lower()
    if 'краснодар' in s or 'оз мол' in s or 'галерея' in s:
        return 'Краснодар'
    return 'Новороссийск'

def generate_single_pdf(summaries, half):
    """
    Generates a single PDF containing payouts for all cities (each city starts on a new page).
    half: 1 or 2
    summaries: List of employee dictionaries from calculate_payroll
    """
    pay_key = 'toPayH1' if half == 1 else 'toPayH2'
    
    # Filter and group by City -> Store
    grouped = {}
    for e in summaries:
        amt = float(e.get(pay_key, 0.0))
        if amt == 0:
            continue
            
        store = str(e.get('preferableStore') or '').strip()
        if not store:
            store = 'Unknown'
            
        city = _get_city(store)
        
        if city not in grouped:
            grouped[city] = {}
        if store not in grouped[city]:
            grouped[city][store] = []
            
        grouped[city][store].append({'name': e['name'], 'amount': amt})
        
    # Generate 1 PDF
    pdf = FPDF()
    pdf.add_font('Roboto', '', FONT_PATH, uni=True)
    
    for city in sorted(grouped.keys()):
        stores = grouped[city]
        
        pdf.add_page()
        pdf.set_font('Roboto', '', 14)
        
        # Title
        pdf.cell(0, 10, f"Выплаты - {city} (H{half})", ln=True, align='C')
        pdf.ln(5)
        
        pdf.set_font('Roboto', '', 10)
        
        for store in sorted(stores.keys()):
            employees = sorted(stores[store], key=lambda x: x['name'])
            store_total = sum(x['amount'] for x in employees)
            
            # Store Header
            pdf.set_fill_color(220, 230, 241) # Light blue header
            pdf.cell(110, 8, store, border=1, fill=True)
            pdf.cell(40, 8, f"{store_total:,.0f}", border=1, ln=True, align='R', fill=True)
            
            # Employees
            for emp in employees:
                pdf.cell(110, 8, emp['name'], border=1)
                pdf.cell(40, 8, f"{emp['amount']:,.0f}", border=1, ln=True, align='R')
                
            pdf.ln(5)
            
    # Write to buffer
    buf = io.BytesIO()
    pdf.output(buf)
    return buf.getvalue()
