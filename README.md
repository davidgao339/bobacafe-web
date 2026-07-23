# Боба Кролик — Web Platform

Website and internal tooling for Боба Кролик (Boba Rabbit) bubble tea cafés.

**Live:** [bobacafe.net](https://bobacafe.net) · **Internal:** [bobacafe.net/internal](https://bobacafe.net/internal)

---

## Structure

```
bobacafe-web/
├── site/
│   ├── index.html              # Public site (menu, locations, Yandex map)
│   └── internal/               # Internal portal (PIN-gated dashboard)
│       ├── index.html          
│       ├── faq.html            # Employee FAQ (live from Google Sheets)
│       └── reports/            # Business reports (weekly / monthly HTML)
├── apps/
│   ├── schedule-app/           # React source for the staff schedule app
│   ├── bank-statement/         # Streamlit bank statement analyser
│   ├── payment/                # Google Apps Script payment system
│   ├── databricks-proxy/       # Databricks Cloudflare Worker proxy
│   ├── inventory-app/          # Vite/React inventory management
│   └── schedule-optimizer/     # Streamlit CP-SAT optimizer
├── scripts/                    # Utility and sync scripts
├── data/                       # Miscellaneous data files
└── .github/workflows/          # GitHub Actions deploy pipeline
```

## Sites

### Public — `bobacafe.net`
Static landing page with the café menu, branch locations, and an interactive Yandex map. Deployed automatically on every push to `main`.

### Internal — `bobacafe.net/internal`
PIN-protected dashboard (PIN: see ops team) linking to all internal tools.

| App | URL | Stack |
|-----|-----|-------|
| Staff Schedule | `/internal/schedule/` | React 19, built in CI |
| Employee FAQ | `/internal/faq.html` | Vanilla JS, live Google Sheets CSV |
| Reports | `/internal/reports/` | Static HTML |
| Bank Statement | [bobacafe-web-bank-statement.streamlit.app](https://bobacafe-web-bank-statement.streamlit.app) | Streamlit, pandas |
| Payroll | TBD | Streamlit |
| Payments | TBD | Google Apps Script |

## Deployment

GitHub Actions (`.github/workflows/deploy-pages.yml`) runs on every push to `main`:

1. Builds the React schedule app (`apps/schedule-app/`) with `npm ci && npm run build`
2. Assembles a `deploy/` folder:
   - `site/index.html` → site root
   - `site/internal/index.html` + `site/internal/faq.html` → internal portal pages
   - `apps/schedule-app/build/` → `internal/schedule/`
   - `site/internal/reports/` → `internal/reports/`
3. Publishes to GitHub Pages via `actions/deploy-pages`

The Streamlit bank statement app deploys separately on [Streamlit Community Cloud](https://share.streamlit.io) from `bank-statement/app.py`.

## Local Development

**Schedule app**
```bash
cd apps/schedule-app
npm install
npm start          # http://localhost:3000
```

**Bank statement app**
```bash
cd apps/bank-statement
pip install -r requirements.txt
streamlit run app.py
```

## Adding a Report

1. Drop the HTML file into `site/internal/reports/`
2. Add a row for it in `site/internal/reports/index.html`
3. Push — CI deploys it automatically

## Notes

- Bank statement CSV/XLSX files are gitignored — never commit real financial data
- The schedule app `homepage` in `package.json` is set to `/internal/schedule` so built asset paths resolve correctly
- Internal portal uses `sessionStorage` for the PIN session (clears on tab close)
