import { useState, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

const TODAY = new Date().toISOString().slice(0, 10)

const STATUS_STYLE = {
  draft:    'bg-gray-100 text-gray-600',
  sent:     'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
}
const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', received: 'Received' }

// ─── Status stepper ───────────────────────────────────────────────────────────

function StatusStepper({ po }) {
  const steps = [
    { label: 'Created',  date: po.createdDate },
    { label: 'Sent',     date: po.sentDate },
    { label: 'Received', date: po.receivedDate },
  ]
  const activeIdx = po.status === 'received' ? 2 : po.status === 'sent' ? 1 : 0
  return (
    <div className="flex items-center gap-0 mb-5 max-w-sm">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
              i < activeIdx    ? 'bg-blue-600 border-blue-600 text-white'
              : i === activeIdx ? 'border-blue-600 text-blue-600 bg-white'
              : 'border-gray-200 text-gray-300 bg-white'
            }`}>
              {i < activeIdx ? '✓' : i + 1}
            </div>
            <p className={`text-xs mt-1 font-medium ${i <= activeIdx ? 'text-gray-700' : 'text-gray-300'}`}>{s.label}</p>
            <p className="text-xs text-gray-400">{s.date ?? ''}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-6 mx-1 ${i < activeIdx ? 'bg-blue-400' : 'bg-gray-200'}`} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ nextId, onSave, onCancel, ingredients, getOrderQty }) {
  const [store, setStore] = useState(STORES[0])
  const [qtys,  setQtys]  = useState({})

  const lines = ingredients.map(p => ({
    ...p,
    suggested: getOrderQty(store, p.id),
    qty:       qtys[`${store}:${p.id}`] ?? getOrderQty(store, p.id),
  }))

  const handleStoreChange = (s) => { setStore(s); setQtys({}) }
  const setQty = (ingredientId, val) =>
    setQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))

  const handleSave = () => {
    onSave({
      id: nextId, store, status: 'draft',
      createdDate: TODAY, sentDate: null, receivedDate: null,
      lines: lines.map(l => ({ ingredientId: l.id, ordered: Math.max(0, Number(l.qty) || 0) })),
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">New Purchase Order — {nextId}</h2>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-600">Store</label>
          <select value={store} onChange={e => handleStoreChange(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            {STORES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
            <th className="px-6 py-3 font-medium">Ingredient</th>
            <th className="px-4 py-3 font-medium">Unit</th>
            <th className="px-4 py-3 font-medium text-right">Suggested</th>
            <th className="px-4 py-3 font-medium text-right">Order qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {lines.map(l => (
            <tr key={l.id} className="hover:bg-gray-50">
              <td className="px-6 py-2.5 font-medium text-gray-900">{l.name}</td>
              <td className="px-4 py-2.5 text-gray-500">{l.unit}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{l.suggested}</td>
              <td className="px-4 py-2.5 text-right">
                <input type="number" min="0" value={l.qty}
                  onChange={e => setQty(l.id, e.target.value)}
                  className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <p className="text-xs text-gray-400">Quantities pre-filled from replenishment formula: consumed ×1.05 − inventory adjustment</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Create Draft
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PurchaseOrders() {
  const { config, data, addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder } = useConfig()
  const { getOrderQty } = useCalcs()

  const ingredientName = (id) => config.ingredients.find(p => p.id === id)?.name ?? '—'
  const ingredientUnit = (id) => config.ingredients.find(p => p.id === id)?.unit ?? ''

  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)
  const [filter,   setFilter]   = useState('all')

  const pos     = data.purchaseOrders
  const nextId  = `PO-${String(data._nextPoId).padStart(3, '0')}`

  const filtered = pos.filter(po => filter === 'all' || po.status === filter)
  const count    = (s) => s === 'all' ? pos.length : pos.filter(p => p.status === s).length

  const toggle = (id) => setExpanded(prev => prev === id ? null : id)

  const advance = (id) => {
    const po = pos.find(p => p.id === id)
    if (!po) return
    if (po.status === 'draft') updatePurchaseOrder(id, { status: 'sent',     sentDate: TODAY })
    if (po.status === 'sent')  updatePurchaseOrder(id, { status: 'received', receivedDate: TODAY })
  }

  const handleDelete = (id) => {
    deletePurchaseOrder(id)
    if (expanded === id) setExpanded(null)
  }

  const handleCreate = (newPO) => {
    addPurchaseOrder(newPO)
    setCreating(false)
    setExpanded(newPO.id)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track ingredient orders from draft through delivery</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            + New PO
          </button>
        )}
      </div>

      {creating && (
        <CreateForm
          nextId={nextId}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
          ingredients={config.ingredients}
          getOrderQty={getOrderQty}
        />
      )}

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
        {[['all','All'], ['draft','Draft'], ['sent','Sent'], ['received','Received']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label} <span className="ml-1 text-gray-400">{count(id)}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-3 font-medium">PO #</th>
              <th className="px-4 py-3 font-medium">Store</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Sent</th>
              <th className="px-4 py-3 font-medium">Received</th>
              <th className="px-4 py-3 font-medium text-right">Lines</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={8} className="px-6 py-10 text-center text-gray-400 text-sm">No purchase orders</td></tr>
              : filtered.map(po => (
                <Fragment key={po.id}>
                  <tr onClick={() => toggle(po.id)}
                    className={`border-b border-gray-50 cursor-pointer ${expanded === po.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-6 py-3 font-mono text-xs font-semibold text-gray-700">{po.id}</td>
                    <td className="px-4 py-3 text-gray-800">{po.store}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.createdDate}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.sentDate ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">{po.receivedDate ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{po.lines.filter(l => l.ordered > 0).length}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[po.status]}`}>
                        {STATUS_LABEL[po.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {po.status === 'draft' && <>
                          <button onClick={() => advance(po.id)}
                            className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700">Send</button>
                          <button onClick={() => handleDelete(po.id)}
                            className="px-2.5 py-1 text-red-400 text-xs hover:text-red-600">Delete</button>
                        </>}
                        {po.status === 'sent' && (
                          <button onClick={() => advance(po.id)}
                            className="px-2.5 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700">Mark Received</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === po.id && (
                    <tr className="bg-blue-50 border-b border-blue-100">
                      <td colSpan={8} className="px-8 py-5">
                        <StatusStepper po={po} />
                        <table className="w-full max-w-md text-sm bg-white rounded-lg border border-blue-100 overflow-hidden">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
                              <th className="px-4 py-2 font-medium">Ingredient</th>
                              <th className="px-4 py-2 font-medium text-right">Ordered</th>
                              <th className="px-4 py-2 font-medium">Unit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {po.lines.filter(l => l.ordered > 0).map(l => (
                              <tr key={l.ingredientId}>
                                <td className="px-4 py-2 font-medium text-gray-800">{ingredientName(l.ingredientId)}</td>
                                <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{l.ordered}</td>
                                <td className="px-4 py-2 text-gray-400">{ingredientUnit(l.ingredientId)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
