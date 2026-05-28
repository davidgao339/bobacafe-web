import { useState } from 'react'
import { useConfig } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

const TODAY = new Date().toISOString().slice(0, 10)

const REASONS = [
  { id: 'spilled',  label: 'Spilled or overcooked', desc: 'Dropped, knocked over, boiled dry', type: 'waste',     icon: '💧' },
  { id: 'expired',  label: 'Expired — threw it out', desc: 'Past use-by date or gone bad',     type: 'write_off', icon: '🗑️' },
  { id: 'damaged',  label: 'Damaged packaging',      desc: 'Torn bag, broken bottle, crush',   type: 'write_off', icon: '📦' },
]

function ProgressBar({ step, total = 4 }) {
  return (
    <div className="flex items-center gap-2 mb-10">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i < step ? 'bg-blue-500' : 'bg-gray-200'}`} />
      ))}
      <span className="text-xs text-gray-400 whitespace-nowrap">Step {step} of {total}</span>
    </div>
  )
}

export default function LogLoss() {
  const { config, addTransaction } = useConfig()
  const [step,      setStep]      = useState(1)
  const [store,     setStore]     = useState(null)
  const [reasonId,  setReasonId]  = useState(null)
  const [productId, setProductId] = useState(null)
  const [qty,       setQty]       = useState('')
  const [done,      setDone]      = useState(false)

  const selectedReason  = REASONS.find(r => r.id === reasonId)
  const selectedProduct = config.ingredients.find(p => p.id === productId)

  const reset = () => {
    setStep(1); setStore(null); setReasonId(null); setProductId(null); setQty(''); setDone(false)
  }

  const handleSubmit = () => {
    addTransaction({
      store,
      ingredientId: productId,
      date: TODAY,
      quantity: parseFloat(qty),
      type: selectedReason.type,
      notes: selectedReason.label,
    })
    setDone(true)
  }

  if (done) {
    return (
      <div className="p-8 flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-10 text-center max-w-sm w-full">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-green-800 mb-3">Logged!</h2>
          <p className="text-green-700 text-sm leading-relaxed mb-1">
            <strong>{qty} {selectedProduct?.unit}</strong> of <strong>{selectedProduct?.name}</strong>
          </p>
          <p className="text-green-600 text-sm mb-8">{selectedReason?.label} · {store}</p>
          <div className="flex flex-col gap-2.5">
            <button onClick={reset}
              className="w-full px-4 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 transition-colors">
              Log another loss
            </button>
            <button onClick={reset}
              className="w-full px-4 py-3 bg-white border border-green-200 text-green-700 rounded-xl text-sm font-medium hover:bg-green-50 transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Log a Loss</h1>
        <p className="text-sm text-gray-500 mt-0.5">Record spills, expired stock, or damaged items</p>
      </div>

      <ProgressBar step={step} />

      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-5">Which store are you at?</h2>
          <div className="flex flex-col gap-3">
            {STORES.map(s => (
              <button key={s} onClick={() => { setStore(s); setStep(2) }}
                className="w-full text-left px-6 py-4 bg-white border-2 border-gray-200 rounded-xl text-base font-medium text-gray-800 hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-1">What happened?</h2>
          <p className="text-sm text-gray-400 mb-5">{store}</p>
          <div className="flex flex-col gap-3">
            {REASONS.map(r => (
              <button key={r.id} onClick={() => { setReasonId(r.id); setStep(3) }}
                className="w-full text-left px-5 py-4 bg-white border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{r.icon}</span>
                  <div>
                    <p className="font-semibold text-gray-800">{r.label}</p>
                    <p className="text-sm text-gray-400 mt-0.5">{r.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(1)} className="mt-5 text-sm text-gray-400 hover:text-gray-600">← Back</button>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Which ingredient?</h2>
          <p className="text-sm text-gray-400 mb-5">{selectedReason?.label} · {store}</p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            {config.ingredients.map((p, i) => (
              <button key={p.id} onClick={() => { setProductId(p.id); setStep(4) }}
                className={`w-full text-left px-5 py-4 flex items-center justify-between hover:bg-blue-50 active:bg-blue-100 transition-colors ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                <span className="font-medium text-gray-800 text-base">{p.name}</span>
                <span className="text-sm text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{p.unit}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="mt-5 text-sm text-gray-400 hover:text-gray-600">← Back</button>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-1">
            How much <span className="text-blue-600">{selectedProduct?.name}</span> was lost?
          </h2>
          <p className="text-sm text-gray-400 mb-8">{selectedReason?.label} · {store}</p>
          <div className="flex items-center gap-4 mb-10">
            <input type="number" min="0" step="0.1" value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder="0" autoFocus
              className="w-36 text-4xl font-bold text-gray-900 border-2 border-gray-300 rounded-xl px-4 py-3 text-center focus:outline-none focus:border-blue-500 transition-colors" />
            <span className="text-2xl text-gray-400 font-medium">{selectedProduct?.unit}</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setStep(3)} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
            <button onClick={handleSubmit} disabled={!qty || Number(qty) <= 0}
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Log Loss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
