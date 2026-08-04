import { useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { roundOrderQty } from '../utils/productTypes'

export function useCalcs() {
  const { config, sales, posWaste, data, stores } = useConfig()

  return useMemo(() => {
    const { ingredients, recipes } = config
    const r1 = n => Math.round(n * 10) / 10

    // Store-level window: two most recent audits regardless of what was counted.
    // Used only for display (header date range in Variance Report).
    const getVarianceWindow = (store) => {
      const sorted = [...data.audits].filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date))
      return sorted.length >= 2 ? { opening: sorted[1], closing: sorted[0] } : null
    }

    // Ingredient-level window: two most recent audits that BOTH counted this ingredient.
    // A partial audit that left an ingredient blank is skipped for that ingredient.
    const getIngredientVarianceWindow = (store, ingredientId) => {
      const sorted = [...data.audits]
        .filter(a => a.store === store && a.counts[ingredientId] != null)
        .sort((a, b) => b.date.localeCompare(a.date))
      return sorted.length >= 2 ? { opening: sorted[1], closing: sorted[0] } : null
    }

    const getLastAudit = (store) =>
      [...data.audits].filter(a => a.store === store).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null

    const getSalesConsumption = (store, ingredientId) => {
      const win = getIngredientVarianceWindow(store, ingredientId)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return r1([...sales, ...posWaste].filter(s => s.store === store && s.date > from && s.date <= to)
        .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ingredientId] ?? 0), 0))
    }

    const getDirectConsumption = (store, ingredientId) => {
      const win = getIngredientVarianceWindow(store, ingredientId)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return r1(data.transactions
        .filter(t => t.store === store && t.ingredientId === ingredientId && t.type !== 'adjustment' && t.date > from && t.date <= to)
        .reduce((sum, t) => sum + t.quantity, 0))
    }

    const getConsumed7d = (store, ingredientId) => {
      const to   = sales.length > 0 ? sales[0].date : new Date().toISOString().slice(0, 10)
      const cut  = new Date(to + 'T12:00:00'); cut.setDate(cut.getDate() - 7)
      const from = cut.toISOString().slice(0, 10)
      return r1(
        [...sales, ...posWaste]
          .filter(s => s.store === store && s.date > from && s.date <= to)
          .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ingredientId] ?? 0), 0)
        + data.transactions
          .filter(t => t.store === store && t.ingredientId === ingredientId && t.type !== 'adjustment' && t.date > from && t.date <= to)
          .reduce((sum, t) => sum + t.quantity, 0)
      )
    }

    const getAdjDelta = (store, ingredientId) => {
      const win = getIngredientVarianceWindow(store, ingredientId)
      const from = win?.opening.date ?? ''; const to = win?.closing.date ?? '9999-12-31'
      return data.transactions
        .filter(t => t.store === store && t.ingredientId === ingredientId && t.type === 'adjustment'
          && !(t.quantity < 0 && t.poId)   // exclude transfer-outs; they show in their own column
          && t.date > from && t.date <= to)
        .reduce((sum, t) => sum + t.quantity, 0)
    }

    const getOrderQty = (store, ingredientId, days = 7, bufferPct = 5) => {
      const ing = ingredients.find(i => i.id === ingredientId)
      const rawNeeded = getDailyAvg(store, ingredientId) * days * (1 + bufferPct / 100) - estimateCurrentStock(store, ingredientId)
      return roundOrderQty(rawNeeded, ing)
    }

    const estimateCurrentStock = (store, ingredientId) => {
      // Use the most recent audit that actually counted this ingredient.
      // A later partial audit that left this ingredient blank should not reset it to 0.
      const lastAudit = [...data.audits]
        .filter(a => a.store === store && a.counts[ingredientId] != null)
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
      const cut  = lastAudit?.date ?? '0000-00-00'
      const base = lastAudit?.counts[ingredientId] ?? 0
      const cutTime = lastAudit?.timestamp ?? `${cut}T23:59:59`

      const salesSince = lastAudit
        ? r1([...sales, ...posWaste].filter(s => s.store === store && s.date >= cut && `${s.date}T23:59:58` > cutTime)
            .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ingredientId] ?? 0), 0))
        : 0

      const getPoTime = (poId) => {
        const po = data.purchaseOrders.find(p => p.id === poId)
        return po?.receivedAt ?? (po?.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
      }

      const txSince = lastAudit
        ? data.transactions
            .filter(t => {
              if (t.store !== store || t.ingredientId !== ingredientId || t.date < cut) return false
              let time = `${t.date}T12:00:00`
              if (t.type === 'adjustment' && t.poId) time = getPoTime(t.poId)
              return time > cutTime
            })
            .reduce((sum, t) => t.type === 'adjustment' ? sum + t.quantity : sum - t.quantity, 0)
        : 0

      // Compare by receivedAt timestamp when available; fall back to date-only with strict >
      // Transfer POs (fromLocation + toLocation) are already accounted for by their adjustment
      // transactions in txSince — exclude them here to avoid double-counting.
      const poSince = data.purchaseOrders
        .filter(po => po.store === store && po.status === 'received'
          && !(po.fromLocation && po.toLocation)
          && (po.receivedAt ?? (po.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')) > cutTime)
        .reduce((sum, po) => { const l = po.lines.find(l => l.ingredientId === ingredientId); return sum + (l?.received ?? l?.ordered ?? 0) }, 0)
      
      return r1(base - salesSince + txSince + poSince)
    }

    const getDailyAvg = (store, ingredientId) => r1(getConsumed7d(store, ingredientId) / 7)
    const isLowStock  = (store, ingredientId) => estimateCurrentStock(store, ingredientId) < getDailyAvg(store, ingredientId) * 3

    const getLowStockAlerts = () => {
      const alerts = []
      for (const store of stores)
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

    const getOpeningStock = (store, ingredientId) => { const win = getIngredientVarianceWindow(store, ingredientId); return win ? (win.opening.counts[ingredientId] ?? 0) : 0 }
    const getClosingStock = (store, ingredientId) => { const win = getIngredientVarianceWindow(store, ingredientId); return win ? (win.closing.counts[ingredientId] ?? 0) : 0 }
    const getActualConsumed = (store, ingredientId) => {
      const win = getIngredientVarianceWindow(store, ingredientId)
      if (!win) return null
      const opening = win.opening.counts[ingredientId]
      const closing = win.closing.counts[ingredientId]
      // Transfer POs are represented by their poId-linked adjustment transactions
      const poInWindow = data.purchaseOrders
        .filter(po => po.store === store && po.status === 'received'
          && !(po.fromLocation && po.toLocation)
          && (po.receivedDate ?? '') > win.opening.date
          && (po.receivedDate ?? '') <= win.closing.date)
        .reduce((sum, po) => { const l = po.lines.find(l => l.ingredientId === ingredientId); return sum + (l?.received ?? l?.ordered ?? 0) }, 0)
      // Net transfers in/out so a transfer doesn't read as consumption (out) or surplus (in)
      const transferNet = data.transactions
        .filter(t => t.store === store && t.ingredientId === ingredientId
          && t.type === 'adjustment' && t.poId
          && t.date > win.opening.date && t.date <= win.closing.date)
        .reduce((sum, t) => sum + t.quantity, 0)
      return r1(opening - closing + poInWindow + transferNet)
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
