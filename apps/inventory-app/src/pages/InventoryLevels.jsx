import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'


const STATUS_RANK = { depleted: 0, critical: 1, low: 2, ok: 3, unknown: 4 }

// Tiny 7-bar usage sparkline; bars normalised to the week's max
function Sparkline({ values }) {
  const max = Math.max(...values, 0.001)
  return (
    <svg width="52" height="18" className="inline-block align-middle">
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, Math.round((v / max) * 16))
        return <rect key={i} x={i * 7.5} y={18 - h} width="5" height={h} rx="1"
          className={v > 0 ? 'fill-blue-300' : 'fill-gray-100'} />
      })}
    </svg>
  )
}

export default function InventoryLevels({ onNavigate }) {
  const { config, data, sales, posWaste, visibleStores } = useConfig()
  const { estimateCurrentStock, getDailyAvg, getLastAudit, getOrderQty } = useCalcs()
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

  const filteredStores = selectedStore === 'All' ? visibleStores : [selectedStore]
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
    const hasAudit = !!getLastAudit(store)
    const hasPO    = data.purchaseOrders.some(po => po.store === store && po.status === 'received' &&
                       po.lines.some(l => l.ingredientId === ing.id && l.ordered > 0))
    const hasData  = hasAudit || hasPO
    const qty      = estimateCurrentStock(store, ing.id)
    const daily    = getDailyAvg(store, ing.id)
    const daysLeft = daily > 0 ? qty / daily : null
    const status   = !hasData ? 'unknown'
                   : qty <= 0 ? 'depleted'
                   : daily > 0 && daysLeft < 1 ? 'critical'
                   : daily > 0 && daysLeft < 3 ? 'low'
                   : 'ok'
    return { qty: Math.max(0, qty), daily, daysLeft, status, hasData }
  }

  // ── Shared header ────────────────────────────────────────────────────────────

  const q = search.toLowerCase()

  const StoreTabs = () => (
    <div className="flex gap-1.5 flex-wrap">
      {['All', ...visibleStores].map(s => (
        <button key={s}
          onClick={() => { setSelectedStore(s); setIssuesOnly(false) }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selectedStore === s
              ? 'bg-slate-800 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}>
          {s === 'All' ? t('common.allStores') : s}
        </button>
      ))}
    </div>
  )

  // ── Single-store view ────────────────────────────────────────────────────────

  if (filteredStores.length === 1) {
    const store     = filteredStores[0]
    const lastAudit = getLastAudit(store)
    const auditLabel = lastAudit ? t('levels.lastAudit', { date: lastAudit.date }) : t('levels.noAudit')

    // Last-7-day usage per ingredient per day, for the sparkline column
    const sparkTo    = sales.length > 0 ? sales[0].date : new Date().toISOString().slice(0, 10)
    const sparkDates = [...Array(7)].map((_, i) => {
      const d = new Date(sparkTo + 'T12:00:00'); d.setDate(d.getDate() - (6 - i))
      return d.toISOString().slice(0, 10)
    })
    const rowsByDate = {}
    ;[...sales, ...posWaste]
      .filter(s => s.store === store && s.date >= sparkDates[0] && s.date <= sparkTo)
      .forEach(s => { (rowsByDate[s.date] ??= []).push(s) })
    const sparkFor = (ingId) => sparkDates.map(d =>
      (rowsByDate[d] ?? []).reduce((sum, s) => sum + s.quantity * (config.recipes[s.product]?.[ingId] ?? 0), 0))

    const rows = ingredients
      .filter(ing => !q || ing.name.toLowerCase().includes(q))
      .map(ing => ({ ing, ...stockLevel(store, ing), orderQty: getOrderQty(store, ing.id), spark: sparkFor(ing.id) }))
      .sort((a, b) => {
        if (sortKey === 'name') {
          const cmp = a.ing.name.localeCompare(b.ing.name, undefined, { sensitivity: 'base' })
          return sortDir === 'asc' ? cmp : -cmp
        }
        if (sortKey === 'qty')   return sortDir === 'asc' ? a.qty - b.qty : b.qty - a.qty
        if (sortKey === 'order') return sortDir === 'asc' ? a.orderQty - b.orderQty : b.orderQty - a.orderQty
        // Status first, then fewest days left within the same status
        const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
        if (rank !== 0) return rank
        return (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)
      })

    const issueCount  = rows.filter(r => r.status === 'depleted' || r.status === 'critical' || r.status === 'low').length
    const visibleRows = issuesOnly ? rows.filter(r => r.status !== 'ok' && r.status !== 'unknown') : rows

    const rowBg = status =>
      status === 'depleted' || status === 'critical' ? 'bg-red-50 hover:bg-red-100/60' :
      status === 'low'      ? 'bg-amber-50 hover:bg-amber-100/60' :
      'hover:bg-gray-50'

    const qtyColor = status =>
      status === 'depleted' || status === 'critical' ? 'text-red-700 font-bold' :
      status === 'low'      ? 'text-amber-700 font-semibold' :
      status === 'unknown'  ? 'text-gray-300' : 'text-gray-800 font-medium'

    const daysColor = status =>
      status === 'depleted' || status === 'critical' ? 'text-red-600 font-semibold' :
      status === 'low' ? 'text-amber-600' : 'text-gray-400'

    const StatusBadge = ({ status }) => {
      if (status === 'depleted') return <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">{t('levels.depleted')}</span>
      if (status === 'critical') return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">{t('levels.critical')}</span>
      if (status === 'low')      return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{t('levels.low')}</span>
      if (status === 'ok')       return <span className="text-xs text-gray-300">{t('levels.ok')}</span>
      return <span className="text-xs text-gray-200">—</span>
    }

    return (
      <div className="p-4 md:p-8 max-w-3xl">
        {/* Title */}
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">{t('levels.title')}</h1>
          <p className="text-sm text-gray-400 mt-0.5">{auditLabel}</p>
        </div>

        {/* Store tabs */}
        <div className="mb-4">
          <StoreTabs />
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-40 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
          {issueCount > 0 && (
            <button onClick={() => setIssuesOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                issuesOnly
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>
              {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
              {issuesOnly && <span className="ml-1 text-xs font-normal opacity-70">· show all</span>}
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {visibleRows.map(({ ing, qty, daily, daysLeft, status, orderQty }) => (
              <div key={ing.id}
                onClick={() => onNavigate?.('usage', null, { store, ingredientId: ing.id })}
                className={`px-4 py-3.5 ${onNavigate ? 'cursor-pointer' : ''} ${rowBg(status)}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <p className="font-medium text-gray-900 leading-snug">{ing.name}</p>
                    <p className="text-xs text-gray-400">{ing.unit}</p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className={`text-2xl tabular-nums leading-none ${qtyColor(status)}`}>{qty}</span>
                  <span className="text-sm text-gray-400">{ing.unit}</span>
                  {daysLeft !== null && status !== 'unknown' && (
                    <span className={`text-xs ml-1 ${daysColor(status)}`}>
                      {daysLeft < 1 ? '< 1 day' : `~${Math.round(daysLeft)}d left`}
                    </span>
                  )}
                  {daily > 0 && <span className="text-xs text-gray-300 ml-auto tabular-nums">{daily}/day</span>}
                </div>
                {orderQty > 0 && (
                  <p className="text-xs text-blue-600 mt-1.5 tabular-nums">
                    {t('levels.colOrder')}: <span className="font-semibold">{orderQty} {ing.unit}</span>
                  </p>
                )}
              </div>
            ))}
            {visibleRows.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-gray-400">{issuesOnly ? t('levels.noIssues') : t('audit.noMatch', { query: search })}</p>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-5 py-3 font-medium cursor-pointer select-none hover:text-gray-700 w-full" onClick={() => handleSort('name')}>{t('common.ingredient')}{si('name')}</th>
                  <th className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('qty')}>{t('levels.estStock')}{si('qty')}</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{t('levels.colDaily')}</th>
                  <th className="px-4 py-3 font-medium text-center whitespace-nowrap">{t('levels.col7d')}</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">{t('levels.daysLeft')}</th>
                  <th className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleSort('order')}>{t('levels.colOrder')}{si('order')}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.map(({ ing, qty, daily, daysLeft, status, orderQty, spark }) => (
                  <tr key={ing.id}
                    onClick={() => onNavigate?.('usage', null, { store, ingredientId: ing.id })}
                    title={t('levels.openLedger')}
                    className={`transition-colors ${onNavigate ? 'cursor-pointer' : ''} ${rowBg(status)}`}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{ing.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{ing.unit}</p>
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums text-base ${qtyColor(status)}`}>{qty}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-sm text-gray-500">
                      {daily > 0 ? daily : <span className="text-gray-200">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Sparkline values={spark} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-sm">
                      {status === 'unknown' || daysLeft === null
                        ? <span className="text-gray-200">—</span>
                        : daysLeft < 1
                          ? <span className="text-red-600 font-semibold">&lt;1d</span>
                          : <span className={daysColor(status)}>{Math.round(daysLeft)}d</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-sm">
                      {orderQty > 0
                        ? <span className="font-semibold text-blue-700">{orderQty} <span className="text-blue-300 text-xs font-normal">{ing.unit}</span></span>
                        : <span className="text-gray-200">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                    {issuesOnly ? t('levels.noIssues') : t('audit.noMatch', { query: search })}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ── All-stores matrix ────────────────────────────────────────────────────────

  const matrixRows = ingredients
    .filter(ing => !q || ing.name.toLowerCase().includes(q))
    .map(ing => {
      const cells     = filteredStores.map(s => ({ store: s, ...stockLevel(s, ing) }))
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

  const CELL_BG = {
    unknown:  '',
    depleted: 'bg-red-50 text-red-700 font-semibold',
    critical: 'bg-red-50 text-red-600',
    low:      'bg-amber-50 text-amber-700',
    ok:       'text-gray-700',
  }

  return (
    <div className="p-4 md:p-8">
      {/* Title */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">{t('levels.title')}</h1>
        <p className="text-sm text-gray-400 mt-0.5">{t('levels.subtitle')}</p>
      </div>

      {/* Store tabs */}
      <div className="mb-4">
        <StoreTabs />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-40 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="text-sm" style={{ minWidth: `${220 + filteredStores.length * 110}px` }}>
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
              <th className="px-5 py-3 font-medium sticky left-0 bg-gray-50 z-10 cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
                {t('common.ingredient')}{si('name')}
              </th>
              {filteredStores.map(s => (
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
                  <p className="font-medium text-gray-900 truncate max-w-[180px] sm:max-w-none">{ing.name}</p>
                  <p className="text-xs text-gray-400">{ing.unit}</p>
                </td>
                {cells.map(({ store, qty, daysLeft, status, hasData }) => (
                  <td key={store}
                    onClick={() => hasData && onNavigate?.('usage', null, { store, ingredientId: ing.id })}
                    title={hasData ? t('levels.openLedger') : undefined}
                    className={`px-3 py-2.5 text-center tabular-nums ${hasData && onNavigate ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-blue-200' : ''} ${CELL_BG[status]}`}>
                    {!hasData ? <span className="text-gray-200">—</span> : (
                      <div>
                        <div className="font-medium">{qty}</div>
                        {daysLeft !== null && (
                          <div className={`text-xs ${
                            status === 'depleted' || status === 'critical' ? 'text-red-400' :
                            status === 'low' ? 'text-amber-500' : 'text-gray-300'
                          }`}>
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
              {filteredStores.map(store => {
                const a = getLastAudit(store)
                return <td key={store} className="px-3 py-2 text-center">{a ? a.date : '—'}</td>
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>{t('levels.legendDepleted')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>{t('levels.legendLow')}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>{t('levels.ok')}</span>
        <span>{t('levels.legendNote')}</span>
      </div>
    </div>
  )
}
