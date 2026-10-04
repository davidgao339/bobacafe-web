import { useState, useEffect } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import { useConfig } from '../../context/ConfigContext'

export default function OzonMatcher({ parsedItems, pos, onConfirm, onCancel }) {
  const { t } = useLanguage()
  const { config, settings, updateOzonMapping } = useConfig()
  
  const candidatePos = pos.filter(p => p.status === 'sent' || p.status === 'partially_received')
  const [selectedPoId, setSelectedPoId] = useState(candidatePos[0]?.id || '')
  const [mappings, setMappings] = useState({})

  useEffect(() => {
    const selectedPo = candidatePos.find(p => p.id === selectedPoId)
    if (!selectedPo) return
    const poIngredientIds = new Set(selectedPo.lines.map(l => l.ingredientId))
    const initialMappings = {}
    
    parsedItems.forEach((item, idx) => {
      let mappedId = settings.ozonMappings?.[item.rawName]
      if (!mappedId) {
        const possible = config.ingredients.find(i => i.name && item.rawName.toLowerCase().includes(i.name.toLowerCase()))
        if (possible) mappedId = possible.id
      }
      if (mappedId && poIngredientIds.has(mappedId)) {
        initialMappings[idx] = mappedId
      }
    })
    setMappings(initialMappings)
  }, [selectedPoId, parsedItems, settings.ozonMappings, config.ingredients, candidatePos])

  const handleConfirm = () => {
    const receiveQtys = {}
    parsedItems.forEach((item, idx) => {
      const ingId = mappings[idx]
      if (ingId) {
        receiveQtys[ingId] = (receiveQtys[ingId] || 0) + item.rawQty
        if (settings.ozonMappings?.[item.rawName] !== ingId) {
          updateOzonMapping(item.rawName, ingId)
        }
      }
    })
    onConfirm({ poId: selectedPoId, receiveQtys })
  }

  const selectedPo = candidatePos.find(p => p.id === selectedPoId)

  if (candidatePos.length === 0) {
    return (
      <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
        <p className="text-gray-500 mb-4">{t('po.ozonNoPoFound') || 'No sent or partially received wishlists available.'}</p>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">{t('common.cancel')}</button>
      </div>
    )
  }

  return (
    <div className="bg-white border border-blue-200 rounded-xl shadow-md overflow-hidden mb-8">
      <div className="p-4 border-b border-gray-100 bg-blue-50 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-blue-900">Map Ozon Delivery</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>
      
      <div className="p-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">Select Purchase Order (Wishlist)</label>
        <select 
          value={selectedPoId} 
          onChange={e => setSelectedPoId(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
        >
          {candidatePos.map(po => (
            <option key={po.id} value={po.id}>{po.id} — {po.store} ({t(`po.${po.status}`) || po.status})</option>
          ))}
        </select>
        
        {selectedPo && (
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 font-medium">Delivered Item (Ozon)</th>
                  <th className="px-4 py-3 font-medium text-right">Delivered Qty</th>
                  <th className="px-4 py-3 font-medium">Matches to Wishlist Item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsedItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-800 break-words max-w-xs">{item.rawName}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-600 tabular-nums">{item.rawQty}</td>
                    <td className="px-4 py-3">
                      <select
                        value={mappings[idx] || ''}
                        onChange={e => setMappings(prev => ({ ...prev, [idx]: e.target.value }))}
                        className={`w-full max-w-sm border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mappings[idx] ? 'border-green-300 bg-green-50' : 'border-gray-300'}`}
                      >
                        <option value="">-- Ignore / Do not receive --</option>
                        {selectedPo.lines.filter(l => l.ordered > 0).map(l => {
                          const ing = config.ingredients.find(i => i.id === l.ingredientId)
                          return <option key={l.ingredientId} value={l.ingredientId}>{ing ? ing.name : l.ingredientId} (Requested: {l.ordered})</option>
                        })}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        <div className="mt-6 flex justify-end gap-3 pt-4">
          <button onClick={onCancel} className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium">{t('common.cancel')}</button>
          <button onClick={handleConfirm} className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium shadow-sm">
            Review Receipt →
          </button>
        </div>
      </div>
    </div>
  )
}
