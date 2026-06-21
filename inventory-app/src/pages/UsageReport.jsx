import { useState, useMemo, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'

const r1 = n => Math.round(n * 10) / 10
const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DailyLedger() {
  const { config, sales, posWaste, data, reportFrom, reportTo, stores } = useConfig()
  const calcs = useCalcs()
  const { t } = useLanguage()
  const { recipes } = config

  const [selectedStore, setSelectedStore] = useState('All')
  const [from,          setFrom]          = useState(reportFrom)
  const [to,            setTo]            = useState(reportTo)
  const [selectedId,    setSelectedId]    = useState(null)
  const [search,        setSearch]        = useState('')
  const [expandedDate,  setExpandedDate]  = useState(null)

  const today       = todayStr()
  const singleStore = selectedStore !== 'All'

  // ── Left panel: current estimate per ingredient ───────────────────────────
  const listItems = useMemo(() => {
    const q = search.toLowerCase()
    return config.ingredients
      .filter(ing => !q || ing.name.toLowerCase().includes(q))
      .map(ing => {
        const estimate = singleStore
          ? calcs.estimateCurrentStock(selectedStore, ing.id)
          : r1(stores.reduce((sum, st) => sum + calcs.estimateCurrentStock(st, ing.id), 0))
        return { id: ing.id, name: ing.name, unit: ing.unit, estimate }
      })
  }, [config.ingredients, calcs, selectedStore, singleStore, stores, search])

  // ── Daily ledger rows (single store only) ─────────────────────────────────
  const { auditInfo, ledgerRows } = useMemo(() => {
    if (!selectedId || !singleStore) return { auditInfo: null, ledgerRows: [] }

    // All audits for this ingredient at this store, oldest first
    const storeAudits = [...data.audits]
      .filter(a => a.store === selectedStore && a.counts[selectedId] != null)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (storeAudits.length === 0) return { auditInfo: null, ledgerRows: [] }

    // Baseline: last audit at or before `from`, else the earliest audit we have
    const baseAudit = [...storeAudits].filter(a => a.date <= from).pop()
      ?? storeAudits[0]

    const startDate = baseAudit.date
    const base      = baseAudit.counts[selectedId] ?? 0

    // Subsequent audits (after baseline) become adjustment anchors
    const auditByDate = new Map(
      storeAudits
        .filter(a => a.date > startDate)
        .map(a => [a.date, a.counts[selectedId] ?? 0])
    )

    // Build per-day activity map from day after baseline
    const byDate = {}
    const ensure = d => { if (!byDate[d]) byDate[d] = { usage: 0, received: 0, details: [] } }

    sales
      .filter(s => s.store === selectedStore && s.date > startDate)
      .forEach(s => {
        const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
        if (!consumed) return
        ensure(s.date)
        byDate[s.date].usage = r1(byDate[s.date].usage + consumed)
        byDate[s.date].details.push({ kind: 'sale', product: s.product, soldQty: s.quantity, consumed: r1(consumed) })
      })

    posWaste
      .filter(s => s.store === selectedStore && s.date > startDate)
      .forEach(s => {
        const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
        if (!consumed) return
        ensure(s.date)
        byDate[s.date].usage = r1(byDate[s.date].usage + consumed)
        byDate[s.date].details.push({ kind: 'waste', product: s.product, soldQty: s.quantity, consumed: r1(consumed) })
      })

    data.transactions
      .filter(t => t.ingredientId === selectedId && t.store === selectedStore && t.date > startDate)
      .forEach(t => {
        ensure(t.date)
        if (t.type === 'adjustment') {
          byDate[t.date].received = r1(byDate[t.date].received + t.quantity)
          byDate[t.date].details.push({ kind: 'adjustment', qty: t.quantity })
        } else {
          byDate[t.date].usage = r1(byDate[t.date].usage + t.quantity)
          byDate[t.date].details.push({ kind: t.type, qty: t.quantity })
        }
      })

    data.purchaseOrders
      .filter(po =>
        po.store === selectedStore &&
        po.status === 'received' &&
        (po.receivedAt ?? po.receivedDate ?? '') > (baseAudit.timestamp ?? startDate)
      )
      .forEach(po => {
        const line = po.lines.find(l => l.ingredientId === selectedId)
        if (!line) return
        const qty = line.received ?? line.ordered ?? 0
        if (!qty) return
        const d = (po.receivedAt ?? po.receivedDate ?? '').slice(0, 10)
        ensure(d)
        byDate[d].received = r1(byDate[d].received + qty)
        byDate[d].details.push({ kind: 'po', poId: po.id, qty })
      })

    // Walk every date from startDate to today; audits snap the running balance
    const allDates = [
      ...new Set([startDate, ...Object.keys(byDate), ...[...auditByDate.keys()], today])
    ].sort()

    let running = base
    const allRows = []
    for (const d of allDates) {
      if (d <= startDate) continue
      const { usage = 0, received = 0, details = [] } = byDate[d] ?? {}
      const computed = r1(running - usage + received)
      let auditAdj = null
      if (auditByDate.has(d)) {
        const auditCount = auditByDate.get(d)
        auditAdj = r1(auditCount - computed)
        running = auditCount
        details.push({ kind: 'audit', count: auditCount, adj: auditAdj })
      } else {
        running = computed
      }
      allRows.push({ date: d, usage, received, auditAdj, ending: running, details })
    }

    const displayRows = allRows
      .filter(r =>
        r.date >= from && r.date <= to &&
        (r.usage > 0 || r.received > 0 || r.auditAdj !== null || r.date === today)
      )
      .reverse()

    return {
      auditInfo: { date: startDate, base },
      ledgerRows: displayRows,
    }
  }, [selectedId, selectedStore, singleStore, data, sales, posWaste, recipes, from, to, today])

  const selectedIng = config.ingredients.find(i => i.id === selectedId)

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header + filters ────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-4 md:pt-8 pb-4 flex items-start justify-between flex-wrap gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('ledger.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('ledger.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('common.from')}</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('common.to')}</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={selectedStore} onChange={e => { setSelectedStore(e.target.value); setExpandedDate(null) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="All">{t('common.allStores')}</option>
            {stores.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden px-4 md:px-8 pb-4 md:pb-8 gap-5 min-h-0">

        {/* Ingredient list */}
        <div className="w-full md:w-60 flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-48 md:h-auto">
          <div className="p-2.5 border-b border-gray-100">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
          </div>
          <div className="flex px-3 py-1.5 border-b border-gray-100 text-xs text-gray-400 justify-between">
            <span>{t('common.ingredient')}</span>
            <span>{t('ledger.colCurrent')}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {listItems.map(ing => (
              <button key={ing.id}
                onClick={() => { setSelectedId(ing.id); setExpandedDate(null) }}
                className={`w-full flex items-center justify-between px-3 py-2 border-b border-gray-50 last:border-0 transition-colors ${
                  selectedId === ing.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}>
                <span className={`text-left font-medium truncate flex-1 mr-2 text-xs ${selectedId === ing.id ? 'text-blue-700' : 'text-gray-700'}`}>
                  {ing.name}
                </span>
                <span className={`tabular-nums text-xs flex-shrink-0 ${selectedId === ing.id ? 'text-blue-500' : 'text-gray-400'}`}>
                  {ing.estimate !== 0 ? `${ing.estimate} ${ing.unit}` : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Daily ledger */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {selectedId == null ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400">{t('usage.selectIngredient')}</p>
            </div>
          ) : !singleStore ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">{t('ledger.selectStorePrompt')}</p>
                <p className="text-xs text-gray-400 mt-1">{t('ledger.selectStoreHint')}</p>
              </div>
            </div>
          ) : !auditInfo ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400">
              {t('ledger.noAudit')}
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-lg font-semibold text-gray-900">{selectedIng?.name}</h2>
                <span className="text-sm text-gray-400">{selectedIng?.unit}</span>
                <span className="text-xs text-gray-400 ml-auto">
                  {t('ledger.auditBase', { date: auditInfo.date, base: auditInfo.base })}
                </span>
              </div>

              {ledgerRows.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400">
                  {t('ledger.noActivity')}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                        <th className="px-5 py-3 font-medium">{t('common.date')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colUsage')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colReceived')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colAuditAdj')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colEnding')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map((row, i) => (
                        <Fragment key={row.date}>
                          <tr
                            onClick={() => row.details.length > 0 && setExpandedDate(d => d === row.date ? null : row.date)}
                            className={`border-b border-gray-50 transition-colors select-none ${
                              row.details.length > 0 ? 'cursor-pointer' : ''
                            } ${
                              expandedDate === row.date ? 'bg-blue-50' :
                              row.auditAdj !== null    ? 'bg-purple-50/40' :
                              row.date === today       ? 'bg-amber-50/50' :
                                                        'hover:bg-gray-50'
                            }`}>
                            <td className="px-5 py-3 font-medium text-gray-900">
                              <div className="flex items-center gap-2">
                                {row.details.length > 0 && (
                                  <svg className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${expandedDate === row.date ? 'rotate-90' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                                  </svg>
                                )}
                                <span className={row.date === today ? 'text-amber-700 font-semibold' : ''}>
                                  {row.date}
                                </span>
                                {row.date === today && (
                                  <span className="text-xs bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-medium">
                                    {t('ledger.today')}
                                  </span>
                                )}
                                {row.auditAdj !== null && (
                                  <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">
                                    {t('ledger.auditTag')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-red-600">
                              {row.usage > 0
                                ? <span>−{row.usage} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-green-600">
                              {row.received > 0
                                ? <span>+{row.received} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.auditAdj !== null
                                ? <span className={row.auditAdj >= 0 ? 'text-green-600' : 'text-red-500'}>
                                    {row.auditAdj >= 0 ? '+' : ''}{row.auditAdj}{' '}
                                    <span className="text-gray-400 text-xs">{selectedIng?.unit}</span>
                                  </span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                              i === 0 ? 'text-blue-700' : 'text-gray-800'
                            }`}>
                              {row.ending} <span className="text-gray-400 text-xs font-normal">{selectedIng?.unit}</span>
                            </td>
                          </tr>

                          {expandedDate === row.date && (
                            <tr className="bg-blue-50/60 border-b border-blue-100">
                              <td colSpan={5} className="px-8 py-3">
                                <div className="space-y-1.5">
                                  {row.details.map((d, j) => (
                                    <div key={j} className="flex items-center gap-3 text-xs">
                                      <span className={`px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                                        d.kind === 'sale'       ? 'bg-blue-100 text-blue-700' :
                                        d.kind === 'waste'      ? 'bg-amber-100 text-amber-700' :
                                        d.kind === 'po'         ? 'bg-green-100 text-green-700' :
                                        d.kind === 'adjustment' ? 'bg-purple-100 text-purple-700' :
                                        d.kind === 'audit'      ? 'bg-purple-100 text-purple-700' :
                                                                  'bg-gray-100 text-gray-600'
                                      }`}>
                                        {d.kind === 'sale'       ? t('ledger.kindSale') :
                                         d.kind === 'waste'      ? t('ledger.kindWaste') :
                                         d.kind === 'po'         ? `PO-${d.poId}` :
                                         d.kind === 'adjustment' ? t('ledger.kindAdj') :
                                         d.kind === 'audit'      ? t('ledger.kindAudit') :
                                                                   d.kind}
                                      </span>
                                      {d.product && (
                                        <span className="font-medium text-gray-800 flex-1 truncate">{d.product}</span>
                                      )}
                                      {d.soldQty != null && (
                                        <span className="text-gray-400 flex-shrink-0">×{d.soldQty}</span>
                                      )}
                                      {d.kind === 'audit'
                                        ? <span className="text-purple-700 font-semibold flex-shrink-0">
                                            {t('ledger.auditCounted', { count: d.count, unit: selectedIng?.unit })}
                                            {d.adj !== 0 && (
                                              <span className={`ml-1.5 ${d.adj > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                ({d.adj > 0 ? '+' : ''}{d.adj})
                                              </span>
                                            )}
                                          </span>
                                        : <span className={`font-semibold flex-shrink-0 ${
                                            d.kind === 'po' || d.kind === 'adjustment' ? 'text-green-700' : 'text-red-600'
                                          }`}>
                                            {d.kind === 'po' || d.kind === 'adjustment' ? '+' : '−'}
                                            {d.consumed ?? d.qty} {selectedIng?.unit}
                                          </span>
                                      }
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
