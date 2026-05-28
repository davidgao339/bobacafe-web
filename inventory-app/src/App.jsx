import { useState } from 'react'
import { ConfigProvider } from './context/ConfigContext'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import InventoryAudit from './pages/InventoryAudit'
import Transactions from './pages/Transactions'
import ReplenishmentReport from './pages/ReplenishmentReport'
import Recipes from './pages/Recipes'
import VarianceReport from './pages/VarianceReport'
import PurchaseOrders from './pages/PurchaseOrders'

export default function App() {
  return (
    <ConfigProvider>
      <AppContent />
    </ConfigProvider>
  )
}

function AppContent() {
  const [page, setPage] = useState('dashboard')

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="no-print">
        <Sidebar currentPage={page} onNavigate={setPage} />
      </div>
      <main className="flex-1 overflow-auto">
        {page === 'dashboard'    && <Dashboard onNavigate={setPage} />}
        {page === 'audit'        && <InventoryAudit />}
        {page === 'transactions' && <Transactions />}
        {page === 'report'       && <ReplenishmentReport />}
        {page === 'recipes'      && <Recipes />}
        {page === 'variance'     && <VarianceReport />}
        {page === 'purchases'    && <PurchaseOrders />}

      </main>
    </div>
  )
}
