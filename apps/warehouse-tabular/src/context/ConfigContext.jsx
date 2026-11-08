import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { stores as STORES } from '@inventory/data/fakeData'
import { fetchDatabricksSales, queryD1 } from '@inventory/services/api'
import { useCalcs } from '../hooks/useInventoryCalcs'
import SyncErrorToast from '@inventory/components/SyncErrorToast'

const SALES_CACHE_KEY       = 'bobacafe_sales_cache'
const SETTINGS_KEY          = 'bobacafe_settings'
const SUPPRESSED_STORES_KEY = 'bobacafe_suppressed_stores'
const COOK_UNIT_PAY_KEY     = 'bobacafe_cook_unit_pay'

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
  const [config, setConfigState] = useState(() => ({
    ingredients: DEFAULT_INGREDIENTS,
    recipes: DEFAULT_RECIPES,
    unitPay: loadFromStorage(COOK_UNIT_PAY_KEY) || {},
    suppliers: [],
    _nextIngId: 1,
    _nextSupplierId: 1
  }))
  const [data, setDataState] = useState(DEFAULT_DATA)
  
  const [isD1Loaded, setIsD1Loaded] = useState(false)
  const [salesCache, setSalesCacheState] = useState(null)
  const [settings, setSettingsState] = useState(() => {
    const stored = loadFromStorage(SETTINGS_KEY) ?? {}
    return { token: '', warehouseId: '', ...stored }
  })
  const [stores, setStoresState] = useState(() => STORES)
  const [suppressedStores, setSuppressedStores] = useState([])
  const storeMapsRef = useRef({ idToName: { 99: 'Warehouse' }, nameToId: { 'Warehouse': 99, 'СКЛАД': 99 }, idToCode: { 99: 'WHS' } })

  const resolveStoreId = useCallback((name) => {
    if (!name) return null
    const trimmed = String(name).trim()
    const { nameToId } = storeMapsRef.current
    if (nameToId[trimmed] !== undefined) return nameToId[trimmed]
    const lower = trimmed.toLowerCase()
    if (lower === 'warehouse' || lower === 'склад') return 99
    for (const [k, v] of Object.entries(nameToId)) {
      if (k.toLowerCase() === lower) return v
    }
    return null
  }, [])

  const resolveStoreCode = useCallback((storeId) => {
    if (!storeId) return ''
    return storeMapsRef.current.idToCode[storeId] || ''
  }, [])

  // ─── D1 Tabular Data Loading ──────────────────────────────────────────────
  useEffect(() => {
    async function loadFromD1() {
      try {
        const [storesRes, aliasesRes, ingRes, recRes, suppRes, txRes, posRes, linesRes, audHeadersRes, audCountsRes, payRes] = await Promise.all([
          queryD1('SELECT * FROM dim_stores ORDER BY store_id ASC'),
          queryD1('SELECT * FROM dim_store_aliases'),
          queryD1('SELECT ingredient_id AS id, ingredient_name AS name, unit, product_type AS productType, supplier_id AS supplierId, supplier_name AS supplierName, is_warehouse_only AS warehouseOnly, is_hidden AS hidden, cost_per_unit AS costPerUnit, last_purchase_cost AS lastPurchaseCost, wac_cost_30d AS wacCost30d FROM dim_ingredients'),
          queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'production'"),
          queryD1('SELECT * FROM suppliers'),
          queryD1('SELECT transaction_id AS id, store_id AS storeId, store_code AS storeCode, transaction_date AS date, transaction_timestamp AS timestamp, transaction_type AS type, ingredient_id AS ingredientId, ingredient_name AS ingredientName, quantity, po_id AS poId, reason FROM fact_inventory_transactions ORDER BY transaction_date DESC, transaction_timestamp DESC'),
          queryD1('SELECT * FROM fact_purchase_orders ORDER BY po_id DESC'),
          queryD1('SELECT * FROM fact_purchase_order_lines ORDER BY po_id, line_index ASC'),
          queryD1('SELECT audit_id AS id, store_id AS storeId, store_code AS storeCode, audit_date AS date, audit_timestamp AS timestamp, status FROM fact_audit_headers ORDER BY audit_date DESC, audit_timestamp DESC'),
          queryD1('SELECT audit_id, ingredient_id, count_quantity FROM fact_audit_counts'),
          queryD1("SELECT product_name, pay_rate FROM dim_cook_unit_pay").catch(() => [])
        ])

        const idToName = { 99: 'Warehouse' }
        const nameToId = { 'Warehouse': 99, 'СКЛАД': 99 }
        const idToCode = { 99: 'WHS' }

        storesRes.forEach(s => {
          idToName[s.store_id] = s.store_name
          idToCode[s.store_id] = s.store_code
          nameToId[s.store_name] = s.store_id
          if (s.store_name_en) nameToId[s.store_name_en] = s.store_id
          if (s.store_code) nameToId[s.store_code] = s.store_id
        })

        aliasesRes.forEach(a => {
          if (a.alias_name && a.store_id) {
            nameToId[a.alias_name] = a.store_id
          }
        })
        storeMapsRef.current = { idToName, nameToId, idToCode }

        const activeStores = storesRes.filter(s => s.is_active && s.store_id !== 99).map(s => s.store_name)
        setStoresState(['Warehouse', ...activeStores])

        let unitPay = loadFromStorage(COOK_UNIT_PAY_KEY) || {}
        if (payRes && payRes.length > 0) {
          payRes.forEach(p => {
            if (p.product_name) unitPay[p.product_name] = Number(p.pay_rate) || 0
          })
          saveToStorage(COOK_UNIT_PAY_KEY, unitPay)
        }

        const ingredients = ingRes.map(i => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          productType: i.productType,
          supplierId: i.supplierId,
          supplierName: i.supplierName,
          hidden: Boolean(i.hidden),
          warehouseOnly: Boolean(i.warehouseOnly),
          costPerUnit: i.costPerUnit != null ? Number(i.costPerUnit) : (i.lastPurchaseCost != null ? Number(i.lastPurchaseCost) : 0),
          lastPurchaseCost: i.lastPurchaseCost != null ? Number(i.lastPurchaseCost) : 0,
          wacCost30d: i.wacCost30d != null ? Number(i.wacCost30d) : 0,
        }))

        const recipes = {}
        recRes.forEach(r => {
          if (!recipes[r.recipe_product_name]) recipes[r.recipe_product_name] = {}
          recipes[r.recipe_product_name][r.ingredient_id] = Number(r.amount_per_serving) || 0
        })

        setConfigState({
          ingredients,
          recipes,
          unitPay,
          suppliers: suppRes,
          _nextIngId: Math.max(0, ...ingredients.map(i => i.id)) + 1,
          _nextSupplierId: Math.max(0, ...suppRes.map(s => s.id)) + 1,
        })

        const linesByPo = {}
        linesRes.forEach(l => {
          if (!linesByPo[l.po_id]) linesByPo[l.po_id] = []
          linesByPo[l.po_id].push(l)
        })

        const purchaseOrders = posRes.map(po => {
          const pLines = linesByPo[po.po_id] || []
          const regularLines = pLines.filter(l => !l.is_custom_item).map(l => ({
            ingredientId: l.ingredient_id,
            name: l.ingredient_name,
            unit: l.unit,
            ordered: l.ordered_quantity ?? 0,
            received: l.received_quantity ?? 0,
            unitCost: l.unit_cost != null ? Number(l.unit_cost) : 0,
            totalCost: l.total_cost != null ? Number(l.total_cost) : ((l.unit_cost || 0) * (l.received_quantity || l.ordered_quantity || 0)),
            costCategory: l.cost_category || 'cogs',
            overheadCategory: null
          }))
          const customLines = pLines.filter(l => l.is_custom_item).map(l => ({
            id: String(l.line_index),
            name: l.ingredient_name,
            unit: l.unit || 'шт',
            ordered: l.ordered_quantity ?? 0,
            received: l.received_quantity ?? 0,
            unitCost: l.unit_cost != null ? Number(l.unit_cost) : 0,
            totalCost: l.total_cost != null ? Number(l.total_cost) : ((l.unit_cost || 0) * (l.received_quantity || l.ordered_quantity || 0)),
            costCategory: l.cost_category || 'overhead',
            overheadCategory: l.overhead_category || 'General Overhead'
          }))

          const storeName = idToName[po.store_id] || po.store_code || 'Warehouse'
          const fromStoreName = po.from_store_id ? (idToName[po.from_store_id] || 'Warehouse') : null
          const toStoreName = po.to_store_id ? (idToName[po.to_store_id] || null) : null

          return {
            id: po.po_id,
            orderType: po.order_type,
            storeId: po.store_id,
            store: storeName,
            fromStoreId: po.from_store_id,
            fromLocation: fromStoreName,
            toStoreId: po.to_store_id,
            toLocation: toStoreName,
            status: po.status,
            createdDate: po.created_date,
            sentDate: po.sent_date,
            receivedDate: po.received_date,
            receivedAt: po.received_at,
            supplierId: po.supplier_id,
            lines: regularLines,
            customLines: customLines,
            isOzon: po.po_id.startsWith('OZON-')
          }
        })

        const countsByAudit = {}
        audCountsRes.forEach(c => {
          if (!countsByAudit[c.audit_id]) countsByAudit[c.audit_id] = {}
          countsByAudit[c.audit_id][c.ingredient_id] = Number(c.count_quantity) || 0
        })

        const audits = audHeadersRes.map(h => ({
          id: h.id,
          store: idToName[h.storeId] || h.storeCode || 'Warehouse',
          storeId: h.storeId,
          date: h.date,
          timestamp: h.timestamp,
          status: h.status,
          counts: countsByAudit[h.id] || {}
        }))

        const transactions = txRes.map(t => ({
          id: t.id,
          store: idToName[t.storeId] || t.storeCode || 'Warehouse',
          storeId: t.storeId,
          date: t.date,
          timestamp: t.timestamp,
          type: t.type,
          ingredientId: t.ingredientId,
          ingredientName: t.ingredientName,
          quantity: Number(t.quantity) || 0,
          poId: t.poId,
          reason: t.reason
        }))

        setDataState({
          transactions,
          purchaseOrders,
          audits,
          _nextTxId: Math.max(0, ...transactions.map(t => parseInt(String(t.id).replace('T-', '')) || 0)) + 1,
          _nextPoId: Math.max(0, ...purchaseOrders.map(p => parseInt(String(p.id).replace('PO-', '').replace('TR-', '').replace('OZON-', '')) || 0)) + 1,
          _nextAuditId: Math.max(0, ...audits.map(a => parseInt(String(a.id).replace('A-', '')) || 0)) + 1,
        })

        setIsD1Loaded(true)
      } catch (err) {
        console.error("Failed to load tabular data from D1:", err)
        alert(`Could not load tabular database. Running empty. Error: ${err.message}`)
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
    setSettingsState(prev => {
      const next = { ...prev, ...s }
      saveToStorage(SETTINGS_KEY, next)
      return next
    })
  }, [])

  const updateOzonMapping = useCallback((rawName, ingredientId, multiplier = null) => {
    setSettingsState(prev => {
      const next = { ...prev, ozonMappings: { ...(prev.ozonMappings || {}) } }
      if (multiplier !== null) {
        next.ozonMappings[rawName] = { id: ingredientId, multiplier }
      } else {
        next.ozonMappings[rawName] = ingredientId
      }
      saveToStorage(SETTINGS_KEY, next)
      return next
    })
  }, [])

  const clearSalesCache = useCallback(() => {
    setSalesCacheState(null)
    idbRemove(SALES_CACHE_KEY).catch(console.error)
  }, [])

  const visibleStores = ['Warehouse']

  // ─── Operational data mutations (Optimistic + D1 Tabular & Legacy) ────────
  const addAudit = useCallback((store, date, counts, timestamp) => {
    const storeId = resolveStoreId(store)
    const storeCode = resolveStoreCode(storeId)
    const ts = timestamp || new Date().toISOString()

    setDataState(prev => {
      const existing = prev.audits.find(a => a.store === store && a.date === date)
      const auditId = existing ? existing.id : `A-${String(prev._nextAuditId).padStart(3, '0')}`

      // 1. D1 fact_audit_headers
      queryD1(
        `INSERT OR REPLACE INTO fact_audit_headers (audit_id, store_id, store_code, audit_date, audit_timestamp, status) VALUES (?, ?, ?, ?, ?, 'approved')`,
        [auditId, storeId, storeCode, date, ts]
      ).catch(console.error)

      // 2. D1 fact_audit_counts
      const mergedCounts = existing ? { ...existing.counts, ...counts } : counts
      queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [auditId]).catch(console.error)
      Object.entries(mergedCounts).forEach(([ingId, qty]) => {
        if (Number(qty) > 0) {
          const ing = config.ingredients.find(i => String(i.id) === String(ingId))
          queryD1(
            `INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
            [auditId, storeId, date, Number(ingId), ing?.name || `Item #${ingId}`, Number(qty)]
          ).catch(console.error)
        }
      })

      // 3. Legacy audits table sync
      if (existing) {
        queryD1(`UPDATE audits SET counts = ?, timestamp = ? WHERE id = ?`, [JSON.stringify(mergedCounts), ts, existing.id]).catch(console.error)
        return {
          ...prev,
          audits: prev.audits.map(a => a.id === existing.id ? { ...a, counts: mergedCounts, ...(timestamp && { timestamp }) } : a),
        }
      }
      queryD1(`INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`, [auditId, store, date, JSON.stringify(counts), ts]).catch(console.error)
      return {
        ...prev,
        audits: [...prev.audits, { id: auditId, store, storeId, date, counts, timestamp: ts, status: 'approved' }],
        _nextAuditId: prev._nextAuditId + 1
      }
    })
  }, [config.ingredients, resolveStoreId, resolveStoreCode])

  const deleteAudit = useCallback((id) => {
    queryD1(`DELETE FROM fact_audit_headers WHERE audit_id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM audits WHERE id = ?`, [id]).catch(console.error)
    setDataState(prev => ({ ...prev, audits: prev.audits.filter(a => a.id !== id) }))
  }, [])

  const updateAudit = useCallback((id, counts) => {
    setDataState(prev => {
      const audit = prev.audits.find(a => a.id === id)
      if (!audit) return prev

      queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [id]).catch(console.error)
      Object.entries(counts).forEach(([ingId, qty]) => {
        if (Number(qty) > 0) {
          const ing = config.ingredients.find(i => String(i.id) === String(ingId))
          queryD1(
            `INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, audit.storeId, audit.date, Number(ingId), ing?.name || `Item #${ingId}`, Number(qty)]
          ).catch(console.error)
        }
      })

      queryD1(`UPDATE audits SET counts = ? WHERE id = ?`, [JSON.stringify(counts), id]).catch(console.error)
      return {
        ...prev,
        audits: prev.audits.map(a => a.id === id ? { ...a, counts } : a),
      }
    })
  }, [config.ingredients])

  const addTransaction = useCallback((tx) => {
    const storeId = resolveStoreId(tx.store)
    const storeCode = resolveStoreCode(storeId)
    const newTx = { ...tx, id: tx.id || `T-${Date.now()}`, storeId, timestamp: tx.timestamp || new Date().toISOString() }

    queryD1(
      `INSERT INTO fact_inventory_transactions (transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newTx.id, storeId, storeCode, newTx.date, newTx.timestamp, newTx.type, newTx.ingredientId, newTx.ingredientName || '', newTx.quantity, newTx.poId || null, newTx.reason || null]
    ).catch(console.error)

    queryD1(
      `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [newTx.id, newTx.store, newTx.date, newTx.type, newTx.ingredientId, newTx.quantity, newTx.poId || null, newTx.reason || null, newTx.timestamp]
    ).catch(console.error)

    setDataState(prev => ({ ...prev, transactions: [...prev.transactions, newTx] }))
  }, [resolveStoreId, resolveStoreCode])

  const deleteProductionEvent = useCallback((poId) => {
    setDataState(prev => {
      const toDelete = prev.transactions.filter(t => t.poId === poId && t.type === 'production')
      toDelete.forEach(d => {
        queryD1(`DELETE FROM fact_inventory_transactions WHERE transaction_id = ?`, [d.id]).catch(console.error)
        queryD1(`DELETE FROM transactions WHERE id = ?`, [d.id]).catch(console.error)
      })
      return { ...prev, transactions: prev.transactions.filter(t => t.poId !== poId || t.type !== 'production') }
    })
  }, [])

  const updateProductionEvent = useCallback((poId, newTransactions) => {
    setDataState(prev => {
      const toDelete = prev.transactions.filter(t => t.poId === poId && t.type === 'production')
      toDelete.forEach(d => {
        queryD1(`DELETE FROM fact_inventory_transactions WHERE transaction_id = ?`, [d.id]).catch(console.error)
        queryD1(`DELETE FROM transactions WHERE id = ?`, [d.id]).catch(console.error)
      })
      
      newTransactions.forEach(tx => {
        const storeId = resolveStoreId(tx.store)
        const storeCode = resolveStoreCode(storeId)
        queryD1(
          `INSERT INTO fact_inventory_transactions (transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, storeId, storeCode, tx.date, tx.timestamp, tx.type, tx.ingredientId, tx.ingredientName || '', tx.quantity, tx.poId || null, tx.reason || null]
        ).catch(console.error)

        queryD1(
          `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [tx.id, tx.store, tx.date, tx.type, tx.ingredientId, tx.quantity, tx.poId || null, tx.reason || null, tx.timestamp]
        ).catch(console.error)
      })

      return { 
        ...prev, 
        transactions: [
          ...prev.transactions.filter(t => t.poId !== poId || t.type !== 'production'),
          ...newTransactions
        ] 
      }
    })
  }, [resolveStoreId, resolveStoreCode])

  const deleteTransaction = useCallback((id) => {
    setDataState(prev => {
      const tx = prev.transactions.find(t => t.id === id)
      const isPairedLeg = t => tx?.poId != null && t.poId === tx.poId && t.ingredientId === tx.ingredientId
      
      const toDelete = prev.transactions.filter(t => t.id === id || isPairedLeg(t))
      toDelete.forEach(d => {
        queryD1(`DELETE FROM fact_inventory_transactions WHERE transaction_id = ?`, [d.id]).catch(console.error)
        queryD1(`DELETE FROM transactions WHERE id = ?`, [d.id]).catch(console.error)
      })
      
      return { ...prev, transactions: prev.transactions.filter(t => t.id !== id && !isPairedLeg(t)) }
    })
  }, [])

  const addPurchaseOrder = useCallback((po) => {
    const isTransfer = Boolean(po.fromLocation && po.toLocation)
    const orderType = isTransfer ? 'inter_store_transfer' : 'vendor_order'
    const storeId = resolveStoreId(po.store || po.toLocation || 'Warehouse') || 99
    const fromStoreId = resolveStoreId(po.fromLocation)
    const toStoreId = resolveStoreId(po.toLocation)
    const storeCode = resolveStoreCode(storeId)

    // 1. D1 fact_purchase_orders
    queryD1(
      `INSERT OR REPLACE INTO fact_purchase_orders (
        po_id, order_type, store_id, store_code, from_store_id, to_store_id, status, received_date, received_at, created_date, sent_date, supplier_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        po.id,
        orderType,
        storeId,
        storeCode,
        fromStoreId,
        toStoreId,
        po.status || 'draft',
        po.receivedDate || (po.receivedAt ? po.receivedAt.split('T')[0] : null),
        po.receivedAt || null,
        po.createdDate || null,
        po.sentDate || null,
        po.supplierId || null
      ]
    ).catch(console.error)

    // 2. D1 fact_purchase_order_lines
    queryD1(`DELETE FROM fact_purchase_order_lines WHERE po_id = ?`, [po.id]).catch(console.error)

    ;(po.lines || []).forEach((line, idx) => {
      const ordered = Number(line.ordered) || 0
      const received = Number(line.received) || 0
      if (ordered <= 0 && received <= 0) return

      const ing = config.ingredients.find(i => i.id === line.ingredientId)
      const ingName = line.name || ing?.name || `Item #${line.ingredientId}`
      const unit = line.unit || ing?.unit || ''
      const unitCost = line.unitCost != null ? Number(line.unitCost) : (ing?.costPerUnit || ing?.lastPurchaseCost || null)
      const totalCost = line.totalCost != null ? Number(line.totalCost) : (unitCost != null ? unitCost * ordered : null)

      queryD1(
        `INSERT OR REPLACE INTO fact_purchase_order_lines (
          po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, cost_category, overhead_category
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'cogs', NULL)`,
        [po.id, idx, line.ingredientId, ingName, ordered, received, unit, unitCost, totalCost]
      ).catch(console.error)

      // Update dim_ingredients last_purchase_cost on supplier receipt
      if (!isTransfer && po.status === 'received' && unitCost > 0) {
        queryD1(
          `UPDATE dim_ingredients SET last_purchase_cost = ?, last_purchase_date = ? WHERE ingredient_id = ?`,
          [unitCost, po.receivedDate || new Date().toISOString().slice(0, 10), line.ingredientId]
        ).catch(console.error)
      }
    })

    ;(po.customLines || []).forEach((cline, idx) => {
      const lineIndex = 1000 + idx
      const ordered = Number(cline.ordered) || 0
      const received = Number(cline.received) || 0
      const unitCost = cline.unitCost != null ? Number(cline.unitCost) : null
      const totalCost = cline.totalCost != null ? Number(cline.totalCost) : (unitCost != null ? unitCost * ordered : null)
      const overheadCategory = cline.overheadCategory || 'General Overhead'

      queryD1(
        `INSERT OR REPLACE INTO fact_purchase_order_lines (
          po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, cost_category, overhead_category
        ) VALUES (?, ?, NULL, ?, 1, ?, ?, ?, ?, ?, 'overhead', ?)`,
        [po.id, lineIndex, cline.name || 'One-off item', ordered, received, cline.unit || 'шт', unitCost, totalCost, overheadCategory]
      ).catch(console.error)
    })

    // 3. Sync to legacy purchase_orders blob table
    queryD1(
      `INSERT OR REPLACE INTO purchase_orders (id, store, status, receivedAt, createdDate, sentDate, fromLocation, toLocation, lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        po.id,
        po.store,
        po.status || 'draft',
        po.receivedAt || null,
        po.createdDate || null,
        po.sentDate || null,
        po.fromLocation || null,
        po.toLocation || null,
        JSON.stringify({ regular: po.lines || [], custom: po.customLines || [] })
      ]
    ).catch(console.error)

    setDataState(prev => ({
      ...prev,
      purchaseOrders: [po, ...prev.purchaseOrders],
      _nextPoId: prev._nextPoId + 1
    }))
  }, [config.ingredients, resolveStoreId, resolveStoreCode])

  const updatePurchaseOrder = useCallback((id, changes, logMsg) => {
    setDataState(prev => {
      const po = prev.purchaseOrders.find(p => p.id === id)
      if (!po) return prev

      const editHistory = logMsg 
        ? [...(po.editHistory || []), { date: new Date().toISOString(), msg: logMsg }]
        : po.editHistory

      const updatedPo = { ...po, ...changes, editHistory }
      const isTransfer = Boolean(updatedPo.fromLocation && updatedPo.toLocation)
      const orderType = isTransfer ? 'inter_store_transfer' : 'vendor_order'
      const storeId = resolveStoreId(updatedPo.store || updatedPo.toLocation || 'Warehouse') || 99
      const fromStoreId = resolveStoreId(updatedPo.fromLocation)
      const toStoreId = resolveStoreId(updatedPo.toLocation)
      const storeCode = resolveStoreCode(storeId)

      // 1. Update D1 fact_purchase_orders
      queryD1(
        `UPDATE fact_purchase_orders SET 
          order_type = ?, store_id = ?, store_code = ?, from_store_id = ?, to_store_id = ?,
          status = ?, received_date = ?, received_at = ?, created_date = ?, sent_date = ?
        WHERE po_id = ?`,
        [
          orderType,
          storeId,
          storeCode,
          fromStoreId,
          toStoreId,
          updatedPo.status,
          updatedPo.receivedDate || (updatedPo.receivedAt ? updatedPo.receivedAt.split('T')[0] : null),
          updatedPo.receivedAt || null,
          updatedPo.createdDate || null,
          updatedPo.sentDate || null,
          id
        ]
      ).catch(console.error)

      // 2. If lines or customLines changed, update fact_purchase_order_lines
      if (changes.lines || changes.customLines) {
        queryD1(`DELETE FROM fact_purchase_order_lines WHERE po_id = ?`, [id]).catch(console.error)

        ;(updatedPo.lines || []).forEach((line, idx) => {
          const ordered = Number(line.ordered) || 0
          const received = Number(line.received) || 0
          if (ordered <= 0 && received <= 0) return

          const ing = config.ingredients.find(i => i.id === line.ingredientId)
          const ingName = line.name || ing?.name || `Item #${line.ingredientId}`
          const unit = line.unit || ing?.unit || ''
          const unitCost = line.unitCost != null ? Number(line.unitCost) : (ing?.costPerUnit || ing?.lastPurchaseCost || null)
          const totalCost = line.totalCost != null ? Number(line.totalCost) : (unitCost != null ? unitCost * (received || ordered) : null)

          queryD1(
            `INSERT OR REPLACE INTO fact_purchase_order_lines (
              po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, cost_category, overhead_category
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'cogs', NULL)`,
            [id, idx, line.ingredientId, ingName, ordered, received, unit, unitCost, totalCost]
          ).catch(console.error)

          // Update dim_ingredients last_purchase_cost on supplier receipt
          if (!isTransfer && (updatedPo.status === 'received' || updatedPo.status === 'partially_received') && unitCost > 0) {
            queryD1(
              `UPDATE dim_ingredients SET last_purchase_cost = ?, last_purchase_date = ? WHERE ingredient_id = ?`,
              [unitCost, updatedPo.receivedDate || new Date().toISOString().slice(0, 10), line.ingredientId]
            ).catch(console.error)
          }
        })

        ;(updatedPo.customLines || []).forEach((cline, idx) => {
          const lineIndex = 1000 + idx
          const ordered = Number(cline.ordered) || 0
          const received = Number(cline.received) || 0
          const unitCost = cline.unitCost != null ? Number(cline.unitCost) : null
          const totalCost = cline.totalCost != null ? Number(cline.totalCost) : (unitCost != null ? unitCost * (received || ordered) : null)
          const overheadCategory = cline.overheadCategory || 'General Overhead'

          queryD1(
            `INSERT OR REPLACE INTO fact_purchase_order_lines (
              po_id, line_index, ingredient_id, ingredient_name, is_custom_item, ordered_quantity, received_quantity, unit, unit_cost, total_cost, cost_category, overhead_category
            ) VALUES (?, ?, NULL, ?, 1, ?, ?, ?, ?, ?, 'overhead', ?)`,
            [id, lineIndex, cline.name || 'One-off item', ordered, received, cline.unit || 'шт', unitCost, totalCost, overheadCategory]
          ).catch(console.error)
        })
      }

      // 3. Update legacy purchase_orders
      queryD1(`UPDATE purchase_orders SET status = ?, receivedAt = ?, createdDate = ?, sentDate = ?, fromLocation = ?, toLocation = ?, lines = ? WHERE id = ?`, 
        [updatedPo.status, updatedPo.receivedAt || null, updatedPo.createdDate || null, updatedPo.sentDate || null, updatedPo.fromLocation || null, updatedPo.toLocation || null, JSON.stringify({ regular: updatedPo.lines || [], custom: updatedPo.customLines || [] }), id]).catch(console.error)

      // 4. Handle transfer transactions
      let newTxns = prev.transactions
      let nextTxId = prev._nextTxId

      if (po.status === 'received' || updatedPo.status === 'received') {
        const wasTransfer = po.fromLocation && po.toLocation
        if (wasTransfer || isTransfer) {
          const oldTxns = newTxns.filter(t => t.poId === id)
          oldTxns.forEach(t => {
            queryD1(`DELETE FROM fact_inventory_transactions WHERE transaction_id = ?`, [t.id]).catch(console.error)
            queryD1(`DELETE FROM transactions WHERE id = ?`, [t.id]).catch(console.error)
          })
          
          newTxns = newTxns.filter(t => t.poId !== id)

          if (isTransfer) {
            updatedPo.lines.forEach(l => {
              const qty = l.received ?? l.ordered
              if (qty > 0) {
                const tx1Id = `T-${String(nextTxId++).padStart(3, '0')}`
                const tx2Id = `T-${String(nextTxId++).padStart(3, '0')}`
                const nowIso = new Date().toISOString()
                const rDate = updatedPo.receivedDate || nowIso.slice(0, 10)
                const fromId = resolveStoreId(updatedPo.fromLocation)
                const toId = resolveStoreId(updatedPo.toLocation)

                const tx1 = { id: tx1Id, ingredientId: l.ingredientId, store: updatedPo.fromLocation, storeId: fromId, date: rDate, type: 'adjustment', quantity: -qty, poId: id, timestamp: nowIso }
                const tx2 = { id: tx2Id, ingredientId: l.ingredientId, store: updatedPo.toLocation, storeId: toId, date: rDate, type: 'adjustment', quantity: qty, poId: id, timestamp: nowIso }
                
                queryD1(`INSERT INTO fact_inventory_transactions (transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [tx1.id, fromId, resolveStoreCode(fromId), tx1.date, tx1.timestamp, tx1.type, tx1.ingredientId, l.name || '', tx1.quantity, tx1.poId]).catch(console.error)
                queryD1(`INSERT INTO fact_inventory_transactions (transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [tx2.id, toId, resolveStoreCode(toId), tx2.date, tx2.timestamp, tx2.type, tx2.ingredientId, l.name || '', tx2.quantity, tx2.poId]).catch(console.error)

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
  }, [config.ingredients, resolveStoreId, resolveStoreCode])

  const deletePurchaseOrder = useCallback((id) => {
    queryD1(`DELETE FROM fact_purchase_orders WHERE po_id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM fact_purchase_order_lines WHERE po_id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM fact_inventory_transactions WHERE po_id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM purchase_orders WHERE id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM transactions WHERE poId = ?`, [id]).catch(console.error)
    
    setDataState(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.filter(po => po.id !== id),
      transactions:   prev.transactions.filter(t => t.poId !== id),
    }))
  }, [])

  const updatePoReceivedDate = useCallback((id, receivedDate, receivedAt) => {
    queryD1(`UPDATE fact_purchase_orders SET received_date = ?, received_at = ? WHERE po_id = ?`, [receivedDate, receivedAt, id]).catch(console.error)
    queryD1(`UPDATE purchase_orders SET receivedAt = ? WHERE id = ?`, [receivedAt, id]).catch(console.error)
    queryD1(`UPDATE fact_inventory_transactions SET transaction_date = ?, transaction_timestamp = ? WHERE po_id = ?`, [receivedDate, receivedAt, id]).catch(console.error)
    queryD1(`UPDATE transactions SET date = ? WHERE poId = ?`, [receivedDate, id]).catch(console.error)
    
    setDataState(prev => ({
      ...prev,
      purchaseOrders: prev.purchaseOrders.map(po =>
        po.id === id ? { ...po, receivedDate, receivedAt } : po
      ),
      transactions: prev.transactions.map(t =>
        t.poId === id ? { ...t, date: receivedDate, timestamp: receivedAt } : t
      ),
    }))
  }, [])

  const revertPoToSent = useCallback((id) => {
    queryD1(`UPDATE fact_purchase_orders SET status = 'sent', received_date = NULL, received_at = NULL WHERE po_id = ?`, [id]).catch(console.error)
    queryD1(`UPDATE purchase_orders SET status = 'sent', receivedAt = NULL WHERE id = ?`, [id]).catch(console.error)
    queryD1(`DELETE FROM fact_inventory_transactions WHERE po_id = ?`, [id]).catch(console.error)
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
            queryD1(`DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = ? AND recipe_type = 'production'`, [product]).catch(console.error)
            Object.entries(mapping).forEach(([ingId, amt]) => {
              const ing = next.ingredients?.find(i => String(i.id) === String(ingId))
              queryD1(
                `INSERT INTO fact_recipe_ingredients (recipe_product_name, ingredient_id, ingredient_name, amount_per_serving, recipe_type) VALUES (?, ?, ?, ?, 'production')`,
                [product, Number(ingId), ing?.name || `Item #${ingId}`, Number(amt)]
              ).catch(console.error)
            })
            queryD1(`INSERT OR REPLACE INTO recipes (product_name, type, ingredient_mapping) VALUES (?, 'production', ?)`, [product, JSON.stringify(mapping)]).catch(console.error)
          }
        }
        const nextProducts = new Set(Object.keys(next.recipes))
        for (const product of Object.keys(prev.recipes)) {
          if (!nextProducts.has(product)) {
            queryD1(`DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = ? AND recipe_type = 'production'`, [product]).catch(console.error)
            queryD1(`DELETE FROM recipes WHERE product_name = ? AND type = 'production'`, [product]).catch(console.error)
          }
        }
      }

      // Compute delta for ingredients
      if (next.ingredients !== prev.ingredients) {
        for (const ing of next.ingredients) {
          const oldIng = prev.ingredients.find(i => i.id === ing.id)
          if (!oldIng || JSON.stringify(oldIng) !== JSON.stringify(ing)) {
            queryD1(
              `INSERT OR REPLACE INTO dim_ingredients (ingredient_id, ingredient_name, unit, product_type, supplier_id, supplier_name, is_warehouse_only, is_hidden, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null, ing.supplierName || null, ing.warehouseOnly ? 1 : 0, ing.hidden ? 1 : 0, ing.costPerUnit || null]
            ).catch(console.error)
            queryD1(`INSERT OR REPLACE INTO ingredients (id, name, unit, productType, supplierId, hidden, warehouseOnly) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
              [ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null, ing.hidden ? 1 : 0, ing.warehouseOnly ? 1 : 0]).catch(console.error)
          }
        }
        const nextIds = new Set(next.ingredients.map(i => i.id))
        for (const oldIng of prev.ingredients) {
          if (!nextIds.has(oldIng.id)) {
            queryD1(`DELETE FROM dim_ingredients WHERE ingredient_id = ?`, [oldIng.id]).catch(console.error)
            queryD1(`DELETE FROM ingredients WHERE id = ?`, [oldIng.id]).catch(console.error)
          }
        }
      }
      
      return next
    })
  }, [])

  const refreshRecipes = useCallback(async () => {
    const [recRes, payRes] = await Promise.all([
      queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'production'"),
      queryD1("SELECT product_name, pay_rate FROM dim_cook_unit_pay").catch(() => [])
    ])
    let unitPayUpdate = null
    if (payRes && payRes.length > 0) {
      unitPayUpdate = {}
      payRes.forEach(p => {
        if (p.product_name) unitPayUpdate[p.product_name] = Number(p.pay_rate) || 0
      })
      saveToStorage(COOK_UNIT_PAY_KEY, unitPayUpdate)
    }
    const recipes = {}
    recRes.forEach(r => {
      if (!recipes[r.recipe_product_name]) recipes[r.recipe_product_name] = {}
      recipes[r.recipe_product_name][r.ingredient_id] = Number(r.amount_per_serving) || 0
    })
    setConfigState(prev => ({
      ...prev,
      recipes,
      ...(unitPayUpdate ? { unitPay: unitPayUpdate } : {})
    }))
  }, [])

  const saveUnitPay = useCallback((productName, rate) => {
    setConfigState(prev => {
      const nextUnitPay = { ...(prev.unitPay || {}) }
      const numRate = parseFloat(rate)
      if (!isNaN(numRate) && numRate >= 0) {
        nextUnitPay[productName] = numRate
        queryD1("INSERT OR REPLACE INTO dim_cook_unit_pay (product_name, pay_rate) VALUES (?, ?)", [productName, numRate]).catch(console.error)
      } else {
        delete nextUnitPay[productName]
        queryD1("DELETE FROM dim_cook_unit_pay WHERE product_name = ?", [productName]).catch(console.error)
      }
      saveToStorage(COOK_UNIT_PAY_KEY, nextUnitPay)
      queryD1("INSERT OR REPLACE INTO settings (key, value) VALUES ('cook_unit_pay', ?)", [JSON.stringify(nextUnitPay)]).catch(console.error)
      return {
        ...prev,
        unitPay: nextUnitPay
      }
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
            unitPay: nextConfig.unitPay || config.unitPay || {},
            suppliers: nextConfig.suppliers || [],
            _nextIngId: Math.max(0, ...(nextConfig.ingredients || []).map(i => i.id)) + 1,
            _nextSupplierId: Math.max(0, ...(nextConfig.suppliers || []).map(s => s.id)) + 1,
          }

          // Sync Config to D1
          await queryD1(`DELETE FROM ingredients`)
          for (const ing of conf.ingredients) {
            await queryD1(`INSERT INTO ingredients (id, name, unit, productType, supplierId, hidden, warehouseOnly) VALUES (?, ?, ?, ?, ?, ?, ?)`, [ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null, ing.hidden ? 1 : 0, ing.warehouseOnly ? 1 : 0])
          }
          
          await queryD1(`DELETE FROM recipes WHERE type = 'production'`)
          for (const [product, mapping] of Object.entries(conf.recipes)) {
            await queryD1(`INSERT INTO recipes (product_name, type, ingredient_mapping) VALUES (?, 'production', ?)`, [product, JSON.stringify(mapping)])
          }
          
          await queryD1(`DELETE FROM suppliers`)
          for (const supp of conf.suppliers) {
            await queryD1(`INSERT INTO suppliers (id, name) VALUES (?, ?)`, [supp.id, supp.name])
          }

          if (conf.unitPay) {
            saveToStorage(COOK_UNIT_PAY_KEY, conf.unitPay)
            await queryD1("INSERT OR REPLACE INTO settings (key, value) VALUES ('cook_unit_pay', ?)", [JSON.stringify(conf.unitPay)]).catch(console.error)
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
            d._nextPoId = Math.max(0, ...d.purchaseOrders.map(p => parseInt(p.id.replace('PO-', '').replace('TR-', '').replace('OZON-', '')) || 0)) + 1
            d._nextAuditId = Math.max(0, ...d.audits.map(a => parseInt(a.id.replace('A-', '')) || 0)) + 1

            await queryD1(`DELETE FROM transactions`)
            for (const tx of d.transactions) {
              await queryD1(`INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [tx.id, tx.store, tx.date, tx.type, tx.ingredientId, tx.quantity, tx.poId || null, tx.reason || null, tx.timestamp || new Date().toISOString()])
            }

            await queryD1(`DELETE FROM purchase_orders`)
            for (const po of d.purchaseOrders) {
              await queryD1(`INSERT INTO purchase_orders (id, store, status, receivedAt, createdDate, sentDate, fromLocation, toLocation, lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [po.id, po.store, po.status, po.receivedAt || null, po.createdDate || null, po.sentDate || null, po.fromLocation || null, po.toLocation || null, JSON.stringify({ regular: po.lines || [], custom: po.customLines || [] })])
            }

            await queryD1(`DELETE FROM audits`)
            for (const audit of d.audits) {
              await queryD1(`INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`, 
                [audit.id, audit.store, audit.date, JSON.stringify(audit.counts || {}), audit.timestamp || new Date().toISOString()])
            }

            setDataState(d)
          }
          
          // Import sales cache if present
          if (parsed.salesCache) {
            setSalesCacheState(parsed.salesCache)
            idbSet(SALES_CACHE_KEY, parsed.salesCache).catch(console.error)
          }

          resolve()
        } catch (err) { reject(err) }
      }
      reader.readAsText(file)
    })
  , [])

  const filteredData = useMemo(() => {
    if (!data) return data
      return {
        ...data,
        purchaseOrders: data.purchaseOrders || [],
        transactions: (data.transactions || []).filter(tx => tx.store === 'Warehouse'),
        audits: (data.audits || []).filter(a => a.store === 'Warehouse')
      }
  }, [data])

  // If not loaded, we can return null to avoid crashing child components that expect full data,
  // or return the context. For now, children expect data to be defined. It starts as DEFAULT_DATA.
  if (!isD1Loaded) {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
  }

  return (
    <ConfigContext.Provider value={{
      config, setConfig, refreshRecipes, saveUnitPay,
      data: filteredData, setData,
      addAudit, deleteAudit, updateAudit, addTransaction, deleteTransaction, deleteProductionEvent, updateProductionEvent,
      addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, revertPoToSent, updatePoReceivedDate,
      sales, posWaste, usingLiveData, salesCache, clearSalesCache,
      stores, visibleStores, suppressedStores, toggleStoreVisibility: () => {},
      settings, saveSettings, updateOzonMapping, refreshSales,
      reportFrom, reportTo,
      exportConfig, importConfig,
      addSupplier, updateSupplier, deleteSupplier,
    }}>
      {children}
      <SyncErrorToast />
    </ConfigContext.Provider>
  )
}

export function useConfig() {
  return useContext(ConfigContext)
}

export { useCalcs }
