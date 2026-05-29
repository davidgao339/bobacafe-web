import { useState, useMemo } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

export default function ReplenishmentReport() {
  const { config, reportFrom, reportTo } = useConfig()
  const { getConsumed7d, getAdjDelta, getOrderQty } = useCalcs()
  const [selectedStore, setSelectedStore] = useState('All')
  const [hideZero,      setHideZero]      = useState(true)

  const stores = selectedStore === 'All' ? STORES : [selectedStore]

  const reportRows = useMemo(() =>
    stores.map(store => ({
      store,
      rows: config.ingredients.map(p => ({
        ...p,
        consumed: getConsumed7d(store, p.id),
        adjDelta: getAdjDelta(store, p.id),
        orderQty: getOrderQty(store, p.id),
      })),
    })),
    [selectedStore, config.ingredients, getConsumed7d, getAdjDelta, getOrderQty]
  )

  const csvField = (v) => {
    const s = String(v)
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const handleExportCSV = () => {
    const lines = ['Store,Product,Unit,Consumed 7d,Adj Delta,Order Qty']
    reportRows.forEach(({ store, rows }) =>
      rows.forEach(r => lines.push([store, r.name, r.unit, r.consumed, r.adjDelta, r.orderQty].map(csvField).join(',')))
    )
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `replenishment-${selectedStore.replace(/ /g, '-')}-${reportTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-8 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Replenishment Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Period: {reportFrom} – {reportTo} &nbsp;·&nbsp; Formula: consumed × 1.05 − adj delta
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Hide zero rows
          </label>
          <select value={selectedStore} onChange={e => setSelectedStore(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option>All</option>
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
          <button onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Export CSV
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            Print
          </button>
        </div>
      </div>

      <div className="hidden print:block mb-6">
        <h1 className="text-xl font-bold">Weekly Replenishment Report</h1>
        <p className="text-sm text-gray-600">
          Period: {reportFrom} – {reportTo}
          {selectedStore !== 'All' && ` · Store: ${selectedStore}`}
        </p>
      </div>

      <div className="space-y-8">
        {reportRows.map(({ store, rows }) => {
          const visibleRows  = hideZero ? rows.filter(r => r.orderQty > 0) : rows
          const itemsToOrder = rows.filter(r => r.orderQty > 0).length
          return (
            <div key={store} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{store}</h2>
                <span className="text-sm text-gray-500">
                  {itemsToOrder} of {rows.length} ingredients to order
                </span>
              </div>
              {visibleRows.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-400 text-center">Nothing to order for this store</p>
              ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-6 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Unit</th>
                    <th className="px-4 py-3 font-medium text-right">Consumed 7d</th>
                    <th className="px-4 py-3 font-medium text-right">× 1.05</th>
                    <th className="px-4 py-3 font-medium text-right">Adj Delta</th>
                    <th className="px-4 py-3 font-medium text-right bg-blue-50 text-blue-700">Order Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibleRows.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3 text-gray-500">{r.unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.consumed}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{Math.ceil(r.consumed * 1.05)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.adjDelta === 0
                          ? <span className="text-gray-300">—</span>
                          : <span className={`font-medium ${r.adjDelta < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {r.adjDelta > 0 ? '+' : ''}{r.adjDelta}
                            </span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right bg-blue-50">
                        <span className="font-bold text-blue-700 tabular-nums text-base">{r.orderQty}</span>
                        <span className="text-blue-400 text-xs ml-1">{r.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={5} className="px-6 py-3 text-sm font-semibold text-gray-700">
                      Items to order
                    </td>
                    <td className="px-4 py-3 text-right bg-blue-100">
                      <span className="font-bold text-blue-800 tabular-nums text-base">{itemsToOrder}</span>
                      <span className="text-blue-500 text-xs ml-1">ingredients</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
              )}
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                Order Qty = ⌈Consumed × 1.05⌉ − Adj Delta
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
