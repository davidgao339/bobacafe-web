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
  const [page,   setPage]   = useState('dashboard')
  const [subTab, setSubTab] = useState(null)

  const navigate = (pageId, tabId = null) => {
    setPage(pageId)
    setSubTab(tabId ?? DEFAULT_TABS[pageId] ?? null)
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="no-print">
        <Sidebar currentPage={page} currentTab={subTab} onNavigate={navigate} />
      </div>
      <main className="flex-1 overflow-auto">
        {page === 'dashboard'    && <Dashboard onNavigate={navigate} />}
        {page === 'audit'        && <InventoryAudit activeTab={subTab ?? 'count'} onTabChange={t => setSubTab(t)} />}
        {page === 'transactions' && <Transactions   activeTab={subTab ?? 'sales'} onTabChange={t => setSubTab(t)} />}
        {page === 'report'       && <ReplenishmentReport />}
        {page === 'recipes'      && <Recipes         activeTab={subTab ?? 'ingredients'} onTabChange={t => setSubTab(t)} />}
        {page === 'variance'     && <VarianceReport />}
        {page === 'purchases'    && <PurchaseOrders />}
        {page === 'inventory'    && <InventoryLevels />}
        {page === 'usage'        && <UsageReport />}
      </main>
    </div>
  )
}
