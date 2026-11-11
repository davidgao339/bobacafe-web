import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { stores as STORES } from '@inventory/data/fakeData'
import { fetchDatabricksSales, queryD1 } from '@inventory/services/api'
import { fetchCurrentInventory, fetchLh, LH_PUSH, runDatabricksSql, esc } from '../services/databricks'
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

// Statement API returns every value as a string; coerce numerics/booleans so
// lakehouse rows match what queryD1 (Cloudflare worker) would have returned.
const _NUM = new Set(['store_id', 'id', 'storeId', 'supplier_id', 'supplierId', 'ingredient_id', 'product_id', 'parent_product_id', 'productId', 'from_store_id', 'to_store_id', 'line_index', 'amount_per_serving', 'ordered_quantity', 'received_quantity', 'unit_cost', 'total_cost', 'count_quantity', 'quantity', 'costPerUnit', 'lastPurchaseCost', 'wacCost30d', 'pay_rate'])
const _BOOL = new Set(['is_active', 'isActive', 'is_modifier', 'isModifier', 'is_custom_item', 'is_warehouse_only', 'is_hidden', 'warehouseOnly', 'hidden'])
function coerceLhRows(rows) {
  return (rows || []).map(r => {
    const out = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) { out[k] = v; continue }
      if (_BOOL.has(k)) { out[k] = (v === true || v === 'true' || v === 1 || v === '1') ? 1 : 0; continue }
      if (_NUM.has(k)) { const n = Number(v); out[k] = Number.isFinite(n) ? n : v; continue }
      out[k] = v
    }
    return out
  })
}

// Fire-and-forget lakehouse push (spec §3). D1 write above is already saved,
// so a failed push is logged and healed by the nightly sync. Idempotent MERGEs
// mean a re-save never duplicates.
function lhPush(settings, sqls) {
  if (!settings?.token || !settings?.warehouseId || !sqls?.length) return
  sqls.reduce((p, s) => p.then(() => runDatabricksSql(settings.token, settings.warehouseId, s)), Promise.resolve())
    .catch(err => console.error('LH push failed (D1 write already saved):', err))
}

// Canonical recipe key resolution (product_id matched). Recipe facts are
// attached to dim_product by product_id in the lakehouse; D1 rows carry no
// product_id column, so they resolve by normalized spelling (case/whitespace
// insensitive) against dim_product, preferring active rows. Rows with no dim
// match keep their raw fact spelling (retail pseudo-products 'Списание - …').
function normNameKey(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function buildRecipeKeyResolver(dimProducts) {
  const byId = new Map()
  const byNorm = new Map()
  for (const p of dimProducts || []) {
    if (!p.productRu) continue
    if (p.productId != null && !byId.has(Number(p.productId))) byId.set(Number(p.productId), p.productRu)
    const k = normNameKey(p.productRu)
    const prev = byNorm.get(k)
    if (!prev || (p.isActive && !prev.isActive)) byNorm.set(k, p)
  }
  return row => {
    if (row.product_id != null && byId.has(Number(row.product_id))) return byId.get(Number(row.product_id))
    const hit = byNorm.get(normNameKey(row.recipe_product_name))
    return (hit && hit.isActive) ? hit.productRu : row.recipe_product_name
  }
}

// Normalized PO lines (regular + custom) for lakehouse pushes
function buildPoLines(po, ingredients) {
  const reg = (po.lines || [])
    .filter(l => (Number(l.ordered) || 0) > 0 || (Number(l.received) || 0) > 0)
    .map(l => {
      const ing = ingredients.find(i => i.id === l.ingredientId)
      const unitCost = l.unitCost != null ? Number(l.unitCost) : (ing?.costPerUnit ?? ing?.lastPurchaseCost ?? 0)
      return {
        ingredientId: l.ingredientId, name: l.name || ing?.name || `Item #${l.ingredientId}`,
        unit: l.unit || ing?.unit || '', isCustom: false,
        ordered: Number(l.ordered) || 0, received: Number(l.received) || 0, unitCost,
        totalCost: l.totalCost != null ? Number(l.totalCost) : unitCost * (Number(l.received) || Number(l.ordered) || 0),
      }
    })
  const cust = (po.customLines || []).map(c => ({
    ingredientId: null, name: c.name || 'One-off item', unit: c.unit || 'шт', isCustom: true,
    ordered: Number(c.ordered) || 0, received: Number(c.received) || 0,
    unitCost: c.unitCost != null ? Number(c.unitCost) : 0,
    totalCost: c.totalCost != null ? Number(c.totalCost) : 0,
  }))
  return [...reg, ...cust]
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
    // Full dim_ingredients (incl. is_warehouse_only rows). The store-facing
    // `ingredients` above only carries what a retail store can hold; Recipes
    // consumes WHS-only raw materials (flour, cream cheese…), so the recipe
    // editor needs the unfiltered list.
    allIngredients: DEFAULT_INGREDIENTS,
    recipes: DEFAULT_RECIPES,
    salesRecipes: DEFAULT_RECIPES,
    dimProducts: [],
    unitPay: loadFromStorage(COOK_UNIT_PAY_KEY) || {},
    suppliers: [],
    _nextIngId: 1,
    _nextSupplierId: 1
  }))
  const [data, setDataState] = useState(DEFAULT_DATA)
  
  const [isD1Loaded, setIsD1Loaded] = useState(false)
  const [salesCache, setSalesCacheState] = useState(null)
  // Flips true once the async IDB sales-cache load has settled (needed so the
  // auto sales refresh below doesn't race the cache load).
  const [salesCacheLoaded, setSalesCacheLoaded] = useState(false)
  const [settings, setSettingsState] = useState(() => {
    const stored = loadFromStorage(SETTINGS_KEY) ?? {}
    return { token: '', warehouseId: '', ...stored }
  })
  const [stores, setStoresState] = useState(() => STORES)
  const [suppressedStores, setSuppressedStores] = useState([])
  // Stores app: the retail store this session operates as (never Warehouse/99)
  const [selectedStore, setSelectedStoreState] = useState(() => loadFromStorage('bobacafe_selected_store') || null)
  // Lakehouse pull state: current balances from view_current_inventory — ALL
  // stores in one fetch (~1 row per store × ingredient pair). Derived maps
  // below make every estimateCurrentStock consumer view-prioritized.
  const [lhAllRows, setLhAllRows] = useState(null)
  const setSelectedStore = useCallback((name) => {
    saveToStorage('bobacafe_selected_store', name)
    setSelectedStoreState(name)
  }, [])
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
        // 6c: Lakehouse is THE read path — no toggle. D1 remains only as a
        // bootstrap when credentials aren't configured yet (first run).
        const useLh = Boolean(settings?.token && settings?.warehouseId)
        const lh = qk => fetchLh(settings.token, settings.warehouseId, qk).then(coerceLhRows)

        const [storesRes, aliasesRes, ingRes, recRes, recRetailRes, suppRes, txRes, posRes, linesRes, audHeadersRes, audCountsRes, payRes, prodRes] = useLh
          ? await Promise.all([
              lh('stores'),
              Promise.resolve([]),
              lh('ingredients'),
              lh('recipes'),
              lh('recipesRetail'),
              lh('suppliers'),
              lh('transactions'),
              lh('purchaseOrders'),
              lh('poLines'),
              lh('auditHeaders'),
              lh('auditCounts'),
              lh('cookUnitPay'),
              // Product master is best-effort: a gold-schema permission error
              // must not take down the whole load — the Recipes tab falls
              // back to its legacy sales-derived universe.
              lh('dimProduct').catch(() => []),
            ])
          : await Promise.all([
              queryD1('SELECT * FROM dim_stores ORDER BY store_id ASC'),
              queryD1('SELECT * FROM dim_store_aliases'),
              queryD1('SELECT ingredient_id AS id, ingredient_name AS name, unit, product_type AS productType, supplier_id AS supplierId, supplier_name AS supplierName, is_warehouse_only AS warehouseOnly, is_hidden AS hidden, cost_per_unit AS costPerUnit, last_purchase_cost AS lastPurchaseCost, wac_cost_30d AS wacCost30d FROM dim_ingredients'),
              queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'production'"),
              queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'retail'"),
              queryD1('SELECT * FROM suppliers'),
              queryD1('SELECT transaction_id AS id, store_id AS storeId, store_code AS storeCode, transaction_date AS date, transaction_timestamp AS timestamp, transaction_type AS type, ingredient_id AS ingredientId, ingredient_name AS ingredientName, quantity, po_id AS poId, reason FROM fact_inventory_transactions ORDER BY transaction_date DESC, transaction_timestamp DESC'),
              queryD1('SELECT * FROM fact_purchase_orders ORDER BY po_id DESC'),
              queryD1('SELECT * FROM fact_purchase_order_lines ORDER BY po_id, line_index ASC'),
              queryD1('SELECT audit_id AS id, store_id AS storeId, store_code AS storeCode, audit_date AS date, audit_timestamp AS timestamp, status FROM fact_audit_headers ORDER BY audit_date DESC, audit_timestamp DESC'),
              queryD1('SELECT audit_id, ingredient_id, count_quantity FROM fact_audit_counts'),
              queryD1("SELECT product_name, pay_rate FROM dim_cook_unit_pay").catch(() => []),
              // No dim_product in D1 — Recipes tab falls back to sales cache
              Promise.resolve([]),
            ])

        const CANONICAL_UI_STORE_NAMES = {
          1: 'НОВО КП',
          2: 'ГРИН ПАРК',
          3: 'БОН ПАССАЖ',
          4: 'ЧЕРНОМОРСКИЙ',
          5: 'СОВЕТОВ',
          6: 'ГАЛЕРЕЯ',
          10: 'ОЗМОЛЛ',
          13: 'КИОСК',
          99: 'Warehouse',
        }

        const idToName = { 99: 'Warehouse' }
        const nameToId = { 'Warehouse': 99, 'СКЛАД': 99, 'Склад': 99, 'склад': 99, 'WHS': 99, 'whs': 99 }
        const idToCode = { 99: 'WHS' }

        storesRes.forEach(s => {
          const uiName = CANONICAL_UI_STORE_NAMES[s.store_id] || (s.store_id === 99 ? 'Warehouse' : s.store_name)
          idToName[s.store_id] = uiName
          idToCode[s.store_id] = s.store_code
          nameToId[s.store_name] = s.store_id
          nameToId[uiName] = s.store_id
          if (s.store_name_en) nameToId[s.store_name_en] = s.store_id
          if (s.store_code) nameToId[s.store_code] = s.store_id
        })

        aliasesRes.forEach(a => {
          if (a.alias_name && a.store_id) {
            nameToId[a.alias_name] = a.store_id
          }
        })

        // Enforce store 99 explicitly as Warehouse
        idToName[99] = 'Warehouse'
        idToCode[99] = 'WHS'
        nameToId['Warehouse'] = 99
        nameToId['СКЛАД'] = 99
        nameToId['Склад'] = 99
        nameToId['склад'] = 99
        nameToId['WHS'] = 99
        nameToId['whs'] = 99

        storeMapsRef.current = { idToName, nameToId, idToCode }

        // Stores app: active retail stores only (never Warehouse/99).
        // Active set verified against lakehouse dim_stores 2026-11-08: RSQ(1), GPK(2), BON(3), CHM(4), GAL(6).
        const ACTIVE_RETAIL_STORE_IDS = [1, 2, 3, 4, 6]
        const activeRes = storesRes.filter(s => s.store_id !== 99)
        const activeStores = activeRes
          .filter(s => Number(s.is_active) === 1 || (s.is_active === undefined && ACTIVE_RETAIL_STORE_IDS.includes(s.store_id)))
          .map(s => CANONICAL_UI_STORE_NAMES[s.store_id] || s.store_name)
        if (activeStores.length === 0) activeStores.push('НОВО КП', 'ГРИН ПАРК', 'БОН ПАССАЖ', 'ЧЕРНОМОРСКИЙ', 'ГАЛЕРЕЯ')
        setStoresState(activeStores)
        setSelectedStoreState(prev => (prev && activeStores.includes(prev)) ? prev : (activeStores[0] || null))

        let unitPay = loadFromStorage(COOK_UNIT_PAY_KEY) || {}
        if (payRes && payRes.length > 0) {
          payRes.forEach(p => {
            if (p.product_name) unitPay[p.product_name] = Number(p.pay_rate) || 0
          })
          saveToStorage(COOK_UNIT_PAY_KEY, unitPay)
        }

        // Stores app: store-visible ingredients per the two-echelon class model —
        // finished / intermediate / store_only / dual_use. Items lacking a class
        // (D1-sourced rows, pre-classification data) fall back to the legacy
        // is_warehouse_only hint. Recipes keeps consuming the full list incl.
        // WHS-only raws, so the full dim_ingredients rides along in allIngredients.
        const STORE_VISIBLE_CLASSES = ['finished', 'intermediate', 'store_only', 'dual_use']
        const allIngredients = ingRes.map(i => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          productType: i.productType,
          supplierId: i.supplierId,
          supplierName: i.supplierName,
          hidden: Boolean(i.hidden),
          warehouseOnly: Boolean(i.warehouseOnly),
          itemClass: i.itemClass || null,
          costPerUnit: i.costPerUnit != null ? Number(i.costPerUnit) : (i.lastPurchaseCost != null ? Number(i.lastPurchaseCost) : 0),
          lastPurchaseCost: i.lastPurchaseCost != null ? Number(i.lastPurchaseCost) : 0,
          wacCost30d: i.wacCost30d != null ? Number(i.wacCost30d) : 0,
        }))
        const ingredients = allIngredients.filter(i =>
          i.itemClass != null ? STORE_VISIBLE_CLASSES.includes(i.itemClass) : !i.warehouseOnly)

        // Product master (read-only from lakehouse). isActive default TRUE —
        // dim_product rows with NULL is_active are live items (menu-manager
        // applies the same COALESCE). Built BEFORE recipes so fact rows can be
        // keyed onto canonical dim_product spellings via product_id.
        const toDimBool = v => v === 1 || v === true || v === 'true' || v === '1'
        const dimProducts = (prodRes || []).filter(p => p.productRu).map(p => ({
          productId: p.productId != null ? Number(p.productId) : null,
          productRu: p.productRu,
          parentProductId: p.parentProductId != null ? Number(p.parentProductId) : null,
          parentProductEn: (p.parentProductEn || '').trim(),
          variant: p.variant || 'Standard',
          category: (p.category || '').trim() || 'Uncategorized',
          subcategory: (p.subcategory || '').trim(),
          isActive: p.isActive == null ? true : toDimBool(p.isActive),
          isModifier: toDimBool(p.isModifier),
          basePrice: p.basePrice != null ? Number(p.basePrice) : null,
          cost: p.cost != null ? Number(p.cost) : null,
        }))
        const recipeKeyFor = buildRecipeKeyResolver(dimProducts)

        const recipes = {}
        recRes.forEach(r => {
          const key = recipeKeyFor(r)
          if (!recipes[key]) recipes[key] = {}
          recipes[key][r.ingredient_id] = Number(r.amount_per_serving) || 0
        })

        // Retail (drink) recipes drive POS-sales-based consumption for PO
        // suggestions. Production recipes (WHS-made items) stay in config.recipes
        // and are managed on the Recipes tab — see useInventoryCalcs.
        const salesRecipes = {}
        ;(recRetailRes || []).forEach(r => {
          const key = recipeKeyFor(r)
          if (!salesRecipes[key]) salesRecipes[key] = {}
          salesRecipes[key][r.ingredient_id] = Number(r.amount_per_serving) || 0
        })

        setConfigState({
          ingredients,
          allIngredients,
          recipes,
          salesRecipes,
          dimProducts,
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

          const isStoreWh = po.store_id === 99 || po.store_code === 'WHS'
          const isFromWh = po.from_store_id === 99
          const isToWh = po.to_store_id === 99

          const storeName = isStoreWh ? 'Warehouse' : (idToName[po.store_id] || po.store_code || 'Warehouse')
          const fromStoreName = po.from_store_id ? (isFromWh ? 'Warehouse' : (idToName[po.from_store_id] || 'Warehouse')) : null
          const toStoreName = po.to_store_id ? (isToWh ? 'Warehouse' : (idToName[po.to_store_id] || null)) : null

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
          // Zero = counted, nothing left; a NULL count_quantity (shouldn't exist,
        // but be safe) must not masquerade as a counted zero.
        countsByAudit[c.audit_id][c.ingredient_id] = c.count_quantity == null ? null : Number(c.count_quantity)
        })

        const audits = audHeadersRes.map(h => ({
          id: h.id,
          store: (h.storeId === 99 || h.storeCode === 'WHS') ? 'Warehouse' : (idToName[h.storeId] || h.storeCode || 'Warehouse'),
          storeId: h.storeId,
          storeCode: h.storeCode,
          date: h.date,
          timestamp: h.timestamp,
          status: h.status,
          counts: countsByAudit[h.id] || {}
        }))

        const transactions = txRes.map(t => ({
          id: t.id,
          store: (t.storeId === 99 || t.storeCode === 'WHS') ? 'Warehouse' : (idToName[t.storeId] || t.storeCode || 'Warehouse'),
          storeId: t.storeId,
          storeCode: t.storeCode,
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
      } finally {
        setSalesCacheLoaded(true)
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

  const visibleStores = stores

  const selectedStoreId = selectedStore ? (storeMapsRef.current.nameToId[selectedStore] ?? null) : null
  const selectedStoreCode = selectedStoreId != null ? (storeMapsRef.current.idToCode[selectedStoreId] ?? null) : null

  // ─── Lakehouse pull (spec §2 Pull 2): current balances, view-prioritized ───
  // One fetch for ALL stores from view_current_inventory (source of truth for
  // on-hand). Per-store maps are derived so estimateCurrentStock — and every
  // consumer of it (PO suggestions, Inventory Levels, Ledger) — uses the view
  // value first, falling back to the local audit+tx calc only for pairs the
  // view doesn't cover (e.g. never-audited ingredients).
  useEffect(() => {
    let cancelled = false
    setLhAllRows(null)
    if (!settings?.token || !settings?.warehouseId) return
    fetchCurrentInventory(settings.token, settings.warehouseId)
      .then(rows => { if (!cancelled) setLhAllRows(rows || []) })
      .catch(err => console.error('Lakehouse balances fetch failed', err))
    return () => { cancelled = true }
  }, [settings?.token, settings?.warehouseId])

  // Raw view rows for the selected store, keyed by ingredient_id (Ledger shape).
  const lhBalances = useMemo(() => {
    if (!lhAllRows || !selectedStoreCode) return null
    const map = {}
    lhAllRows.forEach(r => { if (r.store_code === selectedStoreCode) map[String(r.ingredient_id)] = r })
    return map
  }, [lhAllRows, selectedStoreCode])

  // Numeric on-hand per UI store name → ingredient_id → current_on_hand.
  const lhBalancesByStore = useMemo(() => {
    const { idToName, idToCode } = storeMapsRef.current
    const codeToName = {}
    Object.entries(idToCode).forEach(([id, code]) => { codeToName[code] = idToName[id] })
    const out = {}
    ;(lhAllRows || []).forEach(r => {
      const name = codeToName[r.store_code]
      if (!name) return
      const n = Number(r.current_on_hand)
      ;(out[name] ??= {})[r.ingredient_id] = Number.isFinite(n) ? n : 0
    })
    return out
  }, [lhAllRows, isD1Loaded])

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

      // 2. D1 fact_audit_counts — explicit 0 counts ARE written (zero = counted,
      // nothing left); absence of a row = not counted (NULL semantics).
      const mergedCounts = existing ? { ...existing.counts, ...counts } : counts
      queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [auditId]).catch(console.error)
      Object.entries(mergedCounts).forEach(([ingId, qty]) => {
        if (Number.isFinite(Number(qty))) {
          const ing = config.ingredients.find(i => String(i.id) === String(ingId))
          queryD1(
            `INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
            [auditId, storeId, date, Number(ingId), ing?.name || `Item #${ingId}`, Number(qty)]
          ).catch(console.error)
        }
      })

      // 1b. Lakehouse push (spec §3): idempotent MERGE + counts replace
      lhPush(settings, [
        LH_PUSH.auditHeader({ auditId, storeId, storeCode, date, ts }),
        ...LH_PUSH.auditCountsReplace(auditId, storeId, date, Object.entries(mergedCounts).map(([ingId, qty]) => ({
          ingredientId: Number(ingId),
          name: config.ingredients.find(i => String(i.id) === String(ingId))?.name || `Item #${ingId}`,
          qty: Number(qty),
        }))),
      ])

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
    lhPush(settings, [LH_PUSH.del('fact_audit_headers', `audit_id = '${id}'`), LH_PUSH.del('fact_audit_counts', `audit_id = '${id}'`)])
    setDataState(prev => ({ ...prev, audits: prev.audits.filter(a => a.id !== id) }))
  }, [])

  const updateAudit = useCallback((id, counts) => {
    setDataState(prev => {
      const audit = prev.audits.find(a => a.id === id)
      if (!audit) return prev

      queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [id]).catch(console.error)
      Object.entries(counts).forEach(([ingId, qty]) => {
        // Explicit 0 counts ARE written (zero = counted, nothing left).
        if (Number.isFinite(Number(qty))) {
          const ing = config.ingredients.find(i => String(i.id) === String(ingId))
          queryD1(
            `INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, ingredient_name, count_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, audit.storeId, audit.date, Number(ingId), ing?.name || `Item #${ingId}`, Number(qty)]
          ).catch(console.error)
        }
      })

      queryD1(`UPDATE audits SET counts = ? WHERE id = ?`, [JSON.stringify(counts), id]).catch(console.error)
      lhPush(settings, LH_PUSH.auditCountsReplace(id, audit.storeId, audit.date, Object.entries(counts).map(([ingId, qty]) => ({
        ingredientId: Number(ingId),
        name: config.ingredients.find(i => String(i.id) === String(ingId))?.name || `Item #${ingId}`,
        qty: Number(qty),
      }))))
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
    lhPush(settings, [LH_PUSH.tx({ id: newTx.id, storeId, storeCode, date: newTx.date, ts: newTx.timestamp, type: newTx.type, ingredientId: newTx.ingredientId, ingredientName: newTx.ingredientName || '', qty: newTx.quantity, poId: newTx.poId, reason: newTx.reason })])

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
        lhPush(settings, [LH_PUSH.del('fact_inventory_transactions', `transaction_id = '${d.id}'`)])
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
        lhPush(settings, [LH_PUSH.del('fact_inventory_transactions', `transaction_id = '${d.id}'`)])
      })
      
      newTransactions.forEach(tx => {
        const storeId = resolveStoreId(tx.store)
        const storeCode = resolveStoreCode(storeId)
        queryD1(
          `INSERT INTO fact_inventory_transactions (transaction_id, store_id, store_code, transaction_date, transaction_timestamp, transaction_type, ingredient_id, ingredient_name, quantity, po_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [tx.id, storeId, storeCode, tx.date, tx.timestamp, tx.type, tx.ingredientId, tx.ingredientName || '', tx.quantity, tx.poId || null, tx.reason || null]
        ).catch(console.error)
        lhPush(settings, [LH_PUSH.tx({ id: tx.id, storeId, storeCode, date: tx.date, ts: tx.timestamp, type: tx.type, ingredientId: tx.ingredientId, ingredientName: tx.ingredientName || '', qty: tx.quantity, poId: tx.poId, reason: tx.reason })])

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
        lhPush(settings, [LH_PUSH.del('fact_inventory_transactions', `transaction_id = '${d.id}'`)])
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

    // 1b. Lakehouse push (spec §3)
    lhPush(settings, [
      LH_PUSH.po({ poId: po.id, orderType, storeId, storeCode, fromStoreId, toStoreId, status: po.status || 'draft', receivedDate: po.receivedDate || (po.receivedAt ? po.receivedAt.split('T')[0] : null), receivedAt: po.receivedAt, createdDate: po.createdDate, sentDate: po.sentDate }),
      ...LH_PUSH.poLinesReplace(po.id, buildPoLines(po, config.ingredients)),
    ])

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

      // 1b. Lakehouse push (spec §3)
      lhPush(settings, [
        LH_PUSH.po({ poId: id, orderType, storeId, storeCode, fromStoreId, toStoreId, status: updatedPo.status, receivedDate: updatedPo.receivedDate || (updatedPo.receivedAt ? updatedPo.receivedAt.split('T')[0] : null), receivedAt: updatedPo.receivedAt, createdDate: updatedPo.createdDate, sentDate: updatedPo.sentDate }),
        ...(changes.lines || changes.customLines ? LH_PUSH.poLinesReplace(id, buildPoLines(updatedPo, config.ingredients)) : []),
      ])

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
            lhPush(settings, [LH_PUSH.del('fact_inventory_transactions', `transaction_id = '${t.id}'`)])
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
                lhPush(settings, [
                  LH_PUSH.tx({ id: tx1.id, storeId: fromId, storeCode: resolveStoreCode(fromId), date: tx1.date, ts: tx1.timestamp, type: tx1.type, ingredientId: tx1.ingredientId, ingredientName: l.name || '', qty: tx1.quantity, poId: tx1.poId }),
                  LH_PUSH.tx({ id: tx2.id, storeId: toId, storeCode: resolveStoreCode(toId), date: tx2.date, ts: tx2.timestamp, type: tx2.type, ingredientId: tx2.ingredientId, ingredientName: l.name || '', qty: tx2.quantity, poId: tx2.poId }),
                ])
                
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
    lhPush(settings, [LH_PUSH.del('fact_purchase_orders', `po_id = '${id}'`), LH_PUSH.del('fact_purchase_order_lines', `po_id = '${id}'`), LH_PUSH.del('fact_inventory_transactions', `po_id = '${id}'`)])
    
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
    lhPush(settings, [
      LH_PUSH.upd('fact_purchase_orders', `received_date = '${esc(receivedDate)}', received_at = '${esc(receivedAt)}'`, `po_id = '${id}'`),
      LH_PUSH.upd('fact_inventory_transactions', `transaction_date = '${esc(receivedDate)}', transaction_timestamp = '${esc(receivedAt)}'`, `po_id = '${id}'`),
    ])
    
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
    lhPush(settings, [LH_PUSH.upd('fact_purchase_orders', `status = 'sent', received_date = NULL, received_at = NULL`, `po_id = '${id}'`), LH_PUSH.del('fact_inventory_transactions', `po_id = '${id}'`)])
    
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
            // Two-echelon guard: a production BOM must never consume its own
            // output (self-reference = the degenerate cycle). Retail recipes
            // for finished SKUs legitimately deplete themselves and are exempt.
            const selfIngId = Object.keys(mapping).find(ingId => {
              const ing = next.ingredients?.find(i => String(i.id) === String(ingId))
              return ing && normNameKey(ing.name) === normNameKey(product)
            })
            if (selfIngId != null) {
              console.error(`Recipe cycle blocked: production recipe '${product}' would consume itself (ingredient ${selfIngId})`)
              continue
            }
            queryD1(`DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = ? AND recipe_type = 'production'`, [product]).catch(console.error)
            Object.entries(mapping).forEach(([ingId, amt]) => {
              const ing = next.ingredients?.find(i => String(i.id) === String(ingId))
              queryD1(
                `INSERT INTO fact_recipe_ingredients (recipe_product_name, ingredient_id, ingredient_name, amount_per_serving, recipe_type) VALUES (?, ?, ?, ?, 'production')`,
                [product, Number(ingId), ing?.name || `Item #${ingId}`, Number(amt)]
              ).catch(console.error)
            })
            queryD1(`INSERT OR REPLACE INTO recipes (product_name, type, ingredient_mapping) VALUES (?, 'production', ?)`, [product, JSON.stringify(mapping)]).catch(console.error)
            // Attach the dim_product id (product_id-matched recipes): normalize
            // match against the catalog; NULL when the product isn't in dim yet.
            const dimHit = (next.dimProducts || []).find(p => p.productRu === product)
            const dimHitNorm = dimHit ? null : (next.dimProducts || []).find(p => normNameKey(p.productRu) === normNameKey(product) && p.isActive)
            const dimMatch = dimHit || dimHitNorm || null
            lhPush(settings, LH_PUSH.recipeReplace(product, Object.entries(mapping).map(([ingId, amt]) => ({ id: Number(ingId), name: next.ingredients?.find(i => String(i.id) === String(ingId))?.name || `Item #${ingId}`, amt: Number(amt) })), dimMatch?.productId ?? null))
          }
        }
        const nextProducts = new Set(Object.keys(next.recipes))
        for (const product of Object.keys(prev.recipes)) {
          if (!nextProducts.has(product)) {
            queryD1(`DELETE FROM fact_recipe_ingredients WHERE recipe_product_name = ? AND recipe_type = 'production'`, [product]).catch(console.error)
            queryD1(`DELETE FROM recipes WHERE product_name = ? AND type = 'production'`, [product]).catch(console.error)
            lhPush(settings, [LH_PUSH.del('fact_recipe_ingredients', `recipe_product_name = '${esc(product)}' AND recipe_type = 'production'`)])
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
            lhPush(settings, [LH_PUSH.ingredient(ing)])
          }
        }
        const nextIds = new Set(next.ingredients.map(i => i.id))
        for (const oldIng of prev.ingredients) {
          if (!nextIds.has(oldIng.id)) {
            queryD1(`DELETE FROM dim_ingredients WHERE ingredient_id = ?`, [oldIng.id]).catch(console.error)
            lhPush(settings, [LH_PUSH.del('dim_ingredients', `ingredient_id = ${oldIng.id}`)])
            queryD1(`DELETE FROM ingredients WHERE id = ?`, [oldIng.id]).catch(console.error)
          }
        }
      }
      
      return next
    })
  }, [])

  const refreshRecipes = useCallback(async () => {
    // 6c: Lakehouse is THE read path — no toggle.
    const useLh = Boolean(settings?.token && settings?.warehouseId)
    const [recRes, recRetailRes, payRes, prodRes] = useLh
      ? await Promise.all([
          fetchLh(settings.token, settings.warehouseId, 'recipes').then(coerceLhRows),
          fetchLh(settings.token, settings.warehouseId, 'recipesRetail').then(coerceLhRows),
          fetchLh(settings.token, settings.warehouseId, 'cookUnitPay').then(coerceLhRows),
          // Same best-effort contract as the initial load
          fetchLh(settings.token, settings.warehouseId, 'dimProduct').then(coerceLhRows).catch(() => null),
        ])
      : await Promise.all([
          queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'production'"),
          queryD1("SELECT recipe_product_name, ingredient_id, amount_per_serving FROM fact_recipe_ingredients WHERE recipe_type = 'retail'"),
          queryD1("SELECT product_name, pay_rate FROM dim_cook_unit_pay").catch(() => []),
          Promise.resolve(null),
        ])
    let unitPayUpdate = null
    if (payRes && payRes.length > 0) {
      unitPayUpdate = {}
      payRes.forEach(p => {
        if (p.product_name) unitPayUpdate[p.product_name] = Number(p.pay_rate) || 0
      })
      saveToStorage(COOK_UNIT_PAY_KEY, unitPayUpdate)
    }
    const toDimBool = v => v === 1 || v === true || v === 'true' || v === '1'
    const dimProducts = (prodRes || []).filter(p => p.productRu).map(p => ({
      productId: p.productId != null ? Number(p.productId) : null,
      productRu: p.productRu,
      parentProductId: p.parentProductId != null ? Number(p.parentProductId) : null,
      parentProductEn: (p.parentProductEn || '').trim(),
      variant: p.variant || 'Standard',
      category: (p.category || '').trim() || 'Uncategorized',
      subcategory: (p.subcategory || '').trim(),
      isActive: p.isActive == null ? true : toDimBool(p.isActive),
      isModifier: toDimBool(p.isModifier),
      basePrice: p.basePrice != null ? Number(p.basePrice) : null,
      cost: p.cost != null ? Number(p.cost) : null,
    }))
    const recipeKeyFor = buildRecipeKeyResolver(dimProducts)
    const recipes = {}
    recRes.forEach(r => {
      const key = recipeKeyFor(r)
      if (!recipes[key]) recipes[key] = {}
      recipes[key][r.ingredient_id] = Number(r.amount_per_serving) || 0
    })
    const salesRecipes = {}
    ;(recRetailRes || []).forEach(r => {
      const key = recipeKeyFor(r)
      if (!salesRecipes[key]) salesRecipes[key] = {}
      salesRecipes[key][r.ingredient_id] = Number(r.amount_per_serving) || 0
    })
    setConfigState(prev => ({
      ...prev,
      recipes,
      salesRecipes,
      // dimProduct fetch failed → keep whatever we already have; fresh rows →
      // normalize with the same rules as the initial load.
      ...(prodRes ? { dimProducts } : {}),
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
        lhPush(settings, [LH_PUSH.cookPay(productName, numRate)])
      } else {
        delete nextUnitPay[productName]
        queryD1("DELETE FROM dim_cook_unit_pay WHERE product_name = ?", [productName]).catch(console.error)
        lhPush(settings, [LH_PUSH.cookPay(productName, null)])
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

  // Auto-refresh POS sales on load so PO suggestions have data with no manual
  // step. refreshSales is otherwise dead code in this app: a fresh browser has
  // an empty IndexedDB cache, sales stays [] and every suggestion is 0.
  // Fetches from the day after lastRefreshDate — or the last 60 days when the
  // cache is empty — through today. The Statement API aggregates by date, so
  // re-pulling the boundary day is safe (the merge dedups by key).
  const autoSalesRef = useRef(false)
  const refreshSalesRef = useRef(refreshSales)
  refreshSalesRef.current = refreshSales
  useEffect(() => {
    if (autoSalesRef.current) return
    if (!isD1Loaded || !salesCacheLoaded) return
    if (!settings?.token || !settings?.warehouseId) return
    autoSalesRef.current = true
    const today = new Date().toISOString().slice(0, 10)
    const last = salesCache?.lastRefreshDate
    const cut = new Date((last || today) + 'T12:00:00')
    if (!last) cut.setDate(cut.getDate() - 60)
    const fromDate = cut.toISOString().slice(0, 10)
    if (fromDate > today) return
    refreshSalesRef.current(settings.token, settings.warehouseId, fromDate, today)
      .catch(err => console.error('Auto sales refresh failed (suggestions will be 0):', err))
  }, [isD1Loaded, salesCacheLoaded, settings?.token, settings?.warehouseId, salesCache?.lastRefreshDate])

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
        purchaseOrders: (data.purchaseOrders || []).filter(po =>
          po.store === selectedStore || po.toLocation === selectedStore || po.fromLocation === selectedStore),
        transactions: (data.transactions || []).filter(tx =>
          tx.store === selectedStore || (selectedStoreId != null && tx.storeId === selectedStoreId)),
        audits: (data.audits || []).filter(a =>
          a.store === selectedStore || (selectedStoreId != null && a.storeId === selectedStoreId))
      }
  }, [data, selectedStore, selectedStoreId])

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
      stores, visibleStores, suppressedStores, selectedStore, setSelectedStore, selectedStoreCode, toggleStoreVisibility: () => {},
      settings, saveSettings, updateOzonMapping, refreshSales,
      lhBalances, lhBalancesByStore, lhConnected: Boolean(settings?.token && settings?.warehouseId),
      dataSource: 'lakehouse',
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
