import { useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'

const TODAY = new Date().toISOString().slice(0, 10)

export default function DraftForm({ title, initialLines, initialCustomLines, ingredients, suppliers, getOrderQty, initialStore, lockStore, onSave, onCancel, initialCreatedDate, initialFromLocation, initialToLocation, stores, autoApplySuggested, initialStatus }) {
  const { t } = useLanguage()
  const [store,          setStore]          = useState(initialStore ?? stores?.[0] ?? '')
  const [createdDate,    setCreatedDate]    = useState(initialCreatedDate ?? TODAY)
  const [days,           setDays]           = useState(7)
  const [bufferPct,      setBufferPct]      = useState(5)
  const [fromLocation,   setFromLocation]   = useState(initialFromLocation ?? null)
  const [toLocation,     setToLocation]     = useState(initialToLocation ?? null)
  const [customLines,    setCustomLines]    = useState(() => initialCustomLines || [])
  const [search,         setSearch]         = useState('')
  const [sortKey,        setSortKey]        = useState(null)
  const [sortDir,        setSortDir]        = useState('asc')
  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
  const [qtys,        setQtys]        = useState(() => {
    if (initialLines) {
      const map = {}
      initialLines.forEach(l => { map[`${initialStore}:${l.ingredientId}`] = l.ordered })
      return map
    }
    if (autoApplySuggested) {
      // Arriving from the Replenishment Report: pre-fill with suggested quantities
      const st  = initialStore ?? stores?.[0] ?? ''
      const map = {}
      ingredients.forEach(p => {
        const s = getOrderQty(st, p.id, 7)
        if (s > 0) map[`${st}:${p.id}`] = s
      })
      return map
    }
    return {}
  })
  const [receivedQtys, setReceivedQtys] = useState(() => {
    if (initialLines && initialStatus === 'received') {
      const map = {}
      initialLines.forEach(l => { map[`${initialStore}:${l.ingredientId}`] = l.received ?? l.ordered })
      return map
    }
    return {}
  })

  // Set of ingredient IDs that were in the original order (ordered > 0)
  const originalIds = new Set(initialLines?.filter(l => l.ordered > 0).map(l => l.ingredientId) ?? [])

  const lines = ingredients
    .filter(p => !p.hidden || originalIds.has(p.id))
    .map(p => {
    const key = `${store}:${p.id}`
    const suggested = getOrderQty(store, p.id, days, bufferPct)
    const qty = key in qtys ? qtys[key] : (initialLines ? (originalIds.has(p.id) ? (initialLines.find(l => l.ingredientId === p.id)?.ordered ?? 0) : 0) : 0)
    const received = key in receivedQtys ? receivedQtys[key] : (initialLines ? (initialLines.find(l => l.ingredientId === p.id)?.received ?? qty) : qty)
    return { ...p, suggested, qty, received, isOriginal: originalIds.has(p.id) }
  })

  const q = search.toLowerCase()
  const getSupplierName = (l) => suppliers?.find(s => s.id === l.supplierId)?.name ?? ''
  const applySort = arr => {
    const [withSugg, noSugg] = [arr.filter(l => l.suggested > 0), arr.filter(l => l.suggested === 0)]
    const sort = sortKey
      ? (a, b) => {
          let cmp
          if (sortKey === 'name')     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          else if (sortKey === 'suggested') cmp = a.suggested - b.suggested
          else cmp = getSupplierName(a).localeCompare(getSupplierName(b), undefined, { sensitivity: 'base' })
          return sortDir === 'asc' ? cmp : -cmp
        }
      : null
    return [
      ...(sort ? [...withSugg].sort(sort) : withSugg),
      ...(sort ? [...noSugg].sort(sort) : noSugg),
    ]
  }
  const inOrder    = applySort(lines.filter(l => (l.isOriginal || !initialLines) && (!q || l.name.toLowerCase().includes(q))))
  const notInOrder = initialLines ? applySort(lines.filter(l => !l.isOriginal && (!q || l.name.toLowerCase().includes(q)))) : []

  const handleStoreChange = (s) => { setStore(s); setQtys({}); setReceivedQtys({}) }
  const setQty = (ingredientId, val) =>
    setQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))
  const setReceivedQty = (ingredientId, val) =>
    setReceivedQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))

  const handleSave = () => {
    onSave({
      store,
      createdDate,
      fromLocation: fromLocation || null,
      toLocation: toLocation || null,
      lines: lines.map(l => ({ 
        ingredientId: l.id, 
        ordered: Math.max(0, Number(l.qty) || 0),
        ...(initialStatus === 'received' ? { received: Math.max(0, Number(l.received) || 0) } : {})
      })),
      customLines: customLines.filter(c => c.name?.trim()).map(c => ({
        id: c.id,
        name: c.name.trim(),
        unit: c.unit?.trim() || 'шт',
        ordered: Math.max(0, Number(c.ordered) || 0),
        ...(initialStatus === 'received' ? { received: Math.max(0, Number(c.received) || 0) } : {})
      })),
    })
  }

  const supplierName = (ing) => {
    if (!ing.supplierId || !suppliers?.length) return null
    return suppliers.find(s => s.id === ing.supplierId)?.name ?? null
  }

  const colHead = (
    <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
      <th className="px-6 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>{t('common.ingredient')}{si('name')}</th>
      <th className="px-4 py-3 font-medium">{t('common.unit')}</th>
      {suppliers?.length > 0 && <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('supplier')}>{t('recipes.supplier')}{si('supplier')}</th>}
      <th className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('suggested')} title={t('po.applySuggested')}>{t('po.suggested')}{si('suggested')}</th>
      <th className="px-4 py-3 font-medium text-right">{t('po.orderQty')}</th>
      {initialStatus === 'received' && <th className="px-4 py-3 font-medium text-right">{t('po.actualQty')}</th>}
    </tr>
  )

  const renderRow = (l) => (
    <tr key={l.id} className="hover:bg-gray-50">
      <td className="px-6 py-2.5 font-medium text-gray-900">{l.name}</td>
      <td className="px-4 py-2.5 text-gray-500">{l.unit}</td>
      {suppliers?.length > 0 && (
        <td className="px-4 py-2.5 text-gray-400 text-xs">{supplierName(l) ?? <span className="text-gray-300">—</span>}</td>
      )}
      <td className="px-4 py-2.5 text-right tabular-nums">
        {l.suggested > 0
          ? <button onClick={() => setQty(l.id, l.suggested)}
              title={t('po.applySuggested')}
              className="tabular-nums text-gray-400 hover:text-blue-600 hover:font-medium transition-colors cursor-pointer">
              {l.suggested}
            </button>
          : <span className="text-gray-300">0</span>
        }
      </td>
      <td className="px-4 py-2.5 text-right">
        <input type="number" min="0" step="0.1" value={l.qty}
          onChange={e => setQty(l.id, e.target.value)}
          className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </td>
      {initialStatus === 'received' && (
        <td className="px-4 py-2.5 text-right">
          <input type="number" min="0" step="0.1" value={l.received}
            onChange={e => setReceivedQty(l.id, e.target.value)}
            className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </td>
      )}
    </tr>
  )

  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)

  const renderMobileCard = (l) => (
    <div key={l.id} className="p-3.5 space-y-2.5 border-b border-gray-100 last:border-0 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="font-semibold text-gray-900 text-sm leading-tight">{l.name}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="text-xs text-gray-500 font-medium bg-gray-100 px-1.5 py-0.5 rounded">{l.unit}</span>
            {supplierName(l) && (
              <span className="text-[10px] text-gray-600 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">
                {supplierName(l)}
              </span>
            )}
          </div>
        </div>
        {l.suggested > 0 && (
          <button
            type="button"
            onClick={() => setQty(l.id, l.suggested)}
            className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 font-semibold rounded-lg border border-blue-200 hover:bg-blue-100 shrink-0"
          >
            {t('po.suggested')}: {l.suggested}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-medium text-gray-700">{t('po.orderQty')}:</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setQty(l.id, Math.max(0, (parseFloat(l.qty) || 0) - 1))}
            className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold flex items-center justify-center hover:bg-gray-200 active:scale-95 text-base select-none"
          >
            −
          </button>
          <input
            type="number"
            min="0"
            step="0.1"
            inputMode="decimal"
            value={l.qty}
            onChange={e => setQty(l.id, e.target.value)}
            className="w-16 border border-gray-300 rounded-lg py-1.5 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setQty(l.id, (parseFloat(l.qty) || 0) + 1)}
            className="w-9 h-9 rounded-lg bg-gray-100 text-gray-700 font-bold flex items-center justify-center hover:bg-gray-200 active:scale-95 text-base select-none"
          >
            +
          </button>
        </div>
      </div>

      {initialStatus === 'received' && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-xs font-semibold text-green-700">{t('po.actualQty')}:</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setReceivedQty(l.id, Math.max(0, (parseFloat(l.received) || 0) - 1))}
              className="w-9 h-9 rounded-lg bg-green-50 text-green-800 font-bold flex items-center justify-center hover:bg-green-100 active:scale-95 text-base select-none"
            >
              −
            </button>
            <input
              type="number"
              min="0"
              step="0.1"
              inputMode="decimal"
              value={l.received}
              onChange={e => setReceivedQty(l.id, e.target.value)}
              className="w-16 border border-green-300 rounded-lg py-1.5 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="button"
              onClick={() => setReceivedQty(l.id, (parseFloat(l.received) || 0) + 1)}
              className="w-9 h-9 rounded-lg bg-green-50 text-green-800 font-bold flex items-center justify-center hover:bg-green-100 active:scale-95 text-base select-none"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      {/* Form Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900 text-sm sm:text-base">{title}</h2>
            {lockStore && <span className="text-xs font-medium text-gray-600 bg-gray-200 px-2 py-0.5 rounded">{store}</span>}
          </div>
          <button
            type="button"
            onClick={() => setMobileSettingsOpen(!mobileSettingsOpen)}
            className="md:hidden flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 px-2.5 py-1.5 rounded-lg shadow-xs"
          >
            ⚙ {mobileSettingsOpen ? 'Скрыть параметры' : 'Параметры'}
          </button>
        </div>

        {/* Collapsible Mobile Settings & Desktop Filters */}
        <div className={`${mobileSettingsOpen ? 'block' : 'hidden'} md:flex items-center gap-3 sm:gap-4 flex-wrap mt-3 pt-3 border-t border-gray-200 md:border-0 md:pt-0 md:mt-2`}>
          {!lockStore && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">{t('common.store')}</label>
              <select value={store} onChange={e => handleStoreChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white flex-1 sm:flex-none">
                {stores.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">{t('po.createdDate')}</label>
            <input type="date" value={createdDate} onChange={e => setCreatedDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 sm:flex-none" />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">{t('po.daysToFill')}</label>
            <input type="number" min="1" max="365" value={days}
              onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 7))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-20 text-right" />
            <span className="text-xs text-gray-400">{t('po.days')}</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">+ Buffer %</label>
            <input type="number" min="0" max="100" value={bufferPct}
              onChange={e => setBufferPct(Math.max(0, parseInt(e.target.value) || 0))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-16 text-right" />
            <span className="text-xs text-gray-400">%</span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">{t('po.from')}</label>
            <select value={fromLocation ?? ''} onChange={e => setFromLocation(e.target.value || null)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white flex-1 sm:flex-none">
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-gray-600 sm:w-auto w-24">{t('po.to')}</label>
            <select value={toLocation ?? ''} onChange={e => setToLocation(e.target.value || null)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white flex-1 sm:flex-none">
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Search bar */}
        <div className="mt-3 relative w-full sm:w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder={t('po.searchIngredients')} value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>
      </div>

      {/* Mobile Card List (md:hidden) */}
      <div className="md:hidden divide-y divide-gray-100">
        {inOrder.map(renderMobileCard)}
      </div>

      {/* Desktop Table View (hidden md:block) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>{colHead}</thead>
          <tbody className="divide-y divide-gray-50">
            {inOrder.map(renderRow)}
          </tbody>
        </table>
      </div>

      {notInOrder.length > 0 && (
        <>
          <div className="px-4 sm:px-6 py-2 bg-gray-50 border-t border-b border-gray-100 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('po.addMoreIngredients')}</span>
            <span className="text-xs text-gray-400">{t('po.addMoreNote')}</span>
          </div>
          <div className="md:hidden divide-y divide-gray-100">
            {notInOrder.map(renderMobileCard)}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {notInOrder.map(renderRow)}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="px-4 sm:px-6 py-2 bg-gray-50 border-t border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Дополнительные товары</span>
        <button onClick={() => setCustomLines(prev => [...prev, { id: Date.now().toString(), name: '', unit: 'шт', ordered: 0, received: 0 }])} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          + Добавить товар
        </button>
      </div>

      {customLines.length > 0 && (
        <>
          {/* Mobile custom lines */}
          <div className="md:hidden divide-y divide-gray-100 p-3 space-y-2">
            {customLines.map((c, i) => (
              <div key={c.id} className="p-3 bg-gray-50/70 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <input type="text" placeholder="Название (напр., Пакеты)" value={c.name}
                    onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))}
                    className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
                  <button onClick={() => setCustomLines(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 p-1 text-base font-bold">✕</button>
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Ед." value={c.unit}
                    onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, unit: e.target.value } : p))}
                    className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white" />
                  <div className="flex-1 flex items-center gap-1 justify-end">
                    <span className="text-xs text-gray-500">Заказ:</span>
                    <input type="number" min="0" step="0.1" inputMode="decimal" value={c.ordered}
                      onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, ordered: e.target.value } : p))}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-right text-sm font-semibold bg-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop custom lines table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {customLines.map((c, i) => (
                  <tr key={c.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}>
                    <td className="px-4 py-2.5">
                      <input type="text" placeholder="Название товара (например, Мусорные пакеты)" value={c.name} onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, name: e.target.value } : p))} className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </td>
                    <td className="px-4 py-2.5 w-32">
                      <input type="text" placeholder="Ед. изм." value={c.unit} onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, unit: e.target.value } : p))} className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </td>
                    <td className="px-4 py-2.5 w-32 text-right">
                      <input type="number" min="0" step="0.1" value={c.ordered} onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, ordered: e.target.value } : p))} className="w-full border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </td>
                    {initialStatus === 'received' && (
                      <td className="px-4 py-2.5 w-32 text-right">
                        <input type="number" min="0" step="0.1" value={c.received} onChange={e => setCustomLines(prev => prev.map((p, idx) => idx === i ? { ...p, received: e.target.value } : p))} className="w-full border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                      </td>
                    )}
                    <td className="px-4 py-2.5 w-12 text-center">
                      <button onClick={() => setCustomLines(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 text-lg leading-none font-bold">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-xs text-gray-400">{t('po.suggestedNote')}</p>
          <button onClick={() => {
            const filled = {}
            lines.forEach(l => { filled[`${store}:${l.id}`] = l.suggested })
            setQtys(filled)
          }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            {t('po.applySuggested')}
          </button>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common.cancel')}</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            {t('po.saveDraft')}
          </button>
        </div>
      </div>
    </div>
  )
}
