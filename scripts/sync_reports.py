"""
Sync Reports script for bobacafe-web
Copies generated reports from boba-cafe-databricks into site/internal/reports/
and rebuilds index.html with Neo-Editorial styling.
"""
import os
import re
import shutil

RU_MONTHS_GEN = {
    "01": "января", "02": "февраля", "03": "марта",    "04": "апреля",
    "05": "мая",    "06": "июня",    "07": "июля",     "08": "августа",
    "09": "сентября", "10": "октября", "11": "ноября", "12": "декабря"
}
RU_MONTHS_NOM = {
    "01": "Январь", "02": "Февраль", "03": "Март",    "04": "Апрель",
    "05": "Май",    "06": "Июнь",    "07": "Июль",   "08": "Август",
    "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь"
}

def sync_reports():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dest_dir = os.path.join(script_dir, "..", "site", "internal", "reports")
    
    # Possible source directories in boba-cafe-databricks
    databricks_sources = [
        os.path.join(script_dir, "..", "..", "boba-cafe-databricks", "weekly-analysis", "analysis-html"),
        os.path.join(script_dir, "..", "..", "boba-cafe-databricks", "docs", "internal", "weekly", "archive"),
        os.path.join(script_dir, "..", "..", "boba-cafe-databricks", "docs", "internal", "reports", "archive"),
    ]

    os.makedirs(dest_dir, exist_ok=True)

    # 1. Copy any newly generated reports into site/internal/reports/
    for src in databricks_sources:
        if os.path.exists(src):
            for fname in os.listdir(src):
                if fname.endswith(".html") and fname != "index.html":
                    src_file = os.path.join(src, fname)
                    # Normalize naming: if it's YYYY-MM-DD.html, name it YYYY-MM-DD_weekly_report.html
                    if re.match(r"^\d{4}-\d{2}-\d{2}\.html$", fname):
                        target_name = fname.replace(".html", "_weekly_report.html")
                    else:
                        target_name = fname
                    dest_file = os.path.join(dest_dir, target_name)
                    shutil.copy2(src_file, dest_file)
                    print(f"Copied {fname} -> {target_name}")

    # Also copy latest from weekly/index.html if available
    latest_weekly = os.path.join(script_dir, "..", "..", "boba-cafe-databricks", "docs", "internal", "weekly", "index.html")
    if os.path.exists(latest_weekly):
        # Extract date from HTML title if possible
        with open(latest_weekly, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            m = re.search(r"(\d{4}-\d{2}-\d{2})", content)
            if m:
                date_str = m.group(1)
                dest_file = os.path.join(dest_dir, f"{date_str}_weekly_report.html")
                shutil.copy2(latest_weekly, dest_file)
                print(f"Updated active report -> {date_str}_weekly_report.html")

    # 2. Build entries
    all_files = sorted([f for f in os.listdir(dest_dir) if f.endswith(".html") and f != "index.html"], reverse=True)
    
    weekly_items = []
    monthly_items = []

    for fname in all_files:
        # Weekly
        m_w = re.match(r"^(\d{4})-(\d{2})-(\d{2})_weekly", fname)
        if m_w:
            y, m, d = m_w.group(1), m_w.group(2), str(int(m_w.group(3)))
            label = f"{d} {RU_MONTHS_GEN.get(m, m)} {y}"
            weekly_items.append({
                "file": fname,
                "title": "Еженедельный отчёт",
                "label": label,
                "is_new": (fname == all_files[0])
            })
            continue

        # Monthly
        m_m = re.match(r"^(\d{4})-(\d{2})_(.+)", fname)
        if m_m:
            y, m, title_part = m_m.group(1), m_m.group(2), m_m.group(3).replace(".html", "").replace("_", " ").title()
            label = f"{RU_MONTHS_NOM.get(m, m)} {y}"
            monthly_items.append({
                "file": fname,
                "title": title_part,
                "label": label,
                "is_new": False
            })

    def render_row(item, icon):
        badge = '<span class="new-badge">Новый</span>' if item.get("is_new") else ''
        return f"""        <a href="{item['file']}" class="report-item">
            <div class="report-icon">{icon}</div>
            <div class="report-info">
                <div class="report-name">{item['title']} {badge}</div>
                <div class="report-date">{item['label']}</div>
            </div>
            <span class="report-arrow">→</span>
        </a>"""

    weekly_rows = "\n".join([render_row(item, "📈") for item in weekly_items])
    monthly_rows = "\n".join([render_row(item, "📊") for item in monthly_items])

    weekly_sect = f"""    <div class="section-label">Еженедельные отчеты</div>
    <div class="report-list">
{weekly_rows}
    </div>""" if weekly_items else ""

    monthly_sect = f"""    <div class="section-label">Ежемесячная аналитика</div>
    <div class="report-list">
{monthly_rows}
    </div>""" if monthly_items else ""

    index_html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <script>
      if (sessionStorage.getItem('bc_pin_reports') !== '1') {{
        window.location.replace('/internal/');
      }}
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Отчёты — Боба Кролик</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg:            #F5F5F7;
            --surface:       #FFFFFF;
            --border-light:  #E5E5EA;
            --border-strong: #D1D1D6;
            --text-1:        #111111;
            --text-2:        #48484A;
            --text-3:        #8E8E93;
            --brand:         #784D38;
            --brand-light:   #F7F2EF;
            --accent-green:  #197A3B;
            --accent-green-bg:#EBF6ED;
            --shadow-sm:     0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03);
            --shadow-md:     0 10px 25px rgba(0,0,0,0.05), 0 2px 6px rgba(0,0,0,0.03);
        }}

        * {{ margin: 0; padding: 0; box-sizing: border-box; }}

        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
            background: var(--bg);
            color: var(--text-1);
            min-height: 100vh;
            font-size: 15px;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }}

        nav {{
            background: var(--surface);
            border-bottom: 1px solid var(--border-light);
            height: 64px;
            padding: 0 32px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 100;
        }}

        .nav-back {{
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: 'Space Grotesk', sans-serif;
            font-size: 14px;
            font-weight: 700;
            color: var(--brand);
            text-decoration: none;
            transition: color 0.15s ease;
        }}
        .nav-back:hover {{ color: #4E3123; text-decoration: underline; }}

        .nav-title {{
            font-family: 'Space Grotesk', sans-serif;
            font-size: 17px;
            font-weight: 700;
            color: var(--text-1);
        }}

        .page {{
            max-width: 920px;
            margin: 0 auto;
            padding: 48px 24px 80px;
        }}

        .page-header {{
            margin-bottom: 36px;
        }}

        .page-title {{
            font-family: 'Space Grotesk', sans-serif;
            font-size: 34px;
            font-weight: 700;
            color: var(--text-1);
            letter-spacing: -0.03em;
            margin-bottom: 8px;
        }}

        .page-sub {{
            font-size: 15px;
            color: var(--text-2);
        }}

        .section-label {{
            font-family: 'Space Grotesk', sans-serif;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-3);
            margin: 32px 0 14px 4px;
        }}

        .report-list {{
            background: var(--surface);
            border: 1px solid var(--border-light);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: var(--shadow-sm);
        }}

        .report-item {{
            display: flex;
            align-items: center;
            padding: 16px 20px;
            text-decoration: none;
            color: inherit;
            border-bottom: 1px solid var(--border-light);
            transition: background 0.15s ease;
        }}
        .report-item:last-child {{
            border-bottom: none;
        }}
        .report-item:hover {{
            background: var(--brand-light);
        }}

        .report-icon {{
            font-size: 20px;
            margin-right: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            background: var(--bg);
            border: 1px solid var(--border-light);
        }}

        .report-info {{
            flex: 1;
        }}

        .report-name {{
            font-family: 'Space Grotesk', sans-serif;
            font-size: 16px;
            font-weight: 700;
            color: var(--text-1);
            display: flex;
            align-items: center;
            gap: 10px;
        }}

        .new-badge {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            font-weight: 600;
            color: var(--accent-green);
            background: var(--accent-green-bg);
            padding: 2px 8px;
            border-radius: 999px;
            border: 1px solid rgba(25,122,59,0.2);
            text-transform: uppercase;
        }}

        .report-date {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            color: var(--text-3);
            margin-top: 2px;
        }}

        .report-arrow {{
            font-family: 'Space Grotesk', sans-serif;
            font-size: 18px;
            font-weight: 700;
            color: var(--text-3);
            transition: transform 0.15s ease, color 0.15s ease;
        }}
        .report-item:hover .report-arrow {{
            color: var(--brand);
            transform: translateX(4px);
        }}

        footer {{
            text-align: center;
            padding: 32px 24px;
            font-size: 13px;
            color: var(--text-3);
            border-top: 1px solid var(--border-light);
            margin-top: 48px;
        }}
    </style>
</head>
<body>

<nav>
    <a href="/internal/" class="nav-back">← Портал</a>
    <div class="nav-title">Боба Кролик</div>
    <div style="width: 60px;"></div>
</nav>

<div class="page">
    <div class="page-header">
        <h1 class="page-title">Отчёты</h1>
        <p class="page-sub">Внутренняя бизнес-аналитика — обновляется автоматически</p>
    </div>

{weekly_sect}

{monthly_sect}

</div>

<footer>
    Боба Кролик &copy; 2026 &nbsp;·&nbsp; Служебный раздел аналитики
</footer>

</body>
</html>"""

    index_path = os.path.join(dest_dir, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index_html)
    print(f"Rebuilt index.html successfully at {index_path} ({len(weekly_items)} weekly, {len(monthly_items)} monthly)!")

if __name__ == "__main__":
    sync_reports()
