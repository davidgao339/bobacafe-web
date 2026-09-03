import { useState, useEffect } from 'react'
import { ConfigProvider, useConfig } from './context/ConfigContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { ClipboardList, Package, PlusCircle, Factory, RefreshCw, Settings, LogOut, Layers } from 'lucide-react'
import InventoryLevels from './pages/InventoryLevels'
import PurchaseOrders from './pages/PurchaseOrders'
import Production from './pages/Production'
import Adjustments from './pages/Adjustments'
import Recipes from './pages/Recipes'
import Audit from './pages/Audit'
import Ledger from './pages/Ledger'





export default function App() {
  return (
    <LanguageProvider>
      <ConfigProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AppRoot />
        </BrowserRouter>
      </ConfigProvider>
    </LanguageProvider>
  )
}

function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const PINS = { admin: window.BC_PINS?.inv_admin || '7530', warehouse: window.BC_PINS?.warehouse || '1122' }

  const submit = () => {
    if (pin === PINS.admin) { onLogin('admin'); return }
    if (pin === PINS.warehouse) { onLogin('warehouse'); return }
    setError(true); setPin('')
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-72 flex flex-col gap-4">
        <div className="text-center">
          <Factory className="w-8 h-8 mx-auto text-blue-600 mb-2" />
          <p className="font-semibold text-gray-900 text-sm">Boba Кролик</p>
          <p className="text-xs text-gray-400 mt-0.5">Warehouse System</p>
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
        <button onClick={submit} className="w-full py-2 bg-blue-600 text-white font-medium text-sm rounded-lg hover:bg-blue-700 transition-colors">
          Enter
        </button>
      </div>
    </div>
  )
}

function AppRoot() {
  const [role, setRole] = useState(() => localStorage.getItem('whRole') ?? null)

  const handleLogin = (newRole) => {
    localStorage.setItem('whRole', newRole)
    setRole(newRole)
  }

  const handleLogout = () => {
    localStorage.removeItem('whRole')
    setRole(null)
  }

  if (!role) return <LoginScreen onLogin={handleLogin} />
  return <AppContent role={role} onLogout={handleLogout} />
}

function AppContent({ role, onLogout }) {
  const navigate = useNavigate()
  const { config } = useConfig()
  const hasData = (config.ingredients ?? []).length > 0

  const handleLoad = () => {
    window.location.reload()
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 pb-16">
      {/* Mobile Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Factory className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-900 text-sm">Warehouse</span>
        </div>
        <div className="flex items-center gap-2">
          {hasData && (
            <button onClick={handleLoad} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"><RefreshCw className="w-4 h-4" /></button>
          )}
          <button onClick={onLogout} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryLevels />} />
          <Route path="/pos" element={<PurchaseOrders />} />
          <Route path="/production" element={<Production />} />
          <Route path="/adjustments" element={<Adjustments />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/ledger" element={<Ledger />} />
        </Routes>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 w-full bg-white border-t border-gray-200 flex items-center overflow-x-auto pb-safe custom-scrollbar">
        <NavItem to="/inventory" icon={<Layers className="w-5 h-5" />} label="Inventory" />
        <NavItem to="/pos" icon={<ClipboardList className="w-5 h-5" />} label="Receive" />
        <NavItem to="/production" icon={<Package className="w-5 h-5" />} label="Produce" />
        <NavItem to="/audit" icon={<ClipboardList className="w-5 h-5" />} label="Audit" />
        <NavItem to="/ledger" icon={<Settings className="w-5 h-5" />} label="Ledger" />
        <NavItem to="/recipes" icon={<Settings className="w-5 h-5" />} label="Recipes" />
        <NavItem to="/adjustments" icon={<PlusCircle className="w-5 h-5" />} label="Adjust" />
      </nav>
    </div>
  )
}

function NavItem({ to, icon, label }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = location.pathname.startsWith(to)
  return (
    <button onClick={() => navigate(to)} className={`flex-shrink-0 flex flex-col items-center justify-center w-20 py-2 ${isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}>
      {icon}
      <span className="text-[10px] font-medium mt-1">{label}</span>
    </button>
  )
}
