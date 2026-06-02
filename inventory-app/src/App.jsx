import { useState } from 'react'
import { ConfigProvider } from './context/ConfigContext'
import { LanguageProvider } from './context/LanguageContext'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import InventoryAudit from './pages/InventoryAudit'
import Transactions from './pages/Transactions'
import ReplenishmentReport from './pages/ReplenishmentReport'
import Recipes from './pages/Recipes'
import VarianceReport from './pages/VarianceReport'
import PurchaseOrders from './pages/PurchaseOrders'
import InventoryLevels from './pages/InventoryLevels'
import UsageReport from './pages/UsageReport'

export default function App() {
  return (
    <LanguageProvider>
      <ConfigProvider>
        <AppContent />
      </ConfigProvider>
    </LanguageProvider>
  )
}

const DEFAULT_TABS = {
  audit:        'count',
  transactions: 'sales',
  recipes:      'ingredients',
}

function AppContent() {
  const [page,          setPage]          = useState('dashboard')
  const [subTab,        setSubTab]        = useState(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const navigate = (pageId, tabId = null) => {
    setPage(pageId)
    setSubTab(tabId ?? DEFAULT_TABS[pageId] ?? null)
    setMobileNavOpen(false)
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="no-print">
        <Sidebar
          currentPage={page} currentTab={subTab} onNavigate={navigate}
          mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)}
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
