'use client'

import { useState, useMemo } from 'react'
import type { Task } from '@/lib/types'
import { formatDate, isOverdue } from '@/lib/utils'

type NotificationDrawerProps = {
  tasks: Task[]
  tabLabel?: string
}

export function NotificationDrawer({ tasks, tabLabel = 'Tasks' }: NotificationDrawerProps) {
  const [open, setOpen] = useState(false)

  const urgent = useMemo(() => {
    const flat = tasks.flatMap(t => [t, ...(t.subtasks ?? [])])
    const now = Date.now()
    return flat.filter(t => {
      if (t.status === 'complete') return false
      const due = new Date(t.due_date).getTime()
      const daysAway = (due - now) / 86400000
      return daysAway <= 7
    }).sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
  }, [tasks])

  const overdueCount = urgent.filter(t => isOverdue(t.due_date, t.status)).length

  return (
    <>
      {/* Floating bell */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
        title="Upcoming & overdue tasks"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {urgent.length > 0 && (
          <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${overdueCount > 0 ? 'bg-red-500' : 'bg-amber-500'}`}>
            {urgent.length}
          </span>
        )}
      </button>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setOpen(false)} />
      )}

      {/* Slide-up panel */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Upcoming &amp; Overdue</h2>
            <p className="text-[11px] text-gray-400">{tabLabel} · Next 7 days + overdue</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-2" style={{ maxHeight: 'calc(70vh - 73px)' }}>
          {urgent.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-400">No upcoming or overdue tasks.</p>
            </div>
          ) : urgent.map(task => {
            const overdue = isOverdue(task.due_date, task.status)
            return (
              <div key={task.id} className={`flex items-start gap-3 p-3 rounded-xl border ${overdue ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${overdue ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 leading-snug">{task.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{task.phase}</p>
                </div>
                <span className={`text-xs font-semibold flex-shrink-0 ${overdue ? 'text-red-600' : 'text-amber-600'}`}>
                  {overdue ? '⚠ ' : ''}{formatDate(task.due_date)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
