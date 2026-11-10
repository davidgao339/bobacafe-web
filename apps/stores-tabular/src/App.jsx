import { useState, useEffect, useMemo } from 'react'
import { ConfigProvider, useConfig } from './context/ConfigContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { BrowserRouter, Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { ClipboardList, Package, PlusCircle, Factory, RefreshCw, Settings, LogOut, Layers } from 'lucide-react'
import InventoryLevels from './pages/InventoryLevels'
import PurchaseOrders from './pages/PurchaseOrders'
import Adjustments from './pages/Adjustments'
import Recipes from './pages/Recipes'
import Ledger from './pages/Ledger'
import OzonDeliveries from './pages/OzonDeliveries'
import SettingsModal from './components/SettingsModal'





export default function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return (
    <ConfigProvider>
      <LanguageProvider>
        <BrowserRouter basename={base}>
          <AppRoot />
        </BrowserRouter>
      </LanguageProvider>
    </ConfigProvider>
  )
}

function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const PINS = { 
    admin: window.BC_PINS?.inv_admin || window.BC_PINS?.master || '7530', 
    store: window.BC_PINS?.warehouse || '8888'
  }

  const submit = () => {
    if (pin === PINS.admin || pin === (window.BC_PINS?.master || '7530')) { onLogin('admin'); return }
    if (pin === PINS.store) { onLogin('store'); return }
    setError(true); setPin('')
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-72 flex flex-col gap-4">
        <div className="text-center">
          <Factory className="w-8 h-8 mx-auto text-blue-600 mb-2" />
          <p className="font-semibold text-gray-900 text-sm">Boba Кролик</p>
          <p className="text-xs text-gray-400 mt-0.5">Stores &amp; Purchase Order</p>
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
  // Stores app uses its own auth key so it stays independent of the warehouse app on the same origin
  // Session storage FIRST — freshest login signal wins; a stale persistent
  // admin entry in localStorage must never shadow a store (employee) session.
  const [role, setRole] = useState(() => sessionStorage.getItem('storesRole') || localStorage.getItem('storesRole') || null)

  const handleLogin = (newRole) => {
    sessionStorage.setItem('storesRole', newRole)
    if (newRole === 'admin') {
      // Admin keeps the persistent convenience session
      localStorage.setItem('storesRole', newRole)
    } else {
      // Employee roles are tab sessions and must clear any stale persistent
      // admin entry on this device
      localStorage.removeItem('storesRole')
    }
    setRole(newRole)
  }

  const handleLogout = () => {
    localStorage.removeItem('storesRole')
    sessionStorage.removeItem('storesRole')
    setRole(null)
  }

  if (!role) return <LoginScreen onLogin={handleLogin} />
  return <AppContent role={role} onLogout={handleLogout} />
}

function AppContent({ role, onLogout }) {
  const navigate = useNavigate()
  const { config, stores, selectedStore, setSelectedStore, settings, sales, lhBalances } = useConfig()
  const hasData = (config.ingredients ?? []).length > 0
  const [settingsOpen, setSettingsOpen] = useState(false)
  const lhConnected = Boolean(settings?.token && settings?.warehouseId)

  // "Live data as of": the latest date covered by the loaded data — the newest
  // POS sales row and the lakehouse view's current_on_hand_as_of_date.
  // Updates automatically as sales refresh / balance pulls land.
  const dataAsOf = useMemo(() => {
    const dates = []
    if (sales?.length) {
      let max = sales[0].date
      for (const s of sales) if (s.date > max) max = s.date
      if (max) dates.push(String(max))
    }
    if (lhBalances) {
      for (const r of Object.values(lhBalances)) {
        const d = r.current_on_hand_as_of_date ? String(r.current_on_hand_as_of_date).slice(0, 10) : ''
        if (d) dates.push(d)
      }
    }
    return dates.length ? dates.sort().pop() : null
  }, [sales, lhBalances])

  // Fresh = data covers today or yesterday (yesterday allowed so early-morning
  // use before the day's POS sales arrive still shows green).
  const isFresh = useMemo(() => {
    if (!dataAsOf) return false
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 1)
    return dataAsOf >= cutoff.toISOString().slice(0, 10)
  }, [dataAsOf])

  const handleLoad = () => {
    window.location.reload()
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 pb-16">
      {/* Mobile Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <Factory className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-900 text-sm">Stores &amp; Purchase Order</span>
        </div>
        <div className="flex items-center gap-2">
          {dataAsOf && (
            <span
              title={lhConnected
                ? `Данные актуальны на ${dataAsOf} (новейшая дата продаж POS и остатков из lakehouse)`
                : 'Lakehouse не подключён — данные могут быть неактуальны'}
              className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border ${
                lhConnected && isFresh
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${lhConnected && isFresh ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              Live data as of {dataAsOf}
            </span>
          )}
          {stores.length > 0 && (
            <select
              value={selectedStore || ''}
              onChange={e => setSelectedStore(e.target.value)}
              title="Active store"
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-40"
            >
              {stores.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {hasData && (
            <button onClick={handleLoad} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"><RefreshCw className="w-4 h-4" /></button>
          )}
          <button onClick={() => setSettingsOpen(true)} title={lhConnected ? 'Lakehouse OK' : 'Lakehouse: no token'}
            className="p-1.5 rounded-md hover:bg-gray-100 flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${lhConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            <Settings className="w-4 h-4 text-gray-500" />
          </button>
          <button onClick={onLogout} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<InventoryLevels />} />
          <Route path="/pos" element={<PurchaseOrders />} />
          <Route path="/adjustments" element={<Adjustments />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/ozon" element={<OzonDeliveries />} />
        </Routes>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 w-full bg-white border-t border-gray-200 flex items-center overflow-x-auto pb-safe custom-scrollbar">
        <NavItem to="/inventory" icon={<Layers className="w-5 h-5" />} label="Inventory" />
        <NavItem to="/pos" icon={<ClipboardList className="w-5 h-5" />} label="Receive" />
        <NavItem to="/ozon" icon={<Package className="w-5 h-5" />} label="Ozon" />
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
