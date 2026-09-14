/**
 * Filter sales to only tapioca products
 */
export function filterTapiocaSales(sales) {
  return sales.filter(s =>
    s.product?.toLowerCase().includes('tapioca') ||
    s.product?.toLowerCase().includes('тапиока')
  )
}

/**
 * Assign transaction hour to cooking slot
 */
export function assignSlot(hour) {
  if (hour < 2 || hour >= 20) return '6:00 PM'
  if (hour < 16) return '9:30 AM'
  return '2:00 PM'
}

/**
 * Group sales by store, date, day_type, and slot
 */
export function dailyBySlot(tapiocaSales) {
  const map = new Map()

  tapiocaSales.forEach(sale => {
    // Parse time if available (for now, assume it's in the sale data somehow)
    // For now, we'll use date and distribute evenly
    const dateObj = new Date(sale.date)
    const dayOfWeek = dateObj.getDay() // 0 = Sunday … 6 = Saturday
    const dayType = (dayOfWeek === 0 || dayOfWeek === 6) ? 'Weekend' : 'Weekday'

    // Since we don't have hour data in the filtered sales, we'll aggregate by day
    // (In a real scenario, you'd need to expand the data structure)
    const key = `${sale.store}|${sale.date}|${dayType}`
    if (!map.has(key)) {
      map.set(key, { store: sale.store, date: sale.date, dayType, quantity: 0 })
    }
    const entry = map.get(key)
    entry.quantity += sale.quantity
  })

  return Array.from(map.values())
}

/**
 * Compute rolling window stats for percentiles
 */
export function computeRecommendations(dailyData, rollingDays) {
  if (dailyData.length === 0) return {}

  const today = new Date()
  const cutoffDate = new Date(today.getTime() - rollingDays * 86400000)
    .toISOString()
    .split('T')[0]

  // Filter to rolling window
  const windowed = dailyData.filter(d => d.date >= cutoffDate)

  if (windowed.length === 0) return {}

  // Group by store + dayType (simplified: no slots for now)
  const byStoreDay = new Map()
  windowed.forEach(d => {
    const key = `${d.store}|${d.dayType}`
    if (!byStoreDay.has(key)) {
      byStoreDay.set(key, [])
    }
    byStoreDay.get(key).push(d.quantity)
  })

  // Compute percentiles
  const stats = {}
  byStoreDay.forEach((quantities, key) => {
    const sorted = [...quantities].sort((a, b) => a - b)
    const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length
    const p75 = sorted[Math.ceil(sorted.length * 0.75) - 1]
    const p90 = sorted[Math.ceil(sorted.length * 0.90) - 1]
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
    const max = sorted[sorted.length - 1]

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
 * Compute backtest: how often did each percentile fall short?
 */
export function computeBacktest(dailyData, recommendations) {
  if (Object.keys(recommendations).length === 0) return {}

  const results = {}
  const byStoreDay = new Map()

  dailyData.forEach(d => {
    const key = `${d.store}|${d.dayType}`
    if (!byStoreDay.has(key)) {
      byStoreDay.set(key, [])
    }
    byStoreDay.get(key).push(d.quantity)
  })

  byStoreDay.forEach((quantities, key) => {
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
        pctShort: Math.round((shortDays.length / quantities.length) * 1000) / 10,
        avgShortfall: shortages.length > 0 ? Math.ceil(shortages.reduce((a, b) => a + b) / shortages.length) : 0,
        maxShortfall: shortages.length > 0 ? Math.max(...shortages) : 0,
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
