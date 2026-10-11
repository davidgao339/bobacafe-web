import { useState, useEffect } from 'react'

export default function SyncErrorToast() {
  const [errors, setErrors] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const [successMsg, setSuccessMsg] = useState(null)

  const isRu = typeof window !== 'undefined' 
    ? (localStorage.getItem('bobacafe_lang') !== 'en')
    : true

  useEffect(() => {
    const handleSyncError = (e) => {
      const err = e.detail
      if (!err) return

      setErrors(prev => {
        // Prevent spamming identical active error messages
        const exists = prev.find(item => item.message === err.message && item.sql === err.sql)
        if (exists) {
          return prev.map(item => item.id === exists.id ? { ...item, count: (item.count || 1) + 1, timestamp: err.timestamp } : item)
        }
        return [...prev, { ...err, count: 1 }]
      })
    }

    window.addEventListener('d1-sync-error', handleSyncError)
    return () => window.removeEventListener('d1-sync-error', handleSyncError)
  }, [])

  if (errors.length === 0 && !successMsg) return null

  const dismiss = (id) => {
    setErrors(prev => prev.filter(e => e.id !== id))
  }

  const handleRetry = async (err) => {
    if (!err.retry || retryingId) return
    setRetryingId(err.id)
    try {
      await err.retry()
      dismiss(err.id)
      setSuccessMsg(isRu ? 'Данные успешно сохранены на сервере!' : 'Successfully saved to the server!')
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (e) {
      console.error('Retry failed:', e)
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-3 sm:px-0 pointer-events-none">
      {successMsg && (
        <div className="pointer-events-auto bg-green-50 border border-green-300 text-green-900 rounded-xl p-3 shadow-lg flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 text-sm font-medium">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-green-600 hover:text-green-800 text-sm ml-2">✕</button>
        </div>
      )}

      {errors.map(err => {
        const isExpanded = expandedId === err.id
        const isRetrying = retryingId === err.id

        return (
          <div
            key={err.id}
            className="pointer-events-auto bg-red-50 border-2 border-red-400 text-red-950 rounded-xl p-4 shadow-2xl transition-all duration-200"
            role="alert"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-200 text-red-700 font-bold text-xs">
                  ⚠️
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-red-900">
                      {isRu ? 'Ошибка сохранения в базу данных (D1)' : 'Database Save Error (D1)'}
                    </h4>
                    {err.count > 1 && (
                      <span className="px-1.5 py-0.2 bg-red-200 text-red-800 text-[10px] font-bold rounded-full">
                        ×{err.count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-red-800 mt-1 leading-relaxed">
                    {isRu
                      ? 'Изменения видны на экране, но НЕ сохранились на сервере. При перезагрузке они пропадут.'
                      : 'Changes are visible locally, but FAILED to save to the server. They will be lost on page reload.'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => dismiss(err.id)}
                className="text-red-400 hover:text-red-700 p-1 rounded transition-colors -mr-1 -mt-1"
                title={isRu ? 'Закрыть' : 'Dismiss'}
              >
                ✕
              </button>
            </div>

            {/* Error detail preview */}
            <div className="mt-2.5 pt-2 border-t border-red-200/80 text-xs">
              <div className="flex items-center justify-between text-[11px] text-red-700 mb-1">
                <span className="font-medium">{err.timestamp}</span>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : err.id)}
                  className="underline hover:text-red-900 cursor-pointer"
                >
                  {isExpanded
                    ? (isRu ? 'Скрыть детали ▲' : 'Hide details ▲')
                    : (isRu ? 'Технические детали ▼' : 'Technical details ▼')}
                </button>
              </div>

              <p className="font-mono text-[11px] bg-red-100/80 p-1.5 rounded border border-red-200 text-red-800 break-words line-clamp-2">
                {err.message}
              </p>

              {isExpanded && (
                <div className="mt-2 space-y-1.5 font-mono text-[10px] bg-white/90 p-2 rounded border border-red-200 text-gray-800 overflow-x-auto max-h-40 overflow-y-auto">
                  {err.sql && (
                    <div>
                      <span className="font-bold text-gray-500 block mb-0.5">SQL:</span>
                      <pre className="whitespace-pre-wrap">{err.sql}</pre>
                    </div>
                  )}
                  {err.params && err.params.length > 0 && (
                    <div>
                      <span className="font-bold text-gray-500 block mb-0.5">PARAMS:</span>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(err.params, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex items-center justify-end gap-2 pt-1">
              {err.retry && (
                <button
                  onClick={() => handleRetry(err)}
                  disabled={isRetrying}
                  className="text-xs px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {isRetrying ? (
                    <>
                      <span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                      {isRu ? 'Повтор...' : 'Retrying...'}
                    </>
                  ) : (
                    isRu ? 'Повторить попытку' : 'Retry Save'
                  )}
                </button>
              )}
              <button
                onClick={() => window.location.reload()}
                className="text-xs px-2.5 py-1 bg-white hover:bg-gray-100 text-red-800 font-medium rounded-lg border border-red-300 shadow-sm transition-colors"
              >
                {isRu ? 'Обновить страницу' : 'Reload Page'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
