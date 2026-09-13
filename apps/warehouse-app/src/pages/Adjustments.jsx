import { useState, useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { PlusCircle, FileBox, X, CheckCircle, Trash2, ArrowUp, ArrowDown } from 'lucide-react'

const TODAY = new Date().toISOString().slice(0, 10)

export default function Adjustments({ role }) {
  const { config, data, addTransaction, deleteTransaction } = useConfig()
  
  const [isCreating, setIsCreating] = useState(false)
  
  // Adjustment state
  const [adjIngredient, setAdjIngredient] = useState('')
  const [adjQty, setAdjQty] = useState('')
  const [adjType, setAdjType] = useState('loss') // 'loss' or 'gain'
  const [adjReason, setAdjReason] = useState('')

  const ingredients = config.ingredients || []
  
  const submitAdjustment = () => {
    if (!adjIngredient || !adjQty || parseFloat(adjQty) <= 0) return
    
    addTransaction({
      ingredientId: Number(adjIngredient),
      store: 'Warehouse',
      date: TODAY,
      type: 'adjustment',
      quantity: adjType === 'loss' ? -parseFloat(adjQty) : parseFloat(adjQty),
      poId: `ADJ-${Date.now()}`,
      reason: adjReason || (adjType === 'loss' ? 'Write-off' : 'Manual addition')
    })
    
    setAdjIngredient('')
    setAdjQty('')
    setAdjReason('')
    setIsCreating(false)
  }

  const adjustmentEvents = useMemo(() => {
    return data.transactions
      .filter(t => t.type === 'adjustment' && (!t.poId || String(t.poId).startsWith('ADJ-')))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [data.transactions])

  const ingredientName = (id) => ingredients.find(p => p.id === id)?.name ?? 'Unknown'
  const ingredientUnit = (id) => ingredients.find(p => p.id === id)?.unit ?? ''

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Adjustment History</h1>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 text-sm font-medium rounded-lg shadow-sm hover:bg-blue-700 transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          New Adjustment
        </button>
      </div>

      {adjustmentEvents.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <FileBox className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-gray-900 font-medium mb-1">No adjustment events</h3>
          <p className="text-gray-500 text-sm">Click "New Adjustment" to record stock changes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {adjustmentEvents.map(ev => (
            <div key={ev.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {ev.poId && <span className="text-xs font-mono bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">{ev.poId}</span>}
                  <span className="text-sm font-medium text-gray-900">{ev.date}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded border ${ev.quantity > 0 ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                    {ev.quantity > 0 ? '+' : ''}{ev.quantity} {ingredientUnit(ev.ingredientId)}
                  </span>
                  <span className="text-sm text-gray-700 font-medium ml-1">{ingredientName(ev.ingredientId)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                  <span>{ev.reason}</span>
                  <span>•</span>
                  <span>{new Date(ev.timestamp).toLocaleString()}</span>
                </div>
              </div>
              
              {role !== 'cook' && (
                <button 
                  onClick={() => {
                    if (window.confirm("Delete this adjustment? This will reverse the inventory changes.")) {
                      deleteTransaction(ev.id)
                    }
                  }}
                  className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete adjustment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isCreating && (
        <div className="fixed inset-0 bg-gray-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h2 className="text-lg font-bold text-gray-900">Record Adjustment</h2>
              <button onClick={() => setIsCreating(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setAdjType('loss')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      adjType === 'loss' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Write-off / Loss
                  </button>
                  <button 
                    onClick={() => setAdjType('gain')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                      adjType === 'gain' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Found / Correction
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Ingredient</label>
                <select 
                  value={adjIngredient} 
                  onChange={e => setAdjIngredient(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select ingredient...</option>
                  {ingredients.map(ing => (
                    <option key={ing.id} value={ing.id}>{ing.name}</option>
                  ))}
                </select>
              </div>

              {adjIngredient && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Quantity ({ingredients.find(i => i.id === Number(adjIngredient))?.unit})</label>
                  <input 
                    type="number" 
                    min="0" step="0.1"
                    value={adjQty}
                    onChange={e => setAdjQty(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.0"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reason (Optional)</label>
                <input 
                  type="text" 
                  value={adjReason}
                  onChange={e => setAdjReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={adjType === 'loss' ? 'e.g. Expired, spilled' : 'e.g. Inventory count correction'}
                />
              </div>
            </div>
            
            <div className="p-5 border-t border-gray-100 bg-gray-50 flex gap-3">
              <button 
                onClick={() => setIsCreating(false)}
                className="flex-1 py-2.5 font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button 
                onClick={submitAdjustment}
                disabled={!adjIngredient || !adjQty || parseFloat(adjQty) <= 0}
                className={`flex-1 py-2.5 font-medium rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors ${
                  adjIngredient && adjQty && parseFloat(adjQty) > 0
                    ? (adjType === 'loss' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700')
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <CheckCircle className="w-5 h-5" />
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
