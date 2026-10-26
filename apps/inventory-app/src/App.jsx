import { useState, useEffect } from 'react'
import { ConfigProvider, useConfig } from './context/ConfigContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import Sidebar from './components/Sidebar'
import InventoryAudit, { CountTab } from './pages/InventoryAudit'
import Transactions from './pages/Transactions'
import TapiocaCookingPlan from './pages/TapiocaCookingPlan'
import Recipes from './pages/Recipes'
import VarianceReport from './pages/VarianceReport'
import PurchaseOrders from './pages/PurchaseOrders'
import OzonDeliveries from './pages/OzonDeliveries'
import InventoryLevels from './pages/InventoryLevels'
import UsageReport from './pages/UsageReport'

import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams, Navigate, useLocation } from 'react-router-dom'

export default function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return (
    <LanguageProvider>
      <ConfigProvider>
        <BrowserRouter basename={base}>
          <AppRoot />
        </BrowserRouter>
      </ConfigProvider>
    </LanguageProvider>
  )
}

function LoginScreen({ pins, onLogin }) {
  const [pin,   setPin]   = useState('')
  const [error, setError] = useState(false)

  const submit = () => {
    if (pins.admin      && pin === pins.admin)      { onLogin('admin');      return }
    if ((pins.logistics && pin === pins.logistics) || (pins.manager && pin === pins.manager)) { onLogin('logistics'); return }
    if (pins.boba       && pin === pins.boba) {
      sessionStorage.setItem('initialTab', 'tapioca')
      onLogin('logistics')
      return
    }
    if (pins.quickCount && pin === pins.quickCount) { onLogin('quickCount'); return }
    setError(true)
    setPin('')
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-72 flex flex-col gap-4">
        <div>
          <p className="font-semibold text-gray-900 text-sm">Boba Кролик</p>
          <p className="text-xs text-gray-400 mt-0.5">Inventory Manager</p>
        </div>
        <input
          type="password"
          placeholder="PIN"
          value={pin}
          autoFocus
          onChange={e => { setPin(e.target.value); setError(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-center tracking-widest"
        />
        {error && <p className="text-xs text-red-500 text-center -mt-2">Incorrect PIN</p>}
        <button onClick={submit}
          className="w-full py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors">
          Enter
        </button>
      </div>
    </div>
  )
}

const _P = window.BC_PINS || {};
const PINS = {
  admin:      _P.inv_admin     || '7530',
  logistics:  _P.inv_logistics || '9876',
  manager:    _P.inv_manager   || _P.inv_logistics || '9876',
  boba:       _P.boba          || '1023',
  quickCount: _P.quick_count   || '1234',
}
const ADMIN_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days

function AppRoot() {
  const location = useLocation()
  const isStandalone = location.pathname === '/quick-count'

  const [role, setRole] = useState(() => {
    try {
      const stored = localStorage.getItem('invRole')
      if (stored) {
        const { role, expires } = JSON.parse(stored)
        if (expires > Date.now()) return role
        localStorage.removeItem('invRole')
      }
    } catch { localStorage.removeItem('invRole') }
    return sessionStorage.getItem('invRole') ?? null
  })

  const handleLogin = (newRole) => {
    if (newRole === 'admin') {
      localStorage.setItem('invRole', JSON.stringify({ role: newRole, expires: Date.now() + ADMIN_TTL }))
    } else {
      sessionStorage.setItem('invRole', newRole)
    }
    setRole(newRole)
  }

  const handleLogout = () => {
    localStorage.removeItem('invRole')
    sessionStorage.removeItem('invRole')
    setRole(null)
  }

  if (!role) return <LoginScreen pins={PINS} onLogin={handleLogin} />

  return <AppContent role={role} onLogout={handleLogout} />
}

const DEFAULT_TABS = {
  audit:        'count',
  transactions: 'sales',
  recipes:      'ingredients',
}

function LogisticsView({ onLogout }) {
  const { config } = useConfig()
  const { t } = useLanguage()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem('initialTab')
    if (saved) {
      sessionStorage.removeItem('initialTab')
      return saved
    }
    return location.pathname === '/tapioca' ? 'tapioca' : 'levels'
  })
  const [ledgerStore, setLedgerStore] = useState(null)
  const [ledgerIngredientId, setLedgerIngredientId] = useState(null)

  const hasData = (config.ingredients ?? []).length > 0

  const handleLoad = () => {
    window.location.reload()
  }

  const handleNavigateFromLevels = (pageId, tabId, params) => {
    if (pageId === 'usage') {
      if (params?.store) setLedgerStore(params.store)
      if (params?.ingredientId) setLedgerIngredientId(params.ingredientId)
      setActiveTab('ledger')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center justify-between px-3 md:px-4 py-2.5 md:py-3 bg-white border-b border-gray-200 gap-2">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Boba Cafe · Склад</p>
            <p className="text-xs text-gray-400">Менеджер</p>
          </div>
          <div className="hidden md:flex items-center bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('levels')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'levels'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('nav.inventory')}
            </button>
            <button
              onClick={() => setActiveTab('ledger')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'ledger'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('nav.usage')}
            </button>
            <button
              onClick={() => setActiveTab('tapioca')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'tapioca'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('nav.tapioca')}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          {hasData && (
            <button onClick={handleLoad}
              className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors">
              Обновить
            </button>
          )}
          <button onClick={onLogout}
            className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors">
            Выйти
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto pb-16 md:pb-0">
        {activeTab === 'levels' ? (
          <InventoryLevels onNavigate={handleNavigateFromLevels} />
        ) : activeTab === 'ledger' ? (
          <UsageReport
            key={`${ledgerStore ?? 'all'}-${ledgerIngredientId ?? 'none'}`}
            initialStore={ledgerStore}
            initialIngredientId={ledgerIngredientId}
          />
        ) : (
          <TapiocaCookingPlan />
        )}
      </div>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-white/95 border-t border-gray-200/80 px-2 py-1 flex items-center justify-around shadow-[0_-4px_16px_rgba(0,0,0,0.06)] no-print pb-[env(safe-area-inset-bottom,0px)]">
        <button
          onClick={() => setActiveTab('levels')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
            activeTab === 'levels' ? 'text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'levels' ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
          <span className="text-[10px] mt-0.5 leading-tight">{t('nav.inventory')}</span>
          {activeTab === 'levels' && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-600" />}
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
            activeTab === 'ledger' ? 'text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'ledger' ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
          </svg>
          <span className="text-[10px] mt-0.5 leading-tight">{t('nav.usage')}</span>
          {activeTab === 'ledger' && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-600" />}
        </button>
        <button
          onClick={() => setActiveTab('tapioca')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
            activeTab === 'tapioca' ? 'text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className={`w-5 h-5 transition-transform duration-200 ${activeTab === 'tapioca' ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
          </svg>
          <span className="text-[10px] mt-0.5 leading-tight">{t('nav.tapioca')}</span>
          {activeTab === 'tapioca' && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-600" />}
        </button>
      </nav>
    </div>
  )
}

function MobileBottomNav({ onOpenMenu }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const current = location.pathname.split('/')[1] || 'inventory'

  const items = [
    {
      id: 'inventory',
      path: '/inventory',
      label: t('nav.inventory'),
      icon: (active) => (
        <svg className={`w-5 h-5 transition-transform duration-200 ${active ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
        </svg>
      )
    },
    {
      id: 'purchases',
      path: '/purchases',
      label: t('nav.po') || 'PO',
      icon: (active) => (
        <svg className={`w-5 h-5 transition-transform duration-200 ${active ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      )
    },
    {
      id: 'transactions',
      path: '/transactions',
      label: t('nav.transactions'),
      icon: (active) => (
        <svg className={`w-5 h-5 transition-transform duration-200 ${active ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
        </svg>
      )
    },
    {
      id: 'usage',
      path: '/usage',
      label: t('nav.usage'),
      icon: (active) => (
        <svg className={`w-5 h-5 transition-transform duration-200 ${active ? 'scale-110 text-blue-600' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
      )
    },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-white/95 border-t border-gray-200/80 px-1 py-1 flex items-center justify-around shadow-[0_-4px_16px_rgba(0,0,0,0.06)] no-print pb-[env(safe-area-inset-bottom,0px)]">
      {items.map(item => {
        const active = current === item.id
        return (
          <button
            key={item.id}
            data-testid={`mobile-nav-${item.id}`}
            onClick={() => navigate(item.path)}
            className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
              active ? 'text-blue-600 font-semibold' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {item.icon(active)}
            <span className="text-[10px] mt-0.5 truncate max-w-[64px] leading-tight text-center">{item.label}</span>
            {active && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-600 transition-all duration-300" />}
          </button>
        )
      })}
      <button
        data-testid="mobile-nav-more"
        onClick={onOpenMenu}
        className="relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] text-gray-500 hover:text-gray-900 active:scale-90 transition-transform duration-150 select-none"
      >
        <svg className="w-5 h-5 text-gray-500 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
        <span className="text-[10px] mt-0.5 leading-tight text-center">{t('nav.more')}</span>
      </button>
    </nav>
  )
}

function AppContent({ role, onLogout }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { setLang } = useLanguage()
  useEffect(() => { if (role === 'logistics') setLang('ru') }, [role])

  const navigate = useNavigate()
  const location = useLocation()
  const isStandalone = location.pathname === '/quick-count'

  if (role === 'quickCount' && !isStandalone) {
    return <Navigate to="/quick-count" replace />
  }

  if (isStandalone) {
    return <StandaloneCount />
  }

  if (role === 'logistics') {
    return <LogisticsView onLogout={onLogout} />
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {!isStandalone && (
        <div className="no-print">
          <Sidebar
            mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)}
            onLogout={onLogout} role={role}
          />
        </div>
      )}
      <main className="flex-1 overflow-hidden flex flex-col">
        {!isStandalone && (
          <div className="md:hidden flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 sticky top-0 z-10 no-print">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="p-1.5 -ml-1 rounded-md text-gray-600 hover:bg-gray-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
                </svg>
              </button>
              <span className="font-semibold text-gray-800 text-sm">BOBA · Inventory</span>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
        <div key={location.pathname.split('/')[1] || 'inventory'} className="flex-1 overflow-auto bg-gray-50 pb-16 md:pb-0 animate-page-enter">
          <Routes>
            <Route path="/" element={<Navigate to="/inventory" replace />} />
            <Route path="/quick-count" element={<StandaloneCount />} />
            <Route path="/audit/:tab?" element={<AuditWrapper />} />
            <Route path="/transactions/:tab?" element={<TransactionsWrapper />} />
            <Route path="/tapioca" element={<TapiocaCookingPlan />} />
            <Route path="/recipes/:tab?" element={<RecipesWrapper />} />
            <Route path="/variance" element={<VarianceReport />} />
            <Route path="/purchases" element={<PurchaseOrdersWrapper />} />
            <Route path="/ozon" element={<OzonDeliveries />} />
            <Route path="/inventory" element={<InventoryLevels onNavigate={(pageId, tabId, params) => {
              const url = `/${pageId}${tabId ? '/' + tabId : ''}`
              if (params) {
                const search = new URLSearchParams(params).toString()
                navigate(`${url}?${search}`)
              } else {
                navigate(url)
              }
            }} />} />
            <Route path="/usage" element={<UsageReportWrapper />} />
            <Route path="*" element={<Navigate to="/inventory" replace />} />
          </Routes>
        </div>
        <MobileBottomNav onOpenMenu={() => setMobileNavOpen(true)} />
      </main>
    </div>
  )
}

function AuditWrapper() {
  const { tab } = useParams()
  const navigate = useNavigate()
  return <InventoryAudit activeTab={tab ?? 'count'} onTabChange={t => navigate(`/audit/${t}`)} />
}

function TransactionsWrapper() {
  const { tab } = useParams()
  const navigate = useNavigate()
  return <Transactions activeTab={tab ?? 'sales'} onTabChange={t => navigate(`/transactions/${t}`)} />
}

function RecipesWrapper() {
  const { tab } = useParams()
  const navigate = useNavigate()
  return <Recipes activeTab={tab ?? 'ingredients'} onTabChange={t => navigate(`/recipes/${t}`)} />
}

function PurchaseOrdersWrapper() {
  const [searchParams] = useSearchParams()
  return <PurchaseOrders initialCreate={searchParams.get('createPO') === 'true'} />
}

function UsageReportWrapper() {
  const [searchParams] = useSearchParams()
  return <UsageReport initialStore={searchParams.get('store')} initialIngredientId={searchParams.get('ingredientId') ? parseInt(searchParams.get('ingredientId'), 10) : null} />
}

function StandaloneCount() {
  const { stores } = useConfig()
  const { setLang } = useLanguage()

  useEffect(() => {
    setLang('ru')
  }, [setLang])

  const [store, setStore] = useState(stores?.[0] || 'Store 1')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [confirmed, setConfirmed] = useState(false)

  if (!confirmed) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 p-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-full max-w-md flex flex-col gap-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Шаг 1: Подтвердите филиал</h1>
            <p className="text-sm text-gray-500 mt-1">Пожалуйста, дважды проверьте, что вы проводите инвентаризацию для правильного филиала.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Филиал</label>
            <select value={store} onChange={e => setStore(e.target.value)} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50">
              {stores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={() => setConfirmed(true)} className="w-full py-3 bg-blue-600 text-white text-base font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
            Начать инвентаризацию →
          </button>
          <div className="text-center mt-2">
             <a href="/" className="text-xs text-gray-400 hover:text-gray-600">Отмена и возврат в приложение</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto h-full overflow-auto">
      <div className="mb-6 bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Быстрая инвентаризация</h1>
          <p className="text-sm text-gray-500 mt-1">Филиал: <span className="font-semibold text-blue-700 px-2 py-0.5 bg-blue-50 rounded-md ml-1">{store}</span></p>
        </div>
        <button onClick={() => setConfirmed(false)} className="text-sm text-blue-600 hover:text-blue-800">Изменить филиал</button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <CountTab store={store} setStore={setStore} date={date} setDate={setDate} hideHeader={true} />
      </div>
    </div>
  )
}
