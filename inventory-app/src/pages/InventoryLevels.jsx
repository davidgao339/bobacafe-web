import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { STORES } from '../data/fakeData'

const STATUS_RANK = { depleted: 0, critical: 1, low: 2, ok: 3, unknown: 4 }

export default function InventoryLevels() {
  const { config, data } = useConfig()
  const { estimateCurrentStock, getDailyAvg, getLastAudit } = useCalcs()
  const { t } = useLanguage()
  const [selectedStore, setSelectedStore] = useState('All')
  const [issuesOnly,    setIssuesOnly]    = useState(false)
  const [search,        setSearch]        = useState('')
  const [sortKey,       setSortKey]       = useState(null)
  const [sortDir,       setSortDir]       = useState('asc')
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const stores = selectedStore === 'All' ? STORES : [selectedStore]
  const { ingredients } = config

  if (ingredients.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">{t('levels.title')}</h1>
        <p className="text-sm text-gray-400">{t('levels.noIngredients')}</p>
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
    const auditLabel = lastAudit ? t('levels.lastAudit', { date: lastAudit.date }) : t('levels.noAudit')

    const q = search.toLowerCase()
    const rows = ingredients
      .filter(ing => !q || ing.name.toLowerCase().includes(q))
      .map(ing => ({ ing, ...stockLevel(store, ing) }))
      .sort((a, b) => {
        if (sortKey === 'name') {
          const cmp = a.ing.name.localeCompare(b.ing.name, undefined, { sensitivity: 'base' })
          return sortDir === 'asc' ? cmp : -cmp
        }
        if (sortKey === 'qty') return sortDir === 'asc' ? a.qty - b.qty : b.qty - a.qty
        return STATUS_RANK[a.status] - STATUS_RANK[b.status]
      })
    const visibleRows = issuesOnly ? rows.filter(r => r.status !== 'ok' && r.status !== 'unknown') : rows
    const issueCount  = rows.filter(r => r.status === 'depleted' || r.status === 'critical' || r.status === 'low').length

    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-y-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t('levels.title')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{t('levels.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
            <select value={selectedStore} onChange={e => { setSelectedStore(e.target.value); setIssuesOnly(false); setSearch('') }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="All">{t('common.allStores')}</option>
              {STORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-800 text-sm">{store}</span>
              {issueCount > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  {t('levels.issues', { count: issueCount })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {issueCount > 0 && (
                <button onClick={() => setIssuesOnly(v => !v)}
                  className={`text-xs font-medium transition-colors ${issuesOnly ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
                  {issuesOnly ? t('levels.showAll') : t('levels.issuesOnly')}
                </button>
              )}
              <span className="text-xs text-gray-400">{auditLabel}</span>
            </div>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {visibleRows.map(({ ing, qty, daily, daysLeft, status }) => (
              <div key={ing.id} className={`px-4 py-3 ${
                status === 'depleted' || status === 'critical' ? 'bg-red-50' :
                status === 'low' ? 'bg-amber-50/50' : ''
              }`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-medium text-gray-900 leading-snug">{ing.name}</p>
                  {status === 'depleted' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium shrink-0">{t('levels.depleted')}</span>}
                  {status === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs shrink-0">{t('levels.critical')}</span>}
                  {status === 'low'      && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs shrink-0">{t('levels.low')}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold tabular-nums leading-none ${
                    status === 'depleted' ? 'text-red-700' :
                    status === 'critical' ? 'text-red-600' :
                    status === 'low'      ? 'text-amber-700' : 'text-gray-800'
                  }`}>{qty}</span>
                  <span className="text-sm text-gray-400">{ing.unit}</span>
                  {daysLeft !== null && status !== 'unknown' && (
                    <span className={`text-xs ml-1 ${
                      daysLeft < 1 ? 'text-red-600 font-medium' :
                      daysLeft < 3 ? 'text-amber-600' : 'text-gray-400'
                    }`}>{daysLeft < 1 ? '< 1 day' : `${Math.round(daysLeft)}d`}</span>
                  )}
                  {daily > 0 && (
                    <span className="text-xs text-gray-400 ml-auto tabular-nums">{daily}/day</span>
                  )}
                </div>
              </div>
            ))}
            {visibleRows.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-gray-400">{t('levels.noIssues')}</p>
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>{t('common.ingredient')}{si('name')}</th>
                  <th className="px-4 py-2.5 font-medium text-right cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('qty')}>{t('levels.estStock')}{si('qty')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('common.unit')}</th>
                  <th className="px-4 py-2.5 font-medium text-right">{t('levels.dailyAvg')}</th>
                  <th className="px-4 py-2.5 font-medium text-right">{t('levels.daysLeft')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.map(({ ing, qty, daily, daysLeft, status }) => (
                  <tr key={ing.id} className={`${status !== 'ok' ? 'bg-opacity-50' : ''} hover:bg-gray-50`}>
                    <td className="px-5 py-2.5 font-medium text-gray-900">{ing.name}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${STATUS_CELL[status]}`}>{qty}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{ing.unit}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-400 text-xs">{daily > 0 ? daily : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
                      {status === 'unknown' || daysLeft === null ? <span className="text-gray-300">—</span>
                        : daysLeft < 1 ? <span className="text-red-600">&lt;1d</span>
                        : <span className={daysLeft < 3 ? 'text-amber-600' : 'text-gray-500'}>{Math.round(daysLeft)}d</span>
                      }
                    </td>
                    <td className="px-4 py-2.5">
                      {status === 'unknown'  && <span className="text-xs text-gray-300">—</span>}
                      {status === 'depleted' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">{t('levels.depleted')}</span>}
                      {status === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">{t('levels.critical')}</span>}
                      {status === 'low'      && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{t('levels.low')}</span>}
                      {status === 'ok'       && <span className="text-xs text-gray-300">{t('levels.ok')}</span>}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-sm text-gray-400">{t('levels.noIssues')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // All stores: matrix view — sort ingredients by worst status across all stores
  const q = search.toLowerCase()
  const matrixRows = ingredients
    .filter(ing => !q || ing.name.toLowerCase().includes(q))
    .map(ing => {
      const cells = stores.map(s => ({ store: s, ...stockLevel(s, ing) }))
      const worstRank = Math.min(...cells.map(c => STATUS_RANK[c.status]))
      return { ing, cells, worstRank }
    })
    .sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.ing.name.localeCompare(b.ing.name, undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      }
      return a.worstRank - b.worstRank
    })

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('levels.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('levels.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
          <select value={selectedStore} onChange={e => { setSelectedStore(e.target.value); setIssuesOnly(false); setSearch('') }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="All">{t('common.allStores')}</option>
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="text-sm" style={{ minWidth: `${220 + stores.length * 110}px` }}>
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="px-5 py-3 font-medium sticky left-0 bg-gray-50 z-10 w-32 sm:w-48 max-w-[128px] sm:max-w-none cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>{t('common.ingredient')}{si('name')}</th>
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
                <td className="px-5 py-2.5 sticky left-0 bg-white z-10 max-w-[128px] sm:max-w-none">
                  <span className="font-medium text-gray-900 block truncate">{ing.name}</span>
                  <span className="text-xs text-gray-400">{ing.unit}</span>
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
              <td className="px-5 py-2 sticky left-0 bg-gray-50">{t('levels.lastAuditRow')}</td>
              {stores.map(store => {
                const a = getLastAudit(store)
                return <td key={store} className="px-3 py-2 text-center">{a ? a.date : '—'}</td>
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>{t('levels.legendDepleted')}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>{t('levels.legendLow')}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>{t('levels.ok')}</span>
        <span>{t('levels.legendNote')}</span>
      </div>
    </div>
  )
}
