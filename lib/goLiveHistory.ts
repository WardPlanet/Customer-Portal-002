'use client'

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'pdds-golive-history'

// ── Types ─────────────────────────────────────────────────────────────────────

export type GoLiveDateChange = {
  id: string
  practiceId: string
  practiceName: string
  oldDate: string    // ISO "2026-08-15"
  newDate: string    // ISO "2026-09-01"
  changedAt: string  // ISO timestamp
  source: 'tracker' | 'tasks'
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGoLiveHistory() {
  const [history, setHistory] = useState<GoLiveDateChange[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as GoLiveDateChange[]
    } catch {
      return []
    }
  })

  const logChange = useCallback((
    entry: Omit<GoLiveDateChange, 'id' | 'changedAt'>
  ) => {
    const record: GoLiveDateChange = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      changedAt: new Date().toISOString(),
    }
    setHistory(prev => {
      const next = [record, ...prev]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }, [])

  return { history, logChange, clearHistory }
}
