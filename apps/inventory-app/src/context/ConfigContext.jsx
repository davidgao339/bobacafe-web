import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { stores as STORES } from '../data/fakeData'
import { fetchDatabricksSales, queryD1 } from '../services/api'
import { useCalcs } from '../hooks/useInventoryCalcs'

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

// ─── IndexedDB helpers (for large data like sales cache) ───────────────

const DB_NAME = 'bobacafe_db'
const STORE_NAME = 'cache'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key, val) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(val, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbRemove(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ConfigContext = createContext(null)

export function ConfigProvider({ children }) {
  // Initialize with empty defaults, will populate from D1
  const [config, setConfigState] = useState({ ingredients: DEFAULT_INGREDIENTS, recipes: DEFAULT_RECIPES, suppliers: [], _nextIngId: 1, _nextSupplierId: 1 })
  const [data, setDataState] = useState(DEFAULT_DATA)
  
  const [isD1Loaded, setIsD1Loaded] = useState(false)
  const [salesCache, setSalesCacheState] = useState(null)
  const [settings, setSettingsState] = useState(() => {
    const stored = loadFromStorage(SETTINGS_KEY) ?? {}
    return { token: '', warehouseId: '', ...stored }
  })
  const [stores, setStoresState] = useState(() => STORES)
  const [suppressedStores, setSuppressedStores] = useState(() => loadFromStorage(SUPPRESSED_STORES_KEY) ?? [])

  // ─── D1 Data Loading ────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadFromD1() {
      try {
        const [ingRes, recRes, suppRes, txRes, poRes, audRes] = await Promise.all([
          queryD1('SELECT * FROM ingredients'),
          queryD1("SELECT * FROM recipes WHERE type = 'retail'"),
          queryD1('SELECT * FROM suppliers'),
          queryD1('SELECT * FROM transactions'),
          queryD1('SELECT * FROM purchase_orders'),
          queryD1('SELECT * FROM audits')
        ])
        
        setConfigState({
          ingredients: ingRes,
          recipes: Object.fromEntries(recRes.map(r => [r.product_name, JSON.parse(r.ingredient_mapping)])),
          suppliers: suppRes,
          _nextIngId: Math.max(0, ...ingRes.map(i => i.id)) + 1,
          _nextSupplierId: Math.max(0, ...suppRes.map(s => s.id)) + 1,
        })
        
        setDataState({
          transactions: txRes,
          purchaseOrders: poRes.map(po => ({...po, lines: JSON.parse(po.lines)})),
          audits: audRes.map(a => ({...a, counts: JSON.parse(a.counts)})),
          _nextTxId: Math.max(0, ...txRes.map(t => parseInt(t.id.replace('T-', '')) || 0)) + 1,
          _nextPoId: Math.max(0, ...poRes.map(p => parseInt(p.id.replace('PO-', '').replace('TR-', '')) || 0)) + 1,
          _nextAuditId: Math.max(0, ...audRes.map(a => parseInt(a.id.replace('A-', '')) || 0)) + 1,
        })
        
        setIsD1Loaded(true)
      } catch (err) {
        console.error("Failed to load from D1:", err)
        alert("Could not load database. Running empty.")
        setIsD1Loaded(true)
      }
    }
    loadFromD1()
  }, [])

  // Async load sales cache from IDB
  useEffect(() => {
    async function initSalesCache() {
      try {
        let cache = await idbGet(SALES_CACHE_KEY)
        if (!cache) {
          cache = loadFromStorage(SALES_CACHE_KEY)
          if (cache) {
            await idbSet(SALES_CACHE_KEY, cache)
            localStorage.removeItem(SALES_CACHE_KEY)
          }
        }
        if (cache) setSalesCacheState(cache)
      } catch (err) {
        console.error('Failed to load sales cache from IDB', err)
      }
    }
    initSalesCache()
  }, [])

  const saveSettings = useCallback((s) => {
    setSettingsState(s)
    saveToStorage(SETTINGS_KEY, s)
  }, [])

  const clearSalesCache = useCallback(() => {
    setSalesCacheState(null)
    idbRemove(SALES_CACHE_KEY).catch(console.error)
  }, [])

  const toggleStoreVisibility = useCallback((store) => {
    setSuppressedStores(prev => {
      const next = prev.includes(store) ? prev.filter(s => s !== store) : [...prev, store]
      saveToStorage(SUPPRESSED_STORES_KEY, next)
      return next
    })
  }, [])

  const visibleStores = useMemo(() => {
    if (!stores || !suppressedStores) return stores || []
    return stores.filter(s => !suppressedStores.includes(s))
  }, [stores, suppressedStores])

  // ─── Operational data mutations (Optimistic + D1) ───────────────────────────

  const addAudit = useCallback((store, date, counts, timestamp) => {
    setDataState(prev => {
      const existing = prev.audits.find(a => a.store === store && a.date === date)
      if (existing) {
        queryD1(`UPDATE audits SET counts = ?, timestamp = ? WHERE id = ?`, [JSON.stringify(counts), timestamp || new Date().toISOString(), existing.id]).catch(console.error)
        return {
          ...prev,
          audits: prev.audits.map(a => a.id === existing.id ? { ...a, counts: { ...a.counts, ...counts }, ...(timestamp && { timestamp }) } : a),
        }
      }
      const id = `A-${String(prev._nextAuditId).padStart(3, '0')}`
      queryD1(`INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`, [id, store, date, JSON.stringify(counts), timestamp || new Date().toISOString()]).catch(console.error)
      return { ...prev, audits: [...prev.audits, { id, store, date, counts, ...(timestamp && { timestamp }) }], _nextAuditId: prev._nextAuditId + 1 }
    })
  }, [])

  const deleteAudit = useCallback((id) => {
    queryD1(`DELETE FROM audits WHERE id = ?`, [id]).catch(console.error)
    setDataState(prev => ({ ...prev, audits: prev.audits.filter(a => a.id !== id) }))
  }, [])

  const updateAudit = useCallback((id, counts) => {
    queryD1(`UPDATE audits SET counts = ? WHERE id = ?`, [JSON.stringify(counts), id]).catch(console.error)
    setDataState(prev => ({
      ...prev,
      audits: prev.audits.map(a => a.id === id ? { ...a, counts } : a),
    }))
  }, [])

  const addTransaction = useCallback((tx) => {
    setDataState(prev => {
      const id = `T-${String(prev._nextTxId).padStart(3, '0')}`
      const newTx = { id, ...tx, timestamp: tx.timestamp || new Date().toISOString() }
      queryD1(
        `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newTx.id, newTx.store, newTx.date, newTx.type, newTx.ingredientId, newTx.quantity, newTx.poId || null, newTx.reason || null, newTx.timestamp]
      ).catch(console.error)
      return { ...prev, transactions: [...prev.transactions, newTx], _nextTxId: prev._nextTxId + 1 }
    })
  }, [])

  const deleteTransaction = useCallback((id) => {
    setDataState(prev => {
      const tx = prev.transactions.find(t => t.id === id)
      const isPairedLeg = t => tx?.poId != null && t.poId === tx.poId && t.ingredientId === tx.ingredientId
      
      const toDelete = prev.transactions.filter(t => t.id === id || isPairedLeg(t))
      toDelete.forEach(d => queryD1(`DELETE FROM transactions WHERE id = ?`, [d.id]).catch(console.error))
      
      return { ...prev, transactions: prev.transactions.filter(t => t.id !== id && !isPairedLeg(t)) }
    })
  }, [])

  const addPurchaseOrder = useCallback((po) => {
    setDataState(prev => {
      queryD1(
        `INSERT INTO purchase_orders (id, store, status, receivedAt, lines) VALUES (?, ?, ?, ?, ?)`,
        [po.id, po.store, po.status, po.receivedAt || null, JSON.stringify(po.lines || [])]
      ).catch(console.error)
      return { ...prev, purchaseOrders: [po, ...prev.purchaseOrders], _nextPoId: prev._nextPoId + 1 }
    })
  }, [])

  const updatePurchaseOrder = useCallback((id, changes, logMsg) => {
    setDataState(prev => {
      const po = prev.purchaseOrders.find(p => p.id === id)
      if (!po) return prev

      const editHistory = logMsg 
        ? [...(po.editHistory || []), { date: new Date().toISOString(), msg: logMsg }]
        : po.editHistory

      const updatedPo = { ...po, ...changes, editHistory }
      
      queryD1(`UPDATE purchase_orders SET status = ?, receivedAt = ?, lines = ? WHERE id = ?`, 
        [updatedPo.status, updatedPo.receivedAt || null, JSON.stringify(updatedPo.lines), id]).catch(console.error)

      let newTxns = prev.transactions
      let nextTxId = prev._nextTxId

      if (po.status === 'received') {
        const wasTransfer = po.fromLocation && po.toLocation
        const isTransfer = updatedPo.fromLocation && updatedPo.toLocation

        if (wasTransfer || isTransfer) {
          // Delete old transfer txns
          const oldTxns = newTxns.filter(t => t.poId === id)
          oldTxns.forEach(t => queryD1(`DELETE FROM transactions WHERE id = ?`, [t.id]).catch(console.error))
          
          newTxns = newTxns.filter(t => t.poId !== id)

          if (isTransfer) {
            updatedPo.lines.forEach(l => {
              const qty = l.received ?? l.ordered
              if (qty > 0) {
                const tx1 = { id: `T-${String(nextTxId++).padStart(3, '0')}`, ingredientId: l.ingredientId, store: updatedPo.fromLocation, date: updatedPo.receivedDate, type: 'adjustment', quantity: -qty, poId: id, timestamp: new Date().toISOString() }
                const tx2 = { id: `T-${String(nextTxId++).padStart(3, '0')}`, ingredientId: l.ingredientId, store: updatedPo.toLocation, date: updatedPo.receivedDate, type: 'adjustment', quantity: qty, poId: id, timestamp: new Date().toISOString() }
                
                queryD1(`INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tx1.id, tx1.store, tx1.date, tx1.type, tx1.ingredientId, tx1.quantity, tx1.poId, tx1.timestamp]).catch(console.error)
                queryD1(`INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tx2.id, tx2.store, tx2.date, tx2.type, tx2.ingredientId, tx2.quantity, tx2.poId, tx2.timestamp]).catch(console.error)
                
                newTxns.push(tx1, tx2)
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
  }, [])

  const deletePurchaseOrder = useCallback((id) => {
    queryD1(`DELETE FROM purchase_orders WHERE id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM transactions WHERE poId = ?`, [id]).catch(console.error)
    
    setDataState(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.filter(po => po.id !== id),
      transactions:   prev.transactions.filter(t => t.poId !== id),
    }))
  }, [])

  const updatePoReceivedDate = useCallback((id, receivedDate, receivedAt) => {
    queryD1(`UPDATE purchase_orders SET receivedAt = ? WHERE id = ?`, [receivedAt, id]).catch(console.error)
    queryD1(`UPDATE transactions SET date = ? WHERE poId = ?`, [receivedDate, id]).catch(console.error)
    
    setDataState(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po =>
        po.id === id ? { ...po, receivedDate, receivedAt } : po
      ),
      transactions: prev.transactions.map(t =>
        t.poId === id ? { ...t, date: receivedDate } : t
      ),
    }))
  }, [])

  const revertPoToSent = useCallback((id) => {
    queryD1(`UPDATE purchase_orders SET status = 'sent', receivedAt = NULL WHERE id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM transactions WHERE poId = ?`, [id]).catch(console.error)
    
    setDataState(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po =>
        po.id === id ? { ...po, status: 'sent', receivedDate: null, receivedAt: undefined } : po
      ),
      transactions: prev.transactions.filter(t => t.poId !== id),
    }))
  }, [])
  
  // ─── Config mutations ───────────────────────────────────────────────────────
  
  const setConfig = useCallback((updater) => {
    setConfigState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      
      // Compute delta for recipes
      if (next.recipes !== prev.recipes) {
        for (const [product, mapping] of Object.entries(next.recipes)) {
          if (JSON.stringify(mapping) !== JSON.stringify(prev.recipes[product])) {
            queryD1(`INSERT OR REPLACE INTO recipes (product_name, type, ingredient_mapping) VALUES (?, 'retail', ?)`, [product, JSON.stringify(mapping)]).catch(console.error)
          }
        }
        const nextProducts = new Set(Object.keys(next.recipes))
        for (const product of Object.keys(prev.recipes)) {
          if (!nextProducts.has(product)) {
            queryD1(`DELETE FROM recipes WHERE product_name = ? AND type = 'retail'`, [product]).catch(console.error)
          }
        }
      }

      // Compute delta for ingredients
      if (next.ingredients !== prev.ingredients) {
        for (const ing of next.ingredients) {
          const oldIng = prev.ingredients.find(i => i.id === ing.id)
          if (!oldIng || JSON.stringify(oldIng) !== JSON.stringify(ing)) {
            queryD1(`INSERT OR REPLACE INTO ingredients (id, name, unit, productType, supplierId) VALUES (?, ?, ?, ?, ?)`, 
              [ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null]).catch(console.error)
          }
        }
        const nextIds = new Set(next.ingredients.map(i => i.id))
        for (const oldIng of prev.ingredients) {
          if (!nextIds.has(oldIng.id)) {
            queryD1(`DELETE FROM ingredients WHERE id = ?`, [oldIng.id]).catch(console.error)
          }
        }
      }
      
      return next
    })
  }, [])

  const addSupplier = useCallback((name) => {
    setConfigState(prev => {
      const id = prev._nextSupplierId ?? 1
      queryD1(`INSERT INTO suppliers (id, name) VALUES (?, ?)`, [id, name]).catch(console.error)
      return {
        ...prev,
        suppliers: [...(prev.suppliers ?? []), { id, name }],
        _nextSupplierId: id + 1,
      }
    })
  }, [])

  const updateSupplier = useCallback((id, name) => {
    queryD1(`UPDATE suppliers SET name = ? WHERE id = ?`, [name, id]).catch(console.error)
    setConfigState(prev => ({ ...prev, suppliers: (prev.suppliers ?? []).map(s => s.id === id ? { ...s, name } : s) }))
  }, [])

  const deleteSupplier = useCallback((id) => {
    queryD1(`DELETE FROM suppliers WHERE id = ?`, [id]).catch(console.error)
    queryD1(`UPDATE ingredients SET supplierId = NULL WHERE supplierId = ?`, [id]).catch(console.error)
    setConfigState(prev => ({
      ...prev,
      suppliers: (prev.suppliers ?? []).filter(s => s.id !== id),
      ingredients: prev.ingredients.map(i => i.supplierId === id ? { ...i, supplierId: null } : i),
    }))
  }, [])
  
  const setData = useCallback((updater) => {
    setDataState(updater)
  }, [])

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

    const uniqueStores = [...new Set(newRows.map(r => r.store))]
    if (uniqueStores.length > 0) {
      setStoresState(prev => {
        const merged = Array.from(new Set([...prev, ...uniqueStores]))
        return merged
      })
    }

    const keyOf = r => `${r.date}|${r.store}|${r.product}|${r.transaction_type}|${r.is_topping}`
    const map = new Map(currentRows.map(r => [keyOf(r), r]))
    newRows.forEach(r => map.set(keyOf(r), r))
    const merged = [...map.values()].sort((a, b) => (b.date > a.date ? 1 : -1))

    const newCache = { rows: merged, lastRefreshDate: toDate }
    setSalesCacheState(newCache)
    idbSet(SALES_CACHE_KEY, newCache).catch(console.error)

    return { upToDate: false, newRows: newRows.length, fromDate, toDate }
  }, [salesCache])

  // Removed cloud backups logic, D1 is now the source of truth
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
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result)
          let nextConfig, nextData
          
          if (parsed.config && parsed.data) {
            nextConfig = parsed.config
            nextData = parsed.data
          } else if (parsed.ingredients && parsed.recipes) {
            nextConfig = parsed
            nextData = null
          } else {
            return reject(new Error('Invalid config file'))
          }

          // Generate next IDs
          const conf = {
            ingredients: nextConfig.ingredients || [],
            recipes: nextConfig.recipes || {},
            suppliers: nextConfig.suppliers || [],
            _nextIngId: Math.max(0, ...(nextConfig.ingredients || []).map(i => i.id)) + 1,
            _nextSupplierId: Math.max(0, ...(nextConfig.suppliers || []).map(s => s.id)) + 1,
          }

          // Sync Config to D1
          await queryD1(`DELETE FROM ingredients`)
          for (const ing of conf.ingredients) {
            await queryD1(`INSERT INTO ingredients (id, name, unit, productType, supplierId) VALUES (?, ?, ?, ?, ?)`, [ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null])
          }
          
          await queryD1(`DELETE FROM recipes WHERE type = 'retail'`)
          for (const [product, mapping] of Object.entries(conf.recipes)) {
            await queryD1(`INSERT INTO recipes (product_name, type, ingredient_mapping) VALUES (?, 'retail', ?)`, [product, JSON.stringify(mapping)])
          }
          
          await queryD1(`DELETE FROM suppliers`)
          for (const supp of conf.suppliers) {
            await queryD1(`INSERT INTO suppliers (id, name) VALUES (?, ?)`, [supp.id, supp.name])
          }

          setConfigState(conf)

          // Sync Data to D1 if present
          if (nextData) {
            const d = {
              transactions: nextData.transactions || [],
              purchaseOrders: nextData.purchaseOrders || [],
              audits: nextData.audits || [],
            }
            d._nextTxId = Math.max(0, ...d.transactions.map(t => parseInt(t.id.replace('T-', '')) || 0)) + 1
            d._nextPoId = Math.max(0, ...d.purchaseOrders.map(p => parseInt(p.id.replace('PO-', '').replace('TR-', '')) || 0)) + 1
            d._nextAuditId = Math.max(0, ...d.audits.map(a => parseInt(a.id.replace('A-', '')) || 0)) + 1

            await queryD1(`DELETE FROM transactions`)
            for (const tx of d.transactions) {
              await queryD1(`INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [tx.id, tx.store, tx.date, tx.type, tx.ingredientId, tx.quantity, tx.poId || null, tx.reason || null, tx.timestamp || new Date().toISOString()])
            }

            await queryD1(`DELETE FROM purchase_orders`)
            for (const po of d.purchaseOrders) {
              await queryD1(`INSERT INTO purchase_orders (id, store, status, receivedAt, lines) VALUES (?, ?, ?, ?, ?)`, 
                [po.id, po.store, po.status, po.receivedAt || null, JSON.stringify(po.lines || [])])
            }

            await queryD1(`DELETE FROM audits`)
            for (const audit of d.audits) {
              await queryD1(`INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`, 
                [audit.id, audit.store, audit.date, JSON.stringify(audit.counts || {}), audit.timestamp || new Date().toISOString()])
            }

            setDataState(d)
          }

          resolve()
        } catch (err) { reject(err) }
      }
      reader.readAsText(file)
    })
  , [])

  // If not loaded, we can return null to avoid crashing child components that expect full data,
  // or return the context. For now, children expect data to be defined. It starts as DEFAULT_DATA.
  
  if (!isD1Loaded) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
  }

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
