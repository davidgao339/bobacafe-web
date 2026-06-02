import { useState } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { STORES } from '../data/fakeData'

function badge(pct, t) {
  if (pct > 10) return { style: 'bg-red-100 text-red-700',    label: t('variance.high') }
  if (pct > 5)  return { style: 'bg-amber-100 text-amber-700', label: t('variance.medium') }
  if (pct < 0)  return { style: 'bg-blue-100 text-blue-700',   label: t('variance.surplus') }
  return              { style: 'bg-green-100 text-green-700',  label: t('variance.ok') }
}

function StoreSection({ store, issuesOnly }) {
  const { config } = useConfig()
  const { getSalesConsumption, getDirectConsumption, getActualConsumed, getUnexplainedVariance, getVariancePct, getVarianceWindow } = useCalcs()
  const { t } = useLanguage()

  const win = getVarianceWindow(store)

  const rows = config.ingredients
    .map(p => {
      const expected = getSalesConsumption(store, p.id) + getDirectConsumption(store, p.id)
      const actual   = getActualConsumed(store, p.id)
      const lost     = getUnexplainedVariance(store, p.id)
      const pct = actual === null ? 0
        : expected > 0 ? getVariancePct(store, p.id)
        : actual > 0 ? 100 : 0
      return { id: p.id, name: p.name, unit: p.unit, expected, actual, lost, pct }
    })
    .filter(r => r.actual !== null && (r.expected > 0 || r.actual > 0))
    .sort((a, b) => b.pct - a.pct)

  const visibleRows = issuesOnly ? rows.filter(r => r.pct > 5) : rows

  const hasIssues = rows.some(r => r.pct > 5)

  if (!win) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{store}</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">{t('variance.need2Audits')}</span>
        </div>
        <p className="px-6 py-6 text-sm text-gray-400">{t('variance.need2AuditsDesc')}</p>
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
          ? <span className="text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">{t('variance.lossesToReview')}</span>
          : <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">{t('variance.allGood')}</span>
        }
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="px-6 py-3 font-medium">{t('common.ingredient')}</th>
            <th className="px-4 py-3 font-medium text-right">{t('variance.shouldHaveUsed')}</th>
            <th className="px-4 py-3 font-medium text-right">{t('variance.actuallyUsed')}</th>
            <th className="px-4 py-3 font-medium text-right">{t('variance.unexplainedLoss')}</th>
            <th className="px-4 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {visibleRows.length === 0
            ? <tr><td colSpan={5} className="px-6 py-6 text-center text-gray-400 text-sm">
                {rows.length === 0 ? t('variance.noData') : t('variance.noIssues')}
              </td></tr>
            : visibleRows.map(r => {
                const b = badge(r.pct, t)
                return (
                  <tr key={r.id} className={r.pct > 10 ? 'bg-red-50/40' : r.pct > 5 ? 'bg-amber-50/30' : ''}>
                    <td className="px-6 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                      {r.expected > 0 ? `${r.expected} ${r.unit}` : <span className="text-gray-300">{t('variance.noRecipeSales')}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800 font-medium">{r.actual} {r.unit}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                      {r.lost > 0 ? `+${r.lost} ${r.unit}` : r.lost < 0 ? `${r.lost} ${r.unit}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.expected === 0 && r.actual > 0
                        ? <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{t('variance.noRecipeSales')}</span>
                        : <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${b.style}`}>
                            {r.pct !== 0 ? `${r.pct > 0 ? '+' : ''}${r.pct}% ${b.label}` : b.label}
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
    </div>
  )
}

export default function VarianceReport() {
  const [store,      setStore]      = useState('All')
  const [issuesOnly, setIssuesOnly] = useState(false)
  const { t } = useLanguage()
  const visibleStores = store === 'All' ? STORES : [store]

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('variance.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('variance.subtitle')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none mt-1">
          <input type="checkbox" checked={issuesOnly} onChange={e => setIssuesOnly(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          {t('variance.issuesOnly')}
        </label>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6 flex-wrap">
        {[t('common.all'), ...STORES].map((s, i) => {
          const storeKey = i === 0 ? 'All' : s
          return (
            <button key={storeKey} onClick={() => setStore(storeKey)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                store === storeKey ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {s}
            </button>
          )
        })}
      </div>

      {visibleStores.map(s => <StoreSection key={s} store={s} issuesOnly={issuesOnly} />)}

      <p className="text-xs text-gray-400 mt-2">
        {t('variance.footer')}
      </p>
    </div>
  )
}
