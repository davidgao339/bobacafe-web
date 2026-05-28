import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { STORES } from '../data/fakeData'

function badge(pct) {
  if (pct > 10) return { style: 'bg-red-100 text-red-700',    label: 'High' }
  if (pct > 5)  return { style: 'bg-amber-100 text-amber-700', label: 'Medium' }
  return              { style: 'bg-green-100 text-green-700',  label: 'OK' }
}

function StoreSection({ store }) {
  const { config } = useConfig()
  const { getSalesConsumption, getDirectConsumption, getActualConsumed, getUnexplainedVariance, getVariancePct, getVarianceWindow } = useCalcs()

  const win = getVarianceWindow(store)

  const rows = config.ingredients
    .map(p => {
      const expected = getSalesConsumption(store, p.id) + getDirectConsumption(store, p.id)
      const actual   = getActualConsumed(store, p.id)
      const lost     = getUnexplainedVariance(store, p.id)
      // pct relative to expected; if no expected but actual consumed, treat as 100% unexplained
      const pct = expected > 0
        ? getVariancePct(store, p.id)
        : actual > 0 ? 100 : 0
      return { name: p.name, unit: p.unit, expected, actual, lost, pct }
    })
    .filter(r => r.expected > 0 || r.actual !== 0)

  const hasIssues = rows.some(r => r.pct > 5)

  if (!win) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{store}</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">Need 2+ audits</span>
        </div>
        <p className="px-6 py-6 text-sm text-gray-400">Save at least two inventory audits for this store to see variance.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">{store}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{win.opening.date} → {win.closing.date}</p>
        </div>
        {hasIssues
          ? <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">Losses to review</span>
          : <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">All good</span>
        }
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="px-6 py-3 font-medium">Ingredient</th>
            <th className="px-4 py-3 font-medium text-right">Should have used</th>
            <th className="px-4 py-3 font-medium text-right">Actually used</th>
            <th className="px-4 py-3 font-medium text-right">Unexplained loss</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.length === 0
            ? <tr><td colSpan={5} className="px-6 py-6 text-center text-gray-400 text-sm">No data for this store</td></tr>
            : rows.map(r => {
                const b = badge(r.pct)
                return (
                  <tr key={r.name} className={r.pct > 10 ? 'bg-red-50/40' : r.pct > 5 ? 'bg-amber-50/30' : ''}>
                    <td className="px-6 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {r.expected > 0 ? `${r.expected} ${r.unit}` : <span className="text-gray-300">no sales data</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800 font-medium">{r.actual} {r.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                      {r.lost > 0 ? `+${r.lost} ${r.unit}` : r.lost < 0 ? `${r.lost} ${r.unit}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.expected === 0 && r.actual > 0
                        ? <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">No recipe/sales</span>
                        : <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${b.style}`}>
                            {r.pct > 0 ? `+${r.pct}% ${b.label}` : r.pct < 0 ? `${r.pct}%` : b.label}
                          </span>
                      }
                    </td>
                  </tr>
                )
              })
          }
        </tbody>
      </table>
    </div>
  )
}

export default function VarianceReport() {
  const [store, setStore] = useState('All')
  const visibleStores = store === 'All' ? STORES : [store]

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Unexplained Losses</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          How much of each ingredient disappeared beyond what sales and logged waste can account for
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6">
        {['All', ...STORES].map(s => (
          <button key={s} onClick={() => setStore(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              store === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {visibleStores.map(s => <StoreSection key={s} store={s} />)}

      <p className="text-xs text-gray-400 mt-2">
        "Should have used" = sales × recipe + waste logged between the two most recent audits per store. Any gap is unexplained — possible causes: over-pouring, unrecorded spills, or measurement error during stock count.
      </p>
    </div>
  )
}
