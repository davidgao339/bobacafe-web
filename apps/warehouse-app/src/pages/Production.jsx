import { useState, useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { PlusCircle, Package, ArrowDown, ArrowUp, X, CheckCircle, AlertTriangle, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

const TODAY = new Date().toISOString().slice(0, 10)

export default function Production({ role }) {
  const { config, data, addTransaction, deleteProductionEvent } = useConfig()
  
  const [isCreating, setIsCreating] = useState(false)
  const [expanded, setExpanded] = useState({})
  
  const [outputId, setOutputId] = useState('')
  const [outputQty, setOutputQty] = useState('')
  const [search, setSearch] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const ingredients = config.ingredients || []
  const products = ingredients.filter(i => config.recipes?.[i.name])

  const selectedProduct = ingredients.find(i => i.id === Number(outputId))
  const recipe = selectedProduct ? config.recipes?.[selectedProduct.name] : null
  const hasRecipe = recipe && Object.keys(recipe).length > 0
  
  const qtyNum = parseFloat(outputQty) || 0

  const isValid = selectedProduct && hasRecipe && qtyNum > 0

  const handleSubmit = () => {
    if (!isValid) return
    
    const prodId = `PROD-${Date.now()}`

    addTransaction({
      ingredientId: Number(outputId),
      store: 'Warehouse',
      date: TODAY,
      type: 'production',
      quantity: qtyNum,
      poId: prodId,
      reason: selectedProduct.name
    })

    Object.entries(recipe).forEach(([ingIdStr, qtyPerUnit]) => {
      const ingId = Number(ingIdStr)
      const inputQty = qtyPerUnit * qtyNum
      addTransaction({
        ingredientId: ingId,
        store: 'Warehouse',
        date: TODAY,
        type: 'production',
        quantity: -inputQty,
        poId: prodId,
        reason: selectedProduct.name
      })
    })

    setOutputId('')
    setOutputQty('')
    setIsCreating(false)
  }

  const productionEvents = useMemo(() => {
    const prods = data.transactions.filter(t => t.type === 'production')
    const grouped = {}
    for (const p of prods) {
      if (!p.poId) continue
      if (!grouped[p.poId]) {
        grouped[p.poId] = { id: p.poId, date: p.date, timestamp: p.timestamp, yield: null, usages: [] }
      }
      if (p.quantity > 0) {
        grouped[p.poId].yield = p
      } else {
        grouped[p.poId].usages.push(p)
      }
    }
    return Object.values(grouped).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [data.transactions])

  const ingredientName = (id) => ingredients.find(p => p.id === id)?.name ?? 'Unknown'
  const ingredientUnit = (id) => ingredients.find(p => p.id === id)?.unit ?? ''

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Production History</h1>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 text-sm font-medium rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          New Production
        </button>
      </div>
      
      {productionEvents.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium mb-1">No production events</h3>
          <p className="text-gray-500 text-sm">Click "New Production" to record finished goods.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {productionEvents.map(ev => {
            const isExpanded = expanded[ev.id]
            return (
              <div key={ev.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div 
                  className={`flex items-center justify-between cursor-pointer ${isExpanded ? 'mb-4 pb-4 border-b border-gray-50' : ''}`}
                  onClick={() => setExpanded(prev => ({ ...prev, [ev.id]: !prev[ev.id] }))}
                >
                  <div className="flex items-center gap-3">
                    <button className="text-gray-400 hover:bg-gray-50 p-1 rounded">
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">{ev.id}</span>
                        <span className="text-sm font-medium text-gray-900">{ev.date}</span>
                        {!isExpanded && ev.yield && (
                          <span className="ml-2 text-xs font-medium text-gray-500 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                            {ingredientName(ev.yield.ingredientId)} (+{ev.yield.quantity})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">Created: {new Date(ev.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                  {role !== 'cook' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm("Delete this production event? This will reverse the inventory changes.")) {
                          deleteProductionEvent(ev.id)
                        }
                      }}
                      className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete event"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {isExpanded && (
                  <div className="flex flex-col md:flex-row gap-6 ml-10">
                    <div className="flex-1">
                      <h4 className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wider flex items-center gap-1">
                        <ArrowUp className="w-3 h-3" /> Yield
                      </h4>
                      {ev.yield ? (
                        <div className="bg-green-50/50 rounded-lg p-3 border border-green-100 flex justify-between items-center">
                          <span className="text-sm font-medium text-gray-800">{ingredientName(ev.yield.ingredientId)}</span>
                          <div className="text-right">
                            <span className="text-sm font-bold text-green-700">+{ev.yield.quantity}</span>
                            <span className="text-xs text-gray-500 ml-1">{ingredientUnit(ev.yield.ingredientId)}</span>
                          </div>
                        </div>
                      ) : <div className="text-sm text-gray-400">No yield recorded</div>}
                    </div>
                    
                    <div className="flex-1">
                      <h4 className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wider flex items-center gap-1">
                        <ArrowDown className="w-3 h-3" /> Usage
                      </h4>
                      <div className="space-y-2">
                        {ev.usages.map(u => (
                          <div key={u.id} className="bg-amber-50/50 rounded-lg p-3 border border-amber-100 flex justify-between items-center">
                            <span className="text-sm font-medium text-gray-800">{ingredientName(u.ingredientId)}</span>
                            <div className="text-right">
                              <span className="text-sm font-bold text-amber-700">{Math.abs(u.quantity)}</span>
                              <span className="text-xs text-gray-500 ml-1">{ingredientUnit(u.ingredientId)}</span>
                            </div>
                          </div>
                        ))}
                        {ev.usages.length === 0 && <div className="text-sm text-gray-400">No usage recorded</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {isCreating && (
        <div className="fixed inset-0 bg-gray-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h2 className="text-lg font-bold text-gray-900">Record Production</h2>
              <button onClick={() => setIsCreating(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
                <div className="px-4 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2 rounded-t-xl">
                  <ArrowUp className="w-4 h-4 text-green-600" />
                  <h2 className="text-sm font-semibold text-green-800">Output (Finished Good)</h2>
                </div>
                <div className="p-4 space-y-4">
                  <div className="relative">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Select Product to Produce</label>
                    <div className="relative">
                      <input 
                        type="text"
                        placeholder="Type to search products..."
                        value={
                          outputId 
                            ? (products.find(p => p.id === Number(outputId))?.name || '') 
                            : search
                        }
                        onChange={e => {
                          setSearch(e.target.value)
                          setOutputId('')
                          setIsOpen(true)
                        }}
                        onFocus={() => setIsOpen(true)}
                        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                      />
                      {isOpen && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                          {products
                            .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
                            .map(ing => (
                              <button
                                key={ing.id}
                                onMouseDown={() => {
                                  setOutputId(String(ing.id))
                                  setSearch('')
                                  setIsOpen(false)
                                }}
                                className="w-full text-left px-4 py-2 text-sm hover:bg-green-50 text-gray-700 focus:bg-green-50 focus:outline-none"
                              >
                                {ing.name}
                              </button>
                            ))}
                          {products.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).length === 0 && (
                            <div className="px-4 py-2 text-sm text-gray-500">No products found</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedProduct && !hasRecipe && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-medium text-orange-800">Missing Recipe</h3>
                        <p className="text-xs text-orange-700 mt-1">
                          This product does not have a recipe mapped. You cannot produce this item until you set up its ingredients in the <strong>Recipes</strong> tab.
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedProduct && hasRecipe && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Quantity Produced ({selectedProduct.unit})</label>
                      <input 
                        type="number" 
                        min="0" step="0.1"
                        value={outputQty}
                        onChange={e => setOutputQty(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="0.0"
                      />
                    </div>
                  )}
                </div>
              </div>

              {selectedProduct && hasRecipe && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
                  <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2 rounded-t-xl">
                    <ArrowDown className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-blue-800">Inputs (Automatically Calculated)</h2>
                  </div>
                  <div className="p-4 space-y-3">
                    {Object.entries(recipe).map(([ingIdStr, qtyPerUnit]) => {
                      const ing = ingredients.find(i => i.id === Number(ingIdStr))
                      const inputQty = (qtyPerUnit * qtyNum).toFixed(2)
                      return (
                        <div key={ingIdStr} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
                          <span className="text-sm font-medium text-gray-700">{ing?.name || 'Unknown'}</span>
                          <div className="text-right">
                            <span className="text-sm font-bold text-gray-900">{inputQty}</span>
                            <span className="text-xs text-gray-500 ml-1">{ing?.unit}</span>
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-xs text-gray-400 mt-2 text-center">
                      These ingredients will be automatically deducted from your inventory.
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button 
                onClick={() => setIsCreating(false)}
                className="flex-1 py-2.5 font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                onClick={handleSubmit}
                disabled={!isValid}
                className={`flex-1 py-2.5 font-medium rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors ${
                  isValid 
                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

