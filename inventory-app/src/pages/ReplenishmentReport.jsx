import { useState, useMemo } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'


export default function ReplenishmentReport() {
  const { config, reportFrom, reportTo, stores } = useConfig()
  const { getConsumed7d, estimateCurrentStock, getOrderQty } = useCalcs()
  const { t } = useLanguage()
  const [selectedStore, setSelectedStore] = useState('All')
  const [hideZero,      setHideZero]      = useState(true)
  const [sortKey,       setSortKey]       = useState(null)
  const [sortDir,       setSortDir]       = useState('asc')
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const applySort = rows => sortKey ? [...rows].sort((a, b) => {
    const cmp = sortKey === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.orderQty - b.orderQty
    return sortDir === 'asc' ? cmp : -cmp
  }) : rows

  const filteredStores = selectedStore === 'All' ? stores : [selectedStore]

  const supplierMap = useMemo(() =>
    Object.fromEntries((config.suppliers ?? []).map(s => [s.id, s.name])),
    [config.suppliers]
  )

  const reportRows = useMemo(() =>
    filteredStores.map(store => ({
      store,
      rows: config.ingredients.map(p => ({
        ...p,
        supplier: supplierMap[p.supplierId] ?? '—',
        consumed: getConsumed7d(store, p.id),
        currentStock: estimateCurrentStock(store, p.id),
        orderQty: getOrderQty(store, p.id),
      })),
    })),
    [selectedStore, stores, config.ingredients, supplierMap, getConsumed7d, estimateCurrentStock, getOrderQty]
  )

  const csvField = (v) => {
    const s = String(v)
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const handleExportCSV = () => {
    const lines = ['Store,Supplier,Product,Unit,Consumed 7d,Current Stock,Order Qty']
    reportRows.forEach(({ store, rows }) =>
      rows.forEach(r => lines.push([store, r.supplier, r.name, r.unit, r.consumed, r.currentStock, r.orderQty].map(csvField).join(',')))
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
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between mb-8 no-print gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('report.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('report.subtitle', { from: reportFrom, to: reportTo })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            {t('report.hideZero')}
          </label>
          <select value={selectedStore} onChange={e => setSelectedStore(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option>{t('common.all')}</option>
            {stores.map(s => <option key={s}>{s}</option>)}
          </select>
          <button onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            {t('report.exportCSV')}
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            {t('report.print')}
          </button>
        </div>
      </div>

      <div className="hidden print:block mb-6">
        <h1 className="text-xl font-bold">{t('report.printTitle')}</h1>
        <p className="text-sm text-gray-600">
          {t('report.printPeriod', { from: reportFrom, to: reportTo })}
          {selectedStore !== 'All' && t('report.printStore', { store: selectedStore })}
        </p>
      </div>

      <div className="space-y-8">
        {reportRows.map(({ store, rows }) => {
          const visibleRows  = applySort(hideZero ? rows.filter(r => r.orderQty > 0) : rows)
          const itemsToOrder = rows.filter(r => r.orderQty > 0).length
          return (
            <div key={store} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-slate-50 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{store}</h2>
                <span className="text-sm text-gray-500">
                  {t('report.storeHeader', { count: itemsToOrder, total: rows.length })}
                </span>
              </div>
              {visibleRows.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-400 text-center">{t('report.nothingToOrder')}</p>
              ) : (<>
                {/* Mobile: cards */}
                <div className="md:hidden divide-y divide-gray-100">
                  {visibleRows.map(r => (
                    <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 leading-snug">{r.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {t('report.currentStock')}: {r.currentStock} {r.unit}
                          {r.consumed > 0 && <span className="ml-2">{t('report.consumed7d')}: {r.consumed}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-bold tabular-nums text-blue-700">{r.orderQty}</p>
                        <p className="text-xs text-blue-400">{r.unit}</p>
                      </div>
                    </div>
                  ))}
                  <div className="px-4 py-3 bg-blue-50 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">{t('report.itemsToOrder')}</span>
                    <span className="font-bold text-blue-800 tabular-nums">{itemsToOrder} {t('report.ingredientsLabel')}</span>
                  </div>
                </div>
                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="px-6 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>{t('report.product')}{si('name')}</th>
                        <th className="px-4 py-3 font-medium">{t('recipes.supplier')}</th>
                        <th className="px-4 py-3 font-medium">{t('common.unit')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('report.consumed7d')}</th>
                        <th className="px-4 py-3 font-medium text-right">× 1.05</th>
                        <th className="px-4 py-3 font-medium text-right">{t('report.currentStock')}</th>
                        <th className="px-4 py-3 font-medium text-right bg-blue-50 text-blue-700 cursor-pointer select-none hover:bg-blue-100" onClick={() => handleSort('orderQty')}>{t('report.orderQty')}{si('orderQty')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {visibleRows.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-6 py-3 font-medium text-gray-900">{r.name}</td>
                          <td className="px-4 py-3 text-gray-500">{r.supplier}</td>
                          <td className="px-4 py-3 text-gray-500">{r.unit}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.consumed}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">{Math.ceil(r.consumed * 1.05)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.currentStock}</td>
                          <td className="px-4 py-3 text-right bg-blue-50">
                            <span className="font-bold text-blue-700 tabular-nums text-base">{r.orderQty}</span>
                            <span className="text-blue-400 text-xs ml-1">{r.unit}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td colSpan={6} className="px-6 py-3 text-sm font-semibold text-gray-700">{t('report.itemsToOrder')}</td>
                        <td className="px-4 py-3 text-right bg-blue-100">
                          <span className="font-bold text-blue-800 tabular-nums text-base">{itemsToOrder}</span>
                          <span className="text-blue-500 text-xs ml-1">{t('report.ingredientsLabel')}</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>)}
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                {t('report.formula')}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
