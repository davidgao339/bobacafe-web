import { useState, useRef } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'

// ─── Ingredients Tab ──────────────────────────────────────────────────────────

function IngredientsTab() {
  const { config, setConfig } = useConfig()
  const { t } = useLanguage()
  const [editingId,       setEditingId]       = useState(null)
  const [editVals,        setEditVals]        = useState({})
  const [adding,          setAdding]          = useState(false)
  const [newIng,          setNewIng]          = useState({ name: '', unit: '', supplierId: null })
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [search,          setSearch]          = useState('')
  const [sortDir,         setSortDir]         = useState(null)
  const cycleSort = () => setSortDir(d => d === null ? 'asc' : d === 'asc' ? 'desc' : null)
  const si = sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : ''
  const suppliers = config.suppliers ?? []
  const hasSuppliers = suppliers.length > 0

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

  const setIngSupplier = (id, supplierId) => {
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.map(i => i.id === id ? { ...i, supplierId } : i),
    }))
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
    setConfig(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { id: prev._nextIngId, name: newIng.name.trim(), unit: newIng.unit.trim(), supplierId: newIng.supplierId ?? null }],
      _nextIngId: prev._nextIngId + 1,
    }))
    setNewIng({ name: '', unit: '', supplierId: null })
    setAdding(false)
  }

  const q = search.toLowerCase()
  const visibleIngredients = (() => {
    const filtered = config.ingredients.filter(ing => !q || ing.id === editingId || ing.name.toLowerCase().includes(q))
    if (!sortDir) return filtered
    return [...filtered].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
  })()

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <div className="relative max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input type="text" placeholder={t('recipes.searchPlaceholder')} value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
            <th className="px-6 py-3 font-medium cursor-pointer select-none hover:text-gray-700" onClick={cycleSort}>{t('common.name')}{si}</th>
            <th className="px-4 py-3 font-medium w-32">{t('common.unit')}</th>
            {hasSuppliers && <th className="px-4 py-3 font-medium w-44">{t('recipes.supplier')}</th>}
            <th className="px-4 py-3 w-28"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {visibleIngredients.map(ing => (
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
              {hasSuppliers && (
                <td className="px-4 py-2.5">
                  <select value={ing.supplierId ?? ''} onChange={e => setIngSupplier(ing.id, e.target.value ? Number(e.target.value) : null)}
                    className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full">
                    <option value="">{t('recipes.supplierOther')}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
              )}
              <td className="px-4 py-2.5 text-right">
                {editingId === ing.id
                  ? <div className="flex gap-2 justify-end">
                      <button onClick={saveEdit} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">{t('common.save')}</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                    </div>
                  : pendingDeleteId === ing.id
                    ? <div className="flex gap-2 justify-end items-center">
                        <span className="text-xs text-red-600">{t('recipes.removeFromRecipes')}</span>
                        <button onClick={() => { deleteIngredient(ing.id); setPendingDeleteId(null) }}
                          className="text-xs px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600">{t('common.yes')}</button>
                        <button onClick={() => setPendingDeleteId(null)}
                          className="text-xs text-gray-500 hover:text-gray-700">{t('common.no')}</button>
                      </div>
                    : <div className="flex gap-3 justify-end">
                        <button onClick={() => startEdit(ing)} className="text-xs text-blue-600 hover:text-blue-800">{t('common.edit')}</button>
                        <button onClick={() => setPendingDeleteId(ing.id)} className="text-xs text-red-400 hover:text-red-600">{t('common.delete')}</button>
                      </div>
                }
              </td>
            </tr>
          ))}
          {adding && (
            <tr className="bg-blue-50">
              <td className="px-6 py-2.5">
                <input autoFocus placeholder={t('recipes.ingredientName')}
                  value={newIng.name}
                  onChange={e => setNewIng(v => ({ ...v, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addIngredient()}
                  className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </td>
              <td className="px-4 py-2.5">
                <input placeholder={t('recipes.unitPlaceholder')}
                  value={newIng.unit}
                  onChange={e => setNewIng(v => ({ ...v, unit: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addIngredient()}
                  className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </td>
              {hasSuppliers && (
                <td className="px-4 py-2.5">
                  <select value={newIng.supplierId ?? ''} onChange={e => setNewIng(v => ({ ...v, supplierId: e.target.value ? Number(e.target.value) : null }))}
                    className="border border-blue-300 rounded px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-full">
                    <option value="">{t('recipes.supplierOther')}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
              )}
              <td className="px-4 py-2.5 text-right">
                <div className="flex gap-2 justify-end">
                  <button onClick={addIngredient} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">{t('recipes.add')}</button>
                  <button onClick={() => { setAdding(false); setNewIng({ name: '', unit: '', supplierId: null }) }}
                    className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!adding && (
        <div className="px-6 py-3 border-t border-gray-100">
          <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            {t('recipes.addIngredient')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────

function SuppliersTab() {
  const { config, addSupplier, updateSupplier, deleteSupplier } = useConfig()
  const { t } = useLanguage()
  const [adding,    setAdding]    = useState(false)
  const [newName,   setNewName]   = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName,  setEditName]  = useState('')
  const suppliers = config.suppliers ?? []

  const handleAdd = () => {
    if (!newName.trim()) return
    addSupplier(newName.trim())
    setNewName(''); setAdding(false)
  }
  const handleSave = () => {
    if (!editName.trim()) return
    updateSupplier(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="max-w-lg">
      <p className="text-sm text-gray-500 mb-4">{t('recipes.suppliersDesc')}</p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
              <th className="px-6 py-3 font-medium">{t('recipes.supplierName')}</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {suppliers.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-6 py-2.5">
                  {editingId === s.id
                    ? <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSave()}
                        className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    : <span className="font-medium text-gray-900">{s.name}</span>
                  }
                </td>
                <td className="px-4 py-2.5 text-right">
                  {editingId === s.id
                    ? <div className="flex gap-2 justify-end">
                        <button onClick={handleSave} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">{t('common.save')}</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                      </div>
                    : <div className="flex gap-3 justify-end">
                        <button onClick={() => { setEditingId(s.id); setEditName(s.name) }} className="text-xs text-blue-600 hover:text-blue-800">{t('common.edit')}</button>
                        <button onClick={() => deleteSupplier(s.id)} className="text-xs text-red-400 hover:text-red-600">{t('common.delete')}</button>
                      </div>
                  }
                </td>
              </tr>
            ))}
            {adding && (
              <tr className="bg-blue-50">
                <td className="px-6 py-2.5">
                  <input autoFocus placeholder={t('recipes.supplierName')} value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex gap-2 justify-end">
                    <button onClick={handleAdd} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">{t('recipes.add')}</button>
                    <button onClick={() => { setAdding(false); setNewName('') }} className="text-xs text-gray-500 hover:text-gray-700">{t('common.cancel')}</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!adding && (
          <div className="px-6 py-3 border-t border-gray-100">
            <button onClick={() => setAdding(true)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
              + {t('recipes.addSupplier')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Recipes Tab ──────────────────────────────────────────────────────────────

function RecipesTab() {
  const { config, sales, posWaste, setConfig } = useConfig()
  const { t } = useLanguage()
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [selected,  setSelected]  = useState(null)
  const [editing,   setEditing]   = useState(false)
  const [draftQtys, setDraftQtys] = useState({})
  const [adding,     setAdding]     = useState(false)
  const [newIng,     setNewIng]     = useState({ ingredientId: '', qty: '' })
  const [ingSearch,  setIngSearch]  = useState('')
  const [ingOpen,    setIngOpen]    = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [newIngDef,  setNewIngDef]  = useState({ name: '', unit: '' })

  const salesProducts = new Set(sales.map(s => s.product))
  const wasteProducts = new Set(posWaste.map(s => s.product))
  const allProducts   = [...new Set([...salesProducts, ...wasteProducts])].sort()
  const isWasteOnly   = (p) => wasteProducts.has(p) && !salesProducts.has(p)
  const hasRecipe     = (p) => Object.values(config.recipes[p] ?? {}).some(q => q > 0)

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

  const resetIngPicker = () => { setIngSearch(''); setIngOpen(false) }

  const cancelEditing = () => {
    setEditing(false)
    setDraftQtys({})
    setAdding(false)
    setCreating(false)
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
    resetIngPicker()
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
    resetIngPicker()
  }

  const removeFromDraft = (ingredientId) => {
    setDraftQtys(prev => { const next = { ...prev }; delete next[ingredientId]; return next })
  }

  const addIngredient = () => {
    if (!newIng.ingredientId) return
    setDraftQtys(prev => ({ ...prev, [Number(newIng.ingredientId)]: newIng.qty }))
    setNewIng({ ingredientId: '', qty: '' })
    setAdding(false)
    resetIngPicker()
  }

  const createAndAdd = () => {
    if (!newIngDef.name.trim() || !newIng.qty || parseFloat(newIng.qty) <= 0) return
    const newId = config._nextIngId
    setConfig(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { id: newId, name: newIngDef.name.trim(), unit: newIngDef.unit.trim() }],
      _nextIngId: newId + 1,
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
    resetIngPicker()
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
          <input type="text" placeholder={t('recipes.searchPlaceholder')} value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1">
            {[['all', t('common.all')], ['has_recipe', t('recipes.hasRecipe')], ['no_recipe', t('recipes.noRecipeFilter')]].map(([id, label]) => (
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
            ? <p className="px-4 py-8 text-sm text-gray-400 text-center">{t('recipes.noMatch')}</p>
            : displayed.map(p => {
                const count = Object.values(config.recipes[p] ?? {}).filter(q => q > 0).length
                return (
                  <button key={p} onClick={() => handleSelectProduct(p)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                      selected === p ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-800 truncate leading-snug">{p}</p>
                      {isWasteOnly(p) && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium flex-shrink-0">Waste</span>}
                    </div>
                    {count > 0
                      ? <p className="text-xs text-green-600 mt-0.5">{count !== 1 ? t('recipes.ingredientsCount', { count }) : t('recipes.ingredientCount', { count })}</p>
                      : <p className="text-xs text-amber-500 mt-0.5">{t('recipes.noRecipeYet')}</p>
                    }
                  </button>
                )
              })
          }
        </div>

        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
          <p className="text-xs text-gray-400">{displayed.length} / {allProducts.length}</p>
          {noRecipeCount > 0 && <p className="text-xs text-amber-500">{t('recipes.missing', { count: noRecipeCount })}</p>}
        </div>
      </div>

      {/* Right: recipe viewer / editor */}
      {selected ? (
        <div className="flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className={`px-5 py-4 border-b border-gray-100 flex items-center justify-between ${editing ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <div>
              <h3 className="font-semibold text-gray-900">{selected}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {editing
                  ? t('recipes.editingLabel', { type: isWasteOnly(selected) ? t('recipes.wasted') : t('recipes.sold') })
                  : t('recipes.viewingLabel', { type: isWasteOnly(selected) ? t('recipes.wasted') : t('recipes.sold') })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button onClick={cancelEditing}
                    className="text-xs px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                    {t('common.cancel')}
                  </button>
                  <button onClick={saveDraft}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                    {t('recipes.saveChanges')}
                  </button>
                </>
              ) : (
                <button onClick={startEditing}
                  className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium">
                  {t('recipes.modify')}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {draftIngredients.length === 0 && !adding ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-gray-400 mb-3">{t('recipes.noIngredientsYet')}</p>
                <button onClick={() => { setEditing(true); setAdding(true) }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium">{t('recipes.addFirst')}</button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                    <th className="px-5 py-2 font-medium">{t('common.ingredient')}</th>
                    <th className="px-4 py-2 font-medium">{t('common.unit')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('recipes.qtyPerUnit')}</th>
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
                        <div className="relative">
                          <input
                            autoFocus
                            type="text"
                            placeholder={t('recipes.selectIngredient')}
                            value={ingSearch}
                            onChange={e => {
                              setIngSearch(e.target.value)
                              setIngOpen(true)
                              setNewIng(v => ({ ...v, ingredientId: '' }))
                            }}
                            onFocus={() => setIngOpen(true)}
                            onBlur={() => setTimeout(() => setIngOpen(false), 120)}
                            className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          {newIng.ingredientId && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 text-xs">✓</span>
                          )}
                          {ingOpen && (
                            <div className="absolute top-full left-0 right-0 z-20 bg-white border border-blue-200 rounded shadow-lg max-h-44 overflow-y-auto mt-0.5">
                              {draftUnused
                                .filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase()))
                                .map(i => (
                                  <button key={i.id} type="button"
                                    onMouseDown={() => {
                                      setNewIng(v => ({ ...v, ingredientId: i.id }))
                                      setIngSearch(i.name)
                                      setIngOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center justify-between">
                                    <span>{i.name}</span>
                                    <span className="text-gray-400 text-xs ml-2">{i.unit}</span>
                                  </button>
                                ))
                              }
                              {draftUnused.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).length === 0 && (
                                <p className="px-3 py-2 text-xs text-gray-400">No match</p>
                              )}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setCreating(true)}
                          className="text-xs text-blue-600 hover:text-blue-800 mt-1 block">{t('recipes.createNew')}</button>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" min="0" step="0.001" placeholder={t('recipes.qtyPlaceholder')}
                          value={newIng.qty}
                          onChange={e => setNewIng(v => ({ ...v, qty: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && addIngredient()}
                          className="w-28 border border-blue-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={addIngredient}
                            className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">{t('recipes.add')}</button>
                          <button onClick={() => { setAdding(false); setNewIng({ ingredientId: '', qty: '' }); resetIngPicker() }}
                            className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {editing && adding && creating && (
                    <tr className="bg-green-50">
                      <td className="px-5 py-2.5">
                        <input autoFocus placeholder={t('recipes.ingredientName')}
                          value={newIngDef.name}
                          onChange={e => setNewIngDef(v => ({ ...v, name: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="border border-green-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <input placeholder={t('recipes.unitPlaceholder')}
                          value={newIngDef.unit}
                          onChange={e => setNewIngDef(v => ({ ...v, unit: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="border border-green-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input type="number" min="0" step="0.001" placeholder={t('recipes.qtyPlaceholder')}
                          value={newIng.qty}
                          onChange={e => setNewIng(v => ({ ...v, qty: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                          className="w-28 border border-green-300 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={createAndAdd}
                            className="text-xs px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700">{t('recipes.createAndAdd')}</button>
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
                {t('recipes.addIngredient')}
              </button>
              <button onClick={() => setDraftQtys({})}
                className="text-xs text-red-400 hover:text-red-600">{t('recipes.clearAll')}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 border border-gray-200 rounded-xl bg-gray-50/50 flex items-center justify-center">
          <p className="text-sm text-gray-400">{t('recipes.selectProduct')}</p>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Recipes({ activeTab = 'ingredients', onTabChange }) {
  const tab = activeTab
  const setTab = (t) => onTabChange?.(t)
  const { exportConfig, importConfig } = useConfig()
  const { t } = useLanguage()
  const importRef = useRef()
  const [importError, setImportError] = useState(null)

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      await importConfig(file)
      setImportError(null)
    } catch {
      setImportError(t('recipes.invalidConfig'))
    }
    e.target.value = ''
  }

  return (
    <div className="p-8 flex flex-col">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('recipes.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('recipes.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {importError && <span className="text-xs text-red-500">{importError}</span>}
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <button onClick={() => importRef.current.click()}
            className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            {t('recipes.importConfig')}
          </button>
          <button onClick={exportConfig}
            className="px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            {t('recipes.exportConfig')}
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
        {[['ingredients', t('recipes.tabIngredients')], ['recipes', t('recipes.tabRecipes')], ['suppliers', t('recipes.tabSuppliers')]].map(([id, label]) => (
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
      {tab === 'suppliers'   && <SuppliersTab />}
    </div>
  )
}
