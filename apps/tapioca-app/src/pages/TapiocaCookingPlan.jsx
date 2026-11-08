import { useState, useMemo } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import {
  filterTapiocaSales,
  dailyBySlot,
  computeRecommendations,
  computeBacktest,
  severityClass,
  SLOT_ORDER,
} from '../utils/tapiocaCalculations'

export default function TapiocaCookingPlan() {
  const { sales, salesCache, visibleStores } = useConfig()
  const { t } = useLanguage()

  const [rollingDays, setRollingDays] = useState(90)
  const [percentile, setPercentile] = useState('p90')
  const [gramsPerPortion, setGramsPerPortion] = useState(50)

  const lastSync = salesCache?.lastRefreshDate ?? null

  // Filter to tapioca sales and aggregate by slot
  const tapiocaSales = useMemo(() => filterTapiocaSales(sales), [sales])
  const daily = useMemo(() => dailyBySlot(tapiocaSales), [tapiocaSales])
  const recommendations = useMemo(() => computeRecommendations(daily, rollingDays), [daily, rollingDays])
  const backtest = useMemo(() => computeBacktest(daily, recommendations), [daily, recommendations])

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
    <div className="p-3.5 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
          <span>🧋</span> Tapioca Cooking Plan
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">
          Based on {tapiocaSales.length.toLocaleString()} tapioca transactions
          {lastSync && ` • Data as of: ${lastSync}`}
        </p>
        <p className="text-gray-400 text-xs mt-0.5">
          💡 Refresh data in the <strong>Transactions</strong> tab to update this view
        </p>
      </div>

      {/* Controls Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-3.5 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 flex-wrap">
          {/* Rolling Days Slider */}
          <div className="w-full sm:w-48">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Rolling Average Days: <strong className="text-gray-900">{rollingDays}</strong>
            </label>
            <input
              type="range"
              min="7"
              max="180"
              value={rollingDays}
              onChange={e => setRollingDays(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="text-[11px] text-gray-400 mt-1 flex justify-between w-full">
              <span>7d</span>
              <span>90d</span>
              <span>180d</span>
            </div>
          </div>

          {/* Percentile Selection */}
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Percentile Standard</label>
            <div className="grid grid-cols-5 sm:flex gap-1 bg-gray-100 rounded-lg p-1 border border-gray-200">
              {['avg', 'p75', 'p90', 'p95', 'max'].map(pct => (
                <button
                  key={pct}
                  onClick={() => setPercentile(pct)}
                  className={`py-2 sm:px-3 sm:py-1.5 rounded-md text-xs font-medium text-center transition-all ${
                    percentile === pct
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'bg-transparent text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  {pct === 'avg' ? 'Avg' : pct === 'max' ? 'Max' : pct.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Grams Per Portion */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Grams per portion</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="200"
                value={gramsPerPortion}
                onChange={e => setGramsPerPortion(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-20 text-center font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <span className="text-xs text-gray-400">g / cup</span>
            </div>
          </div>
        </div>
      </div>

      {/* No Data State */}
      {tapiocaSales.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center shadow-xs">
          <p className="text-blue-800 font-semibold mb-1 text-base">No tapioca sales data loaded</p>
          <p className="text-blue-600 text-sm">
            Go to <strong>Transactions</strong> tab and click "🔄 Refresh Data" to fetch from Databricks.
          </p>
        </div>
      )}

      {/* Results Grid */}
      {tapiocaSales.length > 0 && (
        <>
          {/* Store Cards */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Cooking Plan by Timeslot</h2>
              <span className="text-xs text-gray-500">
                Target: <strong className="text-gray-700 uppercase">{percentile}</strong> • {gramsPerPortion}g/portion
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleStores.map(store => {
                const getPortions = (dayType, slot) => {
                  const stat = recommendations[`${store}|${dayType}|${slot}`]
                  return stat ? stat[percentile] : null
                }

                // Check if this store has any data
                const totalWeekdayP = SLOT_ORDER.reduce((acc, slot) => acc + (getPortions('Weekday', slot) || 0), 0)
                const totalWeekendP = SLOT_ORDER.reduce((acc, slot) => acc + (getPortions('Weekend', slot) || 0), 0)
                const hasData = totalWeekdayP > 0 || totalWeekendP > 0

                return (
                  <div
                    key={store}
                    className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
                  >
                    <div>
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2.5 mb-3">
                        <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                          {store}
                        </h3>
                        <span className="text-[11px] text-gray-400 font-medium">3 batches / day</span>
                      </div>

                      {hasData ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[11px] font-semibold text-gray-400 uppercase border-b border-gray-100">
                              <th className="py-2 text-left font-medium">Slot</th>
                              <th className="py-2 text-right font-medium">Weekday</th>
                              <th className="py-2 text-right font-medium">Weekend</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {SLOT_ORDER.map(slot => {
                              const wp = getPortions('Weekday', slot)
                              const wg = wp != null ? Math.round(wp * gramsPerPortion) : null
                              const ep = getPortions('Weekend', slot)
                              const eg = ep != null ? Math.round(ep * gramsPerPortion) : null

                              return (
                                <tr key={slot} className="hover:bg-amber-50/20 transition-colors">
                                  <td className="py-2.5 font-medium text-gray-700 whitespace-nowrap">
                                    <span className="inline-block px-2 py-0.5 bg-gray-100 rounded text-gray-700 font-mono text-xs">
                                      {slot}
                                    </span>
                                  </td>
                                  <td className="py-2.5 text-right font-medium whitespace-nowrap">
                                    {wp != null ? (
                                      <>
                                        <span className="text-gray-900">{wp}</span>
                                        <span className="text-[11px] text-amber-800 font-semibold ml-1.5 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded">
                                          {wg}g
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 text-right font-medium whitespace-nowrap">
                                    {ep != null ? (
                                      <>
                                        <span className="text-gray-900">{ep}</span>
                                        <span className="text-[11px] text-amber-800 font-semibold ml-1.5 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded">
                                          {eg}g
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-gray-50/70 font-semibold text-gray-900 text-xs">
                              <td className="py-2.5 pl-2 text-gray-700">Total Day</td>
                              <td className="py-2.5 text-right pr-1 whitespace-nowrap">
                                <span>{totalWeekdayP}</span>
                                <span className="text-[11px] text-blue-800 font-bold ml-1.5 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                  {Math.round(totalWeekdayP * gramsPerPortion)}g
                                </span>
                              </td>
                              <td className="py-2.5 text-right pr-1 whitespace-nowrap">
                                <span>{totalWeekendP}</span>
                                <span className="text-[11px] text-blue-800 font-bold ml-1.5 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                  {Math.round(totalWeekendP * gramsPerPortion)}g
                                </span>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      ) : (
                        <div className="py-8 text-center text-xs text-gray-400">
                          No tapioca sales recorded
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Backtest Results */}
          <div className="pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Backtest Results</h2>
                <p className="text-xs text-gray-500">
                  How often did the <strong className="text-gray-700 uppercase">{percentile}</strong> cooking recommendation fall short across slots?
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span> &lt;15%</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span> 15–29%</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> &ge;30%</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {Object.entries(backtest).map(([key, backtests]) => {
                const [store, dayType, slot] = key.split('|')
                const stats = backtests[percentile]
                if (!stats) return null
                const severity = severityClass(stats.pctShort)

                return (
                  <div
                    key={key}
                    className={`border rounded-xl p-3.5 shadow-xs transition-colors ${severityColor[severity]}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="font-semibold text-gray-900 text-sm block">{store}</span>
                        <span className="text-xs text-gray-500">{slot} • {dayType}</span>
                      </div>
                      <span className={`font-bold text-lg ${severityTextColor[severity]}`}>
                        {stats.pctShort}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 space-y-1 border-t border-gray-200/60 pt-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Recommended:</span>
                        <span className="font-medium text-gray-800">{stats.recommended} portions ({Math.round(stats.recommended * gramsPerPortion)}g)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Days short:</span>
                        <span className="font-medium text-gray-800">{stats.daysShort} of {stats.totalDays} days</span>
                      </div>
                      {stats.daysShort > 0 && (
                        <div className="flex justify-between text-red-600 font-medium">
                          <span>Shortfall (avg / max):</span>
                          <span>+{stats.avgShortfall} / +{stats.maxShortfall} portions</span>
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
