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

// ─── Inline confirm ───────────────────────────────────────────────────────────

function ConfirmInline({ message, onConfirm, onCancel, danger }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600">{message}</span>
      <button onClick={onConfirm}
        className={`px-2.5 py-1 text-xs rounded-md text-white font-medium ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
        Confirm
      </button>
      <button onClick={onCancel} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md">
        Cancel
      </button>
    </div>
  )
}

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

// ─── Create / Edit form ───────────────────────────────────────────────────────

function DraftForm({ title, initialLines, ingredients, getOrderQty, initialStore, lockStore, onSave, onCancel }) {
  const [store, setStore] = useState(initialStore ?? STORES[0])
  const [qtys,  setQtys]  = useState(() => {
    if (initialLines) {
      const map = {}
      initialLines.forEach(l => { map[`${initialStore}:${l.ingredientId}`] = l.ordered })
      return map
    }
    return {}
  })

  // Set of ingredient IDs that were in the original order (ordered > 0)
  const originalIds = new Set(initialLines?.filter(l => l.ordered > 0).map(l => l.ingredientId) ?? [])

  const lines = ingredients.map(p => {
    const key = `${store}:${p.id}`
    const suggested = getOrderQty(store, p.id)
    const qty = key in qtys ? qtys[key] : (initialLines ? (originalIds.has(p.id) ? (initialLines.find(l => l.ingredientId === p.id)?.ordered ?? 0) : 0) : suggested)
    return { ...p, suggested, qty, isOriginal: originalIds.has(p.id) }
  })

  const inOrder  = lines.filter(l => l.isOriginal || (!initialLines && true))
  const notInOrder = initialLines ? lines.filter(l => !l.isOriginal) : []

  const handleStoreChange = (s) => { setStore(s); setQtys({}) }
  const setQty = (ingredientId, val) =>
    setQtys(prev => ({ ...prev, [`${store}:${ingredientId}`]: val }))

  const handleSave = () => {
    onSave({
      store,
      lines: lines.map(l => ({ ingredientId: l.id, ordered: Math.max(0, Number(l.qty) || 0) })),
    })
  }

  const colHead = (
    <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
      <th className="px-6 py-3 font-medium">Ingredient</th>
      <th className="px-4 py-3 font-medium">Unit</th>
      <th className="px-4 py-3 font-medium text-right">Suggested</th>
      <th className="px-4 py-3 font-medium text-right">Order qty</th>
    </tr>
  )

  const renderRow = (l) => (
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
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {!lockStore && (
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-gray-600">Store</label>
            <select value={store} onChange={e => handleStoreChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {STORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        )}
        {lockStore && <span className="text-sm font-medium text-gray-700">{store}</span>}
      </div>

      <table className="w-full text-sm">
        <thead>{colHead}</thead>
        <tbody className="divide-y divide-gray-50">
          {(initialLines ? inOrder : lines).map(renderRow)}
        </tbody>
      </table>

      {notInOrder.length > 0 && (
        <>
          <div className="px-6 py-2 bg-gray-50 border-t border-b border-gray-100 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add more ingredients</span>
            <span className="text-xs text-gray-400">— set qty &gt; 0 to include</span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {notInOrder.map(renderRow)}
            </tbody>
          </table>
        </>
      )}
      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <p className="text-xs text-gray-400">Suggested = consumed ×1.05 − inventory adjustment</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Save Draft
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

  const [expanded,  setExpanded]  = useState(null)
  const [creating,  setCreating]  = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirm,   setConfirm]   = useState(null) // { poId, action }
  const [filter,    setFilter]    = useState('all')

  const pos    = data.purchaseOrders
  const nextId = `PO-${String(data._nextPoId).padStart(3, '0')}`

  const filtered = pos.filter(po => filter === 'all' || po.status === filter)
  const count    = (s) => s === 'all' ? pos.length : pos.filter(p => p.status === s).length

  const toggle = (id) => {
    setExpanded(prev => prev === id ? null : id)
    setConfirm(null)
    if (editingId === id) setEditingId(null)
  }

  const requestConfirm = (poId, action, e) => {
    e.stopPropagation()
    setConfirm(prev => (prev?.poId === poId && prev?.action === action) ? null : { poId, action })
  }

  const doConfirm = () => {
    if (!confirm) return
    const { poId, action } = confirm
    if (action === 'send')     updatePurchaseOrder(poId, { status: 'sent',     sentDate: TODAY })
    if (action === 'receive')  updatePurchaseOrder(poId, { status: 'received', receivedDate: TODAY })
    if (action === 'revertToSent')  updatePurchaseOrder(poId, { status: 'sent',  receivedDate: null })
    if (action === 'revertToDraft') updatePurchaseOrder(poId, { status: 'draft', sentDate: null })
    if (action === 'delete') {
      deletePurchaseOrder(poId)
      if (expanded === poId) setExpanded(null)
    }
    setConfirm(null)
  }

  const handleCreate = (newPO) => {
    addPurchaseOrder({ ...newPO, id: nextId, status: 'draft', createdDate: TODAY, sentDate: null, receivedDate: null })
    setCreating(false)
    setExpanded(nextId)
  }

  const handleEditSave = (poId, { lines }) => {
    updatePurchaseOrder(poId, { lines })
    setEditingId(null)
  }

  const CONFIRM_LABELS = {
    send:          { msg: 'Mark as sent?',     danger: false },
    receive:       { msg: 'Confirm delivery?', danger: false },
    revertToSent:  { msg: 'Revert to Sent?',   danger: true  },
    revertToDraft: { msg: 'Revert to Draft?',  danger: true  },
    delete:        { msg: 'Delete this PO?',   danger: true  },
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
        <DraftForm
          title={`New Purchase Order — ${nextId}`}
          ingredients={config.ingredients}
          getOrderQty={getOrderQty}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="flex gap-1 bg-gray-100 rounded-lg p1 w-fit mb-5">
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
              : filtered.map(po => {
                  const pendingConfirm = confirm?.poId === po.id ? confirm.action : null
                  const cl = pendingConfirm ? CONFIRM_LABELS[pendingConfirm] : null
                  return (
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
                        <td className="px-4 py-3 min-w-64" onClick={e => e.stopPropagation()}>
                          {pendingConfirm ? (
                            <ConfirmInline
                              message={cl.msg}
                              danger={cl.danger}
                              onConfirm={doConfirm}
                              onCancel={() => setConfirm(null)}
                            />
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              {po.status === 'draft' && <>
                                <button onClick={e => requestConfirm(po.id, 'send', e)}
                                  className="px-2.5 py-1 bg-blue-600 text-white text-xs rounded-md hover:bg-blue-700">Send</button>
                                <button onClick={e => { e.stopPropagation(); setEditingId(po.id); setExpanded(po.id) }}
                                  className="px-2.5 py-1 border border-gray-300 text-gray-600 text-xs rounded-md hover:bg-gray-50">Edit</button>
                                <button onClick={e => requestConfirm(po.id, 'delete', e)}
                                  className="px-2.5 py-1 text-red-400 text-xs hover:text-red-600">Delete</button>
                              </>}
                              {po.status === 'sent' && <>
                                <button onClick={e => requestConfirm(po.id, 'receive', e)}
                                  className="px-2.5 py-1 bg-green-600 text-white text-xs rounded-md hover:bg-green-700">Mark Received</button>
                                <button onClick={e => requestConfirm(po.id, 'revertToDraft', e)}
                                  className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">↩ Draft</button>
                              </>}
                              {po.status === 'received' && (
                                <button onClick={e => requestConfirm(po.id, 'revertToSent', e)}
                                  className="px-2.5 py-1 border border-gray-200 text-gray-400 text-xs rounded-md hover:text-gray-600">↩ Sent</button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>

                      {expanded === po.id && (
                        <tr className="bg-blue-50 border-b border-blue-100">
                          <td colSpan={8} className="px-8 py-5">
                            <StatusStepper po={po} />

                            {editingId === po.id && po.status === 'draft' ? (
                              <DraftForm
                                title={`Edit ${po.id}`}
                                initialLines={po.lines}
                                initialStore={po.store}
                                lockStore
                                ingredients={config.ingredients}
                                getOrderQty={getOrderQty}
                                onSave={({ lines }) => handleEditSave(po.id, { lines })}
                                onCancel={() => setEditingId(null)}
                              />
                            ) : (
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
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}
