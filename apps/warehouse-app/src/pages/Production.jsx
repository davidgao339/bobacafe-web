import { useState } from 'react'
import { useConfig } from '../context/ConfigContext'
import { PlusCircle, Package, ArrowDown, ArrowUp, X, CheckCircle, AlertTriangle } from 'lucide-react'


const TODAY = new Date().toISOString().slice(0, 10)

export default function Production() {
  const { config, addTransaction } = useConfig()
  
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
    
    // Add positive transaction for output
    addTransaction({
      ingredientId: Number(outputId),
      store: 'Warehouse',
      date: TODAY,
      type: 'adjustment',
      quantity: qtyNum,
      reason: 'Produced in warehouse'
    })

    // Add negative transactions for inputs based on recipe
    Object.entries(recipe).forEach(([ingIdStr, qtyPerUnit]) => {
      const ingId = Number(ingIdStr)
      const inputQty = qtyPerUnit * qtyNum
      addTransaction({
        ingredientId: ingId,
        store: 'Warehouse',
        date: TODAY,
        type: 'adjustment',
        quantity: -inputQty,
        reason: `Consumed for producing ${selectedProduct.name}`
      })
    })

    // Reset form
    setOutputId('')
    setOutputQty('')
    alert("Production recorded successfully!")
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Production</h1>
      
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
                        onClick={() => {
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
              These ingredients will be automatically deducted from your inventory. If you need to record a spill or mistake, use the Adjustments tab.
            </p>
          </div>
        </div>
      )}

      <button 
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full py-3.5 font-medium rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors ${
          isValid 
            ? 'bg-blue-600 text-white hover:bg-blue-700' 
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        }`}
      >
        <CheckCircle className="w-5 h-5" />
        Record Production
      </button>
    </div>
  )
}
