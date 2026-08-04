# Inventory & Replenishment App (apps/inventory-app)

Internal web application for **Боба Кролик (Boba Rabbit)** bubble tea cafés to manage inventory, recipes, weekly replenishment calculations, purchase orders (POs), supplier grouping, and physical audit reconciliation.

---

## 1. Quick Start & Commands

```powershell
# Navigate to the app directory
cd apps/inventory-app

# Install dependencies (first time)
npm install

# Start local development server (Vite)
npm run dev

# Production build (outputs to dist/)
npm run build
```

---

## 2. Architecture & Data Flow

```
                     ┌──────────────────────────────────────────────┐
                     │          Databricks SQL Warehouse            │
                     │       (workspace.default.transactions)       │
                     └──────────────────────┬───────────────────────┘
                                            │ (Sales / Non-Fiscal rows)
                                            ▼
┌──────────────────────┐     ┌──────────────────────────────────────┐
│  Cloudflare Worker   │◄───►│    apps/inventory-app/src/api.js     │
│   (Cloud Backups)    │     └──────────────────┬───────────────────┘
└──────────────────────┘                        │
                                                ▼
                                 ┌──────────────────────────────┐
                                 │      ConfigContext.jsx       │
                                 │   (localStorage + Sync)      │
                                 └──────────────┬───────────────┘
                                                │
                 ┌──────────────────────────────┼──────────────────────────────┐
                 ▼                              ▼                              ▼
   ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
   │   useInventoryCalcs.jsx   │  │     productTypes.js       │  │    LanguageContext.jsx    │
   │  - getDailyAvg            │  │  - 20 Product Categories  │  │  - ru.js / en.js          │
   │  - estimateCurrentStock   │  │  - Pack Size Rounding     │  │  - i18n Dictionary        │
   │  - getOrderQty            │  │  - Auto Keyword Detector  │  │                           │
   └─────────────┬─────────────┘  └─────────────┬─────────────┘  └───────────────────────────┘
                 │                              │
                 └──────────────────────┬───────┘
                                        ▼
                      ┌──────────────────────────────────┐
                      │             Pages / UI           │
                      │  - Dashboard.jsx                 │
                      │  - ReplenishmentReport.jsx       │
                      │  - PurchaseOrders.jsx            │
                      │  - InventoryAudit.jsx            │
                      │  - InventoryLevels.jsx           │
                      │  - Recipes.jsx                   │
                      │  - Transactions.jsx              │
                      │  - VarianceReport.jsx            │
                      │  - UsageReport.jsx               │
                      │  - TapiocaCookingPlan.jsx        │
                      └──────────────────────────────────┘
```

---

## 3. Directory Structure

```
apps/inventory-app/
├── src/
│   ├── components/
│   │   └── Sidebar.jsx              # App navigation, store selector, language toggle, cloud backup buttons
│   ├── context/
│   │   ├── ConfigContext.jsx        # Central state: ingredients, recipes, suppliers, audits, POs, sales cache
│   │   └── LanguageContext.jsx      # Language state (ru / en)
│   ├── hooks/
│   │   └── useInventoryCalcs.jsx    # Core math engine: consumption averages, stock estimation, replenishment
│   ├── i18n/
│   │   ├── ru.js                    # Russian translation dictionary
│   │   └── en.js                    # English translation dictionary
│   ├── pages/
│   │   ├── Dashboard.jsx            # KPI cards, critical stock alerts, fast actions
│   │   ├── InventoryAudit.jsx       # Physical count entry & history per store
│   │   ├── InventoryLevels.jsx      # Current estimated stock vs safety thresholds
│   │   ├── PurchaseOrders.jsx       # Draft / Sent / Received PO management & PDF exports
│   │   ├── Recipes.jsx              # Ingredients, recipes per menu item, suppliers, product types & steps
│   │   ├── ReplenishmentReport.jsx  # Weekly replenishment recommendations table (CSV / Print)
│   │   ├── TapiocaCookingPlan.jsx   # Dynamic tapioca cooking batches based on sales velocity
│   │   ├── Transactions.jsx         # Sales, waste / loss logging, stock adjustments
│   │   ├── UsageReport.jsx          # Ingredient consumption totals over time
│   │   └── VarianceReport.jsx       # Audit vs. expected consumption loss tracking
│   ├── services/
│   │   └── api.js                   # Databricks SQL API queries and Cloudflare Worker backup endpoints
│   └── utils/
│       ├── productTypes.js          # Product categories, pack sizes (rounding steps), keyword detection
│       └── tapiocaCalculations.js   # Tapioca cooking batch schedule helpers
```

---

## 4. Business Logic & Calculation Formulas

### 4.1 Estimated Current Stock
$$\text{Current Stock} = \text{Latest Audit Count} + \sum \text{Received POs} - \sum \text{Sales Consumption} - \sum \text{Logged Waste}$$
*(Calculated since the date of the store's most recent audit for that ingredient).*

### 4.2 Daily Consumption Average (`getDailyAvg`)
$$\text{Daily Avg} = \frac{\text{Consumed in active window (7 days)}}{\text{Number of days with recorded data}}$$

### 4.3 Replenishment & Suggested PO Quantity (`getOrderQty`)
$$\text{Raw Needed} = (\text{Daily Avg} \times \text{Days} \times (1 + \frac{\text{Buffer\%}}{100})) - \text{Estimated Current Stock}$$
$$\text{Order Qty} = \text{roundOrderQty}(\text{Raw Needed}, \text{Ingredient})$$

- If $\text{Raw Needed} \le 0 \implies \text{Order Qty} = 0$.
- If $\text{Raw Needed} > 0 \implies \text{Order Qty} = \lceil \frac{\text{Raw Needed}}{\text{Step}} \rceil \times \text{Step}$.

---

## 5. Product Types & Rounding Rules Matrix

Configured in `src/utils/productTypes.js`:

| Category ID | Russian Name | Rounding Step (Pack Size) | Default Unit | Keywords / Detection Rules |
|---|---|---|---|---|
| `syrup` | Сиропы | **1000** | мл | `сироп`, `syrup` |
| `topping` | Топпинги | **1000** | г | `топпинг`, `topping`, `желе`, `jelly`, `алоэ`, `тапиока`, `tapioca` |
| `coffee` | Кофе | **1000** | г | `кофе`, `coffee`, `зерно`, `espresso`, `эспрессо` |
| `tea` | Чай | **180** | г | `чай`, `tea`, `ассам`, `жасмин`, `улун`, `эрл грей` |
| `milk` | Молоко | **12000** | мл | `молоко`, `milk` |
| `cream` | Сливки | **500** | мл | `сливки`, `cream` |
| `mochi` | Моти | **4** | шт | `моти`, `mochi` |
| `pancakes` | Блинчики / Вафли | **4** | шт | `блинчик`, `блин`, `вафли`, `pancake` |
| `corndogs` | Корн-доги | **5** | шт | `корн дог`, `корн-дог`, `corn dog` |
| `cups_plastic_500` | Пластиковые стаканы 500мл | **20** | шт | `500` + (`стакан`, `cup`, `пластик`) |
| `cups_plastic_320` | Пластиковые стаканы 320мл | **50** | шт | `320` + (`стакан`, `cup`, `пластик`) |
| `cups_paper` | Бумажные стаканы | **30** | шт | `бумажн`, `paper cup`, `горяч` |
| `sparkling_water` | Газированная вода | **1500** | мл | `газирован`, `sparkling`, `содов` |
| `powder` | Порошки | **500** | г | `порошок`, `пудра`, `матча`, `сухое молоко` |
| `patoka` | Патока | **700** | г | `патока`, `patoka`, `мальтоз` |
| `juice_balls` | Джус болы / Поппинг боба | **3000** | г | `джус боллы`, `джус-боллы`, `джус болы`, `поппинг` |
| `puree` | Пюре | **1000** | г | `пюре`, `puree` |
| `cocoa` | Какао | **1000** | г | `какао`, `cocoa` |
| `juice` | Сок | **1000** | мл | `сок`, `juice`, `нектар` |
| `sugar` | Сахар | **1000** | г | `сахар`, `sugar`, `фруктоза`, `fructose` |
| `other` | Другое (без кратности) | **1** | — | Fallback if no category matches |

> **Custom Step / Category Override**: Any ingredient can have an explicit `productType` or `customStep` set in the **Recipes & Config** $\rightarrow$ **Ingredients** tab, overriding automatic detection.

---

## 6. Storage & State Management

Data is kept in browser `localStorage` and synchronized across tabs in real-time via `window.addEventListener('storage', ...)`:

| LocalStorage Key | Type | Description |
|---|---|---|
| `bobacafe_inventory_config` | JSON | Ingredients array (`id`, `name`, `unit`, `supplierId`, `productType`, `customStep`), Recipes dictionary (`{ [product]: { [ingredientId]: qty } }`), Suppliers array. |
| `bobacafe_inventory_data` | JSON | Historical Audits, Transactions, and Purchase Orders (`draft`, `sent`, `received`). |
| `bobacafe_sales_cache` | JSON | Cached sales rows fetched from Databricks to prevent redundant network requests. |
| `bobacafe_settings` | JSON | Databricks OAuth token and SQL warehouse ID. |
| `bobacafe_suppressed_stores`| JSON | Stores hidden by the user from active reporting. |

---

## 7. Purchase Order Lifecycle

1. **Draft (`draft`)**: Created manually or pre-filled from **Replenishment Report** (`Create PO →`). Suggested quantities are rounded up to product type pack sizes.
2. **Sent (`sent`)**: Marked when the order is placed with suppliers. Order date and expected delivery tracked.
3. **Received (`received`)**: Marked when goods arrive at the store. Entering received quantities immediately adds them to **Estimated Current Stock**.
4. **PDF Export**: Generates printable and downloadable PDF orders grouped by supplier.

---

## 8. Common Tasks & How to Modify

### How to add or change a Product Rounding Rule:
1. Open `src/utils/productTypes.js`.
2. Add or update the object in `PRODUCT_TYPES` (set `id`, `nameRu`, `nameEn`, `roundStep`, `defaultUnit`, `keywords`).
3. Update the matching conditions in `detectProductType(name, unit)`.
4. Run `npm run build` or `node <test_script>` to verify.

### How to update Databricks SQL queries:
1. Open `src/services/api.js`.
2. Modify the SQL query inside `fetchDatabricksSales`. Note that column aliases (`date`, `store`, `product`, `qty`) match what `rowsToSales` in `ConfigContext.jsx` expects.

### How to add a new Language or Translation:
1. Add keys in `src/i18n/ru.js` and `src/i18n/en.js`.
2. Consume them using `const { t } = useLanguage(); t('key.name')`.
