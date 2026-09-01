#!/usr/bin/env python3
"""
Generate index.html for reports directory with sorted report links
"""
import os
import re
from datetime import datetime

dest_dir = "site/internal/reports"

# Get all HTML files except index.html, sorted by date (newest first)
html_files = sorted(
    [f for f in os.listdir(dest_dir) if f.endswith(".html") and f != "index.html"],
    reverse=True
)

if not html_files:
    print("No HTML files to index")
    exit(1)

# Generate index.html
index_html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Boba Cafe — Reports</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #24292e;
      background: #f6f8fa;
      margin: 0;
      padding: 24px;
    }
    #content {
      max-width: 700px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      padding: 40px 48px;
    }
    h1 {
      font-size: 1.9em;
      border-bottom: 2px solid #d0d7de;
      padding-bottom: 10px;
      margin-top: 0;
    }
    h2 {
      font-size: 1.1em;
      color: #57606a;
      font-weight: 500;
      margin-top: 0;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 2em 0 0;
    }
    li {
      border: 1px solid #d0d7de;
      border-radius: 6px;
      margin-bottom: 10px;
      transition: box-shadow 0.15s;
    }
    li:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    li a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      text-decoration: none;
      color: #0969da;
      font-weight: 500;
    }
    li a:hover { text-decoration: underline; }
    .icon { font-size: 1.2em; flex-shrink: 0; }
    .label { flex: 1; }
    .badge {
      font-size: 0.75em;
      background: #ddf4ff;
      color: #0969da;
      border: 1px solid #b6e3ff;
      border-radius: 12px;
      padding: 2px 8px;
      font-weight: 500;
    }
    .badge.product { background: #fff8c5; color: #9a6700; border-color: #e3b341; }
    footer {
      margin-top: 2.5em;
      padding-top: 1.2em;
      border-top: 1px solid #eaecef;
      font-size: 0.85em;
      color: #57606a;
    }
  </style>
</head>
<body>
  <div id="content">
    <h1>Boba Cafe Reports</h1>
    <h2>Weekly and product health analysis</h2>
    <ul>
"""

# Parse filenames and create links
for filename in html_files:
    # Extract date from filename (e.g., 2026-04-20_weekly_report.html)
    match = re.match(r"(\d{4}-\d{2}-\d{2})_(.+)\.html", filename)
    if match:
        date_str = match.group(1)
        report_type = match.group(2)

        # Format date for display
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        formatted_date = date_obj.strftime("%b %d, %Y")

        # Determine icon and badge
        if "weekly_report" in report_type:
            icon = "📊"
            badge = "Weekly"
            label = f"Weekly Report — {formatted_date}"
        elif "product_health" in report_type:
            icon = "🧋"
            badge = "Product Health"
            label = f"Product Health — {date_obj.strftime('%B %Y')}"
        else:
            icon = "📄"
            badge = "Report"
            label = f"Report — {formatted_date}"

        badge_class = "product" if "product_health" in report_type else ""

        index_html += f"""      <li>
        <a href="{filename}">
          <span class="icon">{icon}</span>
          <span class="label">{label}</span>
          <span class="badge{' ' + badge_class if badge_class else ''}">{badge}</span>
        </a>
      </li>
"""

index_html += """    </ul>
    <footer>Boba Cafe — internal analytics</footer>
  </div>
</body>
</html>
"""

# Write index.html
with open(os.path.join(dest_dir, "index.html"), "w", encoding="utf-8") as f:
    f.write(index_html)

print(f"Generated index.html with {len(html_files)} reports")
