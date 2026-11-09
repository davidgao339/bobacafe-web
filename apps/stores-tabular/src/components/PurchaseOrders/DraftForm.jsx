import { useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'

const TODAY = new Date().toISOString().slice(0, 10)

export const OVERHEAD_CATEGORIES = [
  { id: 'Supplies', label: 'Расходники / Хозтовары' },
  { id: 'Equipment', label: 'Оборудование / Ремонт' },
  { id: 'Packaging', label: 'Упаковка и полиграфия' },
  { id: 'Services', label: 'Услуги и сервис' },
  { id: 'General Overhead', label: 'Прочие накладные' },
]

export default function DraftForm({
  title,
  initialLines,
  initialCustomLines,
  ingredients,
  suppliers,
  getOrderQty,
  initialStore,
  lockStore,
  onSave,
  onCancel,
  initialCreatedDate,
  initialFromLocation,
  initialToLocation,
  stores,
  autoApplySuggested,
  initialStatus
}) {
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

  const isSupplierPurchase = !fromLocation

  // Track user's last edited field ('unit' or 'total') for regular ingredients
  const [lastCostEdit, setLastCostEdit] = useState({})

  const [customLines, setCustomLines] = useState(() => {
    return (initialCustomLines || []).map(c => {
      const u = c.unitCost != null && Number(c.unitCost) > 0 ? String(c.unitCost) : ''
      const ord = c.ordered != null ? Number(c.ordered) : 0
      const t = c.totalCost != null && Number(c.totalCost) > 0 
        ? String(c.totalCost) 
        : ((u && ord > 0) ? (Number(u) * ord).toFixed(2) : '')

      return {
        id: c.id || Date.now().toString(),
        name: c.name || '',
        overheadCategory: c.overheadCategory || 'Supplies',
        unit: c.unit || 'шт',
        ordered: ord,
        received: c.received || 0,
        unitCost: u,
        totalCost: t,
        costCategory: 'overhead',
        lastCostEdit: 'unit'
      }
    })
  })

  const handleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  const si = key => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const [qtys, setQtys] = useState(() => {
    if (initialLines) {
      const map = {}
      initialLines.forEach(l => { map[`${initialStore}:${l.ingredientId}`] = l.ordered })
      return map
    }
    if (autoApplySuggested) {
      const st = initialStore ?? stores?.[0] ?? ''
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

  const [unitCosts, setUnitCosts] = useState(() => {
    const map = {}
    if (initialLines) {
      initialLines.forEach(l => {
        if (l.unitCost != null && Number(l.unitCost) > 0) {
          map[`${initialStore}:${l.ingredientId}`] = String(l.unitCost)
        }
      })
    }
    ingredients.forEach(p => {
      const key = `${initialStore ?? stores?.[0] ?? ''}:${p.id}`
      if (!(key in map)) {
        const defaultCost = p.costPerUnit || p.lastPurchaseCost || ''
        if (defaultCost) map[key] = String(defaultCost)
      }
    })
    return map
  })

  const [totalCosts, setTotalCosts] = useState(() => {
    const map = {}
    if (initialLines) {
      initialLines.forEach(l => {
        if (l.totalCost != null && Number(l.totalCost) > 0) {
          map[`${initialStore}:${l.ingredientId}`] = String(l.totalCost)
        } else if (l.unitCost != null && Number(l.unitCost) > 0 && Number(l.ordered) > 0) {
          map[`${initialStore}:${l.ingredientId}`] = (Number(l.unitCost) * Number(l.ordered)).toFixed(2)
        }
      })
    }
    return map
  })

  // Set of ingredient IDs that were in the original order (ordered > 0)
  const originalIds = new Set(initialLines?.filter(l => l.ordered > 0).map(l => l.ingredientId) ?? [])

  const lines = ingredients.map(p => {
    const key = `${store}:${p.id}`
    const suggested = getOrderQty(store, p.id, days, bufferPct)
    const qty = key in qtys ? qtys[key] : (initialLines ? (originalIds.has(p.id) ? (initialLines.find(l => l.ingredientId === p.id)?.ordered ?? 0) : 0) : 0)
    const received = key in receivedQtys ? receivedQtys[key] : (initialLines ? (initialLines.find(l => l.ingredientId === p.id)?.received ?? qty) : qty)
    const unitCost = key in unitCosts ? unitCosts[key] : (initialLines?.find(l => l.ingredientId === p.id)?.unitCost || (p.costPerUnit || p.lastPurchaseCost || ''))
    const totalCost = key in totalCosts ? totalCosts[key] : ((Number(qty) > 0 && Number(unitCost) > 0) ? (Number(qty) * Number(unitCost)).toFixed(2) : '')
    return { ...p, suggested, qty, received, unitCost, totalCost, isOriginal: originalIds.has(p.id) }
  })

  const q = search.toLowerCase()
  const getSupplierName = (l) => suppliers?.find(s => s.id === l.supplierId)?.name ?? ''
  const applySort = arr => {
    const [withSugg, noSugg] = [arr.filter(l => l.suggested > 0), arr.filter(l => l.suggested === 0)]
    const sort = sortKey
      ? (a, b) => {
          let cmp
          if (sortKey === 'name') cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
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

  const handleStoreChange = (s) => {
    setStore(s)
    setQtys({})
    setReceivedQtys({})
    setTotalCosts({})
    setLastCostEdit({})
  }

  // Bidirectional cost logic for regular ingredients
  const setQty = (ingredientId, val) => {
    const key = `${store}:${ingredientId}`
    setQtys(prev => ({ ...prev, [key]: val }))
    const count = Number(val) || 0
    const last = lastCostEdit[key] || 'unit'
    if (count > 0) {
      if (last === 'total' && totalCosts[key] != null && totalCosts[key] !== '') {
        const derivedUnit = Number(totalCosts[key]) / count
        setUnitCosts(prev => ({ ...prev, [key]: isNaN(derivedUnit) ? '' : (Math.round(derivedUnit * 100) / 100).toFixed(2) }))
      } else if (unitCosts[key] != null && unitCosts[key] !== '') {
        const derivedTotal = count * Number(unitCosts[key])
        setTotalCosts(prev => ({ ...prev, [key]: isNaN(derivedTotal) ? '' : (Math.round(derivedTotal * 100) / 100).toFixed(2) }))
      }
    } else {
      setTotalCosts(prev => ({ ...prev, [key]: '' }))
    }
  }

  const handleUnitCostChange = (ingredientId, val) => {
    const key = `${store}:${ingredientId}`
    setUnitCosts(prev => ({ ...prev, [key]: val }))
    setLastCostEdit(prev => ({ ...prev, [key]: 'unit' }))
    const count = Number(qtys[key] ?? 0)
    if (count > 0 && val !== '') {
      const derivedTotal = count * Number(val)
      setTotalCosts(prev => ({ ...prev, [key]: isNaN(derivedTotal) ? '' : (Math.round(derivedTotal * 100) / 100).toFixed(2) }))
    } else if (val === '') {
      setTotalCosts(prev => ({ ...prev, [key]: '' }))
    }
  }

  const handleTotalCostChange = (ingredientId, val) => {
    const key = `${store}:${ingredientId}`
    setTotalCosts(prev => ({ ...prev, [key]: val }))
    setLastCostEdit(prev => ({ ...prev, [key]: 'total' }))
    const count = Number(qtys[key] ?? 0)
    if (count > 0 && val !== '') {
      const derivedUnit = Number(val) / count
      setUnitCosts(prev => ({ ...prev, [key]: isNaN(derivedUnit) ? '' : (Math.round(derivedUnit * 100) / 100).toFixed(2) }))
    } else if (val === '') {
      setUnitCosts(prev => ({ ...prev, [key]: '' }))
    }
  }

  const setReceivedQty = (ingredientId, val) =>
    setReceivedQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))

  // Bidirectional cost logic for custom overhead lines
  const updateCustomLine = (index, updates) => {
    setCustomLines(prev => prev.map((item, idx) => {
      if (idx !== index) return item
      const next = { ...item, ...updates }
      
      if ('unitCost' in updates) {
        next.lastCostEdit = 'unit'
        const count = Number(next.ordered) || 0
        if (count > 0 && updates.unitCost !== '') {
          const derivedTotal = count * Number(updates.unitCost)
          next.totalCost = isNaN(derivedTotal) ? '' : (Math.round(derivedTotal * 100) / 100).toFixed(2)
        } else if (updates.unitCost === '') {
          next.totalCost = ''
        }
      } else if ('totalCost' in updates) {
        next.lastCostEdit = 'total'
        const count = Number(next.ordered) || 0
        if (count > 0 && updates.totalCost !== '') {
          const derivedUnit = Number(updates.totalCost) / count
          next.unitCost = isNaN(derivedUnit) ? '' : (Math.round(derivedUnit * 100) / 100).toFixed(2)
        } else if (updates.totalCost === '') {
          next.unitCost = ''
        }
      } else if ('ordered' in updates) {
        const count = Number(updates.ordered) || 0
        if (count > 0) {
          if (next.lastCostEdit === 'total' && next.totalCost != null && next.totalCost !== '') {
            const derivedUnit = Number(next.totalCost) / count
            next.unitCost = isNaN(derivedUnit) ? '' : (Math.round(derivedUnit * 100) / 100).toFixed(2)
          } else if (next.unitCost != null && next.unitCost !== '') {
            const derivedTotal = count * Number(next.unitCost)
            next.totalCost = isNaN(derivedTotal) ? '' : (Math.round(derivedTotal * 100) / 100).toFixed(2)
          }
        } else {
          next.totalCost = ''
        }
      }
      return next
    }))
  }

  // Cost breakdowns: COGS vs Overhead
  const cogsSubtotal = lines.reduce((acc, l) => {
    const count = Number(l.qty) || 0
    if (count <= 0) return acc
    const lineTot = Number(l.totalCost) || (count * (Number(l.unitCost) || 0))
    return acc + lineTot
  }, 0)

  const overheadSubtotal = customLines.reduce((acc, c) => {
    const count = Number(c.ordered) || 0
    if (count <= 0) return acc
    const lineTot = Number(c.totalCost) || (count * (Number(c.unitCost) || 0))
    return acc + lineTot
  }, 0)

  const totalOrderAmount = cogsSubtotal + overheadSubtotal

  const handleSave = () => {
    // Supplier purchase strict rule: every ordered item MUST have unitCost > 0 and totalCost > 0
    if (isSupplierPurchase) {
      const activeRegular = lines.filter(l => Number(l.qty) > 0)
      const missingRegular = activeRegular.filter(l => !(Number(l.unitCost) > 0) && !(Number(l.totalCost) > 0))

      const activeCustom = customLines.filter(c => c.name?.trim() && Number(c.ordered) > 0)
      const missingCustom = activeCustom.filter(c => !(Number(c.unitCost) > 0) && !(Number(c.totalCost) > 0))

      if (missingRegular.length > 0 || missingCustom.length > 0) {
        const itemNames = [
          ...missingRegular.map(l => l.name),
          ...missingCustom.map(c => c.name)
        ]
        const preview = itemNames.slice(0, 5).join(', ')
        const extra = itemNames.length > 5 ? ` и еще ${itemNames.length - 5} поз.` : ''
        alert(
          `Ошибка валидации: Для закупки у поставщика каждый заказанный товар обязан иметь цену или сумму больше 0 (non-zero cost).\n\n` +
          `Пожалуйста, укажите цену или сумму для позиций:\n• ${preview}${extra}`
        )
        return
      }
    }

    onSave({
      store,
      createdDate,
      fromLocation: fromLocation || null,
      toLocation: toLocation || null,
      lines: lines.map(l => {
        const ord = Math.max(0, Number(l.qty) || 0)
        const uCost = Number(l.unitCost) || (ord > 0 && Number(l.totalCost) ? Number(l.totalCost) / ord : 0)
        const tCost = Number(l.totalCost) || (ord * uCost)
        return { 
          ingredientId: l.id, 
          name: l.name,
          unit: l.unit,
          ordered: ord,
          unitCost: Math.round(uCost * 100) / 100,
          totalCost: Math.round(tCost * 100) / 100,
          costCategory: 'cogs',
          ...(initialStatus === 'received' ? { received: Math.max(0, Number(l.received) || 0) } : {})
        }
      }),
      customLines: customLines.filter(c => c.name?.trim()).map(c => {
        const ord = Math.max(0, Number(c.ordered) || 0)
        const uCost = Number(c.unitCost) || (ord > 0 && Number(c.totalCost) ? Number(c.totalCost) / ord : 0)
        const tCost = Number(c.totalCost) || (ord * uCost)
        return {
          id: c.id,
          name: c.name.trim(),
          overheadCategory: c.overheadCategory || 'Supplies',
          unit: c.unit?.trim() || 'шт',
          ordered: ord,
          unitCost: Math.round(uCost * 100) / 100,
          totalCost: Math.round(tCost * 100) / 100,
          costCategory: 'overhead',
          ...(initialStatus === 'received' ? { received: Math.max(0, Number(c.received) || 0) } : {})
        }
      }),
    })
  }

  const supplierName = (ing) => {
    if (!ing.supplierId || !suppliers?.length) return null
    return suppliers.find(s => s.id === ing.supplierId)?.name ?? null
  }

  const colHead = (
    <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
      <th className="px-6 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('name')}>
        {t('common.ingredient')}{si('name')}
      </th>
      <th className="px-4 py-3 font-medium">{t('common.unit')}</th>
      {suppliers?.length > 0 && (
        <th className="px-4 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('supplier')}>
          {t('recipes.supplier')}{si('supplier')}
        </th>
      )}
      <th className="px-4 py-3 font-medium text-right cursor-pointer select-none hover:text-gray-700" onClick={() => handleSort('suggested')} title={t('po.applySuggested')}>
        {t('po.suggested')}{si('suggested')}
      </th>
      <th className="px-4 py-3 font-medium text-right">{t('po.orderQty')}</th>
      {showCosts && (
        <>
          <th className="px-4 py-3 font-medium text-right text-amber-900 w-36">
            Цена за ед. (₽) {isSupplierPurchase && <span className="text-red-500 font-bold">*</span>}
          </th>
          <th className="px-4 py-3 font-medium text-right text-amber-900 w-36">
            Сумма (₽) {isSupplierPurchase && <span className="text-red-500 font-bold">*</span>}
          </th>
        </>
      )}
      {initialStatus === 'received' && <th className="px-4 py-3 font-medium text-right">{t('po.actualQty')}</th>}
    </tr>
  )

  const renderRow = (l) => {
    const isOrdered = Number(l.qty) > 0
    const hasZeroCost = isSupplierPurchase && isOrdered && !(Number(l.unitCost) > 0) && !(Number(l.totalCost) > 0)

    return (
      <tr key={l.id} className={`hover:bg-gray-50 ${hasZeroCost ? 'bg-red-50/40' : ''}`}>
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
        {showCosts && (
          <>
            <td className="px-4 py-2.5 text-right">
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={l.unitCost}
                  onChange={e => handleUnitCostChange(l.id, e.target.value)}
                  className={`w-28 border rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 tabular-nums ${
                    hasZeroCost
                      ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500'
                      : 'border-gray-300 focus:ring-blue-500'
                  }`}
                />
                <span className="text-xs text-gray-400">₽</span>
              </div>
            </td>
            <td className="px-4 py-2.5 text-right">
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={l.totalCost}
                  onChange={e => handleTotalCostChange(l.id, e.target.value)}
                  className={`w-28 border rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 tabular-nums ${
                    hasZeroCost
                      ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500'
                      : 'border-gray-300 focus:ring-blue-500'
                  }`}
                />
                <span className="text-xs text-gray-400">₽</span>
              </div>
            </td>
          </>
        )}
        {initialStatus === 'received' && (
          <td className="px-4 py-2.5 text-right">
            <input type="number" min="0" step="0.1" value={l.received}
              onChange={e => setReceivedQty(l.id, e.target.value)}
              className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </td>
        )}
      </tr>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {isSupplierPurchase ? (
            <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-0.5 rounded-full font-medium border border-amber-200">
              {t('po.supplierPurchase') || 'Закупка у поставщика'} (двунаправленный ввод: цена ⇄ сумма)
            </span>
          ) : (
            <span className="bg-purple-100 text-purple-800 text-xs px-2.5 py-0.5 rounded-full font-medium border border-purple-200">
              {t('po.interStoreTransfer') || 'Перемещение со склада'}
            </span>
          )}
        </div>
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
              <option value="">— Внешний поставщик —</option>
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
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs cursor-pointer">✕</button>
            )}
          </div>
        </div>
      </div>

      {showCosts && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Двунаправленный ввод: меняйте цену или сумму — расчет автоматический</span>
            </div>
            <div className="hidden md:flex items-center gap-3 text-amber-800">
              <span>Сырьё (COGS): <strong>{cogsSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong></span>
              <span>•</span>
              <span>Накладные (Overhead): <strong>{overheadSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong></span>
            </div>
          </div>
          <div className="font-semibold text-sm">
            Итого к оплате: <span className="text-amber-950 font-bold">{totalOrderAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
          </div>
        </div>
      )}

      {/* 1. Regular Ingredients (COGS) */}
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

      {/* 2. One-off Purchases / Overhead Section */}
      <div className="px-6 py-2.5 bg-purple-50/70 border-t border-b border-purple-200/80 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-purple-950 uppercase tracking-wide">
            📦 Накладные расходы и хозтовары (Overhead / One-off)
          </span>
          <span className="text-[11px] text-purple-700 bg-purple-100/80 border border-purple-200 px-2 py-0.5 rounded-full font-medium">
            Разовые закупки (хозтовары, ремонт, упаковка) — сохраняются в tabular D1 как overhead
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCustomLines(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              name: '',
              overheadCategory: 'Supplies',
              unit: 'шт',
              ordered: 1,
              received: 0,
              unitCost: '',
              totalCost: '',
              costCategory: 'overhead',
              lastCostEdit: 'unit'
            }
          ])}
          className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          + Добавить расход / хозтовары
        </button>
      </div>

      {customLines.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-purple-900 bg-purple-50/40 border-b border-purple-100 font-medium">
              <th className="px-6 py-2.5">Название расхода / товара</th>
              <th className="px-4 py-2.5 w-48">Категория Overhead</th>
              <th className="px-4 py-2.5 w-24">Ед. изм.</th>
              <th className="px-4 py-2.5 w-24 text-right">Кол-во</th>
              {showCosts && (
                <>
                  <th className="px-4 py-2.5 w-36 text-right">Цена за ед. (₽)</th>
                  <th className="px-4 py-2.5 w-36 text-right">Сумма (₽)</th>
                </>
              )}
              {initialStatus === 'received' && <th className="px-4 py-2.5 w-28 text-right">Принято</th>}
              <th className="px-4 py-2.5 w-10 text-center"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customLines.map((c, i) => {
              const isOrdered = Number(c.ordered) > 0
              const hasZeroCost = isSupplierPurchase && isOrdered && !(Number(c.unitCost) > 0) && !(Number(c.totalCost) > 0)

              return (
                <tr key={c.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-purple-50/20 transition-colors ${hasZeroCost ? 'bg-red-50/40' : ''}`}>
                  <td className="px-6 py-2.5">
                    <input
                      type="text"
                      placeholder="Например: Мусорные пакеты, Перчатки, Ремонт кофемолки"
                      value={c.name}
                      onChange={e => updateCustomLine(i, { name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 w-48">
                    <select
                      value={c.overheadCategory || 'Supplies'}
                      onChange={e => updateCustomLine(i, { overheadCategory: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                    >
                      {OVERHEAD_CATEGORIES.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 w-24">
                    <input
                      type="text"
                      placeholder="шт"
                      value={c.unit}
                      onChange={e => updateCustomLine(i, { unit: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 w-24 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={c.ordered}
                      onChange={e => updateCustomLine(i, { ordered: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </td>
                  {showCosts && (
                    <>
                      <td className="px-4 py-2.5 w-36 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={c.unitCost}
                            onChange={e => updateCustomLine(i, { unitCost: e.target.value })}
                            className={`w-28 border rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 tabular-nums ${
                              hasZeroCost
                                ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500'
                                : 'border-gray-300 focus:ring-purple-500'
                            }`}
                          />
                          <span className="text-xs text-gray-400">₽</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 w-36 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                            value={c.totalCost}
                            onChange={e => updateCustomLine(i, { totalCost: e.target.value })}
                            className={`w-28 border rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 tabular-nums ${
                              hasZeroCost
                                ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500'
                                : 'border-gray-300 focus:ring-purple-500'
                            }`}
                          />
                          <span className="text-xs text-gray-400">₽</span>
                        </div>
                      </td>
                    </>
                  )}
                  {initialStatus === 'received' && (
                    <td className="px-4 py-2.5 w-28 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={c.received}
                        onChange={e => updateCustomLine(i, { received: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </td>
                  )}
                  <td className="px-4 py-2.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={() => setCustomLines(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-600 text-lg leading-none font-bold cursor-pointer"
                      title="Удалить"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}

      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <p className="text-xs text-gray-400">{t('po.suggestedNote')}</p>
          <button onClick={() => {
            const filled = {}
            lines.forEach(l => { filled[`${store}:${l.id}`] = l.suggested })
            setQtys(filled)
          }} className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer">
            {t('po.applySuggested')}
          </button>
        </div>
        <div className="flex items-center gap-6">
          {showCosts && (
            <div className="flex items-center gap-4 text-right">
              <div>
                <span className="text-[11px] text-gray-400 uppercase tracking-wide block">Сырьё (COGS)</span>
                <span className="text-xs font-semibold text-gray-700 tabular-nums">
                  {cogsSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                </span>
              </div>
              <div>
                <span className="text-[11px] text-purple-600 uppercase tracking-wide block">Накладные (Overhead)</span>
                <span className="text-xs font-semibold text-purple-800 tabular-nums">
                  {overheadSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                </span>
              </div>
              <div className="pl-2 border-l border-gray-200">
                <span className="text-xs text-gray-500 block">Итого к оплате:</span>
                <span className="text-base font-bold text-gray-900 tabular-nums">
                  {totalOrderAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">{t('common.cancel')}</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium cursor-pointer shadow-sm">
              {t('po.saveDraft')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
