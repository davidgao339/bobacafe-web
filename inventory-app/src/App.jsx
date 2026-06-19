import { useState, useEffect } from 'react'
import { ConfigProvider, useConfig } from './context/ConfigContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import InventoryAudit from './pages/InventoryAudit'
import Transactions from './pages/Transactions'
import ReplenishmentReport from './pages/ReplenishmentReport'
import TapiocaCookingPlan from './pages/TapiocaCookingPlan'
import Recipes from './pages/Recipes'
import VarianceReport from './pages/VarianceReport'
import PurchaseOrders from './pages/PurchaseOrders'
import InventoryLevels from './pages/InventoryLevels'
import UsageReport from './pages/UsageReport'

export default function App() {
  return (
    <LanguageProvider>
      <ConfigProvider>
        <AppRoot />
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

function AppRoot() {
  const { config } = useConfig()
  const [role, setRole] = useState(() => sessionStorage.getItem('invRole') ?? null)

  const pins     = config?.pins ?? { admin: '', logistics: '' }
  const hasAuth  = !!(pins.admin || pins.logistics)

  const handleLogin  = (newRole) => { sessionStorage.setItem('invRole', newRole); setRole(newRole) }
  const handleLogout = ()        => { sessionStorage.removeItem('invRole');        setRole(null) }

  if (!role && hasAuth) return <LoginScreen pins={pins} onLogin={handleLogin} />

  return <AppContent role={role ?? 'admin'} onLogout={handleLogout} hasAuth={hasAuth} />
}

const DEFAULT_TABS = {
  audit:        'count',
  transactions: 'sales',
  recipes:      'ingredients',
}

function AppContent({ role, onLogout, hasAuth }) {
  const [page,          setPage]          = useState('dashboard')
  const [subTab,        setSubTab]        = useState(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { setLang } = useLanguage()
  useEffect(() => { if (role === 'logistics') setLang('ru') }, [role])

  const navigate = (pageId, tabId = null) => {
    setPage(pageId)
    setSubTab(tabId ?? DEFAULT_TABS[pageId] ?? null)
    setMobileNavOpen(false)
  }

  if (role === 'logistics') {
    return (
      <div className="flex flex-col h-screen bg-gray-50">
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <div>
            <p className="font-semibold text-gray-800 text-sm">Боба Кролик · Склад</p>
            <p className="text-xs text-gray-400">Логистика</p>
          </div>
          <button onClick={onLogout}
            className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 border border-gray-200 rounded-md transition-colors">
            Выйти
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          <InventoryLevels />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="no-print">
        <Sidebar
          currentPage={page} currentTab={subTab} onNavigate={navigate}
          mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)}
          onLogout={hasAuth ? onLogout : null}
        />
      </div>
      <main className="flex-1 overflow-auto flex flex-col">
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
        <div className="flex-1 overflow-auto">
          {page === 'dashboard'    && <Dashboard onNavigate={navigate} />}
          {page === 'audit'        && <InventoryAudit activeTab={subTab ?? 'count'} onTabChange={t => setSubTab(t)} />}
          {page === 'transactions' && <Transactions   activeTab={subTab ?? 'sales'} onTabChange={t => setSubTab(t)} />}
          {page === 'tapioca'      && <TapiocaCookingPlan />}
          {page === 'report'       && <ReplenishmentReport />}
          {page === 'recipes'      && <Recipes         activeTab={subTab ?? 'ingredients'} onTabChange={t => setSubTab(t)} />}
          {page === 'variance'     && <VarianceReport />}
          {page === 'purchases'    && <PurchaseOrders />}
          {page === 'inventory'    && <InventoryLevels />}
          {page === 'usage'        && <UsageReport />}
        </div>
      </main>
    </div>
  )
}
