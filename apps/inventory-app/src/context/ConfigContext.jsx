import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { stores as STORES } from '../data/fakeData'
import { fetchDatabricksSales, fetchCloudBackupsList, pushCloudBackup, fetchCloudBackupData } from '../services/api'
import { useCalcs } from '../hooks/useInventoryCalcs'

const STORAGE_KEY           = 'bobacafe_inventory_config'
const DATA_KEY              = 'bobacafe_inventory_data'
const SALES_CACHE_KEY       = 'bobacafe_sales_cache'
const SETTINGS_KEY          = 'bobacafe_settings'
const SUPPRESSED_STORES_KEY = 'bobacafe_suppressed_stores'

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
  const ingredients = raw.ingredients ?? DEFAULT_INGREDIENTS
  const suppliers   = raw.suppliers   ?? []
  const maxIngId  = ingredients.reduce((m, i) => Math.max(m, i.id), 0)
  const maxSuppId = suppliers.reduce((m, s) => Math.max(m, s.id), 0)
  return {
    ingredients,
    recipes:          raw.recipes          ?? DEFAULT_RECIPES,
    suppliers,
    _nextIngId:       raw._nextIngId       ?? maxIngId  + 1,
    _nextSupplierId:  raw._nextSupplierId  ?? maxSuppId + 1,
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ConfigContext = createContext(null)

export function ConfigProvider({ children }) {
  const [config, setConfigState] = useState(() =>
    migrateConfig(loadFromStorage(STORAGE_KEY)) ?? { ingredients: DEFAULT_INGREDIENTS, recipes: DEFAULT_RECIPES, suppliers: [], _nextIngId: 1, _nextSupplierId: 1 }
  )
  const [data,       setDataState]       = useState(() => loadFromStorage(DATA_KEY)        ?? DEFAULT_DATA)
  const [salesCache, setSalesCacheState] = useState(() => loadFromStorage(SALES_CACHE_KEY))
  const [settings,   setSettingsState]   = useState(() => {
    const stored = loadFromStorage(SETTINGS_KEY) ?? {}
    return { token: '', warehouseId: '', ...stored }
  })
  const [stores,     setStoresState]     = useState(() => STORES) // Start with defaults, update from Databricks
  const [suppressedStores, setSuppressedStores] = useState(() => loadFromStorage(SUPPRESSED_STORES_KEY) ?? [])

  // Sync state when another browser tab writes to localStorage
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === DATA_KEY && e.newValue) {
        try { setDataState(JSON.parse(e.newValue)) } catch {}
      }
      if (e.key === STORAGE_KEY && e.newValue) {
        try { setConfigState(migrateConfig(JSON.parse(e.newValue))) } catch {}
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

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

  const toggleStoreVisibility = useCallback((store) => {
    setSuppressedStores(prev => {
      const next = prev.includes(store)
        ? prev.filter(s => s !== store)
        : [...prev, store]
      saveToStorage(SUPPRESSED_STORES_KEY, next)
      return next
    })
  }, [])

  const visibleStores = useMemo(() => {
    if (!stores || !suppressedStores) return stores || []
    return stores.filter(s => !suppressedStores.includes(s))
  }, [stores, suppressedStores])

  // ─── Operational data mutations ─────────────────────────────────────────────

  const addAudit = useCallback((store, date, counts, timestamp) => {
    setData(prev => {
      const existing = prev.audits.find(a => a.store === store && a.date === date)
      if (existing) {
        return {
          ...prev,
          audits: prev.audits.map(a =>
            a.id === existing.id ? { ...a, counts: { ...a.counts, ...counts }, ...(timestamp && { timestamp }) } : a
          ),
        }
      }
      const id = `A-${String(prev._nextAuditId).padStart(3, '0')}`
      return { ...prev, audits: [...prev.audits, { id, store, date, counts, ...(timestamp && { timestamp }) }], _nextAuditId: prev._nextAuditId + 1 }
    })
  }, [setData])

  const deleteAudit = useCallback((id) => {
    setData(prev => ({ ...prev, audits: prev.audits.filter(a => a.id !== id) }))
  }, [setData])

  const updateAudit = useCallback((id, counts) => {
    setData(prev => ({
      ...prev,
      audits: prev.audits.map(a => a.id === id ? { ...a, counts } : a),
    }))
  }, [setData])

  const addTransaction = useCallback((tx) => {
    setData(prev => {
      const id = `T-${String(prev._nextTxId).padStart(3, '0')}`
      return { ...prev, transactions: [...prev.transactions, { id, ...tx }], _nextTxId: prev._nextTxId + 1 }
    })
  }, [setData])

  const deleteTransaction = useCallback((id) => {
    setData(prev => {
      const tx = prev.transactions.find(t => t.id === id)
      // A transfer's two legs (same PO + ingredient) must go together, or stock is created/lost
      const isPairedLeg = t => tx?.poId != null && t.poId === tx.poId && t.ingredientId === tx.ingredientId
      return { ...prev, transactions: prev.transactions.filter(t => t.id !== id && !isPairedLeg(t)) }
    })
  }, [setData])

  const addPurchaseOrder = useCallback((po) => {
    setData(prev => ({ ...prev, purchaseOrders: [po, ...prev.purchaseOrders], _nextPoId: prev._nextPoId + 1 }))
  }, [setData])

  const updatePurchaseOrder = useCallback((id, changes, logMsg) => {
    setData(prev => {
      const po = prev.purchaseOrders.find(p => p.id === id)
      if (!po) return prev

      const editHistory = logMsg 
        ? [...(po.editHistory || []), { date: new Date().toISOString(), msg: logMsg }]
        : po.editHistory

      const updatedPo = { ...po, ...changes, editHistory }

      let newTxns = prev.transactions
      let nextTxId = prev._nextTxId

      // If the PO is already 'received' and is (or was) a transfer, we must resync its transactions
      if (po.status === 'received') {
        const wasTransfer = po.fromLocation && po.toLocation
        const isTransfer = updatedPo.fromLocation && updatedPo.toLocation

        if (wasTransfer || isTransfer) {
          newTxns = newTxns.filter(t => t.poId !== id)

          if (isTransfer) {
            updatedPo.lines.forEach(l => {
              const qty = l.received ?? l.ordered
              if (qty > 0) {
                newTxns.push({ id: `T-${String(nextTxId++).padStart(3, '0')}`, ingredientId: l.ingredientId, store: updatedPo.fromLocation, date: updatedPo.receivedDate, type: 'adjustment', quantity: -qty, poId: id })
                newTxns.push({ id: `T-${String(nextTxId++).padStart(3, '0')}`, ingredientId: l.ingredientId, store: updatedPo.toLocation, date: updatedPo.receivedDate, type: 'adjustment', quantity: qty, poId: id })
              }
            })
          }
        }
      }

      return {
        ...prev,
        purchaseOrders: prev.purchaseOrders.map(p => p.id === id ? updatedPo : p),
        transactions: newTxns,
        _nextTxId: nextTxId,
      }
    })
  }, [setData])

  const deletePurchaseOrder = useCallback((id) => {
    setData(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.filter(po => po.id !== id),
      transactions:   prev.transactions.filter(t => t.poId !== id),
    }))
  }, [setData])

  // Atomically move a received PO's date and any transfer transactions it created
  const updatePoReceivedDate = useCallback((id, receivedDate, receivedAt) => {
    setData(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po =>
        po.id === id ? { ...po, receivedDate, receivedAt } : po
      ),
      transactions: prev.transactions.map(t =>
        t.poId === id ? { ...t, date: receivedDate } : t
      ),
    }))
  }, [setData])

  // Atomically revert a received PO back to sent and remove its transfer transactions
  const revertPoToSent = useCallback((id) => {
    setData(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po =>
        po.id === id ? { ...po, status: 'sent', receivedDate: null, receivedAt: undefined } : po
      ),
      transactions: prev.transactions.filter(t => t.poId !== id),
    }))
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

    const newRows = await fetchDatabricksSales(token, warehouseId, fromDate, toDate)

    // Extract and update distinct stores from data
    const uniqueStores = [...new Set(newRows.map(r => r.store))]
    if (uniqueStores.length > 0) {
      setStoresState(prev => {
        const merged = Array.from(new Set([...prev, ...uniqueStores]))
        // Optional: keep original order for STORES, append new ones sorted
        return merged
      })
    }

    // Merge — deduplicate by date+store+product+topping flag
    const keyOf = r => `${r.date}|${r.store}|${r.product}|${r.transaction_type}|${r.is_topping}`
    const map = new Map(currentRows.map(r => [keyOf(r), r]))
    newRows.forEach(r => map.set(keyOf(r), r))
    const merged = [...map.values()].sort((a, b) => (b.date > a.date ? 1 : -1))

    const newCache = { rows: merged, lastRefreshDate: toDate }
    setSalesCacheState(newCache)
    saveToStorage(SALES_CACHE_KEY, newCache)

    return { upToDate: false, newRows: newRows.length, fromDate, toDate }
  }, [salesCache])

  // ─── Cloud backup ────────────────────────────────────────────────────────────

  const listCloudBackups = useCallback(async () => {
    return fetchCloudBackupsList()
  }, [])

  const saveCloudBackup = useCallback(async (isManual = false) => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), config, data, isManual }
    return pushCloudBackup(payload)
  }, [config, data])

  const restoreCloudBackup = useCallback(async (id) => {
    const parsed = await fetchCloudBackupData(id)
    if (!parsed.config || !parsed.data) throw new Error('Invalid backup')
    restoreFromJson(parsed)
  }, [])

  const restoreFromJson = useCallback((parsed) => {
    setConfig(migrateConfig(parsed.config))
    setData({ ...DEFAULT_DATA, ...parsed.data })
    if (parsed.salesCache !== undefined) {
      if (parsed.salesCache) {
        setSalesCacheState(parsed.salesCache)
        saveToStorage(SALES_CACHE_KEY, parsed.salesCache)
      } else {
        clearSalesCache()
      }
    }
  }, [setConfig, setData, clearSalesCache])

  // ─── Auto-save to Cloud ──────────────────────────────────────────────────────

  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (!settings.autoSaveCloud) return

    const timer = setTimeout(() => {
      saveCloudBackup(false).catch(err => console.error('Auto-save failed:', err))
    }, 60000)

    return () => clearTimeout(timer)
  }, [config, data, settings.autoSaveCloud, saveCloudBackup])

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
          if (parsed.config && parsed.data) {
            // Full debug export — restore everything
            restoreFromJson(parsed)
            resolve()
          } else if (parsed.ingredients && parsed.recipes) {
            setConfig(migrateConfig(parsed))
            resolve()
          } else {
            reject(new Error('Invalid config file'))
          }
        } catch (err) { reject(err) }
      }
      reader.readAsText(file)
    })
  , [restoreFromJson, setConfig])

  const addSupplier = useCallback((name) => {
    setConfig(prev => ({
      ...prev,
      suppliers: [...(prev.suppliers ?? []), { id: prev._nextSupplierId ?? 1, name }],
      _nextSupplierId: (prev._nextSupplierId ?? 1) + 1,
    }))
  }, [setConfig])

  const updateSupplier = useCallback((id, name) => {
    setConfig(prev => ({ ...prev, suppliers: (prev.suppliers ?? []).map(s => s.id === id ? { ...s, name } : s) }))
  }, [setConfig])

  const deleteSupplier = useCallback((id) => {
    setConfig(prev => ({
      ...prev,
      suppliers: (prev.suppliers ?? []).filter(s => s.id !== id),
      ingredients: prev.ingredients.map(i => i.supplierId === id ? { ...i, supplierId: null } : i),
    }))
  }, [setConfig])

  return (
    <ConfigContext.Provider value={{
      config, setConfig,
      data, setData,
      addAudit, deleteAudit, updateAudit, addTransaction, deleteTransaction,
      addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, revertPoToSent, updatePoReceivedDate,
      sales, posWaste, usingLiveData, salesCache, clearSalesCache,
      stores, visibleStores, suppressedStores, toggleStoreVisibility,
      settings, saveSettings, refreshSales,
      reportFrom, reportTo,
      exportConfig, importConfig,
      saveCloudBackup, restoreCloudBackup, listCloudBackups, restoreFromJson,
      addSupplier, updateSupplier, deleteSupplier,
    }}>
      {children}
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}

export { useCalcs }
