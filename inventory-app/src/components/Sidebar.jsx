import { useState } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'

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

export default function Sidebar({ currentPage, currentTab, onNavigate }) {
  const { listCloudBackups, saveCloudBackup, restoreCloudBackup } = useConfig()
  const { lang, setLang, t } = useLanguage()

  const [saving,        setSaving]        = useState(false)
  const [restoreOpen,   setRestoreOpen]   = useState(false)
  const [backups,       setBackups]       = useState(null)  // null = not loaded yet
  const [loading,       setLoading]       = useState(false)
  const [confirmId,     setConfirmId]     = useState(null)
  const [restoring,     setRestoring]     = useState(false)
  const [msg,           setMsg]           = useState(null)  // { type: 'ok'|'err', text }

  const flash = (type, text) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3500)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { savedAt } = await saveCloudBackup()
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
    <aside className="w-56 bg-slate-800 flex flex-col h-full flex-shrink-0">
      <div className="px-6 py-5 border-b border-slate-700">
        <p className="text-white font-semibold text-sm tracking-wide">BOBA</p>
        <p className="text-slate-400 text-xs mt-0.5">Inventory Manager</p>
      </div>

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

        {/* Restore panel */}
        {restoreOpen && (
          <div className="mb-2 bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
            {loading ? (
              <p className="px-3 py-3 text-xs text-slate-400">{t('backup.loading')}</p>
            ) : backups?.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">{t('backup.noBackups')}</p>
            ) : backups?.map(b => (
              <div key={b.id} className="border-b border-slate-700 last:border-0">
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
        )}

        {/* Buttons */}
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

        {msg && (
          <p className={`px-3 text-xs ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
            {msg.text}
          </p>
        )}

        <p className="px-3 pt-1 text-slate-600 text-xs">Boba Кролик · Inventory</p>
      </div>
    </aside>
  )
}

function InventoryIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7m0 10l-8-4V7"/></svg> }
function DashIcon()     { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg> }
function AuditIcon()    { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg> }
function TxIcon()       { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg> }
function RecipeIcon()   { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg> }
function VarianceIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> }
function POIcon()       { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 12h.01M12 16h.01M8 12h.01M8 16h.01"/></svg> }
function ReportIcon()   { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> }
function UsageIcon()    { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg> }
