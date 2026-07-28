'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { OFFICES } from '@/lib/practiceData'
import { C9_PRACTICES } from '@/lib/cloud9PracticeData'

function displayToISO(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

// ── Context ───────────────────────────────────────────────────────────────────

type GoLiveDatesContextValue = {
  allDates:          Record<string, string>   // practiceId → ISO "2026-08-15"
  setDate:           (id: string, iso: string) => void
  getWaveTargetDate: (software: 'denticon' | 'cloud9', wave: 1 | 2 | 3) => string
}

const GoLiveDatesContext = createContext<GoLiveDatesContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

const GOLIVE_DATES_KEY = 'pdds-golive-dates'

export function GoLiveDatesProvider({ children }: { children: React.ReactNode }) {
  const [allDates, setAllDates] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(GOLIVE_DATES_KEY)
        if (saved) return JSON.parse(saved) as Record<string, string>
      } catch { /* ignore */ }
    }
    const map: Record<string, string> = {}
    OFFICES.forEach(o      => { map[o.id] = displayToISO(o.goLiveDate) })
    C9_PRACTICES.forEach(p => { map[p.id] = displayToISO(p.goLiveDate) })
    return map
  })

  useEffect(() => {
    try { localStorage.setItem(GOLIVE_DATES_KEY, JSON.stringify(allDates)) } catch { /* quota */ }
  }, [allDates])

  function setDate(id: string, iso: string) {
    setAllDates(prev => ({ ...prev, [id]: iso }))
  }

  // Returns the latest go-live date across all practices in a wave.
  // This represents when the full wave is live.
  function getWaveTargetDate(software: 'denticon' | 'cloud9', wave: 1 | 2 | 3): string {
    const ids = software === 'denticon'
      ? OFFICES.filter(o => o.wave === wave).map(o => o.id)
      : C9_PRACTICES.filter(p => p.wave === wave).map(p => p.id)
    const dates = ids.map(id => allDates[id] ?? '').filter(Boolean)
    if (dates.length === 0) return ''
    return dates.reduce((latest, d) => (d > latest ? d : latest), dates[0])
  }

  return (
    <GoLiveDatesContext.Provider value={{ allDates, setDate, getWaveTargetDate }}>
      {children}
    </GoLiveDatesContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGoLiveDates() {
  const ctx = useContext(GoLiveDatesContext)
  if (!ctx) throw new Error('useGoLiveDates must be used inside GoLiveDatesProvider')
  return ctx
}
