import { useState, useMemo, Fragment, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { getProductType } from '@inventory/utils/productTypes'
import { fetchLedgerDaily } from '../services/databricks'
const r1 = n => Math.round(n * 10) / 10
const todayStr = () => new Date().toISOString().slice(0, 10)

export default function DailyLedger({ initialIngredientId }) {
  const { config, sales, posWaste, data, reportFrom, reportTo, settings } = useConfig()
  const calcs = useCalcs()
  const { t } = useLanguage()
  const { recipes } = config
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedStore = 'Warehouse'
  const thirtyDaysAgo = () => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }
  const [from,          setFrom]          = useState(() => (reportFrom && reportFrom !== todayStr()) ? reportFrom : thirtyDaysAgo())
  const [to,            setTo]            = useState(todayStr())
  const [selectedIdState, setSelectedIdState] = useState(() => {
    const id = searchParams.get('ingredientId')
    return id ? Number(id) : (initialIngredientId ?? null)
  })
  const [search,        setSearch]        = useState('')
  const [expandedDate,  setExpandedDate]  = useState(null)

  // ── Lakehouse daily ledger (single source of truth) ────────────────────────
  // view_ledger_daily serves one row per day (day aggregates + ending balance +
  // details_json of the day's events) — the app only reshapes and renders.
  const [lhDaily, setLhDaily] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!settings?.token || !settings?.warehouseId || !selectedIdState) return
    fetchLedgerDaily(settings.token, settings.warehouseId, 'WHS', selectedIdState)
      .then(rows => { if (!cancelled) setLhDaily({ ingredientId: selectedIdState, rows }) })
      .catch(err => console.error('Lakehouse daily ledger fetch failed; using local ledger', err))
    return () => { cancelled = true }
  }, [settings?.token, settings?.warehouseId, selectedIdState])

  // Sync state to URL
  useEffect(() => {
    const urlId = searchParams.get('ingredientId')
    if (selectedIdState && String(selectedIdState) !== urlId) {
      setSearchParams({ ingredientId: selectedIdState }, { replace: true })
    } else if (!selectedIdState && urlId) {
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('ingredientId')
      setSearchParams(newParams, { replace: true })
    }
  }, [selectedIdState, searchParams, setSearchParams])

  const selectedId = selectedIdState
  const setSelectedId = setSelectedIdState

  const today       = todayStr()

  // ── Left panel: current estimate per ingredient ───────────────────────────
  const listItems = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = config.ingredients
      .filter(ing => !q || ing.name.toLowerCase().includes(q))
      .map(ing => {
        const estimate = calcs.estimateCurrentStock(selectedStore, ing.id)
        return { id: ing.id, name: ing.name, unit: ing.unit, estimate, productType: getProductType(ing) || 'ingredient' }
      })
    
    const groups = {}
    filtered.forEach(ing => {
      if (!groups[ing.productType]) groups[ing.productType] = []
      groups[ing.productType].push(ing)
    })
    return groups
  }, [config.ingredients, calcs, selectedStore, search])

  // ── Daily ledger rows (single store only) ─────────────────────────────────
  const { auditInfo, ledgerRows } = useMemo(() => {
    if (!selectedId) return { auditInfo: null, ledgerRows: [] }

    // ── Lakehouse path (authoritative): day rows from view_ledger_daily ──────
    // (ignored while the fetch belongs to a previously selected ingredient)
    if (lhDaily && String(lhDaily.ingredientId) === String(selectedId)) {
      const lhRows = lhDaily.rows
      if (lhRows.length === 0) return { auditInfo: null, ledgerRows: [] }

      // Reshape the view's rows to the renderer shape; details_json holds the
      // day's event lines exactly as the old client-side bucketing produced them.
      const allRows = lhRows.map(r => {
        let details = []
        try { details = JSON.parse(r.details_json || '[]') } catch { /* empty day */ }
        details = details.map(d => ({
          kind: d.kind,
          time: d.time,
          product: d.product,
          soldQty: d.sold_qty,
          consumed: d.consumed,
          qty: d.qty,
          poId: d.po_id,
          prodId: d.po_id,
          adjId: d.po_id,
          count: d.audit_count,
          adj: d.adj,
          baseline: d.is_anchor,
        }))
        const hasAudit    = details.some(d => d.kind === 'audit')
        const isAnchorDay = details.some(d => d.kind === 'audit' && d.baseline)
        return {
          date: r.date,
          usage: Number(r.day_usage) || 0,
          received: Number(r.day_received) || 0,
          transferOut: Number(r.day_transfer_out) || 0,
          transferIn: Number(r.day_transfer_in) || 0,
          // The view emits 0.0 on audit-free days; the UI distinguishes
          // "no audit that day" (null) from a real zero adjustment.
          auditAdj: hasAudit && !isAnchorDay ? Number(r.audit_adj) : null,
          baselineAudit: isAnchorDay,
          ending: Number(r.ending_balance) || 0,
          details,
          anchorDate: r.anchor_date,
          anchorCount: Number(r.anchor_count) || 0,
        }
      })

      // The view emits no row for event-less days; the UI always shows today.
      const todayRow = allRows.find(r => r.date === today)
      if (!todayRow && today >= allRows[0].anchorDate) {
        const lastRow = allRows[allRows.length - 1]
        allRows.push({
          date: today, usage: 0, received: 0, transferOut: 0, transferIn: 0,
          auditAdj: null, baselineAudit: false,
          ending: lastRow ? lastRow.ending : 0, details: [],
          anchorDate: lastRow?.anchorDate, anchorCount: lastRow?.anchorCount ?? 0,
        })
      }

      const anchor = allRows[0]
      const displayRows = allRows
        .filter(r =>
          r.date >= from && r.date <= to &&
          (r.usage > 0 || r.received !== 0 || r.transferOut > 0 || r.transferIn > 0 || r.auditAdj !== null || r.baselineAudit || r.date === today)
        )
        .reverse()

      return {
        auditInfo: { date: anchor.anchorDate, base: anchor.anchorCount, isAssumed: false },
        ledgerRows: displayRows,
      }
    }

    // All audits for this ingredient at this store, oldest first
    const storeAudits = [...data.audits]
      .filter(a => a.store === selectedStore && a.counts[selectedId] != null)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Baseline: last audit at or before `from`
    const baseAudit = storeAudits.length > 0 
      ? ([...storeAudits].filter(a => a.date <= from).pop() ?? null)
      : null

    const startDate = baseAudit?.date ?? from
    const base      = baseAudit?.counts[selectedId] ?? 0

    const baseAuditTime = baseAudit
      ? ((baseAudit.timestamp && baseAudit.timestamp.startsWith(startDate)) ? baseAudit.timestamp : `${startDate}T23:59:59`)
      : '0000-00-00T00:00:00'

    // Build per-day activity map
    const byDate = {}
    const ensure = d => { if (!byDate[d]) byDate[d] = { details: [] } }

    sales
      .filter(s => s.store === selectedStore && s.date >= startDate)
      .forEach(s => {
        const time = `${s.date}T23:59:58`
        if (time <= baseAuditTime) return
        const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
        if (!consumed) return
        ensure(s.date)
        byDate[s.date].details.push({ kind: 'sale', product: s.product, soldQty: s.quantity, consumed: r1(consumed), time })
      })

    posWaste
      .filter(s => s.store === selectedStore && s.date >= startDate)
      .forEach(s => {
        const time = `${s.date}T23:59:58`
        if (time <= baseAuditTime) return
        const consumed = s.quantity * (recipes[s.product]?.[selectedId] ?? 0)
        if (!consumed) return
        ensure(s.date)
        byDate[s.date].details.push({ kind: 'waste', product: s.product, soldQty: s.quantity, consumed: r1(consumed), time })
      })

    const getPoTime = (poId) => {
      const po = data.purchaseOrders.find(p => p.id === poId)
      return po?.receivedAt ?? (po?.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
    }

    data.transactions
      .filter(t => t.ingredientId === selectedId && t.store === selectedStore && t.date >= startDate)
      .forEach(t => {
        let time = t.timestamp ? t.timestamp.replace(' ', 'T') : `${t.date}T12:00:00`
        if (t.type === 'adjustment' && t.poId) time = getPoTime(t.poId)
        if (time <= baseAuditTime) return

        ensure(t.date)
        if (t.type === 'adjustment') {
          const po = t.poId ? data.purchaseOrders.find(p => p.id === t.poId) : null
          const isTransfer = po && po.fromLocation && po.toLocation

          if (t.quantity < 0 && t.poId) {
            byDate[t.date].details.push({ kind: 'transfer-out', qty: Math.abs(t.quantity), poId: t.poId, time })
          } else if (t.quantity > 0 && t.poId) {
            if (isTransfer) {
              byDate[t.date].details.push({ kind: 'transfer-in', qty: t.quantity, poId: t.poId, time })
            }
            // If not a transfer, skip pushing here, it is handled by the data.purchaseOrders loop
          } else {
            byDate[t.date].details.push({ kind: 'adjustment', qty: t.quantity, adjId: t.poId, time })
          }
        } else if (t.type === 'production') {
          if (t.quantity > 0) {
            byDate[t.date].details.push({ kind: 'production-yield', qty: t.quantity, prodId: t.poId, product: t.reason, time })
          } else {
            byDate[t.date].details.push({ kind: 'production-usage', qty: Math.abs(t.quantity), prodId: t.poId, product: t.reason, time })
          }
        } else {
          byDate[t.date].details.push({ kind: t.type, qty: t.quantity, time })
        }
      })

    data.purchaseOrders
      .filter(po =>
        po.store === selectedStore &&
        po.status === 'received' &&
        !(po.fromLocation && po.toLocation)
      )
      .forEach(po => {
        const time = po.receivedAt ?? (po.receivedDate ? `${po.receivedDate}T12:00:00` : '9999-12-31T23:59:59')
        if (time <= baseAuditTime) return
        const d = po.receivedDate ?? time.slice(0, 10)
        if (d < startDate) return

        const line = po.lines.find(l => l.ingredientId === selectedId)
        if (!line) return
        const qty = line.received ?? line.ordered ?? 0
        if (!qty) return

        ensure(d)
        byDate[d].details.push({ kind: 'po', poId: po.id, qty, time })
      })

    const auditsByDate = new Map(
      storeAudits
        .filter(a => a.date >= startDate && ((a.timestamp && a.timestamp.startsWith(a.date)) ? a.timestamp : `${a.date}T23:59:59`) > baseAuditTime)
        .map(a => [a.date, a])
    )

    const allDates = [
      ...new Set([startDate, ...Object.keys(byDate), ...[...auditsByDate.keys()], today])
    ].sort()

    let running = base
    const allRows = []

    for (const d of allDates) {
      if (d < startDate) continue
      
      const dayData = byDate[d] ?? { details: [] }
      const details = [...dayData.details]
      
      if (auditsByDate.has(d)) {
        const audit = auditsByDate.get(d)
        details.push({
          kind: 'audit',
          count: audit.counts[selectedId] ?? 0,
          time: (audit.timestamp && audit.timestamp.startsWith(d)) ? audit.timestamp : `${d}T23:59:59`
        })
      }

      details.sort((a, b) => a.time.localeCompare(b.time))

      let dayUsage = 0
      let dayReceived = 0
      let dayTransferOut = 0
      let dayAuditAdj = null

      for (const ev of details) {
        if (ev.kind === 'audit') {
          const adj = r1(ev.count - running)
          ev.adj = adj
          dayAuditAdj = dayAuditAdj === null ? adj : r1(dayAuditAdj + adj)
          running = ev.count
        } else if (ev.kind === 'po' || ev.kind === 'transfer-in') {
          running = r1(running + ev.qty)
          dayReceived = r1(dayReceived + ev.qty)
        } else if (ev.kind === 'transfer-out') {
          running = r1(running - ev.qty)
          dayTransferOut = r1(dayTransferOut + ev.qty)
        } else if (ev.kind === 'sale' || ev.kind === 'waste' || ev.kind === 'production-usage') {
          running = r1(running - (ev.consumed ?? ev.qty))
          dayUsage = r1(dayUsage + (ev.consumed ?? ev.qty))
        } else if (ev.kind === 'adjustment' || ev.kind === 'production-yield') {
          running = r1(running + ev.qty)
          dayReceived = r1(dayReceived + ev.qty)
        } else {
          running = r1(running - ev.qty)
          dayUsage = r1(dayUsage + ev.qty)
        }
      }

      allRows.push({
        date: d,
        usage: dayUsage,
        received: dayReceived,
        transferOut: dayTransferOut,
        auditAdj: dayAuditAdj,
        ending: running,
        details
      })
    }

    const displayRows = allRows
      .filter(r =>
        r.date >= from && r.date <= to &&
        (r.usage > 0 || r.received !== 0 || r.transferOut > 0 || r.auditAdj !== null || r.date === today)
      )
      .reverse()

    return {
      auditInfo: { date: startDate, base, isAssumed: !baseAudit },
      ledgerRows: displayRows,
    }
  }, [selectedId, selectedStore, data, sales, posWaste, recipes, from, to, today, lhDaily])

  const selectedIng = config.ingredients.find(i => i.id === selectedId)

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header + filters ────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-4 md:pt-8 pb-4 flex items-start justify-between flex-wrap gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('ledger.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('ledger.subtitle')}</p>
          <span className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium w-fit ${lhDaily && String(lhDaily.ingredientId) === String(selectedId) ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`} title={lhDaily ? 'view_ledger_daily' : 'Local D1 computation — lakehouse not connected'}>
            <span className={`w-1.5 h-1.5 rounded-full ${lhDaily && String(lhDaily.ingredientId) === String(selectedId) ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {lhDaily && String(lhDaily.ingredientId) === String(selectedId) ? 'Lakehouse' : 'Локальный D1'}
          </span>
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
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden px-4 md:px-8 pb-4 md:pb-8 gap-5 min-h-0">

        {/* Ingredient list */}
        <div className={`w-full md:w-60 flex-shrink-0 flex-col bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-64 md:h-auto ${selectedId ? 'hidden md:flex' : 'flex'}`}>
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
            {Object.entries(listItems).map(([pt, items]) => (
              <div key={pt}>
                <div className="bg-gray-100 px-3 py-1.5 border-y border-gray-200 sticky top-0 z-10 flex justify-between items-center">
                  <h3 className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">
                    {pt === 'product' ? 'Finished Products' : 'Raw Ingredients'}
                  </h3>
                </div>
                {items.map(ing => (
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
            ))}
          </div>
        </div>

        {/* Daily ledger */}
        <div className={`flex-1 overflow-y-auto min-w-0 ${selectedId ? 'flex' : 'hidden md:flex'} flex-col`}>
          {selectedId && (
            <button onClick={() => setSelectedId(null)} className="md:hidden mb-4 self-start text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              Back to List
            </button>
          )}
          {selectedId == null ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-gray-400">{t('usage.selectIngredient')}</p>
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
                  {auditInfo.isAssumed ? t('ledger.noAudit') : t('ledger.auditBase', { date: auditInfo.date, base: auditInfo.base })}
                </span>
              </div>

              {ledgerRows.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400 flex-shrink-0">
                  {t('ledger.noActivity')}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto flex-shrink-0">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                        <th className="px-5 py-3 font-medium">{t('common.date')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colUsage')}</th>
                        <th className="px-4 py-3 font-medium text-right">{t('ledger.colTransferOut')}</th>
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
                              row.auditAdj !== null || row.baselineAudit ? 'bg-purple-50/40' :
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
                                {row.transferIn > 0 && (
                                  <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">
                                    {t('ledger.transferInTag')}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-red-600">
                              {row.usage > 0
                                ? <span>−{row.usage} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-orange-600">
                              {row.transferOut > 0
                                ? <span>−{row.transferOut} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.received > 0
                                ? <span className="text-green-600">+{row.received} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
                                : row.received < 0
                                ? <span className="text-red-600">−{Math.abs(row.received)} <span className="text-gray-400 text-xs">{selectedIng?.unit}</span></span>
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
                              <td colSpan={6} className="px-8 py-3">
                                <div className="space-y-1.5">
                                  {row.details.map((d, j) => (
                                    <div key={j} className="flex items-center gap-3 text-xs">
                                      <span className={`px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                                        d.kind === 'sale'         ? 'bg-blue-100 text-blue-700' :
                                        d.kind === 'waste'        ? 'bg-amber-100 text-amber-700' :
                                        d.kind === 'po'           ? 'bg-green-100 text-green-700' :
                                        d.kind === 'adjustment'   ? 'bg-purple-100 text-purple-700' :
                                        d.kind === 'production-yield' ? 'bg-green-100 text-green-700' :
                                        d.kind === 'production-usage' ? 'bg-amber-100 text-amber-700' :
                                        d.kind === 'audit'        ? 'bg-purple-100 text-purple-700' :
                                        d.kind === 'transfer-out' ? 'bg-orange-100 text-orange-700' :
                                        d.kind === 'transfer-in'  ? 'bg-teal-100 text-teal-700' :
                                                                    'bg-gray-100 text-gray-600'
                                      }`}>
                                        {d.kind === 'sale'         ? t('ledger.kindSale') :
                                         d.kind === 'waste'        ? t('ledger.kindWaste') :
                                         d.kind === 'po'           ? `PO-${d.poId}` :
                                         d.kind === 'production-yield' ? `YIELD (${d.prodId})` :
                                         d.kind === 'production-usage' ? `USAGE (${d.prodId})` :
                                         d.kind === 'adjustment'   ? (d.adjId ? `ADJ (${d.adjId})` : t('ledger.kindAdj')) :
                                         d.kind === 'audit'        ? t('ledger.kindAudit') :
                                         d.kind === 'transfer-out' ? (d.poId ? `${t('ledger.kindTransferOut')} (${d.poId})` : t('ledger.kindTransferOut')) :
                                         d.kind === 'transfer-in'  ? (d.poId ? `${t('ledger.kindTransferIn')} (${d.poId})` : t('ledger.kindTransferIn')) :
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
                                            {d.baseline
                                              ? <span className="ml-1.5 text-purple-400 font-normal">· {t('ledger.auditBaseline')}</span>
                                              : d.adj !== 0 && (
                                              <span className={`ml-1.5 ${d.adj > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                ({d.adj > 0 ? '+' : ''}{d.adj})
                                              </span>
                                            )}
                                          </span>
                                        : (() => {
                                            const isPositive = d.kind === 'po' || d.kind === 'transfer-in' || d.kind === 'production-yield'
                                              || (d.kind === 'adjustment' && d.qty >= 0)
                                            return (
                                              <span className={`font-semibold flex-shrink-0 ${
                                                d.kind === 'transfer-out'                          ? 'text-orange-600' :
                                                d.kind === 'production-usage'                      ? 'text-red-600' :
                                                d.kind === 'transfer-in'                           ? 'text-teal-700' :
                                                d.kind === 'adjustment' && d.qty < 0              ? 'text-red-600' :
                                                isPositive                                         ? 'text-green-700' :
                                                                                                    'text-red-600'
                                              }`}>
                                                {isPositive ? '+' : '−'}
                                                {d.kind === 'adjustment' ? Math.abs(d.qty) : (d.consumed ?? d.qty)} {selectedIng?.unit}
                                              </span>
                                            )
                                          })()}
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
