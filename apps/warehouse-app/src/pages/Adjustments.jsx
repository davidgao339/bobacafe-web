import { useState } from 'react'
import { useConfig } from '../context/ConfigContext'
import { CheckCircle } from 'lucide-react'

const TODAY = new Date().toISOString().slice(0, 10)

export default function Adjustments() {
  const { config, addTransaction } = useConfig()
  
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
      reason: adjReason || (adjType === 'loss' ? 'Write-off' : 'Manual addition')
    })
    
    setAdjIngredient('')
    setAdjQty('')
    setAdjReason('')
    alert("Adjustment recorded!")
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Stock Adjustments</h1>

      <div className="space-y-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
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
          
          <button 
            onClick={submitAdjustment}
            disabled={!adjIngredient || !adjQty || parseFloat(adjQty) <= 0}
            className={`w-full py-3.5 font-medium rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors ${
              adjIngredient && adjQty && parseFloat(adjQty) > 0
                ? (adjType === 'loss' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700')
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <CheckCircle className="w-5 h-5" />
            Submit Adjustment
          </button>
      </div>
    </div>
  )
}
