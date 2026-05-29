import { createContext, useContext, useMemo, useState, useCallback } from 'react'
import { STORES } from '../data/fakeData'

const STORAGE_KEY     = 'bobacafe_inventory_config'
const DATA_KEY        = 'bobacafe_inventory_data'
const SALES_CACHE_KEY = 'bobacafe_sales_cache'
const SETTINGS_KEY    = 'bobacafe_settings'

const WORKSPACE = 'https://dbc-d5bd17fc-eaf4.cloud.databricks.com'
const SALES_TABLE = 'workspace.default.transactions'

// ─── Config defaults ──────────────────────────────────────────────────────────

export const DEFAULT_INGREDIENTS = []
export const DEFAULT_RECIPES = {}

// ─── Operational data defaults ────────────────────────────────────────────────

export const DEFAULT_DATA = {
  audits: [],
  transactions: [],
  purchaseOrders: [],
  _nextAuditId: 1,
  _nextTxId:    1,
  _nextPoId:    1,
}


// ─── Sales row normaliser ─────────────────────────────────────────────────────

function rowsToSales(rows) {
  return rows
    .map(r => ({ ...r, store: r.store ?? r.store_name }))
    .filter(r => STORES.includes(r.store))
    .map((r, i) => ({
      id: i + 1, store: r.store, product: r.product, date: r.date,
      quantity: Math.round(parseFloat(r.qty ?? r.quantity ?? 0)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

function loadFromStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}
function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// ─── Config migration (handle old format with menuItems/productMap) ───────────

function migrateConfig(raw) {
  if (!raw) return null
  return { ingredients: raw.ingredients ?? DEFAULT_INGREDIENTS, recipes: raw.recipes ?? DEFAULT_RECIPES }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ConfigContext = createContext(null)

export function ConfigProvider({ children }) {
  const [config, setConfigState] = useState(() =>
    migrateConfig(loadFromStorage(STORAGE_KEY)) ?? { ingredients: DEFAULT_INGREDIENTS, recipes: DEFAULT_RECIPES }
  )
  const [data,       setDataState]       = useState(() => loadFromStorage(DATA_KEY)        ?? DEFAULT_DATA)
  const [salesCache, setSalesCacheState] = useState(() => loadFromStorage(SALES_CACHE_KEY))
  const [settings,   setSettingsState]   = useState(() => loadFromStorage(SETTINGS_KEY)   ?? { token: '', warehouseId: '' })

  const setConfig = useCallback((updater) => {
    setConfigState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveToStorage(STORAGE_KEY, next)
      return next
    })
  }, [])

  const setData = useCallback((updater) => {
    setDataState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveToStorage(DATA_KEY, next)
      return next
    })
  }, [])

  const saveSettings = useCallback((s) => {
    setSettingsState(s)
    saveToStorage(SETTINGS_KEY, s)
  }, [])

  const clearSalesCache = useCallback(() => {
    setSalesCacheState(null)
    localStorage.removeItem(SALES_CACHE_KEY)
  }, [])

  // ─── Operational data mutations ─────────────────────────────────────────────

  const addAudit = useCallback((store, date, counts) => {
    setData(prev => {
      const id = `A-${String(prev._nextAuditId).padStart(3, '0')}`
      return { ...prev, audits: [...prev.audits, { id, store, date, counts }], _nextAuditId: prev._nextAuditId + 1 }
    })
  }, [setData])

  const addTransaction = useCallback((tx) => {
    setData(prev => {
      const id = `T-${String(prev._nextTxId).padStart(3, '0')}`
      return { ...prev, transactions: [...prev.transactions, { id, ...tx }], _nextTxId: prev._nextTxId + 1 }
    })
  }, [setData])

  const addPurchaseOrder = useCallback((po) => {
    setData(prev => ({ ...prev, purchaseOrders: [po, ...prev.purchaseOrders], _nextPoId: prev._nextPoId + 1 }))
  }, [setData])

  const updatePurchaseOrder = useCallback((id, changes) => {
    setData(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po => po.id === id ? { ...po, ...changes } : po),
    }))
  }, [setData])

  const deletePurchaseOrder = useCallback((id) => {
    setData(prev => ({ ...prev, purchaseOrders: prev.purchaseOrders.filter(po => po.id !== id) }))
  }, [setData])

  // ─── Sales — reactive to cache (set by refresh) ──────────────────────────────

  const { sales, posWaste, usingLiveData } = useMemo(() => {
    const rows = salesCache?.rows ?? null
    if (!rows || rows.length === 0) return { sales: [], posWaste: [], usingLiveData: false }
    const fiscalRows    = rows.filter(r => r.transaction_type !== 'Non-Fiscal')
    const nonFiscalRows = rows.filter(r => r.transaction_type === 'Non-Fiscal')
    return { sales: rowsToSales(fiscalRows), posWaste: rowsToSales(nonFiscalRows), usingLiveData: true }
  }, [salesCache])

  const today      = new Date().toISOString().slice(0, 10)
  const reportFrom = sales.length > 0 ? sales[sales.length - 1].date : today
  const reportTo   = sales.length > 0 ? sales[0].date               : today

  // ─── Databricks refresh ──────────────────────────────────────────────────────

  const refreshSales = useCallback(async (token, warehouseId, fromDate, toDate) => {
    const currentRows = salesCache?.rows ?? []

    if (!fromDate || !toDate) return { upToDate: true, throughDate: null }

    const storesSql = STORES.map(s => `'${s}'`).join(', ')
    const statement = `
      SELECT CAST(date AS STRING) AS date, store_name AS store, product,
             transaction_type, CAST(SUM(qty) AS DOUBLE) AS qty
      FROM ${SALES_TABLE}
      WHERE store_name IN (${storesSql})
        AND date >= '${fromDate}' AND date <= '${toDate}'
        AND is_return = false
      GROUP BY date, store_name, product, transaction_type
      ORDER BY date DESC
    `

    const apiPath = import.meta.env.DEV
      ? '/databricks-proxy/api/2.0/sql/statements'
      : 'https://bobacafe-proxy.davidgao734.workers.dev'
    const resp = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ statement, warehouse_id: warehouseId, wait_timeout: '50s', on_wait_timeout: 'CANCEL' }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`HTTP ${resp.status}${text ? ': ' + text.slice(0, 300) : ''}`)
    }

    const result = await resp.json()
    if (result.status?.state !== 'SUCCEEDED')
      throw new Error(result.status?.error?.message ?? `Query ended: ${result.status?.state}`)

    const cols    = result.manifest.schema.columns.map(c => c.name)
    const newRows = (result.result?.data_array ?? []).map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    )

    // Merge — deduplicate by date+store+product
    const keyOf = r => `${r.date}|${r.store}|${r.product}|${r.transaction_type}`
    const map = new Map(currentRows.map(r => [keyOf(r), r]))
    newRows.forEach(r => map.set(keyOf(r), r))
    const merged = [...map.values()].sort((a, b) => (b.date > a.date ? 1 : -1))

    const newCache = { rows: merged, lastRefreshDate: toDate }
    setSalesCacheState(newCache)
    saveToStorage(SALES_CACHE_KEY, newCache)

    return { upToDate: false, newRows: newRows.length, fromDate, toDate }
  }, [salesCache])

  // ─── Config export/import ───────────────────────────────────────────────────

  const exportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `inventory-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(url)
  }, [config])

  const importConfig = useCallback((file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result)
          if (parsed.ingredients && parsed.recipes) { setConfig({ ingredients: parsed.ingredients, recipes: parsed.recipes }); resolve() }
          else reject(new Error('Invalid config file'))
        } catch (err) { reject(err) }
      }
      reader.readAsText(file)
    })
  , [setConfig])

  return (
    <ConfigContext.Provider value={{
      config, setConfig,
      data, setData,
      addAudit, addTransaction,
      addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
      sales, posWaste, usingLiveData, salesCache, clearSalesCache,
      settings, saveSettings, refreshSales,
      reportFrom, reportTo,
      exportConfig, importConfig,
    }}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}

// ─── Calculation functions ────────────────────────────────────────────────────

export function useCalcs() {
  const { config, sales, posWaste, data } = useConfig()

  return useMemo(() => {
    const { ingredients, recipes } = config
    const r1 = n => Math.round(n * 10) / 10

    const getVarianceWindow = (store) => {
      const sorted = [...data.audits].filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date))
      return sorted.length >= 2 ? { opening: sorted[1], closing: sorted[0] } : null
    }

    const getLastAudit = (store) =>
      [...data.audits].filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

    const getSalesConsumption = (store, ingredientId) => {
      const win = getVarianceWindow(store)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return r1([...sales, ...posWaste].filter(s => s.store === store && s.date > from && s.date <= to)
        .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ingredientId] ?? 0), 0))
    }

    const getDirectConsumption = (store, ingredientId) => {
      const win = getVarianceWindow(store)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return r1(data.transactions
        .filter(t => t.store === store && t.ingredientId === ingredientId && t.type !== 'adjustment' && t.date > from && t.date <= to)
        .reduce((sum, t) => sum + t.quantity, 0))
    }

    const getConsumed7d = (store, ingredientId) =>
      r1(getSalesConsumption(store, ingredientId) + getDirectConsumption(store, ingredientId))

    const getAdjDelta = (store, ingredientId) => {
      const win = getVarianceWindow(store)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return data.transactions
        .filter(t => t.store === store && t.ingredientId === ingredientId && t.type === 'adjustment' && t.date > from && t.date <= to)
        .reduce((sum, t) => sum + t.quantity, 0)
    }

    const getOrderQty = (store, ingredientId) =>
      Math.max(0, Math.ceil(getConsumed7d(store, ingredientId) * 1.05) - getAdjDelta(store, ingredientId))

    const estimateCurrentStock = (store, ingredientId) => {
      const lastAudit = getLastAudit(store)
      const cut  = lastAudit?.date ?? '0000-00-00'
      const base = lastAudit?.counts[ingredientId] ?? 0
      const salesSince = lastAudit
        ? r1([...sales, ...posWaste].filter(s => s.store === store && s.date > cut)
            .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ingredientId] ?? 0), 0))
        : 0
      const txSince = lastAudit
        ? data.transactions
            .filter(t => t.store === store && t.ingredientId === ingredientId && t.date > cut)
            .reduce((sum, t) => t.type === 'adjustment' ? sum + t.quantity : sum - t.quantity, 0)
        : 0
      // Use >= so a PO received on the same day as the audit is still counted
      const poSince = data.purchaseOrders
        .filter(po => po.store === store && po.status === 'received' && (po.receivedDate ?? '') >= cut)
        .reduce((sum, po) => sum + (po.lines.find(l => l.ingredientId === ingredientId)?.ordered ?? 0), 0)
      return r1(base - salesSince + txSince + poSince)
    }

    const getDailyAvg = (store, ingredientId) => r1(getConsumed7d(store, ingredientId) / 7)
    const isLowStock  = (store, ingredientId) => estimateCurrentStock(store, ingredientId) < getDailyAvg(store, ingredientId) * 3

    const getLowStockAlerts = () => {
      const alerts = []
      for (const store of STORES)
        for (const p of ingredients)
          if (isLowStock(store, p.id)) {
            const current = Math.max(0, estimateCurrentStock(store, p.id))
            const dailyAvg = getDailyAvg(store, p.id)
            alerts.push({ store, productId: p.id, product: p.name, unit: p.unit, current,
              daysLeft: dailyAvg > 0 ? r1(current / dailyAvg) : 0 })
          }
      return alerts
    }

    const getSaleIngredientImpact = (product, quantity) => {
      const recipe = recipes[product] ?? {}
      return ingredients.map(p => ({ ...p, consumed: r1(quantity * (recipe[p.id] ?? 0)) })).filter(p => p.consumed > 0)
    }

    const getOpeningStock = (store, ingredientId) => { const win = getVarianceWindow(store); return win ? (win.opening.counts[ingredientId] ?? 0) : 0 }
    const getClosingStock = (store, ingredientId) => { const win = getVarianceWindow(store); return win ? (win.closing.counts[ingredientId] ?? 0) : 0 }
    const getActualConsumed = (store, ingredientId) => {
      const win = getVarianceWindow(store)
      if (!win) return 0
      const opening = win.opening.counts[ingredientId] ?? 0
      const closing = win.closing.counts[ingredientId] ?? 0
      // POs received between the two audits inflate closing stock — add them back so
      // actualConsumed = true consumption, not (opening - closing) which would show as a gain
      const poInWindow = data.purchaseOrders
        .filter(po => po.store === store && po.status === 'received'
          && (po.receivedDate ?? '') > win.opening.date
          && (po.receivedDate ?? '') <= win.closing.date)
        .reduce((sum, po) => sum + (po.lines.find(l => l.ingredientId === ingredientId)?.ordered ?? 0), 0)
      return r1(opening - closing + poInWindow)
    }
    const getUnexplainedVariance = (store, ingredientId) =>
      r1(getActualConsumed(store, ingredientId) - getSalesConsumption(store, ingredientId) - getDirectConsumption(store, ingredientId))
    const getVariancePct = (store, ingredientId) => {
      const t = getSalesConsumption(store, ingredientId)
      return t === 0 ? 0 : Math.round(getUnexplainedVariance(store, ingredientId) / t * 1000) / 10
    }

    return {
      getSalesConsumption, getDirectConsumption, getConsumed7d, getAdjDelta,
      getOrderQty, estimateCurrentStock, getDailyAvg, isLowStock, getLowStockAlerts,
      getSaleIngredientImpact, getOpeningStock, getClosingStock,
      getActualConsumed, getUnexplainedVariance, getVariancePct,
      getVarianceWindow, getLastAudit,
    }
  }, [config, sales, data])
}
