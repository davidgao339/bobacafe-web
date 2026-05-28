import { useState, useRef } from 'react'
import { useConfig } from '../context/ConfigContext'

// ─── Ingredients Tab ──────────────────────────────────────────────────────────

function IngredientsTab() {
  const { config, setConfig } = useConfig()
  const [editingId, setEditingId] = useState(null)
  const [editVals,  setEditVals]  = useState({})
  const [adding,    setAdding]    = useState(false)
  const [newIng,    setNewIng]    = useState({ name: '', unit: '' })

  const startEdit = (ing) => { setEditingId(ing.id); setEditVals({ name: ing.name, unit: ing.unit }) }

  const saveEdit = () => {
    if (!editVals.name?.trim()) return
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.map(i =>
        i.id === editingId ? { ...i, name: editVals.name.trim(), unit: editVals.unit.trim() } : i
      ),
    }))
    setEditingId(null)
  }

  const deleteIngredient = (id) => {
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter(i => i.id !== id),
      recipes: Object.fromEntries(
        Object.entries(prev.recipes).map(([product, recipe]) => [
          product,
          Object.fromEntries(Object.entries(recipe).filter(([iid]) => Number(iid) !== id)),
        ])
      ),
    }))
    if (editingId === id) setEditingId(null)
  }

  const addIngredient = () => {
    if (!newIng.name.trim()) return
    const maxId = config.ingredients.reduce((m, i) => Math.max(m, i.id), 0)
    setConfig(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { id: maxId + 1, name: newIng.name.trim(), unit: newIng.unit.trim() }],
    }))
    setNewIng({ name: '', unit: '' })
    setAdding(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
            <th className="px-6 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium w-32">Unit</th>
            <th className="px-4 py-3 w-28"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {config.ingredients.map(ing => (
            <tr key={ing.id} className="hover:bg-gray-50">
              <td className="px-6 py-2.5">
                {editingId === ing.id
                  ? <input autoFocus value={editVals.name}
                      onChange={e => setEditVals(v => ({ ...v, name: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveEdit()}
                      className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  : <span className="font-medium text-gray-900">{ing.name}</span>
                }
              </td>
              <td className="px-4 py-2.5">
                {editingId === ing.id
                  ? <input value={editVals.unit}
                      onChange={e => setEditVals(v => ({ ...v, unit: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveEdit()}
                      className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  : <span className="text-gray-500">{ing.unit}</span>
                }
              </td>
              <td className="px-4 py-2.5 text-right">
                {editingId === ing.id
                  ? <div className="flex gap-2 justify-end">
                      <button onClick={saveEdit} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                    </div>
                  : <div className="flex gap-3 justify-end">
                      <button onClick={() => startEdit(ing)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                      <button onClick={() => deleteIngredient(ing.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                    </div>
                }
              </td>
            </tr>
          ))}
          {adding && (
            <tr className="bg-blue-50">
              <td className="px-6 py-2.5">
                <input autoFocus placeholder="Ingredient name"
                  value={newIng.name}
                  onChange={e => setNewIng(v => ({ ...v, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addIngredient()}
                  className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </td>
              <td className="px-4 py-2.5">
                <input placeholder="kg / L / pcs…"
                  value={newIng.unit}
                  onChange={e => setNewIng(v => ({ ...v, unit: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addIngredient()}
                  className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex gap-2 justify-end">
                  <button onClick={addIngredient} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
                  <button onClick={() => { setAdding(false); setNewIng({ name: '', unit: '' }) }}
                    className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && (
        <div className="px-6 py-3 border-t border-gray-100">
          <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            + Add ingredient
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Recipes Tab ──────────────────────────────────────────────────────────────

function RecipesTab() {
  const { config, sales, setConfig } = useConfig()
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [selected,  setSelected]  = useState(null)
  const [editing,   setEditing]   = useState(false)
  const [draftQtys, setDraftQtys] = useState({})
  const [adding,    setAdding]    = useState(false)
  const [newIng,    setNewIng]    = useState({ ingredientId: '', qty: '' })
  const [creating,  setCreating]  = useState(false)
  const [newIngDef, setNewIngDef] = useState({ name: '', unit: '' })

  const allProducts = [...new Set(sales.map(s => s.product))].sort()
  const hasRecipe   = (p) => Object.values(config.recipes[p] ?? {}).some(q => q > 0)

  const displayed = allProducts.filter(p => {
    if (search && !p.toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'has_recipe' && !hasRecipe(p)) return false
    if (filter === 'no_recipe'  &&  hasRecipe(p)) return false
    return true
  })

  const noRecipeCount = allProducts.filter(p => !hasRecipe(p)).length

  const selectedRecipe    = config.recipes[selected] ?? {}
  const recipeIngredients = config.ingredients.filter(i => (selectedRecipe[i.id] ?? 0) > 0)
  const unusedIngredients = config.ingredients.filter(i => !((selectedRecipe[i.id] ?? 0) > 0))

  const startEditing = () => {
    const draft = {}
    recipeIngredients.forEach(i => { draft[i.id] = String(selectedRecipe[i.id] ?? '') })
    setDraftQtys(draft)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraftQtys({})
    setAdding(false)
    setCreating(false)
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
  }

  const saveDraft = () => {
    setConfig(prev => {
      const recipe = {}
      Object.entries(draftQtys).forEach(([id, val]) => {
        const num = parseFloat(val)
        if (!isNaN(num) && num > 0) recipe[Number(id)] = num
      })
      return { ...prev, recipes: { ...prev.recipes, [selected]: recipe } }
    })
    setEditing(false)
    setDraftQtys({})
    setAdding(false)
    setCreating(false)
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
  }

  const removeFromDraft = (ingredientId) => {
    setDraftQtys(prev => { const next = { ...prev }; delete next[ingredientId]; return next })
  }

  const addIngredient = () => {
    if (!newIng.ingredientId) return
    setDraftQtys(prev => ({ ...prev, [Number(newIng.ingredientId)]: newIng.qty }))
    setNewIng({ ingredientId: '', qty: '' })
    setAdding(false)
  }

  const createAndAdd = () => {
    if (!newIngDef.name.trim()) return
    const maxId = config.ingredients.reduce((m, i) => Math.max(m, i.id), 0)
    const newId = maxId + 1
    setConfig(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { id: newId, name: newIngDef.name.trim(), unit: newIngDef.unit.trim() }],
    }))
    setDraftQtys(prev => ({ ...prev, [newId]: newIng.qty }))
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
    setCreating(false)
    setAdding(false)
  }

  const handleSelectProduct = (p) => {
    setSelected(p)
    setEditing(false)
    setDraftQtys({})
    setAdding(false)
    setCreating(false)
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
  }

  // In editing mode, show ingredients currently in draft (may differ from saved)
  const draftIngredients = editing
    ? config.ingredients.filter(i => i.id in draftQtys)
    : recipeIngredients
  const draftUnused = config.ingredients.filter(i => !(i.id in draftQtys))

  return (
    <div className="flex gap-4" style={{ height: 580 }}>
      {/* Left: product list */}
      <div className="w-72 flex-shrink-0 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <input type="text" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1">
            {[['all','All'], ['has_recipe','Has recipe'], ['no_recipe','No recipe']].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`flex-1 py-1 text-xs rounded font-medium transition-colors ${
                  filter === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {displayed.length === 0
            ? <p className="px-4 py-8 text-sm text-gray-400 text-center">No products match</p>
            : displayed.map(p => {
                const count = Object.values(config.recipes[p] ?? {}).filter(q => q > 0).length
                return (
                  <button key={p} onClick={() => handleSelectProduct(p)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                      selected === p ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'
                    }`}>
                    <p className="text-sm font-medium text-gray-800 truncate leading-snug">{p}</p>
                    {count > 0
                      ? <p className="text-xs text-green-600 mt-0.5">{count} ingredient{count !== 1 ? 's' : ''}</p>
                      : <p className="text-xs text-amber-500 mt-0.5">No recipe yet</p>
                    }
                  </button>
                )
              })
          }
        </div>

        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <p className="text-xs text-gray-400">{displayed.length} / {allProducts.length}</p>
          {noRecipeCount > 0 && <p className="text-xs text-amber-500">{noRecipeCount} missing</p>}
        </div>
      </div>

      {/* Right: recipe viewer / editor */}
      {selected ? (
        <div className="flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className={`px-5 py-4 border-b border-gray-100 flex items-center justify-between ${editing ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <div>
              <h3 className="font-semibold text-gray-900">{selected}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {editing ? 'Editing — qty consumed per 1 unit sold' : 'Qty consumed per 1 unit sold'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button onClick={cancelEditing}
                    className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                    Cancel
                  </button>
                  <button onClick={saveDraft}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                    Save changes
                  </button>
                </>
              ) : (
                <button onClick={startEditing}
                  className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium">
                  Modify
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {draftIngredients.length === 0 && !adding ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-gray-400 mb-3">No ingredients in this recipe yet</p>
                <button onClick={() => { setEditing(true); setAdding(true) }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add first ingredient</button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                    <th className="px-5 py-2 font-medium">Ingredient</th>
                    <th className="px-4 py-2 font-medium">Unit</th>
                    <th className="px-4 py-2 font-medium text-right">Qty / unit sold</th>
                    {editing && <th className="px-4 py-2 w-8"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {draftIngredients.map(ing => (
                    <tr key={ing.id} className={editing ? 'bg-white hover:bg-blue-50/30' : 'hover:bg-gray-50'}>
                      <td className="px-5 py-2.5 font-medium text-gray-800">{ing.name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{ing.unit}</td>
                      <td className="px-4 py-2.5 text-right">
                        {editing ? (
                          <input type="number" min="0" step="0.001" autoFocus={false}
                            value={draftQtys[ing.id] ?? ''}
                            onChange={e => setDraftQtys(prev => ({ ...prev, [ing.id]: e.target.value }))}
                            className="w-28 border border-blue-300 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums" />
                        ) : (
                          <span className="tabular-nums font-medium text-gray-800">{selectedRecipe[ing.id]}</span>
                        )}
                      </td>
                      {editing && (
                        <td className="px-4 py-2.5">
                          <button onClick={() => removeFromDraft(ing.id)}
                            className="text-gray-300 hover:text-red-400 text-sm">✕</button>
                        </td>
                      )}
                    </tr>
                  ))}

                  {editing && adding && !creating && (
                    <tr className="bg-blue-50">
                      <td className="px-5 py-2.5" colSpan={2}>
                        <select autoFocus value={newIng.ingredientId}
                          onChange={e => setNewIng(v => ({ ...v, ingredientId: e.target.value }))}
                          className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400">
                          <option value="">Select ingredient…</option>
                          {draftUnused.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                        </select>
                        <button onClick={() => setCreating(true)}
                          className="text-xs text-blue-600 hover:text-blue-800 mt-1 block">+ Create new ingredient</button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" min="0" step="0.001" placeholder="qty"
                          value={newIng.qty}
                          onChange={e => setNewIng(v => ({ ...v, qty: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && addIngredient()}
                          className="w-28 border border-blue-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={addIngredient}
                            className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
                          <button onClick={() => { setAdding(false); setNewIng({ ingredientId: '', qty: '' }) }}
                            className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {editing && adding && creating && (
                    <tr className="bg-green-50">
                      <td className="px-5 py-2.5">
                        <input autoFocus placeholder="Ingredient name"
                          value={newIngDef.name}
                          onChange={e => setNewIngDef(v => ({ ...v, name: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="border border-green-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <input placeholder="unit (kg, L…)"
                          value={newIngDef.unit}
                          onChange={e => setNewIngDef(v => ({ ...v, unit: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="border border-green-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" min="0" step="0.001" placeholder="qty"
                          value={newIng.qty}
                          onChange={e => setNewIng(v => ({ ...v, qty: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="w-28 border border-green-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={createAndAdd}
                            className="text-xs px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">Create & add</button>
                          <button onClick={() => setCreating(false)}
                            className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {editing && !adding && (
            <div className="px-5 py-3 border-t border-gray-100 bg-blue-50/50 flex items-center justify-between">
              <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                + Add ingredient
              </button>
              <button onClick={() => setDraftQtys({})}
                className="text-xs text-red-400 hover:text-red-600">Clear all</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 border border-gray-200 rounded-xl bg-gray-50/50 flex items-center justify-center">
          <p className="text-sm text-gray-400">← Select a product to view its recipe</p>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Recipes() {
  const [tab, setTab] = useState('ingredients')
  const { exportConfig, importConfig } = useConfig()
  const importRef = useRef()
  const [importError, setImportError] = useState(null)

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      await importConfig(file)
      setImportError(null)
    } catch {
      setImportError('Invalid config file')
    }
    e.target.value = ''
  }

  return (
    <div className="p-8 flex flex-col">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Recipes & Config</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage ingredients and set recipes for each product sold
          </p>
        </div>
        <div className="flex items-center gap-2">
          {importError && <span className="text-xs text-red-500">{importError}</span>}
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button onClick={() => importRef.current.click()}
            className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            Import config
          </button>
          <button onClick={exportConfig}
            className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            Export config
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
        {[['ingredients', 'Ingredients'], ['recipes', 'Recipes']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ingredients' && <IngredientsTab />}
      {tab === 'recipes'     && <RecipesTab />}
    </div>
  )
}
