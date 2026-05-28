import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

export default function InventoryAudit() {
  const { config, data, addAudit } = useConfig()
  const { getLastAudit } = useCalcs()

  const [store,  setStore]  = useState(STORES[0])
  const [date,   setDate]   = useState(new Date().toISOString().slice(0, 10))
  const [counts, setCounts] = useState({})
  const [saved,  setSaved]  = useState(false)

  const lastAudit = getLastAudit(store)
  const lastAuditDate = lastAudit?.date ?? null

  const lastCount = (productId) => {
    if (!lastAudit) return '—'
    const v = lastAudit.counts[productId]
    return v != null ? v : '—'
  }

  const handleChange = (productId, val) => {
    setSaved(false)
    setCounts(prev => ({ ...prev, [`${store}-${productId}`]: val }))
  }

  const handleSave = () => {
    const auditCounts = {}
    for (const product of config.ingredients) {
      const val = getValue(product.id)
      if (val !== '') auditCounts[product.id] = parseFloat(val)
    }
    addAudit(store, date, auditCounts)
    setSaved(true)
    setCounts({})
    setTimeout(() => setSaved(false), 3500)
  }

  const getValue   = (productId) => counts[`${store}-${productId}`] ?? ''
  const allFilled  = config.ingredients.length > 0 && config.ingredients.every(p => getValue(p.id) !== '')

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Inventory Audit</h1>
        <p className="text-sm text-gray-500 mt-0.5">Enter physical counts after a store audit</p>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Store</label>
          <select value={store} onChange={e => { setStore(e.target.value); setSaved(false) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Audit Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-4 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <span className="col-span-2">Product</span>
          <span>
            Previous Count{' '}
            <span className="font-normal normal-case text-gray-400">
              {lastAuditDate ? `(${lastAuditDate})` : '(none)'}
            </span>
          </span>
          <span>New Count</span>
        </div>
        {config.ingredients.map((product, i) => {
          const prev  = lastCount(product.id)
          const val   = getValue(product.id)
          const delta = val !== '' && prev !== '—' ? parseFloat(val) - parseFloat(prev) : null

          return (
            <div key={product.id}
              className={`px-6 py-4 grid grid-cols-4 gap-4 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} border-b border-gray-100 last:border-0`}>
              <div className="col-span-2">
                <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{product.unit}</p>
              </div>
              <div className="text-sm text-gray-700 tabular-nums">
                {prev} <span className="text-gray-400 text-xs">{prev !== '—' ? product.unit : ''}</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="number" min="0" step="0.1" placeholder="0" value={val}
                  onChange={e => handleChange(product.id, e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums" />
                {delta !== null && (
                  <span className={`text-xs font-medium ${delta < 0 ? 'text-red-600' : delta > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setCounts({})} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
          Clear all
        </button>
        <div className="flex items-center gap-4">
          {saved && (
            <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
              Audit saved for {store}
            </span>
          )}
          <button onClick={handleSave} disabled={!allFilled}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
              allFilled ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}>
            Save Audit
          </button>
        </div>
      </div>
      {!allFilled && (
        <p className="text-xs text-gray-400 text-right mt-2">Fill in all products to save</p>
      )}
    </div>
  )
}
