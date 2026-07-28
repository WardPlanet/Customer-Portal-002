'use client'

import { useEffect } from 'react'
import type { TrackerActivity } from '@/lib/trackerActivityLog'

function fmtTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

type Props = {
  open:     boolean
  onClose:  () => void
  log:      TrackerActivity[]
  onClear:  () => void
}

export function TrackerActivityDrawer({ open, onClose, log, onClear }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full w-[440px] max-w-full bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Field Change Log</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">{log.length} change{log.length !== 1 ? 's' : ''} recorded</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {log.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">No changes recorded yet</p>
              <p className="text-xs text-gray-400 mt-1">Date and status edits in the tracker will appear here</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {log.map(entry => (
                <div key={entry.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-xs font-bold text-gray-800 leading-tight">{entry.entityName}</p>
                    <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
                      entry.software === 'denticon'
                        ? 'bg-blue-50 text-blue-600 border-blue-200'
                        : 'bg-orange-50 text-orange-600 border-orange-200'
                    }`}>
                      {entry.software === 'denticon' ? 'Denticon' : 'Cloud 9'}
                    </span>
                  </div>

                  <p className="text-[10px] font-semibold text-gray-500 mb-1">{entry.fieldLabel}</p>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-gray-400 line-through">{entry.oldDisplay}</span>
                    <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-[11px] font-mono font-bold text-gray-700">{entry.newDisplay}</span>
                  </div>

                  <p className="text-[9px] text-gray-400 mt-1.5">{fmtTimestamp(entry.loggedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {log.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => { if (window.confirm('Clear all field change history? This cannot be undone.')) onClear() }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium"
            >
              Clear log
            </button>
          </div>
        )}
      </div>
    </>
  )
}
