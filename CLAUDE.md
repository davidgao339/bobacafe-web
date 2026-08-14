# CLAUDE.md — bobacafe-web

Website and internal tooling for Боба Кролик (Boba Rabbit) bubble tea cafés.

**Live:** https://bobacafe.net · **Internal:** https://bobacafe.net/internal

---

## Project layout

```
bobacafe-web/
├── site/
│   ├── index.html              # Public site (menu, locations, Yandex map)
│   └── internal/               # PIN-gated internal portal (sessionStorage auth)
│       ├── index.html          
│       ├── faq.html            # Employee FAQ (live-loads Google Sheets CSV)
│       ├── dashboard.html      # Databricks embedded dashboard (token injected at deploy)
│       └── reports/            # Business intelligence HTML reports
├── apps/
│   ├── schedule-app/           # React 19 + TypeScript source for the schedule app
│   ├── bank-statement/         # Streamlit bank statement analyser (separate deployment)
│   ├── payment/                # Google Apps Script payment system
│   ├── databricks-proxy/       # Databricks Cloudflare Worker proxy
│   ├── inventory-app/          # Vite/React inventory management
│   └── schedule-optimizer/     # Streamlit CP-SAT optimizer
├── scripts/                    # Utility and sync scripts
│   └── sync-reports.ps1        # Copies Databricks reports and regenerates index
├── data/                       # Miscellaneous data files
└── .github/workflows/          # CI/CD — deploy-pages.yml
```

---

## Deployment

Cloudflare Pages.

**Trigger:** every push to `main` (or manual `workflow_dispatch`).

**Pipeline (`deploy-cloudflare.yml`):**
1. Build React apps: Schedule App and Inventory App
2. Mint a Databricks embedded dashboard token via OAuth and inject it into `site/internal/dashboard.html`
3. Assemble `deploy/` with: `site/index.html`, `site/internal/`, `site/internal/schedule/` (React build), `site/internal/inventory/` (React build), `site/internal/reports/`
4. Upload and deploy to Cloudflare Pages via `cloudflare/pages-action`

---

## Syncing reports from bobacafe-databricks

New reports live in the sibling repo `boba-cafe-databricks/weekly-analysis/analysis-html/`.

```powershell
# 1. Pull latest reports
cd ..\boba-cafe-databricks && git pull && cd ..\bobacafe-web

# 2. Sync into this repo
cd scripts
.\sync-reports.ps1

# 3. Commit and push to publish
git add ../site/internal/reports/
git commit -m "sync: add new report"
git push
cd ..
```

If the script is blocked by execution policy:
```powershell
powershell -ExecutionPolicy Bypass -File .\sync-reports.ps1
```

Custom source path:
```powershell
.\sync-reports.ps1 -SourceDir "C:\other\path\to\analysis-html"
```

`sync-reports.ps1` copies all `.html` files to `site/internal/reports/` and regenerates `index.html` (UTF-8 without BOM, sorted newest-first by filename).

---

## Schedule app (React)

Source: `apps/schedule-app/` · Built output goes to `internal/schedule/` via CI.

```powershell
cd apps/schedule-app
npm install   # first time only
npm start     # dev server at localhost:3000
npm run build # production build
```

`homepage` in `package.json` is set to `/internal/schedule` so asset paths resolve correctly on the live site.

---

## Inventory app (React)

Source: `apps/inventory-app/` · Vite + React inventory and replenishment management system.

Detailed architecture, formulas, product type pack rounding rules, and troubleshooting guide:
👉 See [apps/inventory-app/README.md](file:///d:/Github/bobacafe-web/apps/inventory-app/README.md)

```powershell
cd apps/inventory-app
npm install   # first time only
npm run dev   # dev server
npm run build # production build
```

---

## Key facts

- The `site/internal/` portal uses PIN auth stored in `sessionStorage` (clears on tab close).
- `site/internal/dashboard.html` has a Databricks token baked in at CI time — don't hand-edit it.
- `apps/bank-statement/` is deployed separately to Streamlit Community Cloud.
