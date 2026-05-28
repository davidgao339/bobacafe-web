import { useState, useMemo } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

// ─── Sales tab ────────────────────────────────────────────────────────────────

function SalesTab() {
  const { sales, salesCache, reportFrom, reportTo, settings, saveSettings, refreshSales, clearSalesCache } = useConfig()
  const { getSaleIngredientImpact } = useCalcs()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const todayStr     = new Date().toISOString().slice(0, 10)

  const [filterStore,    setFilterStore]    = useState('All')
  const [filterFrom,     setFilterFrom]     = useState(reportFrom !== todayStr ? reportFrom : sevenDaysAgo)
  const [filterTo,       setFilterTo]       = useState(reportTo)
  const [expanded,       setExpanded]       = useState(null)
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

  const filtered = useMemo(() =>
    sales.filter(s => {
      if (filterStore !== 'All' && s.store !== filterStore) return false
      if (s.date < filterFrom || s.date > filterTo)         return false
      return true
    }),
    [sales, filterStore, filterFrom, filterTo]
  )

  const toggle = (id) => setExpanded(prev => prev === id ? null : id)

  return (
    <>
      {/* Filter + refresh bar */}
      <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Store</label>
            <select value={filterStore} onChange={e => setFilterStore(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option>All</option>
              {STORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-sm text-gray-500 pb-2">{filtered.length} rows</span>
          <div className="flex-1" />
          <div className="flex items-center gap-2 pb-0.5">
            {lastSync && (
              <span className="text-xs text-gray-400">
                Cached through <span className="font-medium text-gray-600">{lastSync}</span>
              </span>
            )}
            <button onClick={handleRefresh} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? 'Syncing…' : 'Refresh'}
            </button>
            <button onClick={() => { clearSalesCache(); setRefreshMsg({ type: 'ok', text: 'Cache cleared.' }) }}
              title="Clear cached data" disabled={refreshing}
              className="px-2.5 py-2 rounded-lg border border-gray-200 text-xs text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-50">
              Clear cache
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Databricks PAT token</label>
              <input type="password" value={localToken} onChange={e => setLocalToken(e.target.value)}
                placeholder="dapi…"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <div className="w-52">
              <label className="block text-xs font-medium text-gray-600 mb-1">SQL Warehouse ID</label>
              <input type="text" value={localWarehouse} onChange={e => setLocalWarehouse(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
            </div>
            <button onClick={saveCredentials}
              className="px-4 py-1.5 bg-gray-800 text-white text-sm rounded-lg hover:bg-gray-900 transition-colors mb-0.5">
              Save
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Store</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium text-right">Qty Sold</th>
              <th className="px-4 py-3 font-medium text-gray-400 font-normal">Ingredient Impact</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400 text-sm">No sales in this range</td></tr>
              : filtered.map(s => {
                  const impact = getSaleIngredientImpact(s.product, s.quantity)
                  const isOpen = expanded === s.id
                  return (
                    <>
                      <tr key={s.id} onClick={() => toggle(s.id)}
                        className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer">
                        <td className="px-6 py-2.5 text-gray-500 font-mono text-xs">{s.date}</td>
                        <td className="px-4 py-2.5 text-gray-800">{s.store}</td>
                        <td className="px-4 py-2.5 text-gray-800 text-xs">{s.product}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                          {s.quantity} <span className="text-gray-400 font-normal text-xs">cups</span>
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
                        <tr key={`${s.id}-exp`} className="bg-blue-50 border-b border-blue-100">
                          <td colSpan={5} className="px-6 py-3">
                            <p className="text-xs font-semibold text-blue-700 mb-2">
                              Recipe breakdown — {s.quantity} × {s.product}
                            </p>
                            <div className="flex flex-wrap gap-3">
                              {impact.map(i => (
                                <div key={i.id} className="bg-white rounded-lg px-3 py-2 border border-blue-200 text-xs">
                                  <p className="font-semibold text-gray-800">{i.consumed} {i.unit}</p>
                                  <p className="text-gray-500">{i.name}</p>
                                  <p className="text-blue-400 mt-0.5">({(i.consumed / s.quantity).toFixed(3)} per cup)</p>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
            }
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">Click any row to see ingredient breakdown</p>
    </>
  )
}

// ─── Waste tab (Non-Fiscal POS transactions) ─────────────────────────────────

function WasteTab() {
  const { posWaste, salesCache, reportFrom, reportTo } = useConfig()
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [filterStore, setFilterStore] = useState('All')
  const [filterFrom,  setFilterFrom]  = useState(posWaste.length > 0 ? reportFrom : thirtyDaysAgo)
  const [filterTo,    setFilterTo]    = useState(posWaste.length > 0 ? reportTo   : today)

  const filtered = useMemo(() =>
    posWaste.filter(r => {
      if (filterStore !== 'All' && r.store !== filterStore) return false
      if (r.date < filterFrom || r.date > filterTo)         return false
      return true
    }),
    [posWaste, filterStore, filterFrom, filterTo]
  )

  return (
    <>
      <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Store</label>
            <select value={filterStore} onChange={e => setFilterStore(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option>All</option>
              {STORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-sm text-gray-500 pb-2">{filtered.length} rows</span>
          {salesCache?.lastRefreshDate && (
            <span className="text-xs text-gray-400 pb-2 ml-auto">
              Data through <span className="font-medium text-gray-600">{salesCache.lastRefreshDate}</span>
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Store</th>
              <th className="px-4 py-3 font-medium">Item written off</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0
              ? <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400 text-sm">
                  {posWaste.length === 0 ? 'No Non-Fiscal data — refresh to load from Databricks' : 'No records match'}
                </td></tr>
              : filtered.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-6 py-2.5 text-gray-500 font-mono text-xs">{r.date}</td>
                    <td className="px-4 py-2.5 text-gray-800">{r.store}</td>
                    <td className="px-4 py-2.5 text-gray-800 text-xs">{r.product}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{r.quantity}</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Transactions() {
  const [tab, setTab] = useState('sales')

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        <p className="text-sm text-gray-500 mt-0.5">Sales from Databricks · Waste, write-offs & adjustments — all drive ingredient consumption</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {[['sales', 'Sales'], ['waste', 'Non-Fiscal (Waste)']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sales' && <SalesTab />}
      {tab === 'waste' && <WasteTab />}
    </div>
  )
}
