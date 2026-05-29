import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

const STATUS_RANK = { depleted: 0, critical: 1, low: 2, ok: 3, unknown: 4 }

export default function InventoryLevels() {
  const { config, data } = useConfig()
  const { estimateCurrentStock, getDailyAvg, getLastAudit } = useCalcs()
  const [selectedStore, setSelectedStore] = useState('All')
  const [issuesOnly, setIssuesOnly] = useState(false)

  const stores = selectedStore === 'All' ? STORES : [selectedStore]
  const { ingredients } = config

  if (ingredients.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Inventory Levels</h1>
        <p className="text-sm text-gray-400">No ingredients configured — add them in Recipes.</p>
      </div>
    )
  }

  const stockLevel = (store, ing) => {
    const hasAudit   = !!getLastAudit(store)
    const hasPO      = data.purchaseOrders.some(po => po.store === store && po.status === 'received' &&
                         po.lines.some(l => l.ingredientId === ing.id && l.ordered > 0))
    const hasData    = hasAudit || hasPO
    const qty        = estimateCurrentStock(store, ing.id)
    const daily      = getDailyAvg(store, ing.id)
    const daysLeft   = daily > 0 ? qty / daily : null
    const status     = !hasData ? 'unknown'
                     : qty <= 0 ? 'depleted'
                     : daily > 0 && daysLeft < 1 ? 'critical'
                     : daily > 0 && daysLeft < 3 ? 'low'
                     : 'ok'
    return { qty: Math.max(0, qty), daily, daysLeft, status, hasData }
  }

  const STATUS_CELL = {
    unknown:  'text-gray-300',
    depleted: 'bg-red-50 text-red-700 font-semibold',
    critical: 'bg-red-50 text-red-600',
    low:      'bg-amber-50 text-amber-700',
    ok:       'text-gray-800',
  }

  // Single-store: list view with more detail
  if (stores.length === 1) {
    const store      = stores[0]
    const lastAudit  = getLastAudit(store)
    const auditLabel = lastAudit ? `Last audit: ${lastAudit.date}` : 'No audit on record'

    const rows = ingredients
      .map(ing => ({ ing, ...stockLevel(store, ing) }))
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
    const visibleRows = issuesOnly ? rows.filter(r => r.status !== 'ok' && r.status !== 'unknown') : rows
    const issueCount  = rows.filter(r => r.status === 'depleted' || r.status === 'critical' || r.status === 'low').length

    return (
      <div className="p-8 max-w-3xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Inventory Levels</h1>
            <p className="text-sm text-gray-500 mt-0.5">Estimated stock based on last audit + sales + received orders</p>
          </div>
          <select value={selectedStore} onChange={e => { setSelectedStore(e.target.value); setIssuesOnly(false) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="All">All stores</option>
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-800 text-sm">{store}</span>
              {issueCount > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  {issueCount} issue{issueCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {issueCount > 0 && (
                <button onClick={() => setIssuesOnly(v => !v)}
                  className={`text-xs font-medium transition-colors ${issuesOnly ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
                  {issuesOnly ? 'Show all' : 'Issues only'}
                </button>
              )}
              <span className="text-xs text-gray-400">{auditLabel}</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-2.5 font-medium">Ingredient</th>
                <th className="px-4 py-2.5 font-medium text-right">Est. stock</th>
                <th className="px-4 py-2.5 font-medium">Unit</th>
                <th className="px-4 py-2.5 font-medium text-right">Daily avg</th>
                <th className="px-4 py-2.5 font-medium text-right">Days left</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleRows.map(({ ing, qty, daily, daysLeft, status }) => (
                <tr key={ing.id} className={`${status !== 'ok' ? 'bg-opacity-50' : ''} hover:bg-gray-50`}>
                  <td className="px-5 py-2.5 font-medium text-gray-900">{ing.name}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${STATUS_CELL[status]}`}>{qty}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{ing.unit}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-400 text-xs">
                    {daily > 0 ? daily : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                    {status === 'unknown' || daysLeft === null ? <span className="text-gray-300">—</span>
                      : daysLeft < 1 ? <span className="text-red-600">&lt;1d</span>
                      : <span className={daysLeft < 3 ? 'text-amber-600' : 'text-gray-500'}>{Math.round(daysLeft)}d</span>
                    }
                  </td>
                  <td className="px-4 py-2.5">
                    {status === 'unknown'  && <span className="text-xs text-gray-300">—</span>}
                    {status === 'depleted' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">Depleted</span>}
                    {status === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">Critical</span>}
                    {status === 'low'      && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">Low</span>}
                    {status === 'ok'       && <span className="text-xs text-gray-300">OK</span>}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-gray-400">No issues found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // All stores: matrix view — sort ingredients by worst status across all stores
  const matrixRows = ingredients
    .map(ing => {
      const cells = stores.map(s => ({ store: s, ...stockLevel(s, ing) }))
      const worstRank = Math.min(...cells.map(c => STATUS_RANK[c.status]))
      return { ing, cells, worstRank }
    })
    .sort((a, b) => a.worstRank - b.worstRank)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventory Levels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Estimated stock based on last audit + sales + received orders</p>
        </div>
        <select value={selectedStore} onChange={e => { setSelectedStore(e.target.value); setIssuesOnly(false) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="All">All stores</option>
          {STORES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="text-sm" style={{ minWidth: `${220 + stores.length * 110}px` }}>
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="px-5 py-3 font-medium sticky left-0 bg-gray-50 z-10 min-w-48">Ingredient</th>
              {stores.map(s => (
                <th key={s} className="px-3 py-3 font-medium text-center whitespace-nowrap">
                  <button onClick={() => setSelectedStore(s)}
                    className="hover:text-blue-600 hover:underline transition-colors">
                    {s}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {matrixRows.map(({ ing, cells }) => (
              <tr key={ing.id} className="hover:bg-gray-50">
                <td className="px-5 py-2.5 sticky left-0 bg-white z-10">
                  <span className="font-medium text-gray-900">{ing.name}</span>
                  <span className="text-xs text-gray-400 ml-1">{ing.unit}</span>
                </td>
                {cells.map(({ store, qty, daysLeft, status, hasData }) => (
                  <td key={store} className={`px-3 py-2.5 text-center tabular-nums ${STATUS_CELL[status]}`}>
                    {!hasData ? '—' : (
                      <div>
                        <div className="font-medium">{qty}</div>
                        {daysLeft !== null && (
                          <div className={`text-xs ${status === 'depleted' || status === 'critical' ? 'text-red-400' : status === 'low' ? 'text-amber-500' : 'text-gray-300'}`}>
                            {daysLeft < 1 ? '<1d' : `${Math.round(daysLeft)}d`}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50 text-xs text-gray-400">
              <td className="px-5 py-2 sticky left-0 bg-gray-50">Last audit</td>
              {stores.map(store => {
                const a = getLastAudit(store)
                return <td key={store} className="px-3 py-2 text-center">{a ? a.date : '—'}</td>
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>Depleted / Critical (&lt;1d)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Low (&lt;3d)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>OK</span>
        <span>· Numbers in stock qty · small text = days remaining</span>
      </div>
    </div>
  )
}
