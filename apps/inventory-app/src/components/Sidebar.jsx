import { useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { DashIcon, AuditIcon, InventoryIcon, TxIcon, TapiocaIcon, RecipeIcon, VarianceIcon, POIcon, ReportIcon, UsageIcon } from '../icons'

const STAFF_NAV = [
  { id: 'dashboard', labelKey: 'nav.home',      icon: DashIcon },
  { id: 'audit',     labelKey: 'nav.countStock', icon: AuditIcon, children: [
    { id: 'count',   labelKey: 'audit.tabCount' },
    { id: 'history', labelKey: 'audit.tabHistory' },
    { id: 'import',  labelKey: 'audit.tabImport' },
  ]},
]

const MANAGER_NAV = [
  { id: 'inventory',    labelKey: 'nav.inventory',     icon: InventoryIcon },
  { id: 'transactions', labelKey: 'nav.transactions',  icon: TxIcon, children: [
    { id: 'sales',  labelKey: 'tx.tabSales' },
    { id: 'waste',  labelKey: 'tx.tabWaste' },
  ]},
  { id: 'tapioca',  labelKey: 'nav.tapioca', icon: TapiocaIcon },
  { id: 'recipes', labelKey: 'nav.recipes', icon: RecipeIcon, children: [
    { id: 'ingredients', labelKey: 'recipes.tabIngredients' },
    { id: 'recipes',     labelKey: 'recipes.tabRecipes' },
    { id: 'suppliers',   labelKey: 'recipes.tabSuppliers' },
  ]},
  { id: 'variance',  labelKey: 'nav.losses',        icon: VarianceIcon },
  { id: 'purchases', labelKey: 'nav.purchases',     icon: POIcon },
  { id: 'report',    labelKey: 'nav.replenishment', icon: ReportIcon },
  { id: 'usage',     labelKey: 'nav.usage',         icon: UsageIcon },
]

function NavItem({ id, labelKey, icon: Icon, children, currentPage, currentTab, onNavigate }) {
  const { t } = useLanguage()
  const isActive = currentPage === id
  return (
    <div>
      <button
        onClick={() => onNavigate(id)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
        }`}
      >
        <Icon />
        <span className="flex-1 text-left">{t(labelKey)}</span>
        {children && (
          <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${isActive ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
          </svg>
        )}
      </button>
      {isActive && children && (
        <div className="mt-0.5 ml-4 pl-3 border-l border-slate-600 flex flex-col gap-0.5 pb-1">
          {children.map(child => (
            <button key={child.id} onClick={() => onNavigate(id, child.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                currentTab === child.id
                  ? 'text-white bg-slate-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}>
              {t(child.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ mobileOpen, onMobileClose, onLogout, role }) {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPage = location.pathname.split('/')[1] || 'dashboard'
  const currentTab = location.pathname.split('/')[2] || null
  const onNavigate = (pageId, tabId = null) => {
    navigate(`/${pageId}${tabId ? '/' + tabId : ''}`)
    if (onMobileClose) onMobileClose()
  }

  const { listCloudBackups, saveCloudBackup, restoreCloudBackup, stores, toggleStoreVisibility, suppressedStores, config, data, salesCache, importConfig, settings, saveSettings } = useConfig()

  const handleDownloadJson = () => {
    const payload = { exportedAt: new Date().toISOString(), config, data, salesCache: salesCache ?? null }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `inventory-debug-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const fileInputRef = useRef(null)
  
  const handleUploadJson = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    try {
      const file = e.target.files?.[0]
      if (!file) return
      await importConfig(file)
      flash('ok', 'Data imported successfully')
    } catch (err) {
      flash('err', 'Failed to import JSON')
    }
    // reset input so same file can be uploaded again if needed
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const { lang, setLang, t } = useLanguage()

  const [saving,        setSaving]        = useState(false)
  const [restoreOpen,   setRestoreOpen]   = useState(false)
  const [backups,       setBackups]       = useState(null)  // null = not loaded yet
  const [loading,       setLoading]       = useState(false)
  const [confirmId,     setConfirmId]     = useState(null)
  const [restoring,     setRestoring]     = useState(false)
  const [storesOpen,    setStoresOpen]    = useState(false)
  const [msg,           setMsg]           = useState(null)  // { type: 'ok'|'err', text }

  const flash = (type, text) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3500)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { savedAt } = await saveCloudBackup(true)
      flash('ok', `Saved — ${new Date(savedAt).toLocaleTimeString()}`)
      // Invalidate cached list so next open re-fetches
      setBackups(null)
    } catch (e) {
      flash('err', t('backup.saveFailed', { error: e.message }))
    } finally {
      setSaving(false)
    }
  }

  const handleOpenRestore = async () => {
    if (restoreOpen) { setRestoreOpen(false); setConfirmId(null); return }
    setRestoreOpen(true)
    if (backups !== null) return   // already loaded
    setLoading(true)
    try {
      const list = await listCloudBackups()
      setBackups(list)
    } catch (e) {
      flash('err', t('backup.loadFailed', { error: e.message }))
      setRestoreOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (id) => {
    setRestoring(true)
    try {
      await restoreCloudBackup(id)
      flash('ok', t('backup.restored'))
      setRestoreOpen(false)
      setConfirmId(null)
    } catch (e) {
      flash('err', t('backup.restoreFailed', { error: e.message }))
    } finally {
      setRestoring(false)
    }
  }

  const fmt = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}
    <aside className={`w-56 bg-slate-800 flex flex-col h-full flex-shrink-0 ${
      mobileOpen
        ? 'fixed inset-y-0 left-0 z-50'
        : 'hidden md:flex'
    }`}>
      <div className="px-6 py-5 border-b border-slate-700">
        <p className="text-white font-semibold text-sm tracking-wide">BOBA</p>
        <p className="text-slate-400 text-xs mt-0.5">Inventory Manager</p>
      </div>

      {/* Data freshness — every estimate depends on the last sales sync */}
      {(() => {
        const last = salesCache?.lastRefreshDate
        const daysAgo = last ? Math.floor((Date.now() - new Date(last + 'T12:00:00')) / 86400000) : null
        const tone = last == null ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60'
          : daysAgo <= 1 ? 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
          : daysAgo <= 3 ? 'bg-amber-900/40 text-amber-300 hover:bg-amber-900/60'
          :                'bg-red-900/40 text-red-300 hover:bg-red-900/60'
        return (
          <button onClick={() => onNavigate('transactions', 'sales')}
            title={t('nav.refreshHint')}
            className={`mx-3 mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${tone}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              last == null || daysAgo > 3 ? 'bg-red-400' : daysAgo > 1 ? 'bg-amber-400' : 'bg-green-400'
            }`} />
            <span className="truncate">
              {last ? t('nav.dataThrough', { date: last }) : t('nav.noSalesData')}
            </span>
          </button>
        )
      })()}

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {STAFF_NAV.map(item => (
          <NavItem key={item.id} {...item} currentPage={currentPage} currentTab={currentTab} onNavigate={onNavigate} />
        ))}

        <div className="my-3 border-t border-slate-700" />
        <p className="px-3 text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{t('nav.manager')}</p>

        {MANAGER_NAV.map(item => (
          <NavItem key={item.id} {...item} currentPage={currentPage} currentTab={currentTab} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* ── Cloud backup footer ─────────────────────────────────────────────── */}
      <div className="px-3 py-3 border-t border-slate-700 space-y-1">

        {/* Language toggle */}
        <div className="flex items-center gap-1 px-1 pb-1">
          {['en', 'ru'].map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                lang === l
                  ? 'bg-white text-slate-800'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Store visibility toggle */}
        <button onClick={() => setStoresOpen(!storesOpen)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${
            storesOpen ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}>
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/></svg>
          Stores
        </button>

        {storesOpen && stores && (
          <div className="mb-2 bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
            {stores.map(store => (
              <label key={store} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-700 cursor-pointer border-b border-slate-700 last:border-0">
                <input
                  type="checkbox"
                  checked={!suppressedStores.includes(store)}
                  onChange={() => toggleStoreVisibility(store)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-200">{store}</span>
              </label>
            ))}
          </div>
        )}

        {/* Restore panel */}
        {restoreOpen && (
          <div className="mb-2 bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
            {loading ? (
              <p className="px-3 py-3 text-xs text-slate-400">{t('backup.loading')}</p>
            ) : backups?.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">{t('backup.noBackups')}</p>
            ) : (
              <div className="divide-y divide-slate-700">
                {['Manual Saves', 'Auto Saves'].map((section, idx) => {
                  const sectionBackups = backups.filter(b => (idx === 0 ? b.isManual : !b.isManual))
                  if (sectionBackups.length === 0) return null
                  return (
                    <div key={section}>
                      <p className="px-3 py-1.5 bg-slate-800 text-xs font-semibold text-slate-300 uppercase tracking-wider">{section}</p>
                      {sectionBackups.map(b => (
                        <div key={b.id} className="border-t border-slate-700 first:border-0">
                          {confirmId === b.id ? (
                            <div className="px-3 py-2 flex items-center gap-2">
                              <span className="text-xs text-slate-300 flex-1">{t('backup.restoreThis')}</span>
                              <button
                                onClick={() => handleRestore(b.id)}
                                disabled={restoring}
                                className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                {restoring ? t('backup.restoring') : t('common.yes')}
                              </button>
                              <button onClick={() => setConfirmId(null)}
                                className="text-xs text-slate-400 hover:text-slate-200">{t('common.no')}</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmId(b.id)}
                              className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors">
                              <p className="text-xs text-slate-200 font-medium">{fmt(b.savedAt)}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {t('backup.meta', { ingredients: b.ingredientCount, audits: b.auditCount, pos: b.poCount })}
                              </p>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Admin Tools */}
        {role === 'admin' && (
          <details className="group">
            <summary className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer list-none select-none">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Advanced Tools
              <svg className="w-3 h-3 ml-auto transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </summary>
            <div className="mt-1 ml-2 pl-2 border-l border-slate-700 space-y-1">
              <button onClick={handleDownloadJson}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                Download JSON (debug)
              </button>
              <button onClick={handleUploadJson}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12"/></svg>
                Upload JSON (debug)
              </button>
              <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              <label className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={!!settings?.autoSaveCloud} 
                  onChange={e => saveSettings({ ...settings, autoSaveCloud: e.target.checked })}
                  className="rounded border-gray-600 bg-slate-800 text-blue-500 focus:ring-blue-500" 
                />
                Auto-save to Cloud
              </label>
              <button onClick={handleSave} disabled={saving}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                {saving ? t('backup.saving') : t('backup.saveToCloud')}
              </button>
              <button onClick={handleOpenRestore}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs transition-colors ${
                  restoreOpen ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12"/></svg>
                {t('backup.restoreBackup')}
              </button>
            </div>
          </details>
        )}

        {msg && (
          <p className={`px-3 text-xs ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {msg.text}
          </p>
        )}

        {onLogout && (
          <button onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            Sign out
          </button>
        )}

        <p className="px-3 pt-1 text-slate-600 text-xs">Boba Кролик · Inventory</p>
      </div>
    </aside>
    </>
  )
}
