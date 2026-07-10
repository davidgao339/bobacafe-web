import { useState, useMemo, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'

const PAGE_SIZE = 100

// ─── Sales tab ────────────────────────────────────────────────────────────────

function SalesTab() {
  const { sales, salesCache, reportFrom, reportTo, settings, saveSettings, refreshSales, clearSalesCache, stores } = useConfig()
  const { getSaleIngredientImpact } = useCalcs()
  const { t } = useLanguage()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const todayStr     = new Date().toISOString().slice(0, 10)

  const [filterStore,    setFilterStore]    = useState('All')
  const [filterFrom,     setFilterFrom]     = useState(reportFrom !== todayStr ? reportFrom : sevenDaysAgo)
  const [filterTo,       setFilterTo]       = useState(reportTo)
  const [expanded,       setExpanded]       = useState(null)
  const [page,           setPage]           = useState(0)
  const [refreshing,     setRefreshing]     = useState(false)
  const [refreshMsg,     setRefreshMsg]     = useState(null)
  const [showSettings,   setShowSettings]   = useState(false)
  const [localToken,     setLocalToken]     = useState(settings.token ?? '')
  const [localWarehouse, setLocalWarehouse] = useState(settings.warehouseId ?? '')

  const lastSync = salesCache?.lastRefreshDate ?? null

  const handleRefresh = async () => {
    // Use live input if settings panel is open, otherwise fall back to saved settings
    const token       = (showSettings ? localToken : settings.token)?.trim()
    const warehouseId = (showSettings ? localWarehouse : settings.warehouseId)?.trim()
    if (!token) {
      setShowSettings(true)
      setRefreshMsg({ type: 'error', text: 'Enter a Databricks PAT token first.' })
      return
    }
    if (!token.startsWith('dapi')) {
      setShowSettings(true)
      setRefreshMsg({ type: 'error', text: 'Token should start with "dapi". Check your Databricks PAT.' })
      return
    }
    setRefreshing(true); setRefreshMsg(null)
    try {
      const result = await refreshSales(token, warehouseId, filterFrom, filterTo)
      if (result.upToDate) {
        setRefreshMsg({ type: 'ok', text: `Already up to date through ${result.throughDate}.` })
      } else {
        setRefreshMsg({ type: 'ok', text: `Fetched ${result.newRows} rows (${result.fromDate} → ${result.toDate}).` })
      }
    } catch (err) {
      setRefreshMsg({ type: 'error', text: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  const saveCredentials = () => {
    saveSettings({ token: localToken.trim(), warehouseId: localWarehouse.trim() })
    setShowSettings(false)
    setRefreshMsg(null)
  }

  const resetView = () => { setPage(0); setExpanded(null) }

  const filtered = useMemo(() =>
    sales.filter(s => {
      if (filterStore !== 'All' && s.store !== filterStore) return false
      if (s.date < filterFrom || s.date > filterTo)         return false
      return true
    })
  , [sales, filterStore, filterFrom, filterTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows   = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggle = (id) => setExpanded(prev => prev === id ? null : id)

  return (
    <>
      {/* Filter + refresh bar */}
      <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.store')}</label>
            <select value={filterStore} onChange={e => { setFilterStore(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="All">{t('common.all')}</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.from')}</label>
            <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.to')}</label>
            <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-sm text-gray-500 pb-2">{t('tx.rows', { count: filtered.length })}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2 pb-0.5">
            {lastSync && (
              <span className="text-xs text-gray-400">
                {t('tx.cachedThrough')} <span className="font-medium text-gray-600">{lastSync}</span>
              </span>
            )}
            <button onClick={handleRefresh} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? t('tx.syncing') : t('tx.refresh')}
            </button>
            <button onClick={() => { clearSalesCache(); setRefreshMsg({ type: 'ok', text: 'Cache cleared.' }) }}
              title="Clear cached data" disabled={refreshing}
              className="px-2.5 py-2 rounded-lg border border-gray-200 text-xs text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-50">
              {t('tx.clearCache')}
            </button>
            <button onClick={() => setShowSettings(s => !s)} title="Databricks settings"
              className={`p-2 rounded-lg border text-xs transition-colors ${showSettings ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}>
              ⚙
            </button>
          </div>
        </div>

        {refreshMsg && (
          <p className={`text-xs ${refreshMsg.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
            {refreshMsg.text}
          </p>
        )}

        {showSettings && (
          <div className="pt-3 border-t border-gray-100 flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-56">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('tx.token')}</label>
              <input type="password" value={localToken} onChange={e => setLocalToken(e.target.value)}
                placeholder="dapi…"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <div className="w-52">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('tx.warehouseId')}</label>
              <input type="text" value={localWarehouse} onChange={e => setLocalWarehouse(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <button onClick={saveCredentials}
              className="px-4 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900 transition-colors mb-0.5">
              {t('common.save')}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Mobile: cards */}
        {filtered.length === 0
          ? <p className="md:hidden px-6 py-10 text-center text-gray-400 text-sm">{t('tx.noSales')}</p>
          : <div className="md:hidden divide-y divide-gray-100">
              {pageRows.map(s => {
                const impact = getSaleIngredientImpact(s.product, s.quantity)
                const isOpen = expanded === s.id
                return (
                  <div key={s.id}>
                    <div onClick={() => toggle(s.id)}
                      className={`px-4 py-3 cursor-pointer ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="font-mono">{s.date}</span>
                          <span>·</span>
                          <span>{s.store}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-gray-800">
                          {s.quantity} <span className="text-xs font-normal text-gray-400">{t('tx.cups')}</span>
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1.5">{s.product}</p>
                      <div className="flex flex-wrap gap-1">
                        {impact.map(i => (
                          <span key={i.id} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs tabular-nums">
                            {i.consumed} {i.unit} {i.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="bg-blue-50 border-t border-blue-100 px-4 py-3">
                        <p className="text-xs font-semibold text-blue-700 mb-2">
                          {t('tx.recipeBreakdown', { qty: s.quantity, product: s.product })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {impact.map(i => (
                            <div key={i.id} className="bg-white rounded-lg px-3 py-2 border border-blue-200 text-xs">
                              <p className="font-semibold text-gray-800">{i.consumed} {i.unit}</p>
                              <p className="text-gray-500">{i.name}</p>
                              <p className="text-blue-400 mt-0.5">{t('tx.perCup', { qty: (i.consumed / s.quantity).toFixed(3) })}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        }
        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">{t('tx.date')}</th>
                <th className="px-4 py-3 font-medium">{t('common.store')}</th>
                <th className="px-4 py-3 font-medium">{t('common.name')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('tx.qtySold')}</th>
                <th className="px-4 py-3 font-medium text-gray-400 font-normal">{t('tx.ingredientImpact')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400 text-sm">{t('tx.noSales')}</td></tr>
                : pageRows.map(s => {
                    const impact = getSaleIngredientImpact(s.product, s.quantity)
                    const isOpen = expanded === s.id
                    return (
                      <Fragment key={s.id}>
                        <tr onClick={() => toggle(s.id)}
                          className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer">
                          <td className="px-6 py-2.5 text-gray-500 font-mono text-xs">{s.date}</td>
                          <td className="px-4 py-2.5 text-gray-800">{s.store}</td>
                          <td className="px-4 py-2.5 text-gray-800 text-xs">{s.product}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                            {s.quantity} <span className="text-gray-400 font-normal text-xs">{t('tx.cups')}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {impact.map(i => (
                                <span key={i.id} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs tabular-nums">
                                  {i.consumed} {i.unit} {i.name}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-blue-50 border-b border-blue-100">
                            <td colSpan={5} className="px-6 py-3">
                              <p className="text-xs font-semibold text-blue-700 mb-2">
                                {t('tx.recipeBreakdown', { qty: s.quantity, product: s.product })}
                              </p>
                              <div className="flex flex-wrap gap-3">
                                {impact.map(i => (
                                  <div key={i.id} className="bg-white rounded-lg px-3 py-2 border border-blue-200 text-xs">
                                    <p className="font-semibold text-gray-800">{i.consumed} {i.unit}</p>
                                    <p className="text-gray-500">{i.name}</p>
                                    <p className="text-blue-400 mt-0.5">{t('tx.perCup', { qty: (i.consumed / s.quantity).toFixed(3) })}</p>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-400 hidden md:block">{t('tx.clickRow')}</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 mx-auto md:mx-0">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              ←
            </button>
            <span className="text-xs text-gray-500 tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              →
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Waste tab (Non-Fiscal POS transactions) ─────────────────────────────────

function WasteTab() {
  const { posWaste, salesCache, reportFrom, reportTo, stores } = useConfig()
  const { getSaleIngredientImpact } = useCalcs()
  const { t } = useLanguage()
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [filterStore, setFilterStore] = useState('All')
  const [filterFrom,  setFilterFrom]  = useState(posWaste.length > 0 ? reportFrom : thirtyDaysAgo)
  const [filterTo,    setFilterTo]    = useState(posWaste.length > 0 ? reportTo   : today)
  const [expanded,    setExpanded]    = useState(null)
  const [page,        setPage]        = useState(0)
  const [sortAsc,     setSortAsc]     = useState(false)

  const resetView = () => { setPage(0); setExpanded(null) }

  const filtered = useMemo(() => {
    const rows = posWaste.filter(r => {
      if (filterStore !== 'All' && r.store !== filterStore) return false
      if (r.date < filterFrom || r.date > filterTo)         return false
      return true
    })
    return sortAsc
      ? [...rows].sort((a, b) => a.date.localeCompare(b.date))
      : rows
  }, [posWaste, filterStore, filterFrom, filterTo, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows   = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const toggle = (id) => setExpanded(prev => prev === id ? null : id)

  return (
    <>
      <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.store')}</label>
            <select value={filterStore} onChange={e => { setFilterStore(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="All">{t('common.all')}</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.from')}</label>
            <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.to')}</label>
            <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); resetView() }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-sm text-gray-500 pb-2">{t('tx.rows', { count: filtered.length })}</span>
          {salesCache?.lastRefreshDate && (
            <span className="text-xs text-gray-400 pb-2 ml-auto">
              {t('tx.cachedThrough')} <span className="font-medium text-gray-600">{salesCache.lastRefreshDate}</span>
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Mobile: cards */}
        {filtered.length === 0
          ? <p className="md:hidden px-6 py-10 text-center text-gray-400 text-sm">{posWaste.length === 0 ? t('tx.noWaste') : t('tx.noMatch')}</p>
          : <div className="md:hidden divide-y divide-gray-100">
              {pageRows.map(r => {
                const impact = getSaleIngredientImpact(r.product, r.quantity)
                const isOpen = expanded === r.id
                return (
                  <div key={r.id}>
                    <div onClick={() => toggle(r.id)}
                      className={`px-4 py-3 cursor-pointer ${isOpen ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="font-mono">{r.date}</span>
                          <span>·</span>
                          <span>{r.store}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-gray-800">
                          {r.quantity} <span className="text-xs font-normal text-gray-400">{t('tx.cups')}</span>
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1.5">{r.product}</p>
                      <div className="flex flex-wrap gap-1">
                        {impact.map(i => (
                          <span key={i.id} className="px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-100 rounded text-xs tabular-nums">
                            {i.consumed} {i.unit} {i.name}
                          </span>
                        ))}
                        {impact.length === 0 && <span className="text-xs text-gray-300">{t('tx.noRecipe')}</span>}
                      </div>
                    </div>
                    {isOpen && impact.length > 0 && (
                      <div className="bg-orange-50 border-t border-orange-100 px-4 py-3">
                        <p className="text-xs font-semibold text-orange-700 mb-2">
                          {t('tx.ingredientLoss', { qty: r.quantity, product: r.product })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {impact.map(i => (
                            <div key={i.id} className="bg-white rounded-lg px-3 py-2 border border-orange-200 text-xs">
                              <p className="font-semibold text-gray-800">{i.consumed} {i.unit}</p>
                              <p className="text-gray-500">{i.name}</p>
                              <p className="text-orange-400 mt-0.5">{t('tx.perCup', { qty: (i.consumed / r.quantity).toFixed(3) })}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        }
        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">
                  <button onClick={() => { setSortAsc(v => !v); resetView() }}
                    className="flex items-center gap-1 hover:text-gray-800 transition-colors">
                    {t('tx.date')}
                    <span className="text-gray-300">{sortAsc ? '↑' : '↓'}</span>
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">{t('common.store')}</th>
                <th className="px-4 py-3 font-medium">{t('tx.itemWrittenOff')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('tx.qty')}</th>
                <th className="px-4 py-3 font-medium text-gray-400 font-normal">{t('tx.ingredientImpact')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400 text-sm">
                    {posWaste.length === 0 ? t('tx.noWaste') : t('tx.noMatch')}
                  </td></tr>
                : pageRows.map(r => {
                    const impact = getSaleIngredientImpact(r.product, r.quantity)
                    const isOpen = expanded === r.id
                    return (
                      <Fragment key={r.id}>
                        <tr onClick={() => toggle(r.id)}
                          className="border-b border-gray-50 hover:bg-orange-50 cursor-pointer">
                          <td className="px-6 py-2.5 text-gray-500 font-mono text-xs">{r.date}</td>
                          <td className="px-4 py-2.5 text-gray-800">{r.store}</td>
                          <td className="px-4 py-2.5 text-gray-800 text-xs">{r.product}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                            {r.quantity} <span className="text-gray-400 font-normal text-xs">{t('tx.cups')}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {impact.map(i => (
                                <span key={i.id} className="px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-100 rounded text-xs tabular-nums">
                                  {i.consumed} {i.unit} {i.name}
                                </span>
                              ))}
                              {impact.length === 0 && <span className="text-xs text-gray-300">{t('tx.noRecipe')}</span>}
                            </div>
                          </td>
                        </tr>
                        {isOpen && impact.length > 0 && (
                          <tr className="bg-orange-50 border-b border-orange-100">
                            <td colSpan={5} className="px-6 py-3">
                              <p className="text-xs font-semibold text-orange-700 mb-2">
                                {t('tx.ingredientLoss', { qty: r.quantity, product: r.product })}
                              </p>
                              <div className="flex flex-wrap gap-3">
                                {impact.map(i => (
                                  <div key={i.id} className="bg-white rounded-lg px-3 py-2 border border-orange-200 text-xs">
                                    <p className="font-semibold text-gray-800">{i.consumed} {i.unit}</p>
                                    <p className="text-gray-500">{i.name}</p>
                                    <p className="text-orange-400 mt-0.5">{t('tx.perCup', { qty: (i.consumed / r.quantity).toFixed(3) })}</p>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-gray-400 hidden md:block">{t('tx.clickRow')}</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 mx-auto md:mx-0">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              ←
            </button>
            <span className="text-xs text-gray-500 tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              →
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Transfers tab ────────────────────────────────────────────────────────────

function TransfersTab() {
  const { data, config, deleteTransaction } = useConfig()
  const { t } = useLanguage()
  const [pendingDelete, setPendingDelete] = useState(null)

  const txns = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date))
  const ingName = (id) => config.ingredients.find(i => i.id === id)?.name ?? `#${id}`
  const ingUnit = (id) => config.ingredients.find(i => i.id === id)?.unit ?? ''
  const poExists = (poId) => data.purchaseOrders.some(po => po.id === poId)

  if (txns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400">
        {t('tx.noTransfers')}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
            <th className="px-5 py-3 font-medium">{t('tx.date')}</th>
            <th className="px-4 py-3 font-medium">{t('common.store')}</th>
            <th className="px-4 py-3 font-medium">{t('common.ingredient')}</th>
            <th className="px-4 py-3 font-medium text-right">{t('tx.qty')}</th>
            <th className="px-4 py-3 font-medium text-gray-400 font-normal">PO</th>
            <th className="px-4 py-3 w-32"></th>
          </tr>
        </thead>
        <tbody>
          {txns.map(tx => (
            <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-5 py-2.5 text-gray-500 font-mono text-xs">{tx.date}</td>
              <td className="px-4 py-2.5 text-gray-800">{tx.store}</td>
              <td className="px-4 py-2.5 text-gray-800">{ingName(tx.ingredientId)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                <span className={tx.quantity >= 0 ? 'text-green-600' : 'text-red-500'}>
                  {tx.quantity >= 0 ? '+' : ''}{tx.quantity}{' '}
                  <span className="text-gray-400 text-xs font-normal">{ingUnit(tx.ingredientId)}</span>
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs">
                {tx.poId == null
                  ? <span className="text-gray-300">no link</span>
                  : poExists(tx.poId)
                    ? <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-medium">{tx.poId}</span>
                    : <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 font-medium">{tx.poId} · orphaned</span>
                }
              </td>
              <td className="px-4 py-2.5 text-right">
                {pendingDelete === tx.id
                  ? <div className="flex gap-2 items-center justify-end">
                      <span className="text-xs text-red-600">{t('tx.confirmDelete')}</span>
                      <button onClick={() => { deleteTransaction(tx.id); setPendingDelete(null) }}
                        className="text-xs px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">{t('common.yes')}</button>
                      <button onClick={() => setPendingDelete(null)}
                        className="text-xs text-gray-500 hover:text-gray-700">{t('common.no')}</button>
                    </div>
                  : <button onClick={() => setPendingDelete(tx.id)}
                      className="text-xs text-red-400 hover:text-red-600">{t('tx.deleteTransfer')}</button>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Transactions({ activeTab = 'sales', onTabChange }) {
  const { t } = useLanguage()

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('tx.title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('tx.subtitle')}</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {[['sales', t('tx.tabSales')], ['waste', t('tx.tabWaste')], ['transfers', t('tx.tabTransfers')]].map(([id, label]) => (
          <button key={id} onClick={() => onTabChange?.(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'sales'     && <SalesTab />}
      {activeTab === 'waste'     && <WasteTab />}
      {activeTab === 'transfers' && <TransfersTab />}
    </div>
  )
}
