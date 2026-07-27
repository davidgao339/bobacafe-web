import { useState, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'


const TODAY = new Date().toISOString().slice(0, 10)

const STATUS_STYLE = {
  draft:    'bg-gray-100 text-gray-600',
  sent:     'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
}
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', received: 'Received' }
// Note: STATUS_LABEL used only for logic; display uses t() calls

// ─── Inline confirm ───────────────────────────────────────────────────────────

function ConfirmInline({ message, onConfirm, onCancel, danger, dateLabel, date, onDateChange }) {
  const { t } = useLanguage()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {dateLabel && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">{dateLabel}</span>
          <input type="date" value={date} onChange={e => onDateChange(e.target.value)}
            className="border border-gray-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
      )}
      <span className="text-xs text-gray-600">{message}</span>
      <button onClick={onConfirm}
        className={`px-2.5 py-1 text-xs rounded-md text-white font-medium ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
        {t('common.confirm')}
      </button>
      <button onClick={onCancel} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md">
        {t('common.cancel')}
      </button>
    </div>
  )
}

// ─── Status stepper ───────────────────────────────────────────────────────────

function StatusStepper({ po }) {
  const { t } = useLanguage()
  const steps = [
    { label: t('po.stepCreated'),  date: po.createdDate },
    { label: t('po.stepSent'),     date: po.sentDate },
    { label: t('po.stepReceived'), date: po.receivedDate },
  ]
  const activeIdx = po.status === 'received' ? 2 : po.status === 'sent' ? 1 : 0
  return (
    <div className="flex items-center gap-0 mb-5 max-w-sm">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
              i < activeIdx    ? 'bg-blue-600 border-blue-600 text-white'
              : i === activeIdx ? 'border-blue-600 text-blue-600 bg-white'
              : 'border-gray-200 text-gray-300 bg-white'
            }`}>
              {i < activeIdx ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 font-medium ${i <= activeIdx ? 'text-gray-700' : 'text-gray-300'}`}>{s.label}</p>
            <p className="text-xs text-gray-400">{s.date ?? ''}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-6 mx-1 ${i < activeIdx ? 'bg-blue-400' : 'bg-gray-200'}`} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// ─── Create / Edit form ───────────────────────────────────────────────────────

function DraftForm({ title, initialLines, ingredients, suppliers, getOrderQty, initialStore, lockStore, onSave, onCancel, initialCreatedDate, initialFromLocation, initialToLocation, stores, autoApplySuggested }) {
  const { t } = useLanguage()
  const [store,          setStore]          = useState(initialStore ?? stores?.[0] ?? '')
  const [createdDate,    setCreatedDate]    = useState(initialCreatedDate ?? TODAY)
  const [days,           setDays]           = useState(7)
  const [bufferPct,      setBufferPct]      = useState(5)
  const [fromLocation,   setFromLocation]   = useState(initialFromLocation ?? null)
  const [toLocation,     setToLocation]     = useState(initialToLocation ?? null)
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

  // Set of ingredient IDs that were in the original order (ordered > 0)
  const originalIds = new Set(initialLines?.filter(l => l.ordered > 0).map(l => l.ingredientId) ?? [])

  const lines = ingredients.map(p => {
    const key = `${store}:${p.id}`
    const suggested = getOrderQty(store, p.id, days, bufferPct)
    const qty = key in qtys ? qtys[key] : (initialLines ? (originalIds.has(p.id) ? (initialLines.find(l => l.ingredientId === p.id)?.ordered ?? 0) : 0) : 0)
    return { ...p, suggested, qty, isOriginal: originalIds.has(p.id) }
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

  const handleStoreChange = (s) => { setStore(s); setQtys({}) }
  const setQty = (ingredientId, val) =>
    setQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))

  const handleSave = () => {
    onSave({
      store,
      createdDate,
      fromLocation: fromLocation || null,
      toLocation: toLocation || null,
      lines: lines.map(l => ({ ingredientId: l.id, ordered: Math.max(0, Number(l.qty) || 0) })),
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
        <input type="number" min="0" value={l.qty}
          onChange={e => setQty(l.id, e.target.value)}
          className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </td>
    </tr>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <div className="flex items-center gap-4 flex-wrap">
          {!lockStore && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600">{t('common.store')}</label>
              <select value={store} onChange={e => handleStoreChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {stores.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}
          {lockStore && <span className="text-sm font-medium text-gray-700">{store}</span>}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('po.createdDate')}</label>
            <input type="date" value={createdDate} onChange={e => setCreatedDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('po.daysToFill')}</label>
            <input type="number" min="1" max="365" value={days}
              onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 7))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-20 text-right" />
            <span className="text-xs text-gray-400">{t('po.days')}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">+ Buffer %</label>
            <input type="number" min="0" max="100" value={bufferPct}
              onChange={e => setBufferPct(Math.max(0, parseInt(e.target.value) || 0))}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-16 text-right" />
            <span className="text-xs text-gray-400">%</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('po.from')}</label>
            <select value={fromLocation ?? ''} onChange={e => setFromLocation(e.target.value || null)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">{t('po.to')}</label>
            <select value={toLocation ?? ''} onChange={e => setToLocation(e.target.value || null)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('po.searchIngredients')} value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-300 rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>{colHead}</thead>
        <tbody className="divide-y divide-gray-50">
          {inOrder.map(renderRow)}
        </tbody>
      </table>

      {notInOrder.length > 0 && (
        <>
          <div className="px-6 py-2 bg-gray-50 border-t border-b border-gray-100 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t('po.addMoreIngredients')}</span>
            <span className="text-xs text-gray-400">{t('po.addMoreNote')}</span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {notInOrder.map(renderRow)}
            </tbody>
          </table>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

function exportPO(po, config) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const suppliers = config.suppliers ?? []
  const active = po.lines
    .filter(l => l.ordered > 0)
    .map(l => {
      const ing = config.ingredients.find(i => i.id === l.ingredientId)
      return { name: ing?.name ?? '?', unit: ing?.unit ?? '', ordered: l.ordered, supplierId: ing?.supplierId ?? null }
    })

  const groups = []
  for (const s of suppliers) {
    const lines = active.filter(l => l.supplierId === s.id)
    if (lines.length) groups.push({ name: s.name, lines })
  }
  const other = active.filter(l => !suppliers.find(s => s.id === l.supplierId))
  if (other.length) groups.push({ name: 'Остальное', lines: other })
  if (!groups.length) return

  const sectionsHtml = groups.map((g, i) => `
    <div class="section">
      <div class="section-header">${i + 1}. ${esc(g.name)}</div>
      <table>
        <thead><tr>
          <th class="col-cb">СКЛАД</th>
          <th class="col-cb">МАГАЗИН</th>
          <th class="col-name">НАИМЕНОВАНИЕ</th>
          <th class="col-qty">ЗАКАЗ</th>
          <th class="col-unit">ЕД. ИЗМ.</th>
        </tr></thead>
        <tbody>${g.lines.map(l => `
          <tr>
            <td class="col-cb"><span class="cb"></span></td>
            <td class="col-cb"><span class="cb"></span></td>
            <td class="col-name">${esc(l.name)}</td>
            <td class="col-qty">${l.ordered}</td>
            <td class="col-unit">${esc(l.unit)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('')

  const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>Заявка ${esc(po.id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;padding:36px 48px;color:#222;font-size:13px}
.store{font-size:26px;font-weight:900;color:#1a6e34;letter-spacing:.5px;margin-bottom:6px}
.title{font-size:15px;color:#333;margin-bottom:3px}
.cat{font-size:11px;color:#999}
hr{border:none;border-top:1.5px solid #ddd;margin:18px 0}
.section{margin-bottom:28px}
.section-header{font-size:15px;font-weight:bold;border-left:4px solid #1a6e34;padding:8px 14px;background:#f7f7f7;margin-bottom:0}
table{width:100%;border-collapse:collapse}
th{text-transform:uppercase;font-size:10px;letter-spacing:.4px;font-weight:700;color:#666;padding:8px 12px;border-bottom:1.5px solid #e8e8e8;background:#fafafa;text-align:left}
td{padding:10px 12px;border-bottom:1px solid #f2f2f2;vertical-align:middle}
.col-cb{width:52px;text-align:center}
.col-qty{width:90px;text-align:right;font-weight:700}
.col-unit{width:80px;color:#888;font-size:12px}
.cb{display:inline-block;width:18px;height:18px;border:1.5px solid #aaa;border-radius:3px}
.instr{font-style:italic;font-size:11px;color:#888;padding:14px 0;border-top:1px dashed #ccc;margin-top:8px}
.sig-box{border:1px solid #ddd;border-radius:6px;padding:16px 20px;margin-bottom:14px}
.sig-title{font-weight:700;font-size:13px;margin-bottom:20px}
.sig-row{display:flex;gap:32px}
.sig-field{flex:1}
.sig-label{font-size:12px;color:#444;margin-bottom:22px}
.sig-line{border-bottom:1px solid #333}
.pgnum{position:fixed;bottom:18px;right:40px;font-size:10px;color:#bbb}
@media print{body{padding:20px 30px}}
</style></head><body>
<div class="store">${esc(po.store)}</div>
<div class="title">ЗАЯВКА НА ЗАКАЗ (СВЕРКА ПРИЕМКИ)</div>
<div class="cat">Категория: Снабжение кафе / Контроль поставок</div>
<hr>
<div class="sig-box">
  <div class="sig-title">ПОДТВЕРЖДЕНИЕ ПРИЕМКИ ТОВАРА:</div>
  <div class="sig-row">
    <div class="sig-field"><div class="sig-label">Товар принял (ФИО сотрудника):</div><div class="sig-line"></div></div>
    <div class="sig-field"><div class="sig-label">Подпись:</div><div class="sig-line"></div></div>
    <div class="sig-field"><div class="sig-label">Дата приемки:</div><div class="sig-line"></div></div>
  </div>
</div>
<hr>
${sectionsHtml}
<div class="instr">* Инструкция для персонала: Перед отметкой галочкой сверьте фактическое наименование, срок годности, целостность упаковки и точное количество поставляемого товара.</div>
<div class="pgnum">Страница 1</div>
</body></html>`

  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

export default function PurchaseOrders({ initialCreate }) {
  const { config, data, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, revertPoToSent, updatePoReceivedDate, addTransaction, stores } = useConfig()
  const { getOrderQty } = useCalcs()
  const { t } = useLanguage()

  const ingredientName = (id) => config.ingredients.find(p => p.id === id)?.name ?? '—'
  const ingredientUnit = (id) => config.ingredients.find(p => p.id === id)?.unit ?? ''

  const [expanded,    setExpanded]    = useState(null)
  const [creating,    setCreating]    = useState(!!initialCreate)
  const [editingId,   setEditingId]   = useState(null)
  const [confirm,     setConfirm]     = useState(null)
  const [filter,      setFilter]      = useState('all')
  const [search,      setSearch]      = useState('')
  const [receiveId,   setReceiveId]   = useState(null)
  const [receiveDate, setReceiveDate] = useState(TODAY)
  const [receiveTime, setReceiveTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [receiveQtys, setReceiveQtys] = useState({})
  const [editDateId,  setEditDateId]  = useState(null)
  const [editDateVal, setEditDateVal] = useState(TODAY)
  const [editDateTime,setEditDateTime]= useState('00:00')

  const pos    = data.purchaseOrders
  const nextId = `PO-${String(data._nextPoId).padStart(3, '0')}`

  const filtered = pos.filter(po => {
    if (filter !== 'all' && po.status !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return po.id.toLowerCase().includes(q) || po.store.toLowerCase().includes(q)
    }
    return true
  })
  const count    = (s) => s === 'all' ? pos.length : pos.filter(p => p.status === s).length

  const cancelReceive = () => { setReceiveId(null); setReceiveQtys({}) }

  const startReceive = (po, e) => {
    e.stopPropagation()
    const qtys = {}
    po.lines.filter(l => l.ordered > 0).forEach(l => { qtys[l.ingredientId] = String(l.ordered) })
    setReceiveId(po.id); setReceiveDate(TODAY); setReceiveTime(new Date().toTimeString().slice(0, 5)); setReceiveQtys(qtys)
    setExpanded(po.id); setConfirm(null)
  }

  const confirmReceive = (po) => {
    const updatedLines = po.lines.map(l => ({
      ...l,
      received: receiveQtys[l.ingredientId] !== undefined
        ? Math.max(0, parseFloat(receiveQtys[l.ingredientId]) || 0)
        : l.ordered,
    }))
    updatePurchaseOrder(po.id, { status: 'received', receivedDate: receiveDate, receivedAt: `${receiveDate}T${receiveTime}:00`, lines: updatedLines })

    // Handle transfer if both locations are set
    if (po.fromLocation && po.toLocation) {
      updatedLines.forEach(l => {
        const qty = l.received ?? l.ordered
        if (qty > 0) {
          addTransaction({ ingredientId: l.ingredientId, store: po.fromLocation, date: receiveDate, type: 'adjustment', quantity: -qty,  poId: po.id })
          addTransaction({ ingredientId: l.ingredientId, store: po.toLocation,   date: receiveDate, type: 'adjustment', quantity:  qty,  poId: po.id })
        }
      })
    }
    cancelReceive()
  }

  const startEditDate = (po, e) => {
    e.stopPropagation()
    const [date, time] = (po.receivedAt ?? `${po.receivedDate}T00:00:00`).split('T')
    setEditDateId(po.id)
    setEditDateVal(date ?? po.receivedDate ?? TODAY)
    setEditDateTime((time ?? '00:00').slice(0, 5))
    setConfirm(null)
  }

  const saveEditDate = (po, e) => {
    e.stopPropagation()
    updatePoReceivedDate(po.id, editDateVal, `${editDateVal}T${editDateTime}:00`)
    setEditDateId(null)
  }

  const toggle = (id) => {
    setExpanded(prev => prev === id ? null : id)
    setConfirm(null)
    if (editingId === id) setEditingId(null)
    if (receiveId === id) cancelReceive()
    if (editDateId === id) setEditDateId(null)
  }

  const requestConfirm = (poId, action, e) => {
    e.stopPropagation()
    setConfirm(prev => (prev?.poId === poId && prev?.action === action) ? null : { poId, action, date: TODAY })
  }

  const doConfirm = () => {
    if (!confirm) return
    const { poId, action, date } = confirm
    if (action === 'send')          updatePurchaseOrder(poId, { status: 'sent',     sentDate: date })
    if (action === 'receive')       updatePurchaseOrder(poId, { status: 'received', receivedDate: date })
    if (action === 'revertToSent')  revertPoToSent(poId)
    if (action === 'revertToDraft') updatePurchaseOrder(poId, { status: 'draft',    sentDate: null })
    if (action === 'delete') {
      deletePurchaseOrder(poId)
      if (expanded === poId) setExpanded(null)
    }
    setConfirm(null)
  }

  const handleCreate = ({ store, lines, createdDate, fromLocation, toLocation }) => {
    addPurchaseOrder({ store, lines, id: nextId, status: 'draft', createdDate, sentDate: null, receivedDate: null, fromLocation, toLocation })
    setCreating(false)
    setExpanded(nextId)
  }

  const handleEditSave = (poId, { lines, createdDate, fromLocation, toLocation }) => {
    updatePurchaseOrder(poId, { lines, createdDate, fromLocation, toLocation })
    setEditingId(null)
  }

  const CONFIRM_LABELS = {
    send:          { msg: t('po.confirmSend'),        danger: false },
    receive:       { msg: t('po.confirmReceive'),     danger: false },
    revertToSent:  { msg: t('po.confirmRevertSent'),  danger: true  },
    revertToDraft: { msg: t('po.confirmRevertDraft'), danger: true  },
    delete:        { msg: t('po.confirmDelete'),      danger: true  },
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('po.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('po.subtitle')}</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            {t('po.newPO')}
          </button>
        )}
      </div>

      {creating && (
        <DraftForm
          title={t('po.newPOTitle', { id: nextId })}
          ingredients={config.ingredients}
          suppliers={config.suppliers}
          getOrderQty={getOrderQty}
          stores={stores}
          initialStore={initialCreate?.store}
          autoApplySuggested={!!initialCreate}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[['all', t('po.all')], ['draft', t('po.draft')], ['sent', t('po.sent')], ['received', t('po.received')]].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label} <span className="ml-1 text-gray-400">{count(id)}</span>
          </button>
        ))}
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder={t('common.search') + '…'} value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Mobile: cards */}
        {filtered.length === 0
          ? <p className="md:hidden px-6 py-10 text-center text-gray-400 text-sm">
              {filter === 'all' ? t('po.noPOs') : t('po.noFilteredPOs', { status: STATUS_LABEL[filter].toLowerCase() })}
            </p>
          : <div className="md:hidden divide-y divide-gray-100">
              {filtered.map(po => {
                const pendingConfirm = confirm?.poId === po.id ? confirm.action : null
                const cl = pendingConfirm ? CONFIRM_LABELS[pendingConfirm] : null
                const lineCount = po.lines.filter(l => l.ordered > 0).length
                return (
                  <div key={po.id} className={expanded === po.id ? 'bg-blue-50' : ''}>
                    <div onClick={() => toggle(po.id)} className="px-4 py-3 cursor-pointer">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm font-semibold text-gray-700">{po.id}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[po.status]}`}>
                          {t(`po.${po.status}`)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 mb-1">{po.store}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{po.createdDate}</span>
                        {po.sentDate && <span>→ {po.sentDate}</span>}
                        {po.receivedDate && <span>✓ {po.receivedDate}</span>}
                        <span className="ml-auto">{lineCount} {t('po.colLines').toLowerCase()}</span>
                      </div>
                    </div>
                    <div className="px-4 pb-3 flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
                      {pendingConfirm ? (
                        <ConfirmInline
                          message={cl.msg} danger={cl.danger}
                          onConfirm={doConfirm} onCancel={() => setConfirm(null)}
                          dateLabel={pendingConfirm === 'send' ? t('po.sentDate') : pendingConfirm === 'receive' ? t('po.receivedDate') : undefined}
                          date={confirm?.date} onDateChange={d => setConfirm(prev => ({ ...prev, date: d }))}
                        />
                      ) : (<>
                        {po.status === 'draft' && <>
                          <button onClick={e => requestConfirm(po.id, 'send', e)}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg">{t('po.send')}</button>
                          <button onClick={e => { e.stopPropagation(); setEditingId(po.id); setExpanded(po.id) }}
                            className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg">{t('common.edit')}</button>
                          <button onClick={e => requestConfirm(po.id, 'delete', e)}
                            className="px-3 py-1.5 text-red-400 text-xs">{t('common.delete')}</button>
                        </>}
                        {po.status === 'sent' && <>
                          <button onClick={e => startReceive(po, e)}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg">{t('po.markReceived')}</button>
                          <button onClick={e => requestConfirm(po.id, 'revertToDraft', e)}
                            className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">{t('po.revertDraft')}</button>
                        </>}
                        {po.status === 'received' && (editDateId === po.id
                          ? <div className="flex items-center gap-2 flex-wrap w-full" onClick={e => e.stopPropagation()}>
                              <input type="date" value={editDateVal} onChange={e => setEditDateVal(e.target.value)}
                                className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              <input type="time" value={editDateTime} onChange={e => setEditDateTime(e.target.value)}
                                className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              <button onClick={e => saveEditDate(po, e)}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg">{t('common.save')}</button>
                              <button onClick={e => { e.stopPropagation(); setEditDateId(null) }}
                                className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">{t('common.cancel')}</button>
                            </div>
                          : <>
                              <button onClick={e => startEditDate(po, e)}
                                className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">{t('po.editDate')}</button>
                              <button onClick={e => requestConfirm(po.id, 'revertToSent', e)}
                                className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs rounded-lg">{t('po.revertSent')}</button>
                            </>
                        )}
                        <button onClick={e => { e.stopPropagation(); exportPO(po, config) }}
                          className="px-3 py-1.5 border border-gray-300 text-gray-600 text-xs rounded-lg flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                          {t('po.exportPDF')}
                        </button>
                      </>)}
                    </div>
                    {expanded === po.id && (
                      <div className="px-4 pb-4 border-t border-blue-100">
                        <StatusStepper po={po} />
                        {editingId === po.id && po.status === 'draft' ? (
                          <DraftForm
                            title={t('po.editTitle', { id: po.id })}
                            initialLines={po.lines} initialStore={po.store}
                            initialCreatedDate={po.createdDate}
                            initialFromLocation={po.fromLocation}
                            initialToLocation={po.toLocation}
                            lockStore
                            ingredients={config.ingredients} suppliers={config.suppliers} getOrderQty={getOrderQty}
                            stores={stores}
                            onSave={({ lines, createdDate, fromLocation, toLocation }) => handleEditSave(po.id, { lines, createdDate, fromLocation, toLocation })}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <div className="divide-y divide-gray-100 bg-white rounded-lg border border-blue-100 overflow-hidden">
                            {po.lines.filter(l => l.ordered > 0).map(l => {
                              const received = l.received ?? l.ordered
                              const diff = po.status === 'received' && received !== l.ordered
                              return (
                                <div key={l.ingredientId} className="px-4 py-2 flex items-center justify-between text-sm">
                                  <span className="font-medium text-gray-800">{ingredientName(l.ingredientId)}</span>
                                  <span className="tabular-nums text-right">
                                    {diff && <span className="text-gray-400 line-through mr-1.5">{l.ordered}</span>}
                                    <span className={`font-semibold ${diff ? 'text-amber-600' : 'text-gray-900'}`}>{po.status === 'received' ? received : l.ordered}</span>
                                    <span className="text-gray-400 font-normal text-xs ml-1">{ingredientUnit(l.ingredientId)}</span>
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
        }
        {/* Desktop: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 font-medium">{t('po.colId')}</th>
                <th className="px-4 py-3 font-medium">{t('common.store')}</th>
                <th className="px-4 py-3 font-medium">{t('po.colCreated')}</th>
                <th className="px-4 py-3 font-medium">{t('po.colSent')}</th>
                <th className="px-4 py-3 font-medium">{t('po.colReceived')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('po.colLines')}</th>
                <th className="px-4 py-3 font-medium">{t('common.status')}</th>
                <th className="px-4 py-3 font-medium">{t('po.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400 text-sm">
                    {filter === 'all' ? t('po.noPOs') : t('po.noFilteredPOs', { status: STATUS_LABEL[filter].toLowerCase() })}
                  </td></tr>
                : filtered.map(po => {
                    const pendingConfirm = confirm?.poId === po.id ? confirm.action : null
                    const cl = pendingConfirm ? CONFIRM_LABELS[pendingConfirm] : null
                    return (
                      <Fragment key={po.id}>
                        <tr onClick={() => toggle(po.id)}
                          className={`border-b border-gray-50 cursor-pointer ${expanded === po.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <td className="px-6 py-3 font-mono text-xs font-semibold text-gray-700">{po.id}</td>
                          <td className="px-4 py-3 text-gray-800">{po.store}</td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.createdDate}</td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.sentDate ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.receivedDate ?? '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{po.lines.filter(l => l.ordered > 0).length}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[po.status]}`}>
                              {t(`po.${po.status}`)}
                            </span>
                          </td>
                          <td className="px-4 py-3 min-w-72" onClick={e => e.stopPropagation()}>
                            {pendingConfirm ? (
                              <ConfirmInline
                                message={cl.msg} danger={cl.danger}
                                onConfirm={doConfirm} onCancel={() => setConfirm(null)}
                                dateLabel={pendingConfirm === 'send' ? t('po.sentDate') : pendingConfirm === 'receive' ? t('po.receivedDate') : undefined}
                                date={confirm?.date} onDateChange={d => setConfirm(prev => ({ ...prev, date: d }))}
                              />
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                {po.status === 'draft' && <>
                                  <button onClick={e => requestConfirm(po.id, 'send', e)}
                                    className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700">{t('po.send')}</button>
                                  <button onClick={e => { e.stopPropagation(); setEditingId(po.id); setExpanded(po.id) }}
                                    className="px-2.5 py-1 border border-gray-300 text-gray-600 text-xs rounded-md hover:bg-gray-50">{t('common.edit')}</button>
                                  <button onClick={e => requestConfirm(po.id, 'delete', e)}
                                    className="px-2.5 py-1 text-red-400 text-xs hover:text-red-600">{t('common.delete')}</button>
                                </>}
                                {po.status === 'sent' && <>
                                  <button onClick={e => startReceive(po, e)}
                                    className="px-2.5 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700">{t('po.markReceived')}</button>
                                  <button onClick={e => requestConfirm(po.id, 'revertToDraft', e)}
                                    className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">{t('po.revertDraft')}</button>
                                </>}
                                {po.status === 'received' && (editDateId === po.id
                                  ? <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                      <input type="date" value={editDateVal} onChange={e => setEditDateVal(e.target.value)}
                                        className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                      <input type="time" value={editDateTime} onChange={e => setEditDateTime(e.target.value)}
                                        className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                      <button onClick={e => saveEditDate(po, e)}
                                        className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700">{t('common.save')}</button>
                                      <button onClick={e => { e.stopPropagation(); setEditDateId(null) }}
                                        className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">{t('common.cancel')}</button>
                                    </div>
                                  : <>
                                      <button onClick={e => startEditDate(po, e)}
                                        className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">{t('po.editDate')}</button>
                                      <button onClick={e => requestConfirm(po.id, 'revertToSent', e)}
                                        className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">{t('po.revertSent')}</button>
                                    </>
                                )}
                                <button onClick={e => { e.stopPropagation(); exportPO(po, config) }}
                                  className="px-2.5 py-1 border border-gray-300 text-gray-600 text-xs rounded-md hover:bg-gray-50 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                                  {t('po.exportPDF')}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {expanded === po.id && (
                          <tr className="bg-blue-50 border-b border-blue-100">
                            <td colSpan={8} className="px-8 py-5">
                              <StatusStepper po={po} />

                              {/* Receive form */}
                              {receiveId === po.id && (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-4">
                                  <div className="flex items-center gap-4 mb-4 flex-wrap">
                                    <h3 className="font-semibold text-gray-900 flex-1">{t('po.confirmReceiptTitle', { id: po.id })}</h3>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <label className="text-xs font-medium text-gray-600">{t('po.receivedDate')}</label>
                                      <input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)}
                                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                                      <input type="time" value={receiveTime} onChange={e => setReceiveTime(e.target.value)}
                                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                                    </div>
                                  </div>
                                  <table className="w-full max-w-lg text-sm bg-white rounded-lg border border-green-100 overflow-hidden mb-4">
                                    <thead>
                                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                                        <th className="px-4 py-2 font-medium">{t('common.ingredient')}</th>
                                        <th className="px-4 py-2 font-medium text-right">{t('po.orderedQty')}</th>
                                        <th className="px-4 py-2 font-medium text-right">{t('po.actualQty')}</th>
                                        <th className="px-4 py-2 font-medium">{t('common.unit')}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {po.lines.filter(l => l.ordered > 0).map(l => (
                                        <tr key={l.ingredientId}>
                                          <td className="px-4 py-2.5 font-medium text-gray-900">{ingredientName(l.ingredientId)}</td>
                                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{l.ordered}</td>
                                          <td className="px-4 py-2.5 text-right">
                                            <input type="number" min="0" step="0.1"
                                              value={receiveQtys[l.ingredientId] ?? l.ordered}
                                              onChange={e => setReceiveQtys(prev => ({ ...prev, [l.ingredientId]: e.target.value }))}
                                              className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500 tabular-nums" />
                                          </td>
                                          <td className="px-4 py-2.5 text-gray-400 text-xs">{ingredientUnit(l.ingredientId)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  <div className="flex justify-end gap-3">
                                    <button onClick={cancelReceive} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('common.cancel')}</button>
                                    <button onClick={() => confirmReceive(po)}
                                      className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors font-medium">
                                      {t('po.confirmReceive')} ✓
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Line items view */}
                              {!receiveId && (editingId === po.id && po.status === 'draft' ? (
                                <DraftForm
                                  title={t('po.editTitle', { id: po.id })}
                                  initialLines={po.lines} initialStore={po.store}
                                  initialCreatedDate={po.createdDate}
                                  initialFromLocation={po.fromLocation}
                                  initialToLocation={po.toLocation}
                                  lockStore
                                  ingredients={config.ingredients} suppliers={config.suppliers} getOrderQty={getOrderQty}
                                  stores={stores}
                                  onSave={({ lines, createdDate, fromLocation, toLocation }) => handleEditSave(po.id, { lines, createdDate, fromLocation, toLocation })}
                                  onCancel={() => setEditingId(null)}
                                />
                              ) : (
                                <table className="w-full max-w-lg text-sm bg-white rounded-lg border border-blue-100 overflow-hidden">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                                      <th className="px-4 py-2 font-medium">{t('common.ingredient')}</th>
                                      <th className="px-4 py-2 font-medium text-right">{t('po.orderedQty')}</th>
                                      {po.status === 'received' && <th className="px-4 py-2 font-medium text-right">{t('po.actualQty')}</th>}
                                      <th className="px-4 py-2 font-medium">{t('common.unit')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {po.lines.filter(l => l.ordered > 0).map(l => {
                                      const received = l.received ?? l.ordered
                                      const diff = received !== l.ordered
                                      return (
                                        <tr key={l.ingredientId}>
                                          <td className="px-4 py-2 font-medium text-gray-800">{ingredientName(l.ingredientId)}</td>
                                          <td className="px-4 py-2 text-right tabular-nums text-gray-500">{l.ordered}</td>
                                          {po.status === 'received' && (
                                            <td className={`px-4 py-2 text-right tabular-nums font-semibold ${diff ? 'text-amber-600' : 'text-gray-900'}`}>
                                              {received}
                                              {diff && <span className="text-xs font-normal ml-1">({received > l.ordered ? '+' : ''}{Math.round((received - l.ordered) * 10) / 10})</span>}
                                            </td>
                                          )}
                                          <td className="px-4 py-2 text-gray-400 text-xs">{ingredientUnit(l.ingredientId)}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
