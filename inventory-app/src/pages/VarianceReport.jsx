import { useState, Fragment } from 'react'
import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'


const r1 = n => Math.round(n * 10) / 10

function badge(pct, t) {
  if (pct < -10) return { style: 'bg-red-100 text-red-700',    label: t('variance.high') }
  if (pct < -5)  return { style: 'bg-amber-100 text-amber-700', label: t('variance.medium') }
  if (pct > 5)   return { style: 'bg-blue-100 text-blue-700',   label: t('variance.surplus') }
  return               { style: 'bg-green-100 text-green-700',  label: t('variance.ok') }
}

// ─── Detail breakdown card ────────────────────────────────────────────────────

function DetailCard({ store, ingredient, iwin, config, data, sales, posWaste }) {
  const { t } = useLanguage()
  if (!iwin) return null

  const { id, unit } = ingredient
  const { opening, closing } = iwin
  const from = opening.date
  const to   = closing.date

  const openingCount = opening.counts[id] ?? 0
  const closingCount = closing.counts[id] ?? 0

  const salesUsage = r1([...sales]
    .filter(s => s.store === store && s.date > from && s.date <= to)
    .reduce((sum, s) => sum + s.quantity * (config.recipes[s.product]?.[id] ?? 0), 0))

  const wasteUsage = r1([...posWaste]
    .filter(s => s.store === store && s.date > from && s.date <= to)
    .reduce((sum, s) => sum + s.quantity * (config.recipes[s.product]?.[id] ?? 0), 0))

  const windowTxns = data.transactions.filter(t =>
    t.store === store && t.ingredientId === id && t.date > from && t.date <= to)

  const directUsage = r1(windowTxns
    .filter(t => t.type !== 'adjustment')
    .reduce((sum, t) => sum + t.quantity, 0))

  const transfersIn = r1(windowTxns
    .filter(t => t.type === 'adjustment' && t.poId && t.quantity > 0)
    .reduce((sum, t) => sum + t.quantity, 0))

  const transfersOut = r1(Math.abs(windowTxns
    .filter(t => t.type === 'adjustment' && t.poId && t.quantity < 0)
    .reduce((sum, t) => sum + t.quantity, 0)))

  // Transfer POs appear via their transfer transactions above, not as receipts
  const posInWindow = data.purchaseOrders
    .filter(po => po.store === store && po.status === 'received' &&
      !(po.fromLocation && po.toLocation) &&
      (po.receivedDate ?? '') > from && (po.receivedDate ?? '') <= to)
    .map(po => { const line = po.lines.find(l => Number(l.ingredientId) === id); return { id: po.id, date: po.receivedDate, qty: line?.received ?? line?.ordered ?? 0 } })
    .filter(po => po.qty > 0)

  const totalReceived   = r1(posInWindow.reduce((sum, po) => sum + po.qty, 0))
  const totalAvailable  = r1(openingCount + totalReceived + transfersIn)
  const totalExpected   = r1(salesUsage + wasteUsage + directUsage + transfersOut)
  const expectedClosing = r1(totalAvailable - totalExpected)

  // Positive = surplus (have more than expected), negative = loss (have less)
  const variance = r1(closingCount - expectedClosing)
  const pct      = totalExpected > 0 ? Math.round(variance / totalExpected * 1000) / 10 : 0

  const variantColor = variance < 0 ? 'text-red-600' : variance > 0 ? 'text-green-600' : 'text-gray-500'
  const badgeStyle   = variance < 0
    ? 'bg-red-100 text-red-700'
    : variance > 0 ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-500'

  const Row = ({ label, sub, right, rightColor, bold, divider }) => (
    <div className={`flex items-start justify-between gap-4 ${divider ? 'border-t border-gray-200 pt-2 mt-1' : 'py-1'}`}>
      <div>
        <p className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</p>
        {sub && <p className="text-xs text-gray-400 font-mono">{sub}</p>}
      </div>
      <p className={`text-sm tabular-nums font-mono whitespace-nowrap ${rightColor ?? (bold ? 'font-semibold text-gray-900' : 'text-gray-700')}`}>
        {right}
      </p>
    </div>
  )

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 mt-1 max-w-lg">

      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        {t('variance.detailBalance')} &nbsp;<span className="font-normal font-mono normal-case text-gray-300">{from} → {to}</span>
      </p>

      {/* Inflows */}
      <Row label={t('variance.detailOpening')} sub={opening.date} right={`+${openingCount} ${unit}`} rightColor="text-gray-700" />
      {posInWindow.length > 0
        ? posInWindow.map(po => (
            <Row key={po.id} label={`${t('variance.detailReceived')} (${po.id})`} sub={po.date}
              right={`+${po.qty} ${unit}`} rightColor="text-green-600" />
          ))
        : <Row label={t('variance.detailReceived')} sub={t('variance.detailNone')} right={`+0 ${unit}`} rightColor="text-gray-400" />
      }
      {transfersIn > 0 && (
        <Row label={t('variance.detailTransferIn')} right={`+${transfersIn} ${unit}`} rightColor="text-teal-600" />
      )}
      <Row label={t('variance.detailAvailable')} right={`${totalAvailable} ${unit}`} bold divider />

      {/* Expected consumption */}
      <Row label={t('variance.detailSales')}  right={`−${salesUsage} ${unit}`}   rightColor={salesUsage > 0  ? 'text-gray-700' : 'text-gray-400'} />
      <Row label={t('variance.detailWaste')}  right={`−${wasteUsage} ${unit}`}   rightColor={wasteUsage > 0  ? 'text-gray-700' : 'text-gray-400'} />
      {directUsage > 0 && (
        <Row label={t('variance.detailDirect')} right={`−${directUsage} ${unit}`} rightColor="text-gray-700" />
      )}
      {transfersOut > 0 && (
        <Row label={t('variance.detailTransferOut')} right={`−${transfersOut} ${unit}`} rightColor="text-orange-600" />
      )}
      <Row label={t('variance.detailExpClosing')} right={`${expectedClosing} ${unit}`} bold divider />

      {/* Actual vs expected */}
      <Row label={t('variance.detailActClosing')} sub={closing.date} right={`${closingCount} ${unit}`} rightColor="text-gray-700" />

      <div className="border-t border-gray-200 mt-1 pt-2 flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-gray-900">
          {t('variance.detailVarianceLabel')} <span className="text-xs font-normal text-gray-400">{t('variance.detailVarianceSub')}</span>
        </p>
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold tabular-nums font-mono ${variantColor}`}>
            {variance > 0 ? '+' : ''}{variance} {unit}
          </p>
          {totalExpected > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badgeStyle}`}>
              {pct > 0 ? '+' : ''}{pct}%
            </span>
          )}
        </div>
      </div>
      <p className={`text-xs mt-1 ${variantColor}`}>
        {variance < 0 ? t('variance.detailLoss') : variance > 0 ? t('variance.detailSurplus') : t('variance.detailMatch')}
      </p>

    </div>
  )
}

// ─── Store section ────────────────────────────────────────────────────────────

function StoreSection({ store, issuesOnly, search }) {
  const { config, data, sales, posWaste, stores } = useConfig()
  const { getSalesConsumption, getDirectConsumption, getActualConsumed, getUnexplainedVariance,
          getVariancePct, getVarianceWindow, getIngredientVarianceWindow } = useCalcs()
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(null)

  const win = getVarianceWindow(store)

  const rows = config.ingredients
    .map(p => {
      const iwin       = getIngredientVarianceWindow(store, p.id)
      const expected   = getSalesConsumption(store, p.id) + getDirectConsumption(store, p.id)
      const actual     = getActualConsumed(store, p.id)
      const rawVariance = getUnexplainedVariance(store, p.id)  // positive = loss (old convention)
      // Flip sign: negative = loss, positive = surplus
      const lost = rawVariance !== null ? r1(-rawVariance) : null
      const pct  = actual === null ? 0
        : expected > 0 ? -getVariancePct(store, p.id)
        : actual > 0 ? -100 : 0
      return {
        id: p.id, name: p.name, unit: p.unit, expected, actual, lost, pct,
        openDate:  iwin?.opening.date ?? null,
        closeDate: iwin?.closing.date ?? null,
        iwin,
      }
    })
    .filter(r => r.actual !== null && (r.expected > 0 || r.actual > 0))
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.pct - b.pct)   // most negative (worst loss) first

  const visibleRows = issuesOnly ? rows.filter(r => r.pct < -5) : rows
  const hasIssues   = rows.some(r => r.pct < -5)

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
          <p className="text-xs text-gray-400 mt-0.5">{t('variance.perIngredientWindow')}</p>
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
              <th className="px-4 py-3 font-medium text-right">{t('variance.colVariance')}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0
              ? <tr><td colSpan={5} className="px-6 py-6 text-center text-gray-400 text-sm">
                  {rows.length === 0 ? t('variance.noData') : t('variance.noIssues')}
                </td></tr>
              : visibleRows.map(r => {
                  const b        = badge(r.pct, t)
                  const isOpen   = expanded === r.id
                  const rowBg    = isOpen ? 'bg-blue-50' : r.pct < -10 ? 'bg-red-50/40' : r.pct < -5 ? 'bg-amber-50/30' : ''
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => setExpanded(prev => prev === r.id ? null : r.id)}
                        className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 transition-colors ${rowBg}`}>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1.5">
                            <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                            </svg>
                            <div>
                              <p className="font-medium text-gray-900">{r.name}</p>
                              {r.openDate && r.closeDate && (
                                <p className="text-xs text-gray-400 mt-0.5 font-mono">{r.openDate} → {r.closeDate}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                          {r.expected > 0 ? `${r.expected} ${r.unit}` : <span className="text-gray-300">{t('variance.noRecipeSales')}</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-800 font-medium">{r.actual} {r.unit}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                          r.lost < 0 ? 'text-red-600' : r.lost > 0 ? 'text-green-600' : 'text-gray-400'
                        }`}>
                          {r.lost < 0 ? `${r.lost} ${r.unit}` : r.lost > 0 ? `+${r.lost} ${r.unit}` : '—'}
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

                      {isOpen && (
                        <tr className="bg-blue-50/30 border-b border-blue-100">
                          <td colSpan={5} className="px-6 pb-5 pt-1">
                            <DetailCard
                              store={store}
                              ingredient={{ id: r.id, name: r.name, unit: r.unit }}
                              iwin={r.iwin}
                              config={config}
                              data={data}
                              sales={sales}
                              posWaste={posWaste}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VarianceReport() {
  const [store,      setStore]      = useState('All')
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [search,     setSearch]     = useState('')
  const { t } = useLanguage()
  const { stores } = useConfig()
  const visibleStores = store === 'All' ? stores : [store]

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('variance.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('variance.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('audit.filterPlaceholder')}
              className="border border-gray-300 rounded-lg pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={issuesOnly} onChange={e => setIssuesOnly(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            {t('variance.issuesOnly')}
          </label>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-6 flex-wrap">
        {[t('common.all'), ...stores].map((s, i) => {
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

      {visibleStores.map(s => <StoreSection key={s} store={s} issuesOnly={issuesOnly} search={search} />)}

      <p className="text-xs text-gray-400 mt-2">{t('variance.footer')}</p>
    </div>
  )
}
