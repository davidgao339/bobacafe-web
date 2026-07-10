import { useConfig, useCalcs } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'

const daysSince = (dateStr) => Math.floor((Date.now() - new Date(dateStr)) / 86400000)

const URGENCY = {
  critical: { bar: 'bg-red-500',   card: 'border-red-200 bg-red-50',   btn: 'bg-red-600 hover:bg-red-700 text-white',   label: 'text-red-700' },
  warning:  { bar: 'bg-amber-400', card: 'border-amber-200 bg-amber-50', btn: 'bg-amber-500 hover:bg-amber-600 text-white', label: 'text-amber-700' },
  info:     { bar: 'bg-blue-400',  card: 'border-blue-200 bg-blue-50',  btn: 'bg-blue-600 hover:bg-blue-700 text-white',  label: 'text-blue-700' },
  neutral:  { bar: 'bg-slate-400', card: 'border-gray-200 bg-white',    btn: 'bg-slate-700 hover:bg-slate-800 text-white', label: 'text-gray-700' },
}

function TaskCard({ urgency, icon, title, desc, action, onClick }) {
  const s = URGENCY[urgency]
  return (
    <div className={`relative rounded-xl border-2 p-5 overflow-hidden ${s.card}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
      <div className="pl-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none mt-0.5">{icon}</span>
            <div>
              <p className={`font-semibold text-sm ${s.label}`}>{title}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
            </div>
          </div>
          <button onClick={onClick} className={`flex-shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${s.btn}`}>
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  const { config, sales, data } = useConfig()
  const { getLowStockAlerts } = useCalcs()
  const { t } = useLanguage()

  const alerts  = getLowStockAlerts()
  const sentPOs = data.purchaseOrders.filter(po => po.status === 'sent')

  const lastAuditDate = data.audits.length > 0
    ? [...data.audits].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null
  const auditDays = lastAuditDate ? daysSince(lastAuditDate) : 999

  const tasks = []

  if (auditDays >= 7) tasks.push({
    urgency: 'critical', icon: '📋',
    title: t('dash.overdue'),
    desc: lastAuditDate
      ? t('dash.overdueDesc', { days: auditDays })
      : t('dash.noAuditDesc'),
    action: t('dash.countNow'), nav: 'audit',
  })

  if (sentPOs.length) tasks.push({
    urgency: 'info', icon: '📦',
    title: t('dash.deliveryPending', { ids: sentPOs.map(p => p.id).join(', ') }),
    desc: sentPOs.map(p => p.store).join(' · '),
    action: t('dash.confirmReceipt'), nav: 'purchases',
  })

  const recentSales = sales.slice(0, 5)

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">{t('dash.greeting')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t('dash.subtitle')}</p>
      </div>

      <div className="space-y-3 mb-10">
        {tasks.map((task, i) => (
          <TaskCard key={i} {...task} onClick={() => onNavigate(task.nav)} />
        ))}

        {alerts.length > 0 && (
          <div className="bg-white rounded-xl border-2 border-amber-200 overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-800">⚠️ {t('dash.lowAlerts')} · {alerts.length}</p>
              <button onClick={() => onNavigate('inventory')} className="text-xs text-amber-700 hover:underline">
                {t('dash.viewAll')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {[...alerts].sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 6).map(a => (
                <button key={`${a.store}-${a.productId}`}
                  onClick={() => onNavigate('usage', null, { store: a.store, ingredientId: a.productId })}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-amber-50/60 transition-colors">
                  <span className="text-xs text-gray-400 w-28 truncate flex-shrink-0">{a.store}</span>
                  <span className="text-sm font-medium text-gray-800 flex-1 truncate">{a.product}</span>
                  <span className="text-xs tabular-nums text-gray-500">{a.current} {a.unit}</span>
                  <span className={`text-xs tabular-nums font-semibold w-14 text-right ${a.daysLeft < 1 ? 'text-red-600' : 'text-amber-600'}`}>
                    {a.daysLeft < 1 ? '<1d' : `~${Math.round(a.daysLeft)}d`}
                  </span>
                </button>
              ))}
              {alerts.length > 6 && (
                <button onClick={() => onNavigate('inventory')}
                  className="w-full px-5 py-2 text-xs text-gray-400 hover:text-gray-600 text-center">
                  +{alerts.length - 6}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-8">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-4">{t('common.overview')}</p>
        <div className="grid grid-cols-3 gap-3 mb-8">
          <MiniStat label={t('dash.ingredientsTracked')} value={config.ingredients.length} />
          <MiniStat label={t('dash.daysSinceAudit')}    value={auditDays}   highlight={auditDays >= 7} />
          <MiniStat label={t('dash.lowAlerts')}         value={alerts.length} highlight={alerts.length > 0} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('dash.recentSales')}</p>
            <button onClick={() => onNavigate('transactions')} className="text-blue-600 text-xs hover:underline">{t('dash.viewAll')}</button>
          </div>
          <div className="divide-y divide-gray-50">
            {recentSales.length === 0
              ? <p className="px-5 py-4 text-sm text-gray-400">{t('dash.noSales')}</p>
              : recentSales.map(s => (
                <div key={s.id} className="px-5 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400">{s.date}</span>
                    <span className="text-xs text-gray-500">{s.store}</span>
                    <span className="text-sm font-medium text-gray-800">{s.product}</span>
                  </div>
                  <span className="text-sm tabular-nums text-gray-700">{s.quantity} <span className="text-gray-400 text-xs">{t('dash.cups')}</span></span>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniStat({ label, value, highlight }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
      <p className={`text-2xl font-bold ${highlight ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}
