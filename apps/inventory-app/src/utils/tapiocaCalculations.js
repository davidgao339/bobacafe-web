/**
 * Tapioca Cooking Plan Calculations & Slot Aggregation
 */

export const SLOT_ORDER = ['9:30 AM', '2:00 PM', '6:00 PM']

export const DEFAULT_SLOT_DISTRIBUTION = {
  '9:30 AM': 0.45,
  '2:00 PM': 0.40,
  '6:00 PM': 0.15,
}

/**
 * Filter sales to only tapioca products
 */
export function filterTapiocaSales(sales) {
  return (sales || []).filter(s => {
    const p = (s.product || '').toLowerCase()
    return p.includes('tapioca') || p.includes('тапиока')
  })
}

/**
 * Assign transaction hour to cooking slot
 *  - 20:00 to 02:00 (or evening) -> 6:00 PM
 *  - 02:00 to 16:00 (morning/early afternoon) -> 9:30 AM
 *  - 16:00 to 20:00 (afternoon rush) -> 2:00 PM
 */
export function assignSlot(hour) {
  if (hour == null || isNaN(hour)) return '9:30 AM'
  if (hour < 2 || hour >= 20) return '6:00 PM'
  if (hour < 16) return '9:30 AM'
  return '2:00 PM'
}

/**
 * Group sales by store, date, day_type, and slot
 * Gracefully handles transaction data with exact hours OR daily totals.
 */
export function dailyBySlot(tapiocaSales) {
  const map = new Map()

  tapiocaSales.forEach(sale => {
    const store = sale.store || sale.store_name
    if (!store) return

    const dateStr = sale.date || (sale.datetime ? String(sale.datetime).slice(0, 10) : '')
    if (!dateStr) return

    const dateObj = new Date(dateStr)
    const dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getDay()
    const dayType = (dayOfWeek === 0 || dayOfWeek === 6) ? 'Weekend' : 'Weekday'
    const qty = Number(sale.quantity ?? sale.qty ?? 0)
    if (qty <= 0) return

    // Extract hour if present on transaction
    let hour = null
    if (sale.hour != null && !isNaN(Number(sale.hour))) {
      hour = Number(sale.hour)
    } else if (sale.datetime) {
      const dt = new Date(sale.datetime)
      if (!isNaN(dt.getTime())) hour = dt.getHours()
    } else if (typeof sale.time === 'string') {
      const m = sale.time.match(/(\d{1,2}):/)
      if (m) hour = parseInt(m[1], 10)
    }

    if (hour !== null) {
      // Precise transaction hour available
      const slot = assignSlot(hour)
      const key = `${store}|${dateStr}|${dayType}|${slot}`
      if (!map.has(key)) {
        map.set(key, { store, date: dateStr, dayType, slot, quantity: 0 })
      }
      map.get(key).quantity += qty
    } else {
      // Aggregated daily sales: distribute into slots using historical ratio
      SLOT_ORDER.forEach(slot => {
        const ratio = DEFAULT_SLOT_DISTRIBUTION[slot] || 0.333
        const key = `${store}|${dateStr}|${dayType}|${slot}`
        if (!map.has(key)) {
          map.set(key, { store, date: dateStr, dayType, slot, quantity: 0 })
        }
        map.get(key).quantity += qty * ratio
      })
    }
  })

  return Array.from(map.values())
}

/**
 * Compute rolling window stats for percentiles per store, dayType, and slot
 */
export function computeRecommendations(dailyData, rollingDays) {
  if (!dailyData || dailyData.length === 0) return {}

  const today = new Date()
  const cutoffDate = new Date(today.getTime() - rollingDays * 86400000)
    .toISOString()
    .split('T')[0]

  const windowed = dailyData.filter(d => d.date >= cutoffDate)
  if (windowed.length === 0) return {}

  // Group quantities by store + dayType + slot
  const byStoreDaySlot = new Map()
  windowed.forEach(d => {
    const key = `${d.store}|${d.dayType}|${d.slot}`
    if (!byStoreDaySlot.has(key)) {
      byStoreDaySlot.set(key, [])
    }
    byStoreDaySlot.get(key).push(d.quantity)
  })

  // Compute percentile stats for each slot
  const stats = {}
  byStoreDaySlot.forEach((quantities, key) => {
    const sorted = [...quantities].sort((a, b) => a - b)
    const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length
    const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1] ?? 0
    const p90 = sorted[Math.ceil(sorted.length * 0.90) - 1] ?? 0
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
    const max = sorted[sorted.length - 1] ?? 0

    stats[key] = {
      avg: Math.ceil(avg),
      p75: Math.ceil(p75),
      p90: Math.ceil(p90),
      p95: Math.ceil(p95),
      max: Math.ceil(max),
      count: quantities.length,
    }
  })

  return stats
}

/**
 * Compute backtest: how often did recommendation fall short per slot?
 */
export function computeBacktest(dailyData, recommendations) {
  if (!dailyData || Object.keys(recommendations).length === 0) return {}

  const results = {}
  const byStoreDaySlot = new Map()

  dailyData.forEach(d => {
    const key = `${d.store}|${d.dayType}|${d.slot}`
    if (!byStoreDaySlot.has(key)) {
      byStoreDaySlot.set(key, [])
    }
    byStoreDaySlot.get(key).push(d.quantity)
  })

  byStoreDaySlot.forEach((quantities, key) => {
    const stats = recommendations[key]
    if (!stats) return

    const percentiles = { avg: stats.avg, p75: stats.p75, p90: stats.p90, p95: stats.p95, max: stats.max }

    const backtests = {}
    Object.entries(percentiles).forEach(([pct, rec]) => {
      const shortDays = quantities.filter(q => q > rec)
      const shortages = shortDays.map(q => q - rec)

      backtests[pct] = {
        recommended: rec,
        totalDays: quantities.length,
        daysShort: shortDays.length,
        pctShort: quantities.length > 0 ? Math.round((shortDays.length / quantities.length) * 1000) / 10 : 0,
        avgShortfall: shortages.length > 0 ? Math.ceil(shortages.reduce((a, b) => a + b) / shortages.length) : 0,
        maxShortfall: shortages.length > 0 ? Math.ceil(Math.max(...shortages)) : 0,
      }
    })

    results[key] = backtests
  })

  return results
}

/**
 * Determine severity color based on shortage %
 */
export function severityClass(pct) {
  if (pct >= 30) return 'high'
  if (pct >= 15) return 'med'
  if (pct > 0) return 'low'
  return 'none'
}
