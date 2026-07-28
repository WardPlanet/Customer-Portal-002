'use client'

import { useEffect } from 'react'
import type { GoLiveDateChange } from '@/lib/goLiveHistory'

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtISO(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function deltaDays(oldISO: string, newISO: string): number {
  return Math.round(
    (new Date(newISO).getTime() - new Date(oldISO).getTime()) / 86_400_000
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  onClose: () => void
  history: GoLiveDateChange[]
  onClear: () => void
}

export function GoLiveHistoryDrawer({ open, onClose, history, onClear }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Go-Live Date History</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">{history.length} change{history.length !== 1 ? 's' : ''} recorded</p>
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
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">No changes recorded yet</p>
              <p className="text-xs text-gray-400 mt-1">Go-live date edits will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map(entry => {
                const delta = deltaDays(entry.oldDate, entry.newDate)
                const pushed = delta > 0
                return (
                  <div key={entry.id} className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
                    {/* Practice name + source badge */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs font-bold text-gray-800 leading-tight">{entry.practiceName}</p>
                      <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
                        entry.source === 'tracker'
                          ? 'bg-blue-50 text-blue-600 border-blue-200'
                          : 'bg-purple-50 text-purple-600 border-purple-200'
                      }`}>
                        {entry.source}
                      </span>
                    </div>

                    {/* Date change */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-mono text-gray-500 line-through">{fmtISO(entry.oldDate)}</span>
                      <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <span className="text-[11px] font-mono font-bold text-gray-800">{fmtISO(entry.newDate)}</span>

                      {/* Delta pill */}
                      <span className={`ml-auto flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        pushed
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-green-50 text-green-600 border border-green-200'
                      }`}>
                        {pushed ? '+' : ''}{delta}d
                      </span>
                    </div>

                    {/* Timestamp */}
                    <p className="text-[10px] text-gray-400">{fmtTimestamp(entry.changedAt)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => { if (window.confirm('Clear all go-live date history? This cannot be undone.')) onClear() }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors font-medium"
            >
              Clear history
            </button>
          </div>
        )}
      </div>
    </>
  )
}
