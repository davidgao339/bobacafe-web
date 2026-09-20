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
    if (pins.admin     && pin === pins.admin)     { onLogin('admin');     return }
    if (pins.logistics && pin === pins.logistics) { onLogin('logistics'); return }
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
  admin:     _P.inv_admin     || '7530',
  logistics: _P.inv_logistics || '9876',
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

  if (!role && !isStandalone) return <LoginScreen pins={PINS} onLogin={handleLogin} />

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
  const [activeTab, setActiveTab] = useState('levels') // 'levels' | 'ledger'
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
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 gap-4 flex-wrap">
        <div className="flex items-center gap-6">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Boba Cafe · Склад</p>
            <p className="text-xs text-gray-400">Менеджер</p>
          </div>
          <div className="flex items-center bg-gray-100 p-1 rounded-lg">
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
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasData && (
            <button onClick={handleLoad}
              className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors">
              Обновить данные
            </button>
          )}
          <button onClick={onLogout}
            className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors">
            Выйти
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto">
        {activeTab === 'levels' ? (
          <InventoryLevels onNavigate={handleNavigateFromLevels} />
        ) : (
          <UsageReport
            key={`${ledgerStore ?? 'all'}-${ledgerIngredientId ?? 'none'}`}
            initialStore={ledgerStore}
            initialIngredientId={ledgerIngredientId}
          />
        )}
      </div>
    </div>
  )
}

function AppContent({ role, onLogout }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { setLang } = useLanguage()
  useEffect(() => { if (role === 'logistics') setLang('ru') }, [role])

  const navigate = useNavigate()
  const location = useLocation()
  const isStandalone = location.pathname === '/quick-count'

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
      <main className="flex-1 overflow-auto flex flex-col">
        {!isStandalone && (
          <div className="md:hidden flex items-center px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10 no-print">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="p-1 rounded-md text-gray-600 hover:bg-gray-100"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            </button>
            <span className="ml-3 font-semibold text-gray-800 text-sm">BOBA · Inventory</span>
          </div>
        )}
        <div className="flex-1 overflow-auto bg-gray-50">
          <Routes>
            <Route path="/" element={<Navigate to="/inventory" replace />} />
            <Route path="/quick-count" element={<StandaloneCount />} />
            <Route path="/audit/:tab?" element={<AuditWrapper />} />
            <Route path="/transactions/:tab?" element={<TransactionsWrapper />} />
            <Route path="/tapioca" element={<TapiocaCookingPlan />} />
            <Route path="/recipes/:tab?" element={<RecipesWrapper />} />
            <Route path="/variance" element={<VarianceReport />} />
            <Route path="/purchases" element={<PurchaseOrdersWrapper />} />
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
