import { useState, useRef, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { STORES } from '../data/fakeData'

// ─── Count tab ────────────────────────────────────────────────────────────────

function CountTab({ store, setStore, date, setDate }) {
  const { config, data, addAudit } = useConfig()
  const { getLastAudit } = useCalcs()
  const { t } = useLanguage()

  const [counts,  setCounts]  = useState({})
  const [saved,   setSaved]   = useState(false)
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const lastAudit     = getLastAudit(store)
  const lastAuditDate = lastAudit?.date ?? null
  const existingAudit = data.audits.find(a => a.store === store && a.date === date)

  const lastCount = (productId) => {
    if (!lastAudit) return '—'
    const v = lastAudit.counts[productId]
    return v != null ? v : '—'
  }

  const handleChange = (productId, val) => {
    setSaved(false)
    setCounts(prev => ({ ...prev, [`${store}-${productId}`]: val }))
  }

  const handleFillFromLast = () => {
    if (!lastAudit) return
    const filled = {}
    for (const p of config.ingredients) {
      const v = lastAudit.counts[p.id]
      if (v != null) filled[`${store}-${p.id}`] = String(v)
    }
    setCounts(prev => ({ ...prev, ...filled }))
    setSaved(false)
  }

  const handleSave = () => {
    const auditCounts = {}
    for (const product of config.ingredients) {
      const val = getValue(product.id)
      if (val !== '') auditCounts[product.id] = Math.max(0, parseFloat(val))
    }
    addAudit(store, date, auditCounts)
    setSaved(true)
    setCounts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${store}-`))))
    setTimeout(() => setSaved(false), 3500)
  }

  const getValue  = (productId) => counts[`${store}-${productId}`] ?? ''
  const anyFilled = config.ingredients.some(p => getValue(p.id) !== '')

  return (
    <>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.store')}</label>
          <select value={store} onChange={e => { setStore(e.target.value); setSaved(false) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('audit.auditDate')}</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.search')}</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('audit.filterPlaceholder')} value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
        </div>
      </div>

      {existingAudit && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          {t('audit.existingWarning', { store, date })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto mb-6">
       <div className="min-w-[480px]">
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-4 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <span className="col-span-2 cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
            {t('common.ingredient')}{si('name')}
          </span>
          <span className="cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('prev')}>
            {t('audit.prevCount')}{si('prev')}{' '}
            <span className="font-normal normal-case text-gray-400">
              {lastAuditDate ? `(${lastAuditDate})` : '(none)'}
            </span>
          </span>
          <span>{t('audit.newCount')}</span>
        </div>
        {config.ingredients
          .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
          .length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-400">{t('audit.noMatch', { query: search })}</div>
          )
        }
        {(() => {
          const filtered = config.ingredients.filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
          const sorted = sortKey ? [...filtered].sort((a, b) => {
            let cmp = 0
            if (sortKey === 'name') cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            if (sortKey === 'prev') {
              const pa = lastAudit?.counts[a.id] ?? -1, pb = lastAudit?.counts[b.id] ?? -1
              cmp = pa - pb
            }
            return sortDir === 'asc' ? cmp : -cmp
          }) : filtered
          return sorted
        })().map((product, i) => {
          const prev  = lastCount(product.id)
          const val   = getValue(product.id)
          const delta = val !== '' && prev !== '—' ? parseFloat(val) - parseFloat(prev) : null

          return (
            <div key={product.id}
              className={`px-6 py-4 grid grid-cols-4 gap-4 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} border-b border-gray-100 last:border-0`}>
              <div className="col-span-2">
                <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{product.unit}</p>
              </div>
              <div className="text-sm text-gray-700 tabular-nums">
                {prev} <span className="text-gray-400 text-xs">{prev !== '—' ? product.unit : ''}</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="number" min="0" step="0.1" placeholder="0" value={val}
                  onChange={e => handleChange(product.id, e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums" />
                {delta !== null && (
                  <span className={`text-xs font-medium ${delta < 0 ? 'text-red-600' : delta > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}
                  </span>
                )}
              </div>
            </div>
          )
        })}
       </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setCounts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${store}-`))))}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            {t('audit.clearAll')}
          </button>
          {lastAudit && (
            <button onClick={handleFillFromLast}
              className="text-sm text-blue-600 hover:text-blue-700 transition-colors">
              {t('audit.fillFromLast')}
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          {saved && (
            <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              {t('audit.savedFor', { store })}
            </span>
          )}
          <button onClick={handleSave} disabled={!anyFilled}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
              anyFilled ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}>
            {t('audit.saveAudit')}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 text-right mt-2">{t('audit.unfilledNote')}</p>
    </>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const { config, data, deleteAudit } = useConfig()
  const { t } = useLanguage()
  const [historyStore,  setHistoryStore]  = useState('All')
  const [expanded,      setExpanded]      = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const audits = [...data.audits]
    .filter(a => historyStore === 'All' || a.store === historyStore)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  return (
    <>
      <div className="flex items-center gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('common.store')}</label>
          <select value={historyStore}
            onChange={e => { setHistoryStore(e.target.value); setExpanded(null); setPendingDelete(null) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="All">{t('common.allStores')}</option>
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-sm text-gray-500 mt-5">
          {t('audit.auditsCount', { count: audits.length })}
        </p>
      </div>

      {audits.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center text-sm text-gray-400">
          {t('audit.noAuditsYet')}{historyStore !== 'All' ? ` for ${historyStore}` : ''}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">{t('audit.colId')}</th>
                <th className="px-4 py-3 font-medium">{t('common.date')}</th>
                <th className="px-4 py-3 font-medium">{t('common.store')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('audit.colCounted')}</th>
                <th className="px-4 py-3 font-medium w-48"></th>
              </tr>
            </thead>
            <tbody>
              {audits.map(audit => {
                const isExpanded = expanded === audit.id
                const isPending  = pendingDelete === audit.id
                const counted    = Object.keys(audit.counts).length

                return (
                  <Fragment key={audit.id}>
                    <tr
                      onClick={() => { if (!isPending) setExpanded(prev => prev === audit.id ? null : audit.id) }}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-6 py-3 font-mono text-xs text-gray-400">{audit.id}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{audit.date}</td>
                      <td className="px-4 py-3 text-gray-700">{audit.store}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {counted}
                        <span className="text-gray-400 text-xs"> / {config.ingredients.length}</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-red-600">{t('audit.deleteThisAudit')}</span>
                            <button
                              onClick={() => {
                                deleteAudit(audit.id)
                                setPendingDelete(null)
                                if (expanded === audit.id) setExpanded(null)
                              }}
                              className="text-xs px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">
                              {t('common.yes')}
                            </button>
                            <button onClick={() => setPendingDelete(null)}
                              className="text-xs text-gray-500 hover:text-gray-700">
                              {t('common.no')}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setPendingDelete(audit.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors">
                            {t('common.delete')}
                          </button>
                        )}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-blue-50 border-b border-blue-100">
                        <td colSpan={5} className="px-6 py-4">
                          {counted === 0 ? (
                            <p className="text-sm text-gray-400">{t('audit.noCountsRecorded')}</p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                              {config.ingredients
                                .filter(ing => audit.counts[ing.id] != null)
                                .map(ing => (
                                  <div key={ing.id} className="bg-white rounded-lg px-3 py-2 border border-blue-100 text-xs">
                                    <p className="text-gray-500 truncate">{ing.name}</p>
                                    <p className="font-semibold text-gray-900 tabular-nums mt-0.5">
                                      {audit.counts[ing.id]}{' '}
                                      <span className="font-normal text-gray-400">{ing.unit}</span>
                                    </p>
                                  </div>
                                ))
                              }
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ─── Import tab ───────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function ImportTab() {
  const { config, addAudit } = useConfig()
  const { t } = useLanguage()
  const [parsed,  setParsed]  = useState(null)
  const [result,  setResult]  = useState(null)
  const fileRef = useRef(null)

  const csvEsc = v => /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

  const downloadTemplate = () => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = [
      ['store', 'date', 'ingredient', 'unit', 'qty'],
      ...config.ingredients.map(i => [STORES[0], today, i.name, i.unit, '']),
    ]
    const csv = rows.map(r => r.map(csvEsc).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'audit-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const parseFile = (text) => {
    const clean = text.replace(/^﻿/, '')
    const lines = clean.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return { audits: [], rowErrors: [] }

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase())
    const iStore = headers.indexOf('store')
    const iDate  = headers.indexOf('date')
    const iIng   = headers.indexOf('ingredient')
    const iQty   = headers.indexOf('qty')
    if (iStore < 0 || iDate < 0 || iIng < 0 || iQty < 0)
      return { audits: [], rowErrors: [{ rowNum: 1, msg: t('audit.importBadHeader') }] }

    const ingByName = {}
    config.ingredients.forEach(i => { ingByName[i.name.toLowerCase()] = i })

    // collect raw row errors and valid counts grouped by store+date
    const groups = {}   // key "store||date" -> { store, date, counts: {} }
    const rowErrors = []

    for (let i = 1; i < lines.length; i++) {
      const cells = parseCSVLine(lines[i])
      if (cells.every(c => !c.trim())) continue
      const rowNum = i + 1
      const store  = cells[iStore]?.trim() ?? ''
      const date   = cells[iDate]?.trim()  ?? ''
      const ingRaw = cells[iIng]?.trim()   ?? ''
      const qtyRaw = cells[iQty]?.trim()   ?? ''
      const errors = []

      if (!STORES.includes(store)) errors.push(`unknown store "${store}"`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`invalid date "${date}"`)
      const ing = ingByName[ingRaw.toLowerCase()]
      if (!ing) errors.push(`unknown ingredient "${ingRaw}"`)
      const qty = parseFloat(qtyRaw)
      if (qtyRaw && isNaN(qty)) errors.push(`invalid qty "${qtyRaw}"`)

      if (errors.length > 0) { rowErrors.push({ rowNum, msg: errors.join('; ') }); continue }
      if (!qtyRaw) continue  // blank qty = not counted, skip silently

      const key = `${store}||${date}`
      if (!groups[key]) groups[key] = { store, date, counts: {} }
      groups[key].counts[ing.id] = Math.max(0, qty)
    }

    const audits = Object.values(groups)
    return { audits, rowErrors }
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => setParsed(parseFile(ev.target.result))
    reader.readAsText(file, 'UTF-8')
  }

  const handleImport = () => {
    parsed?.audits.forEach(a => addAudit(a.store, a.date, a.counts))
    setResult({ imported: parsed?.audits.length ?? 0 })
    setParsed(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">{t('audit.importTitle')}</h2>
        <p className="text-sm text-gray-500">{t('audit.importDesc')}</p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          {t('audit.downloadTemplate')}
        </button>
        <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          {t('audit.uploadCSV')}
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
        </label>
      </div>

      {result && (
        <div className="mb-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
          {t('audit.importSuccess', { count: result.imported })}
        </div>
      )}

      {parsed && (
        <>
          {parsed.rowErrors.length > 0 && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-red-700 mb-1.5">{parsed.rowErrors.length} row error(s) — these rows were skipped:</p>
              <ul className="text-xs text-red-600 space-y-0.5">
                {parsed.rowErrors.map(e => <li key={e.rowNum}>Row {e.rowNum}: {e.msg}</li>)}
              </ul>
            </div>
          )}

          {parsed.audits.length > 0 ? (
            <>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-700">
                    {t('audit.importReady', { valid: parsed.audits.length, errors: parsed.rowErrors.length })}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 font-medium">{t('common.store')}</th>
                      <th className="px-4 py-2 font-medium">{t('common.date')}</th>
                      <th className="px-4 py-2 font-medium text-right">{t('audit.colCounted')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {parsed.audits.map(a => (
                      <tr key={`${a.store}||${a.date}`}>
                        <td className="px-4 py-2 font-medium text-gray-900">{a.store}</td>
                        <td className="px-4 py-2 text-gray-700">{a.date}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {Object.keys(a.counts).length}
                          <span className="text-gray-400 text-xs"> / {config.ingredients.length}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button onClick={handleImport}
                  className="px-6 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium">
                  {t('audit.importNow', { count: parsed.audits.length })}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">{t('audit.importNoRows')}</p>
          )}
        </>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryAudit({ activeTab = 'count', onTabChange }) {
  const [store, setStore] = useState(STORES[0])
  const [date,  setDate]  = useState(new Date().toISOString().slice(0, 10))
  const { t } = useLanguage()

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('audit.title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('audit.subtitle')}</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {[['count', t('audit.tabCount')], ['history', t('audit.tabHistory')], ['import', t('audit.tabImport')]].map(([id, label]) => (
          <button key={id} onClick={() => onTabChange?.(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'count'   && <CountTab   store={store} setStore={setStore} date={date} setDate={setDate} />}
      {activeTab === 'history' && <HistoryTab />}
      {activeTab === 'import'  && <ImportTab />}
    </div>
  )
}
