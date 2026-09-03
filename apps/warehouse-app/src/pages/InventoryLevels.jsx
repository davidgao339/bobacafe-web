import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export default function InventoryLevels() {
  const navigate = useNavigate()
  const { config, data, sales, posWaste } = useConfig()
  const { estimateCurrentStock, getDailyAvg, getLastAudit, getOrderQty } = useCalcs()
  const { t } = useLanguage()
  
  const selectedStore = 'Warehouse'
  const store = 'Warehouse'
  const filteredStores = ['Warehouse']
  
  const [issuesOnly,    setIssuesOnly]    = useState(false)
  const [search,        setSearch]        = useState('')
  const [sortKey,       setSortKey]       = useState('qty')
  const [sortDir,       setSortDir]       = useState('desc')
  const [page,          setPage]          = useState(0)

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
    setPage(0)
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

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
    const visibleRowsAll = issuesOnly ? rows.filter(r => r.status !== 'ok' && r.status !== 'unknown') : rows

    const PAGE_SIZE = 50
    const totalPages = Math.max(1, Math.ceil(visibleRowsAll.length / PAGE_SIZE))
    const visibleRows = visibleRowsAll.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

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

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <div className="relative flex-1 min-w-40 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
          {issueCount > 0 && (
            <button onClick={() => { setIssuesOnly(v => !v); setPage(0) }}
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
                onClick={() => navigate(`/ledger?ingredientId=${ing.id}`)}
                className={`px-4 py-3.5 cursor-pointer ${rowBg(status)}`}>
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
                    onClick={() => navigate(`/ledger?ingredientId=${ing.id}`)}
                    title={t('levels.openLedger')}
                    className={`transition-colors cursor-pointer ${rowBg(status)}`}>
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

        {totalPages > 1 && (
          <div className="mt-4 flex items-center gap-2 mx-auto md:mx-0 w-full justify-end">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              ←
            </button>
            <span className="text-xs text-gray-500 tabular-nums">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visibleRowsAll.length)} / {visibleRowsAll.length}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-default">
              →
            </button>
          </div>
        )}
      </div>
    )
  }
}
