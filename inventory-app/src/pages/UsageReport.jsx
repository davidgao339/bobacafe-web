import { useState, useMemo, Fragment } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { STORES } from '../data/fakeData'

const r1 = n => Math.round(n * 10) / 10

export default function UsageReport() {
  const { config, sales, posWaste, data, reportFrom, reportTo } = useConfig()
  const { t } = useLanguage()
  const { recipes } = config

  const [store,        setStore]        = useState('All')
  const [from,         setFrom]         = useState(reportFrom)
  const [to,           setTo]           = useState(reportTo)
  const [selectedId,   setSelectedId]   = useState(null)
  const [search,       setSearch]       = useState('')
  const [sortKey,      setSortKey]      = useState('total')
  const [sortDir,      setSortDir]      = useState('desc')
  const [expandedDate, setExpandedDate] = useState(null)

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  // Totals per ingredient for the list panel
  const ingredientTotals = useMemo(() => {
    const storeOk = s => store === 'All' || s === store
    return config.ingredients.map(ing => {
      const salesQty = r1(
        [...sales, ...posWaste]
          .filter(s => storeOk(s.store) && s.date >= from && s.date <= to)
          .reduce((sum, s) => sum + s.quantity * (recipes[s.product]?.[ing.id] ?? 0), 0)
      )
      const directQty = r1(
        data.transactions
          .filter(t => t.ingredientId === ing.id && storeOk(t.store) && t.type !== 'adjustment' && t.date >= from && t.date <= to)
          .reduce((sum, t) => sum + t.quantity, 0)
      )
      return { id: ing.id, name: ing.name, unit: ing.unit, total: r1(salesQty + directQty) }
    })
  }, [config.ingredients, recipes, sales, posWaste, data.transactions, store, from, to])

  const listItems = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = ingredientTotals.filter(i => !q || i.name.toLowerCase().includes(q))
    return [...filtered].sort((a, b) => {
      const cmp = sortKey === 'name'
        ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        : a.total - b.total
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [ingredientTotals, search, sortKey, sortDir])

  // Per-day breakdown for selected ingredient
  const dailyData = useMemo(() => {
    if (selectedId == null) return []
    const storeOk = s => store === 'All' || s === store
    const byDate = {}
    const ensure = date => { if (!byDate[date]) byDate[date] = { salesTx: [], directTx: [], totalSales: 0, totalDirect: 0 } }

    sales.filter(s => storeOk(s.store) && s.date >= from && s.date <= to).forEach(s => {
      const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
      if (!consumed) return
      ensure(s.date)
      byDate[s.date].salesTx.push({ product: s.product, store: s.store, soldQty: s.quantity, consumed: r1(consumed), kind: 'sales' })
      byDate[s.date].totalSales = r1(byDate[s.date].totalSales + consumed)
    })
    posWaste.filter(s => storeOk(s.store) && s.date >= from && s.date <= to).forEach(s => {
      const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
      if (!consumed) return
      ensure(s.date)
      byDate[s.date].salesTx.push({ product: s.product, store: s.store, soldQty: s.quantity, consumed: r1(consumed), kind: 'waste' })
      byDate[s.date].totalSales = r1(byDate[s.date].totalSales + consumed)
    })
    data.transactions
      .filter(t => t.ingredientId === selectedId && storeOk(t.store) && t.type !== 'adjustment' && t.date >= from && t.date <= to)
      .forEach(t => {
        ensure(t.date)
        byDate[t.date].directTx.push({ id: t.id, store: t.store, type: t.type, qty: t.quantity })
        byDate[t.date].totalDirect = r1(byDate[t.date].totalDirect + t.quantity)
      })

    return Object.entries(byDate)
      .map(([date, d]) => ({ date, ...d, total: r1(d.totalSales + d.totalDirect) }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [selectedId, sales, posWaste, data.transactions, recipes, store, from, to])

  const selectedIng  = config.ingredients.find(i => i.id === selectedId)
  const grandTotal   = dailyData.reduce((sum, d) => r1(sum + d.total), 0)
  const allStores    = store === 'All'

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="px-8 pt-8 pb-4 flex items-start justify-between flex-wrap gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('usage.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('usage.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('common.from')}</label>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setExpandedDate(null) }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('common.to')}</label>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setExpandedDate(null) }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={store} onChange={e => { setStore(e.target.value); setExpandedDate(null) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="All">{t('common.allStores')}</option>
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden px-8 pb-8 gap-5 min-h-0">

        {/* Ingredient list */}
        <div className="w-60 flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-2.5 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>}
            </div>
          </div>
          <div className="flex px-3 py-1.5 border-b border-gray-100 text-xs text-gray-400 gap-1">
            <button onClick={() => handleSort('name')} className={`flex-1 text-left hover:text-gray-700 ${sortKey === 'name' ? 'text-blue-600 font-medium' : ''}`}>
              {t('common.ingredient')}{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
            <button onClick={() => handleSort('total')} className={`hover:text-gray-700 ${sortKey === 'total' ? 'text-blue-600 font-medium' : ''}`}>
              {t('usage.colTotal')}{sortKey === 'total' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {listItems.map(ing => (
              <button key={ing.id} onClick={() => { setSelectedId(ing.id); setExpandedDate(null) }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm border-b border-gray-50 last:border-0 transition-colors ${
                  selectedId === ing.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}>
                <span className={`text-left font-medium truncate flex-1 mr-2 ${selectedId === ing.id ? 'text-blue-700' : 'text-gray-700'}`}>{ing.name}</span>
                <span className={`tabular-nums text-xs flex-shrink-0 ${selectedId === ing.id ? 'text-blue-500' : 'text-gray-400'}`}>
                  {ing.total > 0 ? ing.total : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Daily breakdown */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {selectedId == null ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400">{t('usage.selectIngredient')}</p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-4">
                <h2 className="text-lg font-semibold text-gray-900">{selectedIng?.name}</h2>
                <span className="text-sm text-gray-400">{selectedIng?.unit}</span>
                <span className="text-sm text-gray-500 ml-auto">
                  {t('usage.total')}: <span className="font-semibold text-gray-800">{grandTotal} {selectedIng?.unit}</span>
                </span>
              </div>
              {dailyData.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400">
                  {t('usage.noUsage')}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                        <th className="px-5 py-3 font-medium">{t('common.date')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('usage.colSales')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('usage.colDirect')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('usage.colTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.map(day => (
                        <Fragment key={day.date}>
                          <tr onClick={() => setExpandedDate(d => d === day.date ? null : day.date)}
                            className={`border-b border-gray-50 cursor-pointer transition-colors select-none ${expandedDate === day.date ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-5 py-3 font-medium text-gray-900 flex items-center gap-2">
                              <svg className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${expandedDate === day.date ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                              {day.date}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                              {day.totalSales > 0 ? day.totalSales : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                              {day.totalDirect > 0 ? day.totalDirect : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                              {day.total} <span className="text-gray-400 text-xs font-normal">{selectedIng?.unit}</span>
                            </td>
                          </tr>
                          {expandedDate === day.date && (
                            <tr className="bg-blue-50/60 border-b border-blue-100">
                              <td colSpan={4} className="px-8 py-3">
                                <div className="space-y-1.5">
                                  {day.salesTx.map((tx, i) => (
                                    <div key={i} className="flex items-center gap-3 text-xs">
                                      <span className={`px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${tx.kind === 'waste' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                        {tx.kind === 'waste' ? 'Waste' : 'Sale'}
                                      </span>
                                      {allStores && <span className="text-gray-400 flex-shrink-0">{tx.store}</span>}
                                      <span className="font-medium text-gray-800 flex-1 truncate">{tx.product}</span>
                                      <span className="text-gray-400 flex-shrink-0">{tx.soldQty} шт</span>
                                      <span className="text-gray-500 flex-shrink-0">→</span>
                                      <span className="font-semibold text-gray-800 flex-shrink-0">{tx.consumed} {selectedIng?.unit}</span>
                                    </div>
                                  ))}
                                  {day.directTx.map(tx => (
                                    <div key={tx.id} className="flex items-center gap-3 text-xs">
                                      <span className="px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 flex-shrink-0">{tx.type}</span>
                                      {allStores && <span className="text-gray-400 flex-shrink-0">{tx.store}</span>}
                                      <span className="flex-1" />
                                      <span className="font-semibold text-gray-800 flex-shrink-0">{tx.qty} {selectedIng?.unit}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
