'use client'

import { createContext, useContext, useState, useCallback } from 'react'

const STORAGE_KEY = 'pdds-tracker-activity'

export type TrackerActivity = {
  id: string
  software: 'denticon' | 'cloud9'
  entityId: string
  entityName: string
  fieldLabel: string
  oldDisplay: string
  newDisplay: string
  loggedAt: string
}

type TrackerActivityLogContextValue = {
  activityLog:    TrackerActivity[]
  logActivity:    (entry: Omit<TrackerActivity, 'id' | 'loggedAt'>) => void
  clearActivityLog: () => void
}

const TrackerActivityLogContext = createContext<TrackerActivityLogContextValue | null>(null)

export function TrackerActivityLogProvider({ children }: { children: React.ReactNode }) {
  const [activityLog, setActivityLog] = useState<TrackerActivity[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as TrackerActivity[]
      } catch { }
    }
    return []
  })

  const logActivity = useCallback((entry: Omit<TrackerActivity, 'id' | 'loggedAt'>) => {
    const record: TrackerActivity = {
      ...entry,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      loggedAt: new Date().toISOString(),
    }
    setActivityLog(prev => {
      const next = [record, ...prev]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { }
      return next
    })
  }, [])

  const clearActivityLog = useCallback(() => {
    setActivityLog([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { }
  }, [])

  return (
    <TrackerActivityLogContext.Provider value={{ activityLog, logActivity, clearActivityLog }}>
      {children}
    </TrackerActivityLogContext.Provider>
  )
}

export function useTrackerActivityLog() {
  const ctx = useContext(TrackerActivityLogContext)
  if (!ctx) throw new Error('useTrackerActivityLog must be used inside TrackerActivityLogProvider')
  return ctx
}
