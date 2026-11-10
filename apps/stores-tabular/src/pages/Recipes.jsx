import { useState, useRef, Fragment, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { PRODUCT_TYPES, getProductType, getRoundStep, detectProductType } from '@inventory/utils/productTypes'

// ─── Ingredients Tab ──────────────────────────────────────────────────────────

function IngredientsTab() {
  const { config, setConfig } = useConfig()
  const { t, lang } = useLanguage()
  const [editingId,       setEditingId]       = useState(null)
  const [editVals,        setEditVals]        = useState({})
  const [adding,          setAdding]          = useState(false)
  const [newIng,          setNewIng]          = useState({ name: '', unit: '', supplierId: null, productType: '', warehouseOnly: false })
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [search,          setSearch]          = useState('')
  const [sortDir,         setSortDir]         = useState(null)
  const [expandedIngId,   setExpandedIngId]   = useState(null)
  const cycleSort = () => setSortDir(d => d === null ? 'asc' : d === 'asc' ? 'desc' : null)
  const si = sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : ''
  const suppliers = config.suppliers ?? []
  const hasSuppliers = suppliers.length > 0
  const isRu = lang === 'ru'

  const startEdit = (ing) => {
    setEditingId(ing.id)
    setEditVals({ name: ing.name, unit: ing.unit, productType: ing.productType || '', customStep: ing.customStep || '', warehouseOnly: Boolean(ing.warehouseOnly) })
  }

  const saveEdit = () => {
    if (!editVals.name?.trim()) return
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.map(i =>
        i.id === editingId ? {
          ...i,
          name: editVals.name.trim(),
          unit: editVals.unit.trim(),
          productType: editVals.productType || null,
          customStep: editVals.customStep ? Number(editVals.customStep) : null,
          warehouseOnly: Boolean(editVals.warehouseOnly),
        } : i
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

  const toggleWarehouseOnly = (id) => {
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.map(i => i.id === id ? { ...i, warehouseOnly: !i.warehouseOnly } : i),
    }))
  }

  const setIngProductType = (id, productType) => {
    setConfig(prev => ({
      ...prev,
      ingredients: prev.ingredients.map(i => i.id === id ? { ...i, productType: productType || null } : i),
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
      ingredients: [
        ...prev.ingredients,
        {
          id: prev._nextIngId,
          name: newIng.name.trim(),
          unit: newIng.unit.trim(),
          supplierId: newIng.supplierId ?? null,
          productType: newIng.productType || null,
          warehouseOnly: Boolean(newIng.warehouseOnly),
        },
      ],
      _nextIngId: prev._nextIngId + 1,
    }))
    setNewIng({ name: '', unit: '', supplierId: null, productType: '', warehouseOnly: false })
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
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
            <th className="px-4 py-3 font-medium w-28">{t('common.unit')}</th>
            <th className="px-4 py-3 font-medium w-52">{t('recipes.productType')}</th>
            {hasSuppliers && <th className="px-4 py-3 font-medium w-40">{t('recipes.supplier')}</th>}
            <th className="px-4 py-3 w-28"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {visibleIngredients.map(ing => {
            const usedIn = Object.entries(config.recipes)
              .filter(([, recipe]) => (recipe[ing.id] ?? 0) > 0)
              .map(([product, recipe]) => ({ product, qty: recipe[ing.id] }))
            const isExpanded = expandedIngId === ing.id
            const effectivePt = getProductType(ing)
            const step = getRoundStep(ing)
            const isExplicit = Boolean(ing.productType)
            const detected = detectProductType(ing.name, ing.unit)

            return (<Fragment key={ing.id}>
            <tr className={`hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/40' : ''}`}>
              <td className="px-6 py-2.5">
                {editingId === ing.id
                  ? <input autoFocus value={editVals.name}
                      onChange={e => setEditVals(v => ({ ...v, name: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveEdit()}
                      className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  : <button
                      onClick={() => setExpandedIngId(id => id === ing.id ? null : ing.id)}
                      className="flex items-center gap-2 text-left group">
                      <svg className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                      </svg>
                      <span className="font-medium text-gray-900 group-hover:text-blue-700">{ing.name}</span>
                      {usedIn.length > 0
                        ? <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">{usedIn.length}</span>
                        : <span className="text-xs text-gray-300">—</span>
                      }
                    </button>
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
              <td className="px-4 py-2.5">
                {editingId === ing.id
                  ? <select value={editVals.productType ?? ''}
                      onChange={e => setEditVals(v => ({ ...v, productType: e.target.value }))}
                      className="border border-blue-300 rounded px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-full">
                      <option value="">
                        {detected
                          ? `✨ ${isRu ? detected.nameRu : detected.nameEn} (${detected.roundStep})`
                          : t('recipes.typeAuto')}
                      </option>
                      {PRODUCT_TYPES.filter(pt => pt.id !== 'other').map(pt => (
                        <option key={pt.id} value={pt.id}>
                          {isRu ? pt.nameRu : pt.nameEn} ({pt.roundStep} {pt.defaultUnit || ing.unit})
                        </option>
                      ))}
                      <option value="other">{isRu ? 'Другое (без кратности)' : 'Other (1)'}</option>
                    </select>
                  : <select value={ing.productType ?? ''}
                      onChange={e => setIngProductType(ing.id, e.target.value)}
                      className={`border rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full ${
                        isExplicit ? 'border-blue-300 text-blue-800 font-medium' : 'border-gray-200 text-gray-600'
                      }`}>
                      <option value="">
                        {detected
                          ? `✨ ${isRu ? detected.nameRu : detected.nameEn} (${detected.roundStep})`
                          : t('recipes.typeAuto')}
                      </option>
                      {PRODUCT_TYPES.filter(pt => pt.id !== 'other').map(pt => (
                        <option key={pt.id} value={pt.id}>
                          {isRu ? pt.nameRu : pt.nameEn} ({pt.roundStep} {pt.defaultUnit || ing.unit})
                        </option>
                      ))}
                      <option value="other">{isRu ? 'Другое (без кратности)' : 'Other (1)'}</option>
                    </select>
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
                    : <div className="flex gap-3 justify-end items-center">
                        <button onClick={() => toggleWarehouseOnly(ing.id)} className={`text-xs ${ing.warehouseOnly ? 'text-purple-600 hover:text-purple-800 font-medium' : 'text-gray-400 hover:text-purple-600'}`}>W.H. Only</button>
                        <button onClick={() => startEdit(ing)} className="text-xs text-blue-600 hover:text-blue-800">{t('common.edit')}</button>
                        <button onClick={() => setPendingDeleteId(ing.id)} className="text-xs text-red-400 hover:text-red-600">{t('common.delete')}</button>
                      </div>
                }
              </td>
            </tr>
            {isExpanded && (
              <tr className="bg-blue-50/60 border-b border-blue-100">
                <td colSpan={hasSuppliers ? 5 : 4} className="px-10 py-2.5">
                  {usedIn.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">{t('recipes.notUsedAnywhere')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {usedIn.map(({ product, qty }) => (
                        <span key={product} className="inline-flex items-center gap-1.5 bg-white border border-blue-200 rounded-full px-3 py-1 text-xs text-gray-700 shadow-sm">
                          <span className="font-medium">{product}</span>
                          <span className="text-blue-500 font-semibold">{qty} {ing.unit}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            )}
            </Fragment>)
          })}
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
              <td className="px-4 py-2.5">
                <select value={newIng.productType ?? ''}
                  onChange={e => setNewIng(v => ({ ...v, productType: e.target.value }))}
                  className="border border-blue-300 rounded px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-full">
                  <option value="">{t('recipes.typeAuto')}</option>
                  {PRODUCT_TYPES.filter(pt => pt.id !== 'other').map(pt => (
                    <option key={pt.id} value={pt.id}>
                      {isRu ? pt.nameRu : pt.nameEn} ({pt.roundStep} {pt.defaultUnit || newIng.unit})
                    </option>
                  ))}
                  <option value="other">{isRu ? 'Другое (без кратности)' : 'Other (1)'}</option>
                </select>
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
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer pt-1 mr-3">
                    <input type="checkbox" checked={newIng.warehouseOnly} onChange={e => setNewIng(v => ({...v, warehouseOnly: e.target.checked}))} className="rounded border-gray-300 text-purple-600 focus:ring-purple-500" />
                    W.H. Only
                  </label>
                  <button onClick={addIngredient} className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">{t('recipes.add')}</button>
                  <button onClick={() => { setAdding(false); setNewIng({ name: '', unit: '', supplierId: null, productType: '', warehouseOnly: false }) }}
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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
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

// ─── Product Row (catalog + legacy) ──────────────────────────────────────────

function ProductRow({ name, variant, dim, selected, indent, recipeCount, soldRecently, unitPay, onSelect }) {
  const { t } = useLanguage()
  return (
    <button onClick={onSelect}
      className={`w-full text-left border-b transition-colors ${
        selected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'
      } pr-4 ${indent ? 'pl-9' : 'pl-4'}`}>
      <div className="py-1.5">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm truncate leading-snug ${selected ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>{name}</p>
          {dim && dim.isActive === false && (
            <span className="text-[9px] px-1 rounded bg-gray-200 text-gray-500 whitespace-nowrap">off</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-2 min-w-0">
            {variant && <span className="text-[10px] text-gray-400 truncate">{variant}</span>}
            {recipeCount > 0
              ? <span className="text-xs text-green-600 whitespace-nowrap">
                  {recipeCount !== 1 ? t('recipes.ingredientsCount', { count: recipeCount }) : t('recipes.ingredientCount', { count: recipeCount })}
                </span>
              : <span className="text-xs text-amber-500 whitespace-nowrap">{t('recipes.noRecipeYet')}</span>
            }
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {dim && (
              <span title={soldRecently ? t('recipes.catalog') : t('recipes.noRecentSales')}
                className={`w-2 h-2 rounded-full flex-shrink-0 ${soldRecently ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            )}
            {unitPay > 0 && (
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                ₽{unitPay}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Recipes Tab ──────────────────────────────────────────────────────────────

function RecipesTab() {
  const { config, sales, posWaste, setConfig, saveUnitPay, lhConnected } = useConfig()
  const { t } = useLanguage()
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [selected,  setSelected]  = useState(null)
  const [editing,   setEditing]   = useState(false)
  const [draftQtys, setDraftQtys] = useState({})
  const [draftUnitPay, setDraftUnitPay] = useState('')
  const [adding,     setAdding]     = useState(false)
  const [newIng,     setNewIng]     = useState({ ingredientId: '', qty: '' })
  const [ingSearch,  setIngSearch]  = useState('')
  const [ingOpen,    setIngOpen]    = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [newIngDef,  setNewIngDef]  = useState({ name: '', unit: '' })
  // ── Product universe ────────────────────────────────────────────────────────
  // Primary source: workspace.gold.dim_product (lakehouse product master,
  // read-only here — this tab never writes to dim_product; recipes write to
  // fact_recipe_ingredients only, keyed by the POS text name product_ru).
  // Fallback when the lakehouse is offline or dim_product failed to load: the
  // legacy universe — POS names seen in the sales/waste cache plus products
  // that already have a recipe. Ingredient names are raw materials, NOT
  // products — listing them here was the pre-migration bug (~116 items, most
  // "missing").
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dimRows      = (config.dimProducts ?? []).filter(p => p.productRu)
  const useCatalog   = dimRows.length > 0
  const catalogNames = useMemo(() => new Set(dimRows.map(p => p.productRu)), [dimRows])

  // Orphan recipes: keys in fact_recipe_ingredients that belong to no
  // dim_product entry — exactly the dirty-data surface this fixes.
  const orphanNames = useMemo(
    () => Object.keys(config.recipes).filter(p => !catalogNames.has(p)).sort(),
    [config.recipes, catalogNames]
  )

  // POS coverage from the sales cache (badge only — never drives the list).
  const soldDates = {}
  for (const s of [...sales, ...posWaste]) {
    const d = soldDates[s.product]
    if (!d || s.date > d) soldDates[s.product] = s.date
  }
  const weekAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })()

  const hasRecipe = (name) => Object.values(config.recipes[name] ?? {}).some(q => q > 0)
  const soldRecently = (name) => {
    const d = soldDates[name]
    return d != null && d >= weekAgo
  }

  // Active-only: inactive dim_product rows are maintained in menu-manager;
  // this tab always shows the live menu.
  const groups = useMemo(() => {
    if (!useCatalog) return []
    const map = new Map()
    for (const p of dimRows.filter(p => p.isActive)) {
      const key = p.parentProductEn ? `p:${p.parentProductEn.toLowerCase()}` : `s:${p.productRu}`
      if (!map.has(key)) {
        map.set(key, { key, name: p.parentProductEn || p.productRu, category: p.category || 'Uncategorized', children: [] })
      }
      map.get(key).children.push(p)
    }
    for (const g of map.values()) {
      g.children.sort((a, b) => String(a.variant).localeCompare(String(b.variant)) || a.productRu.localeCompare(b.productRu))
    }
    return [...map.values()].sort((a, b) =>
      a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [dimRows, useCatalog])

  // Legacy universe (lakehouse offline / dim_product unavailable)
  const legacyProducts = useMemo(() => {
    if (useCatalog) return []
    const seen = [...new Set([...sales.map(s => s.product), ...posWaste.map(s => s.product), ...orphanNames, ...Object.keys(config.recipes)])]
      .sort()
    return seen.map(name => ({ productRu: name, parentProductEn: '', variant: 'Standard', category: null, isActive: true, isModifier: false }))
  }, [useCatalog, sales, posWaste, config.recipes, orphanNames])

  const categories = useMemo(
    () => [...new Set(groups.map(g => g.category))].sort(),
    [groups]
  )

  const q = search.trim().toLowerCase()

  const inFilter = (p) => {
    if (filter === 'has_recipe' && !hasRecipe(p.productRu)) return false
    if (filter === 'no_recipe'  &&  hasRecipe(p.productRu)) return false
    if (filter === 'no_recent_sales' && soldRecently(p.productRu)) return false
    return true
  }

  const displayedGroups = groups
    .filter(g => categoryFilter === 'all' || g.category === categoryFilter)
    .map(g => ({
      ...g,
      children: g.children.filter(c => {
        if (q && !c.productRu.toLowerCase().includes(q) && !g.name.toLowerCase().includes(q)) return false
        return inFilter(c)
      }),
    }))
    .filter(g => g.children.length > 0)

  const displayedOrphans = orphanNames.filter(o => !q || o.toLowerCase().includes(q))

  // Legacy flat list keeps its own filter shape
  const legacyDisplayed = legacyProducts.filter(p => {
    if (q && !p.productRu.toLowerCase().includes(q)) return false
    return inFilter(p)
  })

  const listProducts = useCatalog
    ? displayedGroups.flatMap(g => g.children)
    : legacyDisplayed
  const visibleCount = filter === 'orphans' ? displayedOrphans.length : listProducts.length

  const totalProducts = useCatalog
    ? groups.reduce((n, g) => n + g.children.length, 0)
    : legacyProducts.length
  const noRecipeCount = useCatalog
    ? groups.reduce((n, g) => n + g.children.filter(c => !hasRecipe(c.productRu)).length, 0)
    : legacyDisplayed.filter(p => !hasRecipe(p.productRu)).length

  // Recipe editor works on the FULL dim_ingredients list (allIngredients):
  // production consumes warehouse-only raw materials (flour, cream cheese…),
  // so the store-facing filtered list would hide most of the recipe.
  const allIngredients = config.allIngredients?.length ? config.allIngredients : config.ingredients
  const selectedRecipe    = config.recipes[selected] ?? {}
  const recipeIngredients = allIngredients.filter(i => (selectedRecipe[i.id] ?? 0) > 0)
  const unusedIngredients = allIngredients.filter(i => !((selectedRecipe[i.id] ?? 0) > 0))
  const selectedProductUnit = allIngredients.find(i => i.name === selected)?.unit || 'ед.'
  const selectedDim = dimRows.find(p => p.productRu === selected) || null
  const selectedIsOrphan = useCatalog && !catalogNames.has(selected) && Object.keys(selectedRecipe).length > 0

  const startEditing = () => {
    const draft = {}
    recipeIngredients.forEach(i => { draft[i.id] = String(selectedRecipe[i.id] ?? '') })
    setDraftQtys(draft)
    setDraftUnitPay(config.unitPay?.[selected] != null ? String(config.unitPay[selected]) : '')
    setEditing(true)
  }

  const resetIngPicker = () => { setIngSearch(''); setIngOpen(false) }

  const cancelEditing = () => {
    setEditing(false)
    setDraftQtys({})
    setDraftUnitPay(config.unitPay?.[selected] != null ? String(config.unitPay[selected]) : '')
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
    saveUnitPay?.(selected, draftUnitPay)
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
    setDraftUnitPay(config.unitPay?.[p] != null ? String(config.unitPay[p]) : '')
    setConfirmDelete(false)
    setAdding(false)
    setCreating(false)
    setNewIng({ ingredientId: '', qty: '' })
    setNewIngDef({ name: '', unit: '' })
    resetIngPicker()
  }

  const deleteRecipe = (name) => {
    setConfig(prev => {
      if (!prev.recipes[name]) return prev
      const recipes = { ...prev.recipes }
      delete recipes[name]
      return { ...prev, recipes }
    })
    setSelected(null)
    setConfirmDelete(false)
  }

  // Two-click guard: first click arms, second click deletes.
  const deleteRecipeFlow = () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteRecipe(selected)
  }

  // In editing mode, show ingredients currently in draft (may differ from saved)
  const draftIngredients = editing
    ? allIngredients.filter(i => i.id in draftQtys)
    : recipeIngredients
  const draftUnused = allIngredients.filter(i => !(i.id in draftQtys))

  return (
    <div className="flex flex-col md:flex-row gap-4 h-full">
      {/* Left: product list (hidden on mobile if selected) */}
      <div className={`w-full md:w-72 flex-shrink-0 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 border-b border-gray-100 space-y-2">
          {!useCatalog && (
            <p className={`text-[11px] leading-snug px-2 py-1.5 rounded border mb-1 ${
              lhConnected ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-500 border-gray-200'
            }`}>
              {lhConnected ? t('recipes.catalogNoData') : t('recipes.catalogOffline')}
            </p>
          )}
          <input type="text" placeholder={t('recipes.searchPlaceholder')} value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1 flex-wrap">
          {/* Orphans chip only makes sense once the catalog is loaded — in the
              legacy fallback every product is "not in catalog" by definition. */}
          {[['all', t('common.all')], ['has_recipe', t('recipes.hasRecipe')], ['no_recipe', t('recipes.noRecipeFilter')], ['no_recent_sales', t('recipes.filterNoRecentSales')], ...(useCatalog ? [['orphans', t('recipes.chipOrphans')]] : [])].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={id === 'orphans'
                  ? `w-full px-2 py-1 text-xs rounded font-medium transition-colors ${
                      filter === id ? 'bg-rose-100 text-rose-700' : 'bg-rose-50 text-rose-600/70 hover:bg-rose-100'
                    }`
                  : `flex-1 min-w-fit px-2 py-1 text-xs rounded font-medium transition-colors ${
                      filter === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                {label}
              </button>
            ))}
          </div>
          {useCatalog && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="all">{t('common.all')} · {t('recipes.catalog')}</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        <div className="overflow-y-auto flex-1">
          {filter === 'orphans' ? (
            <Fragment>
              <div className="px-3 py-2 bg-rose-50/60 border-b border-rose-100">
                <p className="text-[11px] leading-snug text-rose-700/90">
                  {t('recipes.orphanListHint')}
                </p>
              </div>
              {displayedOrphans.length === 0
                ? <p className="px-4 py-8 text-sm text-gray-400 text-center">{t('recipes.noMatch')}</p>
                : displayedOrphans.map(o => (
                    <button key={o} onClick={() => handleSelectProduct(o)}
                      className={`w-full text-left px-4 py-3 border-b border-rose-100 transition-colors ${
                        selected === o ? 'bg-rose-50 border-l-4 border-l-rose-500' : 'hover:bg-rose-50/50'
                      }`}>
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="text-sm font-medium text-gray-800 truncate leading-snug">{o}</p>
                        {!useCatalog && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200 whitespace-nowrap">{t('recipes.notInCatalog')}</span>}
                      </div>
                    </button>
                  ))}
            </Fragment>
          ) : visibleCount === 0
            ? <p className="px-4 py-8 text-sm text-gray-400 text-center">{t('recipes.noMatch')}</p>
            : useCatalog
              ? displayedGroups.map(g => {
                  const hasVariants = g.children.length > 1
                  return (
                    <Fragment key={g.key}>
                      {hasVariants && (
                        <div className="px-4 pt-2 pb-1 bg-gray-50/80 border-b border-gray-100 sticky top-0 z-10">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">{g.name}</p>
                        </div>
                      )}
                      {g.children.map(p => (
                        <ProductRow
                          key={p.productRu}
                          name={p.productRu}
                          variant={hasVariants ? p.variant : null}
                          dim={p}
                          selected={selected === p.productRu}
                          indent={hasVariants}
                          recipeCount={Object.values(config.recipes[p.productRu] ?? {}).reduce((n, v) => n + (v > 0 ? 1 : 0), 0)}
                          soldRecently={soldRecently(p.productRu)}
                          unitPay={config.unitPay?.[p.productRu]}
                          onSelect={() => handleSelectProduct(p.productRu)}
                        />
                      ))}
                    </Fragment>
                  )
                })
              : legacyDisplayed.map(p => (
                  <ProductRow
                    key={p.productRu}
                    name={p.productRu}
                    dim={null}
                    selected={selected === p.productRu}
                    recipeCount={Object.values(config.recipes[p.productRu] ?? {}).reduce((n, v) => n + (v > 0 ? 1 : 0), 0)}
                    soldRecently={soldRecently(p.productRu)}
                    unitPay={config.unitPay?.[p.productRu]}
                    onSelect={() => handleSelectProduct(p.productRu)}
                  />
                ))}
        </div>

        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{visibleCount} / {totalProducts}</p>
            {noRecipeCount > 0 && <p className="text-xs text-amber-500">{t('recipes.missing', { count: noRecipeCount })}</p>}
          </div>
        </div>
      </div>

      {/* Right: recipe viewer / editor */}
      {selected ? (
        <div className={`flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white ${!selected ? 'hidden md:flex' : 'flex'}`}>
          <div className={`px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${editing ? 'bg-blue-50' : selectedIsOrphan ? 'bg-rose-50' : 'bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelected(null)} className="md:hidden text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900">{selected}</h3>
                  {selectedIsOrphan && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
                      {t('recipes.notInCatalog')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedDim
                    ? [selectedDim.category, selectedDim.variant].filter(Boolean).join(' · ') + ` · ${t('recipes.parentProductEnShort')}: ${selectedDim.parentProductEn || '—'}`
                    : selectedIsOrphan
                      ? t('recipes.orphanHint')
                      : editing
                        ? 'Editing Production Recipe'
                        : 'Viewing Production Recipe'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
              {selectedIsOrphan && !editing && (
                <button onClick={deleteRecipeFlow}
                  className={`text-xs px-3 py-1.5 border rounded-lg transition-colors ${
                    confirmDelete
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                      : 'border-red-200 text-red-600 hover:bg-red-50'
                  }`}>
                  {confirmDelete ? '✓ ' + t('common.confirm') : t('recipes.deleteRecipe')}
                </button>
              )}
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
              ) : !selectedIsOrphan && (
                <button onClick={startEditing}
                  className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium">
                  {t('recipes.modify')}
                </button>
              )}
            </div>
          </div>

          {/* Cook Pay Rate Section */}
          <div className="px-5 py-3 bg-gray-50/70 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                ₽
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-800 block">{t('recipes.unitPay')}</span>
                <span className="text-[11px] text-gray-400">{t('recipes.unitPayHint')}</span>
              </div>
            </div>
            <div>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-500">₽</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={draftUnitPay}
                    onChange={e => setDraftUnitPay(e.target.value)}
                    className="w-24 border border-blue-300 rounded-lg px-2.5 py-1 text-sm font-mono font-medium text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  <span className="text-xs text-gray-500">/ {selectedProductUnit}</span>
                </div>
              ) : (
                config.unitPay?.[selected] != null && config.unitPay[selected] > 0 ? (
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-blue-900 font-mono bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                    ₽{Number(config.unitPay[selected]).toLocaleString()} <span className="text-xs font-normal text-gray-500">/ {selectedProductUnit}</span>
                  </span>
                ) : (
                  <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1 rounded-lg">
                    {t('recipes.noRate')}
                  </span>
                )
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
                      <td className="px-5 py-2.5 font-medium text-gray-800">
                        {ing.name}
                        {ing.warehouseOnly && (
                          <span title="Handled at the Warehouse (WHS) — no store-level stock"
                            className="ml-1.5 align-middle text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                            WHS
                          </span>
                        )}
                      </td>
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
        <div className="hidden md:flex flex-1 border border-gray-200 rounded-xl bg-gray-50/50 items-center justify-center">
          <p className="text-sm text-gray-400">{t('recipes.selectProduct')}</p>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Recipes() {
  const [tab, setTab] = useState('ingredients')
  const { exportConfig, importConfig, refreshRecipes } = useConfig()
  const { t } = useLanguage()
  const importRef = useRef()
  const [importError, setImportError] = useState(null)
  const [recalcing, setRecalcing] = useState(false)
  const [recalcOk, setRecalcOk] = useState(false)

  const handleRecalc = async () => {
    setRecalcing(true)
    try {
      await refreshRecipes()
      setRecalcOk(true)
      setTimeout(() => setRecalcOk(false), 2000)
    } catch (e) {
      console.error('Recalc failed:', e)
      alert('Failed to refresh recipes: ' + e.message)
    } finally {
      setRecalcing(false)
    }
  }

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
    <div className="p-4 flex flex-col h-[calc(100vh-140px)]">
      <div className="mb-4 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{t('recipes.title')}</h1>
        </div>
        <button
          onClick={handleRecalc}
          disabled={recalcing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${recalcing ? 'animate-spin' : ''}`} />
          {recalcOk ? t('recipes.recalcOk') : t('recipes.recalc')}
        </button>
      </div>

      <div className="flex gap-4 border-b border-gray-200 mb-4 shrink-0 overflow-x-auto">
        <button onClick={() => setTab('ingredients')}
          className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === 'ingredients' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          {t('recipes.tabIngredients')}
        </button>
        <button onClick={() => setTab('recipes')}
          className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === 'recipes' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          {t('recipes.tabRecipes')}
        </button>
        <button onClick={() => setTab('suppliers')}
          className={`pb-2 text-sm font-medium transition-colors whitespace-nowrap ${tab === 'suppliers' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          {t('recipes.tabSuppliers')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'ingredients' && <IngredientsTab />}
        {tab === 'recipes' && <RecipesTab />}
        {tab === 'suppliers' && <SuppliersTab />}
      </div>
    </div>
  )
}
