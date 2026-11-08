import { useState, useRef, useEffect } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

const OVERHEAD_CATEGORIES = [
  { id: 'Supplies', label: 'Расходники / Хозтовары' },
  { id: 'Equipment', label: 'Оборудование / Ремонт' },
  { id: 'Packaging', label: 'Упаковка и полиграфия' },
  { id: 'Services', label: 'Услуги и сервис' },
  { id: 'General Overhead', label: 'Прочие накладные' },
]

export default function OzonDeliveries() {
  const { config, addPurchaseOrder, deletePurchaseOrder, data, updateOzonMapping, settings } = useConfig()
  const { t } = useLanguage()
  const store = 'Warehouse'
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState([])
  const [isParsing, setIsParsing] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  
  const fileInputRef = useRef(null)

  const storeIngredients = config.ingredients
  const pos = data.purchaseOrders?.filter(po => po.isOzon) || []

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setIsParsing(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      let parsed = []
      
      let currentDocumentDate = null
      const months = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        
        // Sort items by Y (desc), then X (asc)
        const items = content.items.sort((a, b) => {
          const yDiff = b.transform[5] - a.transform[5]
          if (Math.abs(yDiff) > 5) return yDiff
          return a.transform[4] - b.transform[4]
        })
        
        const tokens = items.map(it => ({ str: it.str.trim(), y: it.transform[5] })).filter(it => it.str)
        
        for (let j = 0; j < tokens.length; j++) {
          const { str, y } = tokens[j]
          
          // Date extraction
          const monthMatch = str.match(/от\s+(\d{1,2})\s+([а-яА-Я]+)\s+(20[2-9]\d)/)
          if (monthMatch) {
            const mIndex = months.findIndex(m => monthMatch[2].toLowerCase().startsWith(m))
            if (mIndex >= 0) {
              currentDocumentDate = `${monthMatch[3]}-${String(mIndex + 1).padStart(2, '0')}-${String(monthMatch[1]).padStart(2, '0')}`
            }
          }
          const simpleMatch = str.match(/(?:от\s+)?(\d{2})\.(\d{2})\.(20[2-9]\d)/)
          if (simpleMatch && !str.includes('№1137') && !str.includes('№ 1137')) {
            currentDocumentDate = `${simpleMatch[3]}-${simpleMatch[2]}-${simpleMatch[1]}`
          }

          // Item extraction
          if (/^(шт|упак|кг|кор|набор)\.?$/i.test(str)) {
            const qtyStr = tokens[j + 1]?.str
            if (!qtyStr) continue
            const qty = parseFloat(qtyStr.replace(/\s/g, '').replace(',', '.'))
            
            if (!isNaN(qty) && qty > 0) {
              let nameParts = []
              for (let k = j - 1; k >= Math.max(0, j - 8); k--) {
                const prev = tokens[k].str
                if (prev === '-' || prev === '796' || prev === '166' || prev === '796.00') continue
                if (/^\d+$/.test(prev) && prev.length < 4) break
                if (/^[A-Za-z0-9-]+$/.test(prev) && !/[А-Яа-я]/.test(prev) && prev.length < 15) break
                if (['без ндс', 'х', 'без акциза'].includes(prev.toLowerCase())) break
                if (prev.includes('Всего к оплате') || prev.includes('Документ')) break
                
                nameParts.unshift(prev)
              }
              
              let rawName = nameParts.join(' ').replace(/\s+-\s*$/, '').trim()
              if (rawName.length > 3) {
                const mapping = settings?.ozonMappings?.[rawName]
                let mappedId = ''
                let multiplier = 1
                if (mapping) {
                  if (typeof mapping === 'object') {
                    mappedId = mapping.id
                    multiplier = mapping.multiplier || 1
                  } else {
                    mappedId = mapping
                  }
                }

                // Auto match if name contains ingredient name
                if (!mappedId) {
                  const possible = config.ingredients.find(ing => ing.name && rawName.toLowerCase().includes(ing.name.toLowerCase()))
                  if (possible) mappedId = possible.id
                }

                const mappedIng = mappedId ? config.ingredients.find(ing => ing.id == mappedId) : null
                const defaultUnitCost = mappedIng?.costPerUnit || mappedIng?.lastPurchaseCost || ''
                const totalUnits = (qty || 0) * (multiplier || 1)
                const defaultTotalCost = (defaultUnitCost && totalUnits > 0) ? (Number(defaultUnitCost) * totalUnits).toFixed(2) : ''

                parsed.push({ 
                  id: String(Date.now() + Math.random()),
                  rawName, 
                  qty, 
                  itemType: 'cogs', // 'cogs' or 'overhead'
                  overheadCategory: 'Supplies',
                  ingredientId: mappedId, 
                  multiplier,
                  ingredientName: mappedIng?.name || '',
                  unitCost: defaultUnitCost ? String(defaultUnitCost) : '',
                  totalCost: defaultTotalCost ? String(defaultTotalCost) : '',
                  lastCostEdit: 'unit',
                  date: currentDocumentDate,
                  pageNum: i,
                  y: y
                })
              }
            }
          }
        }
      }
      
      if (parsed.length === 0) {
        alert('В PDF-файле не найдено строк с товарами. Проверьте формат документа.')
      } else {
        setLines(parsed)
        setPdfFile(file)
        if (parsed[0].date) setBatchDate(parsed[0].date)
      }
    } catch (err) {
      console.error(err)
      alert('Ошибка при чтении PDF. Убедитесь, что это корректный УПД / документ Ozon.')
    } finally {
      setIsParsing(false)
      e.target.value = null
    }
  }

  // Bidirectional cost handlers for Ozon lines
  const updateLine = (index, updates) => {
    setLines(prev => prev.map((item, idx) => {
      if (idx !== index) return item
      const next = { ...item, ...updates }

      const mult = next.itemType === 'overhead' ? 1 : (Number(next.multiplier) || 1)
      const count = (Number(next.qty) || 0) * mult

      if ('ingredientName' in updates) {
        const match = storeIngredients.find(ing => ing.name === updates.ingredientName)
        next.ingredientId = match ? match.id : ''
        if (match && (match.costPerUnit || match.lastPurchaseCost) && !next.unitCost) {
          const cost = String(match.costPerUnit || match.lastPurchaseCost)
          next.unitCost = cost
          if (count > 0) next.totalCost = (count * Number(cost)).toFixed(2)
        }
      } else if ('unitCost' in updates) {
        next.lastCostEdit = 'unit'
        if (count > 0 && updates.unitCost !== '') {
          const tot = count * Number(updates.unitCost)
          next.totalCost = isNaN(tot) ? '' : (Math.round(tot * 100) / 100).toFixed(2)
        } else if (updates.unitCost === '') {
          next.totalCost = ''
        }
      } else if ('totalCost' in updates) {
        next.lastCostEdit = 'total'
        if (count > 0 && updates.totalCost !== '') {
          const unit = Number(updates.totalCost) / count
          next.unitCost = isNaN(unit) ? '' : (Math.round(unit * 100) / 100).toFixed(2)
        } else if (updates.totalCost === '') {
          next.unitCost = ''
        }
      } else if ('qty' in updates || 'multiplier' in updates) {
        if (count > 0) {
          if (next.lastCostEdit === 'total' && next.totalCost != null && next.totalCost !== '') {
            const unit = Number(next.totalCost) / count
            next.unitCost = isNaN(unit) ? '' : (Math.round(unit * 100) / 100).toFixed(2)
          } else if (next.unitCost != null && next.unitCost !== '') {
            const tot = count * Number(next.unitCost)
            next.totalCost = isNaN(tot) ? '' : (Math.round(tot * 100) / 100).toFixed(2)
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
    if (l.itemType === 'overhead' || !l.ingredientId || Number(l.qty) <= 0) return acc
    const count = (Number(l.qty) || 0) * (Number(l.multiplier) || 1)
    const tot = Number(l.totalCost) || (count * (Number(l.unitCost) || 0))
    return acc + tot
  }, 0)

  const overheadSubtotal = lines.reduce((acc, l) => {
    if (l.itemType !== 'overhead' || Number(l.qty) <= 0) return acc
    const count = Number(l.qty) || 0
    const tot = Number(l.totalCost) || (count * (Number(l.unitCost) || 0))
    return acc + tot
  }, 0)

  const totalOzonAmount = cogsSubtotal + overheadSubtotal

  const handleSave = () => {
    // 1. Validation: check that mapped items have non-zero costs
    const activeLines = lines.filter(l => Number(l.qty) > 0 && (l.itemType === 'overhead' || l.ingredientId))
    if (activeLines.length === 0) {
      alert('Нет сопоставленных товаров для оприходования. Укажите ингредиент или выберите категорию накладных расходов.')
      return
    }

    const missingCost = activeLines.filter(l => !(Number(l.unitCost) > 0) && !(Number(l.totalCost) > 0))
    if (missingCost.length > 0) {
      const names = missingCost.map(l => l.rawName || l.ingredientName || 'Товар').slice(0, 5).join(', ')
      const extra = missingCost.length > 5 ? ` и еще ${missingCost.length - 5} поз.` : ''
      alert(
        `Ошибка валидации: Для закупки Ozon каждый товар обязан иметь цену или сумму больше 0 (non-zero cost).\n\n` +
        `Пожалуйста, укажите цену или сумму для позиций:\n• ${names}${extra}`
      )
      return
    }

    const groups = {}
    for (const l of lines) {
      if (Number(l.qty) <= 0) continue
      const isOverhead = l.itemType === 'overhead'
      if (!isOverhead && !l.ingredientId) continue

      const mult = isOverhead ? 1 : Number(l.multiplier || 1)
      const totalUnits = Number(l.qty) * mult
      const uCost = Number(l.unitCost) || (totalUnits > 0 && Number(l.totalCost) ? Number(l.totalCost) / totalUnits : 0)
      const tCost = Number(l.totalCost) || (totalUnits * uCost)

      // Update mapping cache for future Ozon imports
      if (!isOverhead && l.rawName) {
        const currentMap = settings?.ozonMappings?.[l.rawName]
        const currentId = typeof currentMap === 'object' ? currentMap?.id : currentMap
        const currentMult = typeof currentMap === 'object' ? currentMap?.multiplier : 1
        if (!currentMap || currentId !== l.ingredientId || currentMult !== mult) {
          updateOzonMapping?.(l.rawName, l.ingredientId, mult)
        }
      }

      const d = l.date || batchDate
      if (!groups[d]) groups[d] = { cogs: [], overhead: [] }

      if (isOverhead) {
        groups[d].overhead.push({
          id: String(Date.now() + Math.random()),
          name: l.rawName || 'Ozon overhead item',
          overheadCategory: l.overheadCategory || 'Supplies',
          unit: 'шт',
          ordered: totalUnits,
          received: totalUnits,
          unitCost: Math.round(uCost * 100) / 100,
          totalCost: Math.round(tCost * 100) / 100,
          costCategory: 'overhead'
        })
      } else {
        const ing = config.ingredients.find(i => i.id === Number(l.ingredientId))
        groups[d].cogs.push({
          ingredientId: Number(l.ingredientId),
          name: ing?.name || l.ingredientName,
          unit: ing?.unit || 'шт',
          ordered: totalUnits,
          received: totalUnits,
          unitCost: Math.round(uCost * 100) / 100,
          totalCost: Math.round(tCost * 100) / 100,
          costCategory: 'cogs',
          rawName: l.rawName
        })
      }
    }

    let idOffset = 0
    for (const [d, group] of Object.entries(groups)) {
      const pId = `OZON-${String((data._nextPoId || 1) + idOffset).padStart(3, '0')}`
      addPurchaseOrder({
        id: pId,
        store,
        orderType: 'vendor_order',
        fromLocation: null,
        lines: group.cogs,
        customLines: group.overhead,
        status: 'received',
        createdDate: d,
        receivedDate: d,
        receivedAt: d ? `${d}T12:00:00.000Z` : new Date().toISOString(),
        isOzon: true
      })
      idOffset++
    }

    setLines([])
    setPdfFile(null)
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Поставки Ozon</h1>
          <p className="text-sm text-gray-500 mt-1">Загрузка УПД / PDF отчетов Ozon с поддержкой цен и накладных расходов в tabular D1.</p>
        </div>
        <div className="flex gap-2">
          <input type="file" accept=".pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isParsing}
            className="px-4 py-2 bg-indigo-600 text-white font-medium text-sm rounded-lg hover:bg-indigo-700 flex items-center gap-2 shadow-sm cursor-pointer transition-colors">
            {isParsing ? 'Обработка...' : 'Загрузить PDF Ozon'}
          </button>
        </div>
      </div>

      {(lines.length > 0 || isParsing) && (
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
          <datalist id="ingredients-list">
            {storeIngredients.map(ing => <option key={ing.id} value={ing.name} />)}
          </datalist>
          
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-medium text-gray-900">Сопоставление и оприходование</h2>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-500">Склад: <strong>{store}</strong></span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Дата:</span>
                <input type="date" value={batchDate} onChange={e => setBatchDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
              </div>
            </div>
          </div>

          {/* Cost Summary Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-center justify-between flex-wrap gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Двунаправленный ввод: меняйте цену или сумму — пересчет автоматический</span>
              </div>
              <div className="flex items-center gap-3 text-amber-800">
                <span>Сырьё (COGS): <strong>{cogsSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong></span>
                <span>•</span>
                <span>Накладные (Overhead): <strong>{overheadSubtotal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</strong></span>
              </div>
            </div>
            <div className="font-semibold text-sm">
              Итого к оплате Ozon: <span className="text-amber-950 font-bold">{totalOzonAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
            </div>
          </div>
          
          <div className="space-y-2 mb-4">
            {lines.map((l, i) => {
              const isOverhead = l.itemType === 'overhead'
              const mult = isOverhead ? 1 : (Number(l.multiplier) || 1)
              const totalUnits = (Number(l.qty) || 0) * mult
              const hasZeroCost = totalUnits > 0 && !(Number(l.unitCost) > 0) && !(Number(l.totalCost) > 0)

              return (
                <div key={l.id || i} className={`flex flex-col lg:flex-row lg:items-center gap-2 text-sm p-3 rounded-lg border transition-colors ${hasZeroCost ? 'bg-red-50/50 border-red-200' : (isOverhead ? 'bg-purple-50/40 border-purple-200' : 'bg-gray-50 border-gray-200')}`}>
                  {/* Name & PDF preview */}
                  <div className="flex-1 min-w-0" title={l.rawName}>
                    <div className="truncate font-medium text-gray-800">
                      {l.rawName || 'Неизвестный товар'}
                      {l.date && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-normal">{l.date}</span>}
                    </div>
                    {pdfFile && l.pageNum && (
                      <button onClick={() => setPreviewItem({ pageNum: l.pageNum, y: l.y })} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-0.5 inline-flex items-center gap-1 cursor-pointer">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        Показать в PDF
                      </button>
                    )}
                  </div>

                  {/* Type Selector (COGS vs Overhead) */}
                  <div className="w-36 shrink-0">
                    <select
                      value={l.itemType || 'cogs'}
                      onChange={e => updateLine(i, { itemType: e.target.value })}
                      className={`w-full border rounded-lg px-2 py-1 text-xs font-medium focus:outline-none focus:ring-2 bg-white ${isOverhead ? 'border-purple-300 text-purple-800 focus:ring-purple-500' : 'border-gray-300 text-gray-700 focus:ring-blue-500'}`}
                    >
                      <option value="cogs">🥗 Сырьё (COGS)</option>
                      <option value="overhead">📦 Накладные</option>
                    </select>
                  </div>
                  
                  {/* Mapping: Ingredient OR Overhead Category */}
                  {!isOverhead ? (
                    <div className="w-full sm:w-60 shrink-0">
                      <input
                        type="text"
                        list="ingredients-list"
                        placeholder="Поиск ингредиента..."
                        value={l.ingredientName || ''}
                        onChange={e => updateLine(i, { ingredientName: e.target.value })}
                        className="border border-gray-300 rounded-lg px-2.5 py-1 w-full text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      />
                    </div>
                  ) : (
                    <div className="w-full sm:w-60 shrink-0">
                      <select
                        value={l.overheadCategory || 'Supplies'}
                        onChange={e => updateLine(i, { overheadCategory: e.target.value })}
                        className="border border-purple-300 rounded-lg px-2.5 py-1 w-full text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white text-purple-900"
                      >
                        {OVERHEAD_CATEGORIES.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Quantity & Multiplier */}
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden shrink-0 bg-white">
                    <input type="number" title="Количество в накладной" value={l.qty} onChange={e => updateLine(i, { qty: e.target.value })} className="px-2 py-1 w-14 text-center focus:outline-none border-r border-gray-200 text-xs" min="0" step="any" />
                    {!isOverhead && (
                      <>
                        <span className="text-gray-400 text-xs px-1.5 bg-gray-50">×</span>
                        <input type="number" title="Множитель (ед. за штуку)" value={l.multiplier || 1} onChange={e => updateLine(i, { multiplier: e.target.value })} className="px-1.5 py-1 w-14 text-center focus:outline-none border-l border-gray-200 text-xs" min="0" step="any" />
                      </>
                    )}
                  </div>

                  <div className="w-20 shrink-0 text-right text-xs text-gray-600 font-medium whitespace-nowrap tabular-nums">
                    = {Math.round(totalUnits * 10) / 10} {!isOverhead && l.ingredientId ? (config.ingredients.find(ing => ing.id === Number(l.ingredientId))?.unit || '') : 'шт'}
                  </div>

                  {/* Bidirectional Cost Inputs */}
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Цена (₽)"
                      title="Цена за единицу"
                      value={l.unitCost}
                      onChange={e => updateLine(i, { unitCost: e.target.value })}
                      className={`w-20 border rounded-lg px-2 py-1 text-right text-xs tabular-nums focus:outline-none focus:ring-2 ${hasZeroCost ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500' : 'border-gray-300 bg-white focus:ring-blue-500'}`}
                    />
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Сумма (₽)"
                      title="Общая сумма по строке"
                      value={l.totalCost}
                      onChange={e => updateLine(i, { totalCost: e.target.value })}
                      className={`w-24 border rounded-lg px-2 py-1 text-right text-xs tabular-nums focus:outline-none focus:ring-2 ${hasZeroCost ? 'border-red-400 bg-red-50 text-red-900 font-semibold focus:ring-red-500' : 'border-gray-300 bg-white focus:ring-blue-500'}`}
                    />
                  </div>

                  <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 px-1 shrink-0 cursor-pointer text-base">✕</button>
                </div>
              )
            })}
          </div>
          
          <div className="flex gap-4 items-center mt-6 pt-4 border-t border-gray-100 flex-wrap">
            <button onClick={() => {
              setLines([])
              setIsParsing(false)
              setPdfFile(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium text-sm cursor-pointer">Отмена</button>
            <div className="flex-1"></div>
            
            <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm text-sm cursor-pointer transition-colors">
              Сохранить и оприходовать
            </button>
          </div>
        </div>
      )}

      <h2 className="text-lg font-medium mb-4 text-gray-900">История поставок Ozon</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100 shadow-sm">
        {pos.length === 0 && <p className="p-6 text-sm text-gray-500 text-center">Пока нет сохраненных поставок Ozon.</p>}
        {pos.map(po => {
          const cogsTotal = po.lines.reduce((s, l) => s + ((Number(l.unitCost) || 0) * (Number(l.received) || Number(l.ordered) || 0)), 0)
          const overheadTotal = (po.customLines || []).reduce((s, c) => s + ((Number(c.unitCost) || 0) * (Number(c.received) || Number(c.ordered) || 0)), 0)
          const totalCost = cogsTotal + overheadTotal
          const totalCount = po.lines.filter(l => (l.received || l.ordered) > 0).length + (po.customLines?.filter(c => (c.received || c.ordered) > 0).length || 0)

          return (
            <div key={po.id} className="p-4 flex justify-between items-center hover:bg-gray-50 flex-wrap gap-3">
              <div>
                <div className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                  <span>{po.id}</span>
                  <span className="text-gray-400 text-xs font-normal">{po.store}</span>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full font-medium">Ozon Delivery</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                  <span>{po.receivedDate}</span>
                  <span>•</span>
                  <span>{totalCount} поз.</span>
                  {totalCost > 0 && (
                    <>
                      <span>•</span>
                      <span className="font-semibold text-gray-800 tabular-nums">Сумма: {totalCost.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Принято</span>
                <button onClick={() => {
                  if (confirm('Удалить эту поставку Ozon?')) {
                    deletePurchaseOrder(po.id)
                  }
                }} className="text-sm text-red-600 hover:text-red-800 font-medium cursor-pointer">Удалить</button>
              </div>
            </div>
          )
        })}
      </div>
      {previewItem && <PdfPreviewModal file={pdfFile} pageNum={previewItem.pageNum} highlightY={previewItem.y} onClose={() => setPreviewItem(null)} />}
    </div>
  )
}

function PdfPreviewModal({ file, pageNum, highlightY, onClose }) {
  const canvasRef = useRef(null)
  
  useEffect(() => {
    if (!file) return;
    let renderTask = null;
    (async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        
        const [, vpY] = viewport.convertToViewportPoint(0, highlightY);
        
        context.fillStyle = 'rgba(250, 204, 21, 0.4)';
        context.fillRect(0, vpY - 30, canvas.width, 40); 
        
        const container = canvas.parentElement;
        if (container) {
          container.scrollTop = Math.max(0, vpY - container.clientHeight / 2);
        }
      } catch (e) {
        console.error('PDF preview error:', e);
      }
    })();
    return () => {
      if (renderTask) renderTask.cancel();
    }
  }, [file, pageNum, highlightY])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-full max-w-5xl w-full">
        <div className="flex justify-between items-center p-4 border-b bg-gray-50">
          <h3 className="font-semibold text-lg text-gray-800">Просмотр PDF — Страница {pageNum}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-lg p-1.5 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-4 overflow-auto bg-gray-200 flex-1 flex justify-center h-[80vh]">
          <canvas ref={canvasRef} className="shadow-lg bg-white" />
        </div>
      </div>
    </div>
  )
}
