import { useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { roundOrderQty } from '../utils/productTypes'

export function useCalcs() {
  const { config, sales, posWaste, data, stores } = useConfig()

  return useMemo(() => {
    const { ingredients, recipes } = config
    const r1 = n => Math.round(n * 10) / 10

    // PRECOMPUTATION
    const ingVarWindows = {} 
    const storeVarWindows = {}
    const lastAudits = {}
    
    const sortedAuditsByStore = {}
    for (const store of stores) {
      sortedAuditsByStore[store] = [...data.audits].filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date))
      storeVarWindows[store] = sortedAuditsByStore[store].length >= 2 ? { opening: sortedAuditsByStore[store][1], closing: sortedAuditsByStore[store][0] } : null
      lastAudits[store] = sortedAuditsByStore[store][0] ?? null
      
      ingVarWindows[store] = {}
      for (const ing of ingredients) {
        const sorted = sortedAuditsByStore[store].filter(a => a.counts[ing.id] != null)
        ingVarWindows[store][ing.id] = sorted.length >= 2 ? { opening: sorted[1], closing: sorted[0] } : null
      }
    }

    const to7d = sales.length > 0 ? sales[0].date : new Date().toISOString().slice(0, 10)
    const cut = new Date(to7d + 'T12:00:00'); cut.setDate(cut.getDate() - 7)
    const from7d = cut.toISOString().slice(0, 10)

    const salesConsumption = {}
    const consumed7d = {}
    const salesSinceLastAudit = {}
    
    for (const store of stores) {
      salesConsumption[store] = {}
      consumed7d[store] = {}
      salesSinceLastAudit[store] = {}
      for (const ing of ingredients) {
        salesConsumption[store][ing.id] = 0
        consumed7d[store][ing.id] = 0
        salesSinceLastAudit[store][ing.id] = 0
      }
    }

    for (const s of [...sales, ...posWaste]) {
      const store = s.store
      const date = s.date
      const qty = s.quantity
      const recipe = recipes[s.product]
      if (!recipe || !stores.includes(store)) continue
      
      for (const ingId in recipe) {
        if (!salesConsumption[store] || salesConsumption[store][ingId] === undefined) continue
        
        const amt = qty * recipe[ingId]
        const win = ingVarWindows[store]?.[ingId]
        const fromVar = win?.opening.date ?? ''
        const toVar = win?.closing.date ?? '9999-12-31'
        
        if (date > fromVar && date <= toVar) {
          salesConsumption[store][ingId] += amt
        }

        if (date > from7d && date <= to7d) {
          consumed7d[store][ingId] += amt
        }
        
        const lastIngAudit = sortedAuditsByStore[store]?.filter(a => a.counts[ingId] != null)[0]
        const cutAudit = lastIngAudit?.date ?? '0000-00-00'
        const cutTime = lastIngAudit?.timestamp ?? `${cutAudit}T23:59:59`
        if (date >= cutAudit && `${date}T23:59:58` > cutTime) {
           salesSinceLastAudit[store][ingId] += amt
        }
      }
    }

    const directConsumption = {}
    const adjDelta = {}
    const txSinceLastAudit = {}
    const txConsumed7d = {}
    const transferNet = {}
    
    for (const store of stores) {
      directConsumption[store] = {}
      adjDelta[store] = {}
      txSinceLastAudit[store] = {}
      txConsumed7d[store] = {}
      transferNet[store] = {}
      for (const ing of ingredients) {
        directConsumption[store][ing.id] = 0
        adjDelta[store][ing.id] = 0
        txSinceLastAudit[store][ing.id] = 0
        txConsumed7d[store][ing.id] = 0
        transferNet[store][ing.id] = 0
      }
    }

    const getPoTime = (poId) => {
      const po = data.purchaseOrders.find(p => p.id === poId)
      return po?.receivedAt ?? (po?.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
    }

    for (const t of data.transactions) {
      const store = t.store
      const date = t.date
      const ingId = t.ingredientId
      const qty = t.quantity
      if (!stores.includes(store) || directConsumption[store][ingId] === undefined) continue
      
      const win = ingVarWindows[store]?.[ingId]
      const fromVar = win?.opening.date ?? ''
      const toVar = win?.closing.date ?? '9999-12-31'
      
      if (t.type !== 'adjustment') {
        if (date > fromVar && date <= toVar) {
          directConsumption[store][ingId] += qty
        }
        if (date > from7d && date <= to7d) {
          txConsumed7d[store][ingId] += qty
        }
      } else {
        if (!(qty < 0 && t.poId)) {
          if (date > fromVar && date <= toVar) {
            adjDelta[store][ingId] += qty
          }
        }
        if (t.poId) {
          if (date > fromVar && date <= toVar) {
            transferNet[store][ingId] += qty
          }
        }
      }
      
      const lastIngAudit = sortedAuditsByStore[store]?.filter(a => a.counts[ingId] != null)[0]
      const cutAudit = lastIngAudit?.date ?? '0000-00-00'
      const cutTime = lastIngAudit?.timestamp ?? `${cutAudit}T23:59:59`
      if (date >= cutAudit) {
        let time = `${date}T12:00:00`
        if (t.type === 'adjustment' && t.poId) time = getPoTime(t.poId)
        if (time > cutTime) {
          txSinceLastAudit[store][ingId] += (t.type === 'adjustment' ? qty : -qty)
        }
      }
    }
    
    const poSinceLastAudit = {}
    const poInWindow = {}
    for (const store of stores) {
      poSinceLastAudit[store] = {}
      poInWindow[store] = {}
      for (const ing of ingredients) {
        poSinceLastAudit[store][ing.id] = 0
        poInWindow[store][ing.id] = 0
      }
    }
    
    for (const po of data.purchaseOrders) {
      if (po.status !== 'received' || (po.fromLocation && po.toLocation)) continue
      const store = po.store
      if (!stores.includes(store)) continue
      const poTime = po.receivedAt ?? (po.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
      
      for (const l of po.lines) {
        const ingId = l.ingredientId
        if (poInWindow[store][ingId] === undefined) continue

        const win = ingVarWindows[store]?.[ingId]
        if (win && (po.receivedDate ?? '') > win.opening.date && (po.receivedDate ?? '') <= win.closing.date) {
          poInWindow[store][ingId] += (l.received ?? l.ordered ?? 0)
        }
        
        const lastIngAudit = sortedAuditsByStore[store]?.filter(a => a.counts[ingId] != null)[0]
        const cutAudit = lastIngAudit?.date ?? '0000-00-00'
        const cutTime = lastIngAudit?.timestamp ?? `${cutAudit}T23:59:59`
        if (poTime > cutTime) {
          poSinceLastAudit[store][ingId] += (l.received ?? l.ordered ?? 0)
        }
      }
    }

    for (const store of stores) {
      for (const ing of ingredients) {
        salesConsumption[store][ing.id] = r1(salesConsumption[store][ing.id])
        consumed7d[store][ing.id] = r1(consumed7d[store][ing.id] + txConsumed7d[store][ing.id])
        salesSinceLastAudit[store][ing.id] = r1(salesSinceLastAudit[store][ing.id])
        directConsumption[store][ing.id] = r1(directConsumption[store][ing.id])
        adjDelta[store][ing.id] = r1(adjDelta[store][ing.id])
        txSinceLastAudit[store][ing.id] = r1(txSinceLastAudit[store][ing.id])
        poSinceLastAudit[store][ing.id] = r1(poSinceLastAudit[store][ing.id])
        poInWindow[store][ing.id] = r1(poInWindow[store][ing.id])
        transferNet[store][ing.id] = r1(transferNet[store][ing.id])
      }
    }

    // GETTERS (O(1))
    const getVarianceWindow = (store) => storeVarWindows[store]
    const getIngredientVarianceWindow = (store, ingredientId) => ingVarWindows[store]?.[ingredientId]
    const getLastAudit = (store) => lastAudits[store]
    
    const getSalesConsumption = (store, ingredientId) => salesConsumption[store]?.[ingredientId] || 0
    const getDirectConsumption = (store, ingredientId) => directConsumption[store]?.[ingredientId] || 0
    const getConsumed7d = (store, ingredientId) => consumed7d[store]?.[ingredientId] || 0
    const getAdjDelta = (store, ingredientId) => adjDelta[store]?.[ingredientId] || 0
    
    const estimateCurrentStock = (store, ingredientId) => {
      const lastIngAudit = sortedAuditsByStore[store]?.filter(a => a.counts[ingredientId] != null)[0]
      const base = lastIngAudit?.counts[ingredientId] ?? 0
      return r1(base - (salesSinceLastAudit[store]?.[ingredientId] || 0) + (txSinceLastAudit[store]?.[ingredientId] || 0) + (poSinceLastAudit[store]?.[ingredientId] || 0))
    }

    const getDailyAvg = (store, ingredientId) => r1(getConsumed7d(store, ingredientId) / 7)
    const isLowStock  = (store, ingredientId) => estimateCurrentStock(store, ingredientId) < getDailyAvg(store, ingredientId) * 3

    const getOrderQty = (store, ingredientId, days = 7, bufferPct = 5) => {
      const ing = ingredients.find(i => i.id === ingredientId)
      const rawNeeded = getDailyAvg(store, ingredientId) * days * (1 + bufferPct / 100) - estimateCurrentStock(store, ingredientId)
      return roundOrderQty(rawNeeded, ing)
    }

    const getLowStockAlerts = () => {
      const alerts = []
      for (const store of stores) {
        for (const p of ingredients) {
          if (isLowStock(store, p.id)) {
            const current = Math.max(0, estimateCurrentStock(store, p.id))
            const dailyAvg = getDailyAvg(store, p.id)
            alerts.push({ store, productId: p.id, product: p.name, unit: p.unit, current, daysLeft: dailyAvg > 0 ? r1(current / dailyAvg) : 0 })
          }
        }
      }
      return alerts
    }

    const getSaleIngredientImpact = (product, quantity) => {
      const recipe = recipes[product] ?? {}
      return ingredients.map(p => ({ ...p, consumed: r1(quantity * (recipe[p.id] ?? 0)) })).filter(p => p.consumed > 0)
    }

    const getOpeningStock = (store, ingredientId) => { const win = getIngredientVarianceWindow(store, ingredientId); return win ? (win.opening.counts[ingredientId] ?? 0) : 0 }
    const getClosingStock = (store, ingredientId) => { const win = getIngredientVarianceWindow(store, ingredientId); return win ? (win.closing.counts[ingredientId] ?? 0) : 0 }
    
    const getActualConsumed = (store, ingredientId) => {
      const win = getIngredientVarianceWindow(store, ingredientId)
      if (!win) return null
      const opening = win.opening.counts[ingredientId]
      const closing = win.closing.counts[ingredientId]
      return r1(opening - closing + (poInWindow[store]?.[ingredientId] || 0) + (transferNet[store]?.[ingredientId] || 0))
    }
    
    const getUnexplainedVariance = (store, ingredientId) => {
      const actual = getActualConsumed(store, ingredientId)
      if (actual === null) return null
      return r1(actual - getSalesConsumption(store, ingredientId) - getDirectConsumption(store, ingredientId))
    }
    
    const getVariancePct = (store, ingredientId) => {
      const t = getSalesConsumption(store, ingredientId)
      return t === 0 ? 0 : Math.round(getUnexplainedVariance(store, ingredientId) / t * 1000) / 10
    }

    return {
      getSalesConsumption, getDirectConsumption, getConsumed7d, getAdjDelta,
      getOrderQty, estimateCurrentStock, getDailyAvg, isLowStock, getLowStockAlerts,
      getSaleIngredientImpact, getOpeningStock, getClosingStock,
      getActualConsumed, getUnexplainedVariance, getVariancePct,
      getVarianceWindow, getIngredientVarianceWindow, getLastAudit,
    }
  }, [config, sales, data])
}
