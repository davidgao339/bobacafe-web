import { useState } from 'react'
import { useConfig } from '../context/ConfigContext'
import { runDatabricksSql } from '../services/databricks'

// Lakehouse credentials entry point (Databricks token + SQL warehouse).
// Once saved, Ledger + current balances come from the lakehouse views
// (view_inventory_events_last_audit / view_current_inventory), not local D1.
export default function SettingsModal({ onClose }) {
  const { settings, saveSettings } = useConfig()
  const [token, setToken] = useState(settings?.token || '')
  const [warehouseId, setWarehouseId] = useState(settings?.warehouseId || '959d56e804ae9b36')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState(null)
  const [ok, setOk] = useState(false)

  const handleSave = async () => {
    setTesting(true); setError(null); setOk(false)
    try {
      await runDatabricksSql(token.trim(), warehouseId.trim(), 'SELECT 1 AS ok')
      saveSettings({ token: token.trim(), warehouseId: warehouseId.trim() })
      setOk(true)
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-md flex flex-col gap-4 p-6" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Подключение к Lakehouse</h2>
          <p className="text-xs text-gray-500 mt-1">
            После сохранения остатки и журнал (Ledger) берутся из lakehouse
            (view_current_inventory / view_inventory_events_last_audit), а не из локального D1.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Databricks токен</label>
          <input type="password" value={token} onChange={e => setToken(e.target.value)} autoFocus placeholder="dapi..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">SQL Warehouse ID</label>
          <input value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
        {ok && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">Подключение проверено — обновление…</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Отмена</button>
          <button onClick={handleSave} disabled={testing || !token.trim() || !warehouseId.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {testing ? 'Проверка…' : 'Проверить и сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}