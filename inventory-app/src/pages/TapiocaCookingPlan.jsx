import { useState, useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { STORES } from '../data/fakeData'
import {
  filterTapiocaSales,
  dailyBySlot,
  computeRecommendations,
  computeBacktest,
  severityClass,
} from '../utils/tapiocaCalculations'

export default function TapiocaCookingPlan() {
  const { sales, salesCache, settings, saveSettings, refreshSales } = useConfig()
  const { t } = useLanguage()

  const [rollingDays, setRollingDays] = useState(90)
  const [percentile, setPercentile] = useState('p90')
  const [gramsPerPortion, setGramsPerPortion] = useState(50)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [localToken, setLocalToken] = useState(settings.token ?? '')
  const [localWarehouse, setLocalWarehouse] = useState(settings.warehouseId ?? '')

  const lastSync = salesCache?.lastRefreshDate ?? null

  // Filter to tapioca sales and aggregate
  const tapiocaSales = useMemo(() => filterTapiocaSales(sales), [sales])
  const daily = useMemo(() => dailyBySlot(tapiocaSales), [tapiocaSales])
  const recommendations = useMemo(() => computeRecommendations(daily, rollingDays), [daily, rollingDays])
  const backtest = useMemo(() => computeBacktest(daily, recommendations), [daily, recommendations])

  const handleRefresh = async () => {
    const token = (showSettings ? localToken : settings.token)?.trim()
    const warehouseId = (showSettings ? localWarehouse : settings.warehouseId)?.trim()

    if (!token) {
      setShowSettings(true)
      setRefreshMsg({ type: 'error', text: 'Enter a Databricks PAT token first.' })
      return
    }

    setRefreshing(true)
    setRefreshMsg(null)

    try {
      const today = new Date().toISOString().slice(0, 10)
      const fromDate = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
      const result = await refreshSales(token, warehouseId, fromDate, today)

      if (result.upToDate) {
        setRefreshMsg({ type: 'ok', text: `Already up to date through ${result.throughDate}.` })
      } else {
        setRefreshMsg({ type: 'ok', text: `Fetched ${result.newRows} rows.` })
      }
    } catch (err) {
      setRefreshMsg({ type: 'error', text: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  const saveCredentials = () => {
    saveSettings({ token: localToken.trim(), warehouseId: localWarehouse.trim() })
    setShowSettings(false)
    setRefreshMsg(null)
  }

  const severityColor = {
    high: 'bg-red-50 border-red-200',
    med: 'bg-yellow-50 border-yellow-200',
    low: 'bg-teal-50 border-teal-200',
    none: 'bg-white border-gray-200',
  }

  const severityTextColor = {
    high: 'text-red-700',
    med: 'text-yellow-700',
    low: 'text-teal-700',
    none: 'text-gray-700',
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">🧋 Tapioca Cooking Plan</h1>
        <p className="text-gray-500 text-sm mt-1">
          Based on {tapiocaSales.length} tapioca transactions
          {lastSync && ` • Last sync: ${lastSync}`}
        </p>
      </div>

      {/* Controls Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-end gap-4 flex-wrap">
          {/* Rolling Days Slider */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Rolling Average Days: {rollingDays}
            </label>
            <input
              type="range"
              min="7"
              max="180"
              value={rollingDays}
              onChange={e => setRollingDays(parseInt(e.target.value))}
              className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-xs text-gray-500 mt-1">7 — 180 days</div>
          </div>

          {/* Percentile Selection */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Percentile Standard</label>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {['avg', 'p75', 'p90', 'p95', 'max'].map(pct => (
                <button
                  key={pct}
                  onClick={() => setPercentile(pct)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    percentile === pct
                      ? 'bg-slate-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {pct === 'avg' ? 'Avg' : pct === 'max' ? 'Max' : pct.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Grams Per Portion */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Grams per portion</label>
            <input
              type="number"
              min="1"
              max="200"
              value={gramsPerPortion}
              onChange={e => setGramsPerPortion(parseInt(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-20"
            />
          </div>

          <div className="flex-1" />

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh Data'}
          </button>
        </div>

        {/* Messages */}
        {refreshMsg && (
          <div
            className={`p-3 rounded-lg text-sm ${
              refreshMsg.type === 'ok'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {refreshMsg.text}
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Databricks PAT Token</label>
              <input
                type="password"
                value={localToken}
                onChange={e => setLocalToken(e.target.value)}
                placeholder="dapi..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Warehouse ID</label>
              <input
                type="text"
                value={localWarehouse}
                onChange={e => setLocalWarehouse(e.target.value)}
                placeholder="9xxxx..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveCredentials}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 bg-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* No Data State */}
      {tapiocaSales.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <p className="text-blue-700 font-medium mb-2">No tapioca sales data</p>
          <p className="text-blue-600 text-sm mb-4">
            Click "Refresh Data" to fetch transactions from Databricks
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Fetch Data
          </button>
        </div>
      )}

      {/* Results Grid */}
      {tapiocaSales.length > 0 && (
        <>
          {/* Store Cards */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Cooking Plan</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {STORES.map(store => {
                const storeStats = Object.entries(recommendations)
                  .filter(([key]) => key.startsWith(store + '|'))
                  .map(([key, stats]) => ({
                    dayType: key.split('|')[1],
                    [percentile]: stats[percentile],
                  }))

                return (
                  <div key={store} className="bg-white border border-gray-200 rounded-xl p-4">
                    <h3 className="font-semibold text-gray-800 mb-3">{store}</h3>
                    <div className="space-y-2">
                      {['Weekday', 'Weekend'].map(dayType => {
                        const stat = storeStats.find(s => s.dayType === dayType)
                        const portions = stat ? stat[percentile] : '—'
                        const grams = portions !== '—' ? (portions * gramsPerPortion).toFixed(0) : '—'

                        return (
                          <div key={dayType} className="flex justify-between text-sm">
                            <span className="text-gray-600 font-medium">{dayType}:</span>
                            <span className="text-gray-800 font-semibold">
                              {portions} portions ({grams}g)
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Backtest Results */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Backtest Results</h2>
            <p className="text-sm text-gray-600 mb-4">
              How often did the {percentile} recommendation fall short?
            </p>
            <div className="space-y-3">
              {Object.entries(backtest).map(([key, backtests]) => {
                const [store, dayType] = key.split('|')
                const stats = backtests[percentile]
                const severity = severityClass(stats.pctShort)

                return (
                  <div
                    key={key}
                    className={`border-l-4 rounded-lg p-3 ${severityColor[severity]}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-800">
                        {store} • {dayType}
                      </span>
                      <span className={`font-bold text-lg ${severityTextColor[severity]}`}>
                        {stats.pctShort}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 space-y-0.5">
                      <div>Recommended: {stats.recommended} portions</div>
                      <div>Short on {stats.daysShort} of {stats.totalDays} days</div>
                      {stats.daysShort > 0 && (
                        <div>
                          Shortfall: {stats.avgShortfall} avg / {stats.maxShortfall} max
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
