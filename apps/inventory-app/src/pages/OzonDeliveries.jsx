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
        
        const tokens = items.map(it => it.str.trim()).filter(Boolean)
        
        for (let j = 0; j < tokens.length; j++) {
          const str = tokens[j]
          
          // Date extraction
          const monthMatch = str.match(/от\s+(\d{1,2})\s+([а-яА-Я]+)\s+(20[2-9]\d)/)
          if (monthMatch) {
            const mIndex = months.findIndex(m => monthMatch[2].toLowerCase().startsWith(m))
            if (mIndex >= 0) {
              currentDocumentDate = `${monthMatch[3]}-${String(mIndex + 1).padStart(2, '0')}-${String(monthMatch[1]).padStart(2, '0')}`
            }
          }
          const simpleMatch = str.match(/(?:от\s+)?(\d{2})\.(\d{2})\.(20[2-9]\d)/)
          if (simpleMatch && !str.includes('№1137') && !str.includes('№ 1137')) { // skip decree numbers
            currentDocumentDate = `${simpleMatch[3]}-${simpleMatch[2]}-${simpleMatch[1]}`
          }

          // Item extraction
          if (/^(шт|упак|кг|кор|набор)\.?$/i.test(str)) {
            const qtyStr = tokens[j + 1]
            if (!qtyStr) continue
            const qty = parseFloat(qtyStr.replace(/\s/g, '').replace(',', '.'))
            
            if (!isNaN(qty) && qty > 0) {
              let nameParts = []
              for (let k = j - 1; k >= Math.max(0, j - 8); k--) {
                const prev = tokens[k]
                if (prev === '-' || prev === '796' || prev === '166' || prev === '796.00') continue
                if (/^\d+$/.test(prev) && prev.length < 4) break // sequence number
                if (/^[A-Za-z0-9-]+$/.test(prev) && !/[А-Яа-я]/.test(prev) && prev.length < 15) break // article code
                if (['без ндс', 'х', 'без акциза'].includes(prev.toLowerCase())) break
                if (prev.includes('Всего к оплате') || prev.includes('Документ')) break
                
                nameParts.unshift(prev)
              }
              
              let rawName = nameParts.join(' ').replace(/\s+-\s*$/, '').trim()
              if (rawName.length > 3) {
                let mappedId = settings?.ozonMappings?.[rawName] || ''
                parsed.push({ rawName, qty, ingredientId: mappedId, date: currentDocumentDate })
              }
            }
          }
        }
      }
      
      if (parsed.length === 0) {
        alert('No items found in PDF. Please check the file format.')
      } else {
        setLines(parsed)
        if (parsed[0].date) setBatchDate(parsed[0].date)
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
    const groups = {}
    for (const l of lines) {
      if (!l.ingredientId || Number(l.qty) <= 0) continue
      
      if (settings?.ozonMappings?.[l.rawName] !== l.ingredientId) {
        updateOzonMapping?.(l.rawName, l.ingredientId)
      }
      
      const d = l.date || batchDate
      if (!groups[d]) groups[d] = []
      groups[d].push({
        ingredientId: Number(l.ingredientId),
        ordered: Number(l.qty),
        received: Number(l.qty)
      })
    }
    
    if (Object.keys(groups).length === 0) return alert('No valid mapped items to receive')

    let idOffset = 0
    for (const [d, groupLines] of Object.entries(groups)) {
      const pId = `OZON-${String((data._nextPoId || 1) + idOffset).padStart(3, '0')}`
      addPurchaseOrder({
        id: pId,
        store,
        lines: groupLines,
        status: 'received',
        createdDate: d,
        receivedDate: d,
        isOzon: true
      })
      idOffset++
    }
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
                <div className="flex-1 truncate" title={l.rawName}>
                  {l.rawName || 'Unknown Item'}
                  {l.date && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">{l.date}</span>}
                </div>
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
