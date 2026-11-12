import { useState, Fragment, useMemo } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { getProductType } from '@inventory/utils/productTypes'
// ─── Count tab ────────────────────────────────────────────────────────────────

function CountTab({ date, setDate }) {
  const { config, data, addAudit, stores } = useConfig()
  const { t } = useLanguage()

  // Fool-proofing: the audit store is chosen HERE, per session, with NO
  // default — the global header selector (persisted in localStorage, often
  // left on whichever store was used last, or auto-set to the first store)
  // must not silently decide where a physical count is booked. Not persisted:
  // every audit starts with an explicit choice, re-confirmed at save.
  const [store, setStoreState] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const retailStores = (stores || []).filter(s => s !== 'Warehouse')
  const [counts,  setCounts]  = useState({})
  const [saved,   setSaved]   = useState(false)
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [time,    setTime]    = useState(() => new Date().toTimeString().slice(0, 5))
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const existingAudit = (data.audits || []).find(a => a.store === store && a.date === date)

  const lastItemAudits = useMemo(() => {
    const storeAudits = (data.audits || [])
      .filter(a => {
        if (a.store !== store) return false
        if (a.status === 'rejected') return false
        if (existingAudit && a.id === existingAudit.id) return false
        if (a.date > date) return false
        if (existingAudit && a.date === date) {
          if (existingAudit.timestamp && a.timestamp && a.timestamp >= existingAudit.timestamp) return false
        }
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date) || (b.timestamp || '').localeCompare(a.timestamp || ''))

    const map = {}
    for (const audit of storeAudits) {
      if (!audit.counts) continue
      for (const [ingIdStr, qty] of Object.entries(audit.counts)) {
        const id = Number(ingIdStr)
        if (qty != null && qty !== '' && !isNaN(Number(qty)) && map[id] === undefined) {
          map[id] = { count: Number(qty), date: audit.date, auditId: audit.id }
        }
      }
    }
    return map
  }, [data.audits, store, existingAudit, date])

  const lastCount = (productId) => {
    const item = lastItemAudits[productId]
    return item != null ? item.count : '—'
  }

  const lastCountDate = (productId) => {
    return lastItemAudits[productId]?.date ?? null
  }

  const handleChange = (productId, val) => {
    setSaved(false)
    setCounts(prev => ({ ...prev, [`${store}-${productId}`]: val }))
  }

  const handleFillFromLast = () => {
    const filled = {}
    for (const p of config.ingredients) {
      const v = lastItemAudits[p.id]?.count
      if (v != null) filled[`${store}-${p.id}`] = String(v)
    }
    setCounts(prev => ({ ...prev, ...filled }))
    setSaved(false)
  }

  const changeStore = (next) => {
    // Switching stores must not leak counts keyed to the previous store.
    if (store) setCounts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${store}-`))))
    setStoreState(next)
    setSaved(false)
  }

  // Save is always gated behind an explicit confirmation: the modal restates
  // store / date / time / item count so a mis-picked store can't slip through.
  const handleSave = () => {
    if (anyFilled) setConfirmOpen(true)
  }

  const confirmSave = () => {
    const auditCounts = {}
    for (const product of config.ingredients) {
      const val = getValue(product.id)
      if (val !== '') auditCounts[product.id] = Math.max(0, parseFloat(val))
    }
    addAudit(store, date, auditCounts, `${date}T${time}:00`)
    setConfirmOpen(false)
    setSaved(true)
    setCounts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${store}-`))))
    setTimeout(() => setSaved(false), 3500)
  }

  const getValue  = (productId) => counts[`${store}-${productId}`] ?? ''
  const anyFilled = config.ingredients.some(p => getValue(p.id) !== '')
  const suppName  = (ing) => (config.suppliers ?? []).find(s => s.id === ing.supplierId)?.name ?? ''

  // Date guardrails: future dates are a device-clock mistake — blocked;
  // backdated audits change the ledger's event order (managers here may do
  // that deliberately for corrections — warn, allow).
  const todayStr = new Date().toISOString().slice(0, 10)
  const isFutureDate = date > todayStr
  const lastAuditDate = (data.audits || [])
    .filter(a => a.store === store && a.status !== 'rejected' && (!existingAudit || a.id !== existingAudit.id))
    .map(a => a.date)
    .sort()
    .pop() || null
  const isBackdated = Boolean(lastAuditDate) && date < lastAuditDate

  return (
    <>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t('audit.auditDate')}</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
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
        {store && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-blue-700">{t('audit.countingStore')}:</span>
            <span className="text-sm font-bold text-blue-900">{store}</span>
            <button onClick={() => changeStore(null)}
              className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2">
              {t('audit.changeStore')}
            </button>
          </div>
        )}
      </div>

      {!store && (
        <div className="bg-white rounded-xl border-2 border-dashed border-blue-300 p-6 mb-6">
          <h3 className="text-base font-semibold text-gray-900">{t('audit.chooseStore')}</h3>
          <p className="text-sm text-gray-500 mt-0.5 mb-4">{t('audit.chooseStoreHint')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {retailStores.map(s => (
              <button key={s} onClick={() => changeStore(s)}
                className="px-4 py-3 rounded-lg border border-gray-300 bg-white hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 text-sm font-semibold text-gray-800 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {existingAudit && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          {t('audit.existingWarning', { store, date })}
        </div>
      )}

      {store && (
      <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
        {config.ingredients
          .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
            suppName(p).toLowerCase().includes(search.toLowerCase()))
          .length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-400">{t('audit.noMatch', { query: search })}</div>
          )
        }
        {(() => {
          const filtered = config.ingredients.filter(p =>
            !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
            suppName(p).toLowerCase().includes(search.toLowerCase())
          )
          const sorted = sortKey ? [...filtered].sort((a, b) => {
            let cmp = 0
            if (sortKey === 'name')     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            if (sortKey === 'supplier') cmp = suppName(a).localeCompare(suppName(b), undefined, { sensitivity: 'base' })
            if (sortKey === 'prev') {
              const pa = lastItemAudits[a.id]?.count ?? -1, pb = lastItemAudits[b.id]?.count ?? -1
              cmp = pa - pb
            }
            return sortDir === 'asc' ? cmp : -cmp
          }) : filtered

          const groups = {}
          sorted.forEach(p => {
            const pt = getProductType(p) || 'ingredient'
            if (!groups[pt]) groups[pt] = []
            groups[pt].push(p)
          })

          return Object.entries(groups).map(([pt, items]) => (
            <div key={pt} className="mb-4 last:mb-0">
              <div className="bg-gray-100 px-4 py-2 border-y border-gray-200 sticky top-0 z-10 flex justify-between items-center">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  {pt === 'product' ? 'Finished Products' : 'Raw Ingredients'}
                </h3>
                <span className="text-xs text-gray-500 font-medium">{items.length} items</span>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map((product) => {
                  const prev     = lastCount(product.id)
                  const prevDate = lastCountDate(product.id)
                  const val      = getValue(product.id)
                  const delta    = val !== '' && prev !== '—' ? parseFloat(val) - parseFloat(prev) : null

                  return (
                    <div key={product.id} className="p-4 bg-white hover:bg-gray-50/50 flex flex-col gap-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-semibold text-gray-900 text-sm leading-tight">{product.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{suppName(product) || '—'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">
                            Prev: <span className="font-medium text-gray-800">{prev}</span>
                            {prevDate && <span className="text-[10px] text-gray-400 font-normal ml-1">({prevDate})</span>}
                          </p>
                          {delta !== null && (
                            <p className={`text-[10px] font-bold ${delta < 0 ? 'text-red-500' : delta > 0 ? 'text-green-500' : 'text-gray-400'}`}>
                              {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-50">
                        <span className="text-xs text-gray-500 font-medium">{product.unit}</span>
                        <input type="number" min="0" step="0.1" placeholder="—" value={val}
                          onChange={e => handleChange(product.id, e.target.value)}
                          className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums text-right font-semibold bg-gray-50 focus:bg-white" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        })()}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setCounts(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${store}-`))))}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            {t('audit.clearAll')}
          </button>
          {Object.keys(lastItemAudits).length > 0 && (
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
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('audit.confirmTitle')}</h3>
            <p className="text-xs text-gray-500 mb-4">{t('audit.confirmSubtitle')}</p>
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4"><span className="text-gray-500">{t('audit.confirmStore')}</span><span className="font-bold text-gray-900">{store}</span></div>
              <div className="flex justify-between gap-4"><span className="text-gray-500">{t('audit.confirmDate')}</span><span className="font-medium text-gray-900">{date}</span></div>
              <div className="flex justify-between gap-4"><span className="text-gray-500">{t('audit.confirmTime')}</span><span className="font-medium text-gray-900 tabular-nums">{time}</span></div>
              <div className="flex justify-between gap-4"><span className="text-gray-500">{t('audit.confirmItems')}</span><span className="font-medium text-gray-900">{config.ingredients.filter(p => getValue(p.id) !== '').length}</span></div>
            </div>
            {existingAudit && (
              <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {t('audit.confirmExisting')}
              </div>
            )}
            {isFutureDate && (
              <div className="mb-4 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                📅 {t('audit.futureDateBlock')}
              </div>
            )}
            {isBackdated && !isFutureDate && (
              <div className="mb-4 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                📅 {t('audit.backdateWarn')} ({lastAuditDate})
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setConfirmOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={confirmSave} disabled={isFutureDate}
                className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {t('audit.confirmSave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const { config, data, deleteAudit, updateAudit, selectedStore: historyStore } = useConfig()
  const { t } = useLanguage()
  const [expanded,      setExpanded]      = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [editingId,     setEditingId]     = useState(null)
  const [editCounts,    setEditCounts]    = useState({}) // { ingredientId: string | null }
  const [editSearch,    setEditSearch]    = useState('')

  const audits = [...data.audits]
    .filter(a => a.store === historyStore)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))

  const startEdit = (audit) => {
    // Pre-fill with existing counts as strings; null = will be removed on save
    const draft = {}
    Object.entries(audit.counts).forEach(([id, val]) => { draft[id] = String(val) })
    setEditCounts(draft)
    setEditingId(audit.id)
    setEditSearch('')
  }

  const cancelEdit = () => { setEditingId(null); setEditCounts({}); setEditSearch('') }

  const saveEdit = (auditId) => {
    const newCounts = {}
    Object.entries(editCounts).forEach(([id, val]) => {
      if (val !== '' && val !== null) {
        const num = parseFloat(val)
        if (!isNaN(num)) newCounts[Number(id)] = Math.max(0, num)
      }
    })
    updateAudit(auditId, newCounts)
    cancelEdit()
  }

  const setIngVal = (id, val) => setEditCounts(prev => ({ ...prev, [id]: val }))
  const removeIng = (id) => setEditCounts(prev => { const n = { ...prev }; delete n[id]; return n })

  return (
    <>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
        <h2 className="text-lg font-semibold text-gray-900">{t('audit.tabHistory')}</h2>
        <p className="text-sm text-gray-500">
          {t('audit.auditsCount', { count: audits.length })}
        </p>
      </div>

      {audits.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-12 text-center text-sm text-gray-400">
          {t('audit.noAuditsYet')}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">{t('audit.colId')}</th>
                <th className="px-4 py-3 font-medium">{t('common.date')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('audit.colCounted')}</th>
                <th className="px-4 py-3 font-medium w-52"></th>
              </tr>
            </thead>
            <tbody>
              {audits.map(audit => {
                const isExpanded = expanded === audit.id
                const isPending  = pendingDelete === audit.id
                const isEditing  = editingId === audit.id
                const counted    = Object.keys(audit.counts).length

                return (
                  <Fragment key={audit.id}>
                    <tr
                      onClick={() => { if (!isPending && !isEditing) setExpanded(prev => prev === audit.id ? null : audit.id) }}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${isExpanded || isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-6 py-3 font-mono text-xs text-gray-400">{audit.id}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{audit.date}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {isEditing
                          ? <span className="text-blue-600">{Object.keys(editCounts).length}</span>
                          : counted}
                        <span className="text-gray-400 text-xs"> / {config.ingredients.length}</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-red-600">{t('audit.deleteThisAudit')}</span>
                            <button onClick={() => { deleteAudit(audit.id); setPendingDelete(null); if (expanded === audit.id) setExpanded(null) }}
                              className="text-xs px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">{t('common.yes')}</button>
                            <button onClick={() => setPendingDelete(null)}
                              className="text-xs text-gray-500 hover:text-gray-700">{t('common.no')}</button>
                          </div>
                        ) : isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => saveEdit(audit.id)}
                              className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700">{t('common.save')}</button>
                            <button onClick={cancelEdit}
                              className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-3">
                            <button onClick={e => { e.stopPropagation(); startEdit(audit); setExpanded(audit.id) }}
                              className="text-xs text-blue-500 hover:text-blue-700 transition-colors">{t('common.edit')}</button>
                            <button onClick={() => setPendingDelete(audit.id)}
                              className="text-xs text-red-400 hover:text-red-600 transition-colors">{t('common.delete')}</button>
                          </div>
                        )}
                      </td>
                    </tr>

                    {(isExpanded || isEditing) && (
                      <tr className={`border-b ${isEditing ? 'bg-blue-50 border-blue-200' : 'bg-blue-50 border-blue-100'}`}>
                        <td colSpan={5} className="px-6 py-4">
                          {isEditing ? (
                            <>
                              <p className="text-xs text-blue-700 font-medium mb-3">
                                {t('audit.editCountsHint')}
                              </p>
                              {/* Search within edit mode */}
                              <div className="relative mb-3 max-w-xs">
                                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                                <input type="text" placeholder={t('audit.filterPlaceholder')} value={editSearch}
                                  onChange={e => setEditSearch(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                {/* Partition by the ORIGINAL audit counts so a card never jumps
                                    between groups mid-typing (which unmounts the input and drops focus) */}
                                {[
                                  ...config.ingredients.filter(ing => audit.counts[ing.id] != null),
                                  ...config.ingredients.filter(ing => audit.counts[ing.id] == null),
                                ]
                                  .filter(ing => !editSearch || ing.name.toLowerCase().includes(editSearch.toLowerCase()))
                                  .map(ing => {
                                    const inDraft = ing.id in editCounts
                                    return (
                                      <div key={ing.id} className={`bg-white rounded-lg px-3 py-2 text-xs ${
                                        inDraft
                                          ? 'border border-blue-200'
                                          : 'border border-dashed border-gray-200 opacity-60 hover:opacity-100 transition-opacity'
                                      }`}>
                                        <div className="flex items-center justify-between mb-1">
                                          <p className={`truncate flex-1 ${inDraft ? 'text-gray-500' : 'text-gray-400'}`}>{ing.name}</p>
                                          {inDraft && (
                                            <button onClick={() => removeIng(ing.id)}
                                              className="text-gray-300 hover:text-red-400 ml-1 flex-shrink-0">✕</button>
                                          )}
                                        </div>
                                        <input type="number" min="0" step="0.1" placeholder={inDraft ? undefined : '—'}
                                          value={editCounts[ing.id] ?? ''}
                                          onChange={e => setIngVal(ing.id, e.target.value)}
                                          className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums" />
                                        <span className="text-gray-400 text-xs">{ing.unit}</span>
                                      </div>
                                    )
                                  })
                                }
                              </div>
                            </>
                          ) : counted === 0 ? (
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InventoryAudit() {
  const [activeTab, setActiveTab] = useState('count')
  // NOTE: no global store here — CountTab owns its store choice (no default,
  // forced pick + confirm) so the header selector can't pre-book a count.
  const [date,  setDate]  = useState(new Date().toISOString().slice(0, 10))
  const { t } = useLanguage()

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('audit.title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('audit.subtitle')}</p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {[['count', t('audit.tabCount')], ['history', t('audit.tabHistory')]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'count'   && <CountTab   date={date} setDate={setDate} />}
      {activeTab === 'history' && <HistoryTab />}
    </div>
  )
}
