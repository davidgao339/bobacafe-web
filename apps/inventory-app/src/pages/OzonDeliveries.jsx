import { useState, useRef } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export default function OzonDeliveries() {
  const { config, addPurchaseOrder, stores, data, updateOzonMapping, saveSettings, settings } = useConfig()
  const { t } = useLanguage()
  const [store, setStore] = useState(stores?.[0] || '')
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState([])
  const [isParsing, setIsParsing] = useState(false)
  
  const fileInputRef = useRef(null)

  const storeIngredients = config.ingredients.filter(i => !i.warehouseOnly)
  const pos = data.purchaseOrders?.filter(po => po.isOzon) || []
  const nextId = `OZON-${String((data._nextPoId || 1)).padStart(3, '0')}`

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setIsParsing(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      let parsed = []
      let parsedDate = null
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        
        // Sort items by roughly Y (desc), then X (asc)
        const items = content.items.sort((a, b) => {
          const yDiff = b.transform[5] - a.transform[5]
          if (Math.abs(yDiff) > 5) return yDiff
          return a.transform[4] - b.transform[4]
        })
        
        const exclusions = ['итого', 'наименование', 'грузоотправитель', 'поставщик', 'покупатель', 'сумма', 'ндс', 'всего']
        let currentName = ''
        
        for (const item of items) {
          const str = item.str.trim()
          if (!str) continue
          
          if (!parsedDate) {
            const dateMatch = str.match(/(\d{2})\.(\d{2})\.(\d{4})/)
            if (dateMatch) {
              parsedDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
            }
          }
          
          const lower = str.toLowerCase()
          if (exclusions.some(ex => lower.includes(ex))) {
            currentName = ''
            continue
          }
          
          const num = parseFloat(str.replace(',', '.'))
          if (!isNaN(num) && num > 0 && currentName.length > 5 && !/^[\d\s.,]+$/.test(currentName)) {
            // Found a number after a string, assume it's qty
            let mappedId = settings?.ozonMappings?.[currentName] || ''
            parsed.push({ rawName: currentName, qty: num, ingredientId: mappedId })
            currentName = ''
          } else if (isNaN(num)) {
            currentName = currentName ? currentName + ' ' + str : str
          }
        }
      }
      
      if (parsed.length === 0) {
        alert('No items found in PDF. Please check the file format.')
      } else {
        setLines(parsed)
        if (parsedDate) setBatchDate(parsedDate)
      }
    } catch (err) {
      console.error(err)
      alert('Error parsing PDF. Make sure it is a valid PDF document.')
    } finally {
      setIsParsing(false)
      e.target.value = null
    }
  }

  const handleSave = () => {
    const validLines = lines.filter(l => l.ingredientId && Number(l.qty) > 0).map(l => {
      // Save mapping
      if (settings?.ozonMappings?.[l.rawName] !== l.ingredientId) {
        updateOzonMapping?.(l.rawName, l.ingredientId)
      }
      return {
        ingredientId: Number(l.ingredientId),
        ordered: Number(l.qty),
        received: Number(l.qty)
      }
    })
    
    if (!validLines.length) return alert('No valid mapped items to receive')

    addPurchaseOrder({
      id: nextId,
      store,
      lines: validLines,
      status: 'received',
      createdDate: batchDate,
      receivedDate: batchDate,
      isOzon: true
    })
    setLines([])
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ozon Deliveries</h1>
          <p className="text-sm text-gray-500 mt-1">Upload Ozon PDF statements to receive items.</p>
        </div>
        <div className="flex gap-2">
          <input type="file" accept=".pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isParsing}
            className="px-4 py-2 bg-indigo-50 text-indigo-600 border border-indigo-200 text-sm rounded-lg hover:bg-indigo-100 flex items-center gap-2">
            {isParsing ? 'Parsing...' : 'Upload PDF'}
          </button>
        </div>
      </div>

      {(lines.length > 0 || isParsing) && (
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm mb-8">
          <h2 className="text-lg font-medium mb-4">Map & Receive Batch</h2>
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Store</label>
              <select value={store} onChange={e => setStore(e.target.value)} className="border border-gray-300 rounded px-3 py-2 w-full max-w-xs">
                {stores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Date</label>
              <input type="date" value={batchDate} onChange={e => setBatchDate(e.target.value)} className="border border-gray-300 rounded px-3 py-2 w-full max-w-xs" />
            </div>
          </div>
          
          <div className="space-y-2 mb-4">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 p-2 rounded">
                <div className="flex-1 truncate" title={l.rawName}>{l.rawName || 'Unknown Item'}</div>
                <select value={l.ingredientId} onChange={e => {
                  const n = [...lines]; n[i].ingredientId = e.target.value; setLines(n)
                }} className="border border-gray-300 rounded px-2 py-1 w-48 shrink-0">
                  <option value="">Skip item...</option>
                  {storeIngredients.map(ing => (
                    <option key={ing.id} value={ing.id}>{ing.name}</option>
                  ))}
                </select>
                <input type="number" placeholder="Qty" value={l.qty} onChange={e => {
                  const n = [...lines]; n[i].qty = e.target.value; setLines(n)
                }} className="border border-gray-300 rounded px-2 py-1 w-20 shrink-0" min="0" step="any" />
                <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-red-500 px-2 shrink-0">✕</button>
              </div>
            ))}
          </div>
          
          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Save & Receive</button>
          </div>
        </div>
      )}

      <h2 className="text-lg font-medium mb-4">Past Ozon Deliveries</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {pos.length === 0 && <p className="p-4 text-sm text-gray-500 text-center">No Ozon deliveries yet.</p>}
        {pos.map(po => (
          <div key={po.id} className="p-4 flex justify-between items-center">
            <div>
              <div className="font-medium text-sm">{po.id} <span className="text-gray-400 text-xs ml-2">{po.store}</span></div>
              <div className="text-xs text-gray-500 mt-1">{po.receivedDate} • {po.lines.length} items</div>
            </div>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Received</span>
          </div>
        ))}
      </div>
    </div>
  )
}
