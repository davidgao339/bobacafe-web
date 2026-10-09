import { useState, useRef, useEffect } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

export default function OzonDeliveries() {
  const { config, addPurchaseOrder, deletePurchaseOrder, stores, data, updateOzonMapping, saveSettings, settings } = useConfig()
  const { t } = useLanguage()
  const [store, setStore] = useState(stores?.[0] || '')
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState([])
  const [isParsing, setIsParsing] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [previewItem, setPreviewItem] = useState(null)
  
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
          if (simpleMatch && !str.includes('№1137') && !str.includes('№ 1137')) { // skip decree numbers
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
                if (/^\d+$/.test(prev) && prev.length < 4) break // sequence number
                if (/^[A-Za-z0-9-]+$/.test(prev) && !/[А-Яа-я]/.test(prev) && prev.length < 15) break // article code
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
                parsed.push({ 
                  rawName, qty, 
                  ingredientId: mappedId, 
                  multiplier,
                  ingredientName: mappedId ? storeIngredients.find(ing => ing.id == mappedId)?.name || '' : '',
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
        alert('No items found in PDF. Please check the file format.')
      } else {
        setLines(parsed)
        setPdfFile(file)
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
      
      const mult = Number(l.multiplier || 1)
      const currentMap = settings?.ozonMappings?.[l.rawName]
      const isCurrentObject = typeof currentMap === 'object' && currentMap !== null
      const currentId = isCurrentObject ? currentMap.id : currentMap
      const currentMult = isCurrentObject ? (currentMap.multiplier || 1) : 1
      
      const needsUpdate = !currentMap || currentId !== l.ingredientId || currentMult !== mult
      
      if (needsUpdate) {
        updateOzonMapping?.(l.rawName, l.ingredientId, mult)
      }
      
      const d = l.date || batchDate
      if (!groups[d]) groups[d] = []
      groups[d].push({
        ingredientId: Number(l.ingredientId),
        ordered: Number(l.qty) * mult,
        received: Number(l.qty) * mult,
        rawName: l.rawName,
        context: l.context
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
          <datalist id="ingredients-list">
            {storeIngredients.map(ing => <option key={ing.id} value={ing.name} />)}
          </datalist>
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
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm bg-gray-50 p-2 rounded">
                <div className="flex-1 min-w-0" title={l.rawName}>
                  <div className="truncate font-medium text-gray-800">
                    {l.rawName || 'Unknown Item'}
                    {l.date && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">{l.date}</span>}
                  </div>
                  {pdfFile && l.pageNum && (
                    <button onClick={() => setPreviewItem({ pageNum: l.pageNum, y: l.y })} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1 inline-flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      Preview in PDF
                    </button>
                  )}
                </div>
                
                <div className="w-full sm:w-64 shrink-0">
                  <input
                    type="text"
                    list="ingredients-list"
                    placeholder="Search/Map item..."
                    value={l.ingredientName || ''}
                    onChange={e => {
                      const name = e.target.value
                      const match = storeIngredients.find(ing => ing.name === name)
                      const n = [...lines]
                      n[i].ingredientName = name
                      n[i].ingredientId = match ? match.id : ''
                      setLines(n)
                    }}
                    className="border border-gray-300 rounded px-2 py-1 w-full"
                  />
                </div>
                <div className="flex items-center border border-gray-300 rounded overflow-hidden shrink-0">
                  <input type="number" title="Ozon Qty" value={l.qty} onChange={e => {
                    const n = [...lines]; n[i].qty = e.target.value; setLines(n)
                  }} className="px-2 py-1 w-16 text-center focus:outline-none border-r border-gray-200" min="0" step="any" />
                  <span className="text-gray-400 text-sm px-2 bg-gray-50">×</span>
                  <input type="number" title="Base units per Ozon item" value={l.multiplier || 1} onChange={e => {
                    const n = [...lines]; n[i].multiplier = e.target.value; setLines(n)
                  }} className="px-2 py-1 w-20 text-center focus:outline-none border-l border-gray-200" min="0" step="any" />
                </div>
                <div className="w-24 shrink-0 text-right text-sm text-gray-600 font-medium whitespace-nowrap">
                  = {Math.round((l.qty || 0) * (l.multiplier || 1))} {l.ingredientId ? storeIngredients.find(ing => ing.id === Number(l.ingredientId))?.unit : ''}
                </div>
                <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-red-500 px-2 shrink-0">✕</button>
              </div>
            ))}
          </div>
          
          <div className="flex gap-4 items-center mt-6 pt-4 border-t border-gray-100">
            <button onClick={() => {
              setLines([])
              setIsParsing(false)
              setPdfFile(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium text-sm">Cancel</button>
            <div className="flex-1"></div>
            
            {Array.from(new Set(lines.filter(l => l.date).map(l => l.date))).some(d => 
              pos.some(po => po.store === store && po.receivedDate === d)
            ) && (
              <div className="text-sm text-amber-700 bg-amber-50 px-3 py-1.5 rounded border border-amber-200 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                Warning: An Ozon delivery for {store} on this date already exists
              </div>
            )}
            
            <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm text-sm">
              Save & Receive
            </button>
          </div>
        </div>
      )}

      <h2 className="text-lg font-medium mb-4">Past Ozon Deliveries</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {pos.length === 0 && <p className="p-4 text-sm text-gray-500 text-center">No Ozon deliveries yet.</p>}
        {pos.map(po => (
          <div key={po.id} className="p-4 flex justify-between items-center hover:bg-gray-50">
            <div>
              <div className="font-medium text-sm text-gray-900">{po.id} <span className="text-gray-400 text-xs ml-2">{po.store}</span></div>
              <div className="text-xs text-gray-500 mt-1">{po.receivedDate} • {po.lines.length} items</div>
            </div>
            <div className="flex gap-4 items-center">
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Received</span>
              <button onClick={() => {
                if (confirm('Load this delivery back into the editor? This will delete the saved record so you can remap/re-save it.')) {
                  deletePurchaseOrder(po.id)
                  const restoredLines = po.lines.map(pl => ({
                    rawName: pl.rawName || 'Restored Item',
                    qty: pl.received || pl.ordered,
                    ingredientId: pl.ingredientId,
                    ingredientName: storeIngredients.find(i => i.id == pl.ingredientId)?.name || '',
                    date: po.receivedDate
                  }))
                  setLines(prev => [...prev, ...restoredLines])
                  setStore(po.store)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }
              }} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
              <button onClick={() => {
                if (confirm('Delete this Ozon delivery? This cannot be undone.')) {
                  deletePurchaseOrder(po.id)
                }
              }} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
            </div>
          </div>
        ))}
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
        
        context.fillStyle = 'rgba(250, 204, 21, 0.4)'; // yellow transparent
        context.fillRect(0, vpY - 30, canvas.width, 40); 
        
        // auto scroll to highlight
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
          <h3 className="font-semibold text-lg text-gray-800">PDF Verification — Page {pageNum}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-lg p-1.5">
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
