import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useConfig } from '../context/ConfigContext'
import { useLanguage } from '../context/LanguageContext'
import { 
  Printer, 
  Calendar, 
  ChevronDown, 
  ChevronUp, 
  AlertTriangle, 
  Coins, 
  Package, 
  FileText, 
  Layers,
  ArrowRight,
  TrendingUp,
  Receipt
} from 'lucide-react'

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}

function getPresetDates(preset) {
  const now = new Date()
  const today = toDateStr(now)
  
  if (preset === 'today') {
    return { from: today, to: today }
  }
  
  if (preset === 'thisWeek') {
    // Monday of current week
    const day = now.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    const mon = new Date(now)
    mon.setDate(now.getDate() + diff)
    return { from: toDateStr(mon), to: today }
  }
  
  if (preset === 'lastWeek') {
    // Previous Monday to Sunday
    const day = now.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    const lastMon = new Date(now)
    lastMon.setDate(now.getDate() + diff - 7)
    const lastSun = new Date(lastMon)
    lastSun.setDate(lastMon.getDate() + 6)
    return { from: toDateStr(lastMon), to: toDateStr(lastSun) }
  }
  
  if (preset === 'thisMonth') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: toDateStr(firstDay), to: today }
  }
  
  if (preset === 'lastMonth') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: toDateStr(firstDay), to: toDateStr(lastDay) }
  }
  
  if (preset === 'allTime') {
    return { from: '2025-01-01', to: today }
  }
  
  return { from: today, to: today }
}

export default function Payroll() {
  const { config, data } = useConfig()
  const { t } = useLanguage()

  // Default to this month
  const [activePreset, setActivePreset] = useState('thisMonth')
  const [{ from, to }, setDateRange] = useState(() => getPresetDates('thisMonth'))
  const [expandedRows, setExpandedRows] = useState({})

  const ingredients = config.ingredients || []
  const unitPayMap = config.unitPay || {}

  const ingredientName = (id) => ingredients.find(i => i.id === id)?.name ?? 'Unknown'
  const ingredientUnit = (id) => ingredients.find(i => i.id === id)?.unit ?? 'ед.'

  const handlePreset = (presetKey) => {
    setActivePreset(presetKey)
    setDateRange(getPresetDates(presetKey))
  }

  const toggleRow = (productName) => {
    setExpandedRows(prev => ({ ...prev, [productName]: !prev[productName] }))
  }

  // ─── Aggregate Production Data ──────────────────────────────────────────────
  const payrollData = useMemo(() => {
    const transactions = data.transactions || []

    // Filter production finished goods (quantity > 0) within date range
    const prodTx = transactions.filter(t => {
      if (t.type !== 'production' || t.quantity <= 0) return false
      const txDate = t.date || (t.timestamp ? t.timestamp.slice(0, 10) : '')
      if (!txDate) return false
      if (from && txDate < from) return false
      if (to && txDate > to) return false
      return true
    })

    // Group by product
    const grouped = {}
    for (const tx of prodTx) {
      const prodName = tx.reason || ingredientName(tx.ingredientId)
      if (!grouped[prodName]) {
        grouped[prodName] = {
          name: prodName,
          ingredientId: tx.ingredientId,
          unit: ingredientUnit(tx.ingredientId),
          totalQty: 0,
          batches: 0,
          events: [],
        }
      }
      grouped[prodName].totalQty += tx.quantity
      grouped[prodName].batches += 1
      grouped[prodName].events.push({
        id: tx.id,
        poId: tx.poId || '—',
        date: tx.date || (tx.timestamp ? tx.timestamp.slice(0, 10) : ''),
        time: tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        quantity: tx.quantity,
      })
    }

    // Sort events inside each product chronologically descending
    Object.values(grouped).forEach(item => {
      item.events.sort((a, b) => b.date.localeCompare(a.date))
    })

    // Compute line totals and missing rates
    const items = Object.values(grouped).map(item => {
      const rate = unitPayMap[item.name] ?? 0
      const totalPay = item.totalQty * rate
      return {
        ...item,
        rate,
        totalPay,
        hasRate: rate > 0,
      }
    }).sort((a, b) => b.totalPay - a.totalPay || b.totalQty - a.totalQty)

    const grandTotalPay = items.reduce((sum, i) => sum + i.totalPay, 0)
    const grandTotalUnits = items.reduce((sum, i) => sum + i.totalQty, 0)
    const grandTotalBatches = items.reduce((sum, i) => sum + i.batches, 0)
    const missingRatesCount = items.filter(i => !i.hasRate).length

    return {
      items,
      grandTotalPay,
      grandTotalUnits,
      grandTotalBatches,
      missingRatesCount,
      totalProductsCount: items.length,
    }
  }, [data.transactions, from, to, unitPayMap, ingredients])

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="p-4 md:p-6 pb-24 max-w-6xl mx-auto">
      {/* ─── Printable Invoice Styling ─── */}
      <style>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
            font-size: 12px;
          }
          nav, header, .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          .print-card {
            border: 1px solid #e5e7eb !important;
            box-shadow: none !important;
          }
          .page-break {
            page-break-after: always;
          }
        }
        @media screen {
          .print-only {
            display: none !important;
          }
        }
      `}</style>

      {/* ─── Screen Header ─── */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('payroll.title')}</h1>
              <p className="text-xs text-gray-500">{t('payroll.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm"
          >
            <Printer className="w-4 h-4" />
            {t('payroll.printInvoice')}
          </button>
        </div>
      </div>

      {/* ─── Date Filter & Presets (no-print) ─── */}
      <div className="no-print bg-white rounded-2xl border border-gray-200/80 shadow-sm p-4 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5 mr-1">
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              {t('payroll.selectPeriod')}:
            </span>
            {[
              ['today', t('payroll.today')],
              ['thisWeek', t('payroll.thisWeek')],
              ['lastWeek', t('payroll.lastWeek')],
              ['thisMonth', t('payroll.thisMonth')],
              ['lastMonth', t('payroll.lastMonth')],
              ['allTime', t('payroll.allTime')],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => handlePreset(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activePreset === key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap self-start sm:self-auto">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">{t('payroll.from')}:</span>
              <input
                type="date"
                value={from}
                onChange={e => {
                  setActivePreset('custom')
                  setDateRange(prev => ({ ...prev, from: e.target.value }))
                }}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
            <span className="text-gray-400 font-medium">—</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-medium">{t('payroll.to')}:</span>
              <input
                type="date"
                value={to}
                onChange={e => {
                  setActivePreset('custom')
                  setDateRange(prev => ({ ...prev, to: e.target.value }))
                }}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Missing Rates Banner ─── */}
      {payrollData.missingRatesCount > 0 && (
        <div className="no-print bg-amber-50 border border-amber-200/80 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">{t('payroll.missingRateWarning')}</p>
              <p className="text-xs text-amber-700 mt-0.5">
                {payrollData.missingRatesCount} product(s) produced in this period do not have a unit pay set. Set their pay rates in Recipes so they compute into the payroll total.
              </p>
            </div>
          </div>
          <Link
            to="/recipes"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap self-end sm:self-auto"
          >
            {t('payroll.goToRecipes')}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* ─── KPI Summary Cards (no-print) ─── */}
      <div className="no-print grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-4 text-white shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between opacity-80 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">{t('payroll.totalPay')}</span>
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <div className="text-2xl lg:text-3xl font-extrabold tracking-tight font-mono">
              ₽{payrollData.grandTotalPay.toLocaleString()}
            </div>
            <p className="text-[11px] opacity-75 mt-1">Based on {from} to {to}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">{t('payroll.unitsProduced')}</span>
            <Package className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900 font-mono">
              {payrollData.grandTotalUnits.toLocaleString()}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Total finished units</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">{t('payroll.activeProducts')}</span>
            <Layers className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900 font-mono">
              {payrollData.totalProductsCount}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Unique items made</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200/80 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">{t('payroll.batches')}</span>
            <TrendingUp className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900 font-mono">
              {payrollData.grandTotalBatches}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Production runs</p>
          </div>
        </div>
      </div>

      {/* ─── Printable Formal Invoice Header (print-only) ─── */}
      <div className="print-only mb-6 border-b-2 border-gray-800 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">BOBA RABBIT — WAREHOUSE</h1>
            <p className="text-sm font-semibold text-gray-600 mt-0.5">{t('payroll.invoiceHeader')}</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <p><span className="font-semibold">{t('payroll.period')}:</span> {from} — {to}</p>
            <p><span className="font-semibold">{t('payroll.issued')}:</span> {new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* ─── Itemized Invoice Table ─── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden mb-8 print-card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Itemized Production Invoice</h2>
          </div>
          <span className="text-xs text-gray-400 font-medium">
            {from} → {to}
          </span>
        </div>

        {payrollData.items.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">{t('payroll.noProduction')}</p>
            <p className="text-xs text-gray-400 mt-1">Try selecting a wider date range</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Product Name</th>
                  <th className="py-3 px-3 text-center">Unit</th>
                  <th className="py-3 px-3 text-center">Batches</th>
                  <th className="py-3 px-4 text-right">Qty Produced</th>
                  <th className="py-3 px-4 text-right">{t('payroll.ratePerUnit')}</th>
                  <th className="py-3 px-5 text-right">{t('payroll.itemTotal')}</th>
                  <th className="no-print py-3 px-3 text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payrollData.items.map(item => {
                  const isExpanded = !!expandedRows[item.name]
                  return (
                    <FragmentRow key={item.name}>
                      <tr 
                        className={`transition-colors hover:bg-blue-50/30 ${
                          !item.hasRate ? 'bg-amber-50/30' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 font-semibold text-gray-900">
                          <div className="flex items-center gap-2">
                            <span>{item.name}</span>
                            {!item.hasRate && (
                              <span className="no-print text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                                No rate
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-center text-xs text-gray-500 font-medium">
                          {item.unit}
                        </td>
                        <td className="py-3.5 px-3 text-center font-mono text-xs text-gray-600">
                          {item.batches}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-semibold text-gray-900">
                          {item.totalQty.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-xs">
                          {item.hasRate ? (
                            <span className="font-semibold text-gray-800">₽{item.rate.toLocaleString()}</span>
                          ) : (
                            <span className="text-amber-600 font-medium italic">₽0.00</span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono font-bold text-gray-900">
                          ₽{item.totalPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="no-print py-3.5 px-3 text-center">
                          <button
                            onClick={() => toggleRow(item.name)}
                            className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                            title="Toggle batch breakdown"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Drilldown for Screen */}
                      {isExpanded && (
                        <tr className="no-print bg-gray-50/80">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                              Batch Breakdown ({item.events.length} production runs):
                            </div>
                            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
                                    <th className="py-2 px-3 text-left">Date & Time</th>
                                    <th className="py-2 px-3 text-left">Batch ID</th>
                                    <th className="py-2 px-3 text-right">Produced Qty</th>
                                    <th className="py-2 px-3 text-right">Batch Pay</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 font-mono">
                                  {item.events.map(ev => (
                                    <tr key={ev.id} className="hover:bg-gray-50">
                                      <td className="py-1.5 px-3 text-gray-700">
                                        {ev.date} {ev.time}
                                      </td>
                                      <td className="py-1.5 px-3 text-purple-700 font-medium">
                                        {ev.poId}
                                      </td>
                                      <td className="py-1.5 px-3 text-right text-gray-900 font-semibold">
                                        +{ev.quantity} {item.unit}
                                      </td>
                                      <td className="py-1.5 px-3 text-right text-emerald-700 font-semibold">
                                        ₽{(ev.quantity * item.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold text-gray-900">
                  <td className="py-4 px-4 text-sm uppercase tracking-wider">
                    Total / Итого:
                  </td>
                  <td className="py-4 px-3 text-center text-xs text-gray-500">
                    —
                  </td>
                  <td className="py-4 px-3 text-center font-mono text-sm">
                    {payrollData.grandTotalBatches}
                  </td>
                  <td className="py-4 px-4 text-right font-mono text-base">
                    {payrollData.grandTotalUnits.toLocaleString()}
                  </td>
                  <td className="py-4 px-4 text-right text-xs text-gray-400">
                    —
                  </td>
                  <td className="py-4 px-5 text-right font-mono text-xl text-blue-700">
                    ₽{payrollData.grandTotalPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="no-print py-4 px-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ─── Printable Signature Block (print-only) ─── */}
      <div className="print-only mt-12 pt-8 border-t border-gray-300">
        <div className="grid grid-cols-3 gap-8 text-xs text-gray-800">
          <div>
            <p className="font-bold uppercase tracking-wider mb-6">{t('payroll.preparedBy')}:</p>
            <div className="border-b border-gray-400 h-6"></div>
            <p className="text-[10px] text-gray-500 mt-1">Warehouse Manager</p>
          </div>
          <div>
            <p className="font-bold uppercase tracking-wider mb-6">{t('payroll.approvedBy')}:</p>
            <div className="border-b border-gray-400 h-6"></div>
            <p className="text-[10px] text-gray-500 mt-1">General Management</p>
          </div>
          <div>
            <p className="font-bold uppercase tracking-wider mb-6">{t('payroll.cookSignature')}:</p>
            <div className="border-b border-gray-400 h-6"></div>
            <p className="text-[10px] text-gray-500 mt-1">Cook / Kitchen Staff</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ children }) {
  return <>{children}</>
}
