'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { DEFAULT_RATE_TABLE, computeCredits, createOffice } from '@/lib/creditConfig'
import type { CreditConfig, CreditOffice, CreditSummaryTotals } from '@/lib/creditConfig'

export type CreditNote = {
  id: number
  author: string
  text: string
  timestamp: string
}

type CreditCommentsByOffice = Record<number, CreditNote[]>

type StoredState = {
  config: CreditConfig
  offices: CreditOffice[]
  comments: CreditCommentsByOffice
  nextId: number
}

const INITIAL_CONFIG: CreditConfig = {
  segment:      'commercial',
  pace:         'standard',
  totalOffices: 25,
  rateTable:    DEFAULT_RATE_TABLE,
}

// Demo seed data — mirrors the standalone credit-calc prototype so the
// portal shows something meaningful before real go-live data is wired in.
const SAMPLE_OFFICES: CreditOffice[] = [
  // Wave 1 — live (8)
  { ...createOffice({ id:  1, name: 'Downtown Clinic',         wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  2, name: 'Westside Office',         wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  3, name: 'Lakewood Practice',       wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  4, name: 'Riverside Dental',        wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  5, name: 'Midtown Smiles',          wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  6, name: 'Southpark Oral Care',     wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  7, name: 'Harbor View Dentistry',   wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  { ...createOffice({ id:  8, name: 'Hillcrest Family Dental', wave: 1, targetDate: '2025-09-01' }), status: 'live' },
  // Wave 2 — missed (9)
  { ...createOffice({ id:  9, name: 'Oakwood Dental Group',    wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 10, name: 'Sunset Dental Studio',    wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 11, name: 'Elmwood Oral Health',     wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 12, name: 'Valley Ridge Dentistry',  wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 13, name: 'Pinecrest Dental',        wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 14, name: 'Cedarbrook Smiles',       wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 15, name: 'Maplewood Oral Care',     wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 16, name: 'Birchwood Dental Arts',   wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  { ...createOffice({ id: 17, name: 'Foxhill Family Dental',   wave: 2, targetDate: '2026-01-01' }), status: 'missed' },
  // Wave 3 — pending (8)
  createOffice({ id: 18, name: 'Stonegate Dental',        wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 19, name: 'Clearwater Smiles',       wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 20, name: 'Northshore Oral Health',  wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 21, name: 'Ridgeline Dentistry',     wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 22, name: 'Willow Creek Dental',     wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 23, name: 'Ashford Dental Group',    wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 24, name: 'Bayside Oral Care',       wave: 3, targetDate: '2026-09-01' }),
  createOffice({ id: 25, name: 'Crestview Family Dental', wave: 3, targetDate: '2026-09-01' }),
]

const INITIAL_STATE: StoredState = {
  config:   INITIAL_CONFIG,
  offices:  SAMPLE_OFFICES,
  comments: {},
  nextId:   26,
}

type CreditCalculatorContextValue = {
  config:       CreditConfig
  setConfig:    (config: CreditConfig) => void
  offices:      CreditOffice[]
  addOffice:    () => void
  updateOffice: (id: number, updates: Partial<CreditOffice>) => void
  removeOffice: (id: number) => void
  comments:     CreditCommentsByOffice
  addComment:   (officeId: number, note: CreditNote) => void
  summary:      CreditSummaryTotals
}

const CreditCalculatorContext = createContext<CreditCalculatorContextValue | null>(null)

export function CreditCalculatorProvider({ clientId, children }: { clientId: string; children: React.ReactNode }) {
  const STORAGE_KEY = `pdds-credit-calculator-${clientId}`

  const [state, setState] = useState<StoredState>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) return JSON.parse(saved) as StoredState
      } catch { /* ignore */ }
    }
    return INITIAL_STATE
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* quota */ }
  }, [state, STORAGE_KEY])

  function setConfig(config: CreditConfig) {
    setState(prev => ({ ...prev, config }))
  }

  function addOffice() {
    setState(prev => {
      const maxWave = prev.offices.reduce((m, o) => Math.max(m, o.wave), 1)
      const office = createOffice({ id: prev.nextId, name: 'New Office', wave: maxWave })
      return { ...prev, offices: [...prev.offices, office], nextId: prev.nextId + 1 }
    })
  }

  function updateOffice(id: number, updates: Partial<CreditOffice>) {
    setState(prev => ({ ...prev, offices: prev.offices.map(o => o.id === id ? { ...o, ...updates } : o) }))
  }

  function removeOffice(id: number) {
    setState(prev => ({ ...prev, offices: prev.offices.filter(o => o.id !== id) }))
  }

  function addComment(officeId: number, note: CreditNote) {
    setState(prev => ({
      ...prev,
      comments: { ...prev.comments, [officeId]: [...(prev.comments[officeId] ?? []), note] },
    }))
  }

  const summary = computeCredits(state.config, state.offices)

  return (
    <CreditCalculatorContext.Provider
      value={{
        config: state.config, setConfig,
        offices: state.offices, addOffice, updateOffice, removeOffice,
        comments: state.comments, addComment,
        summary,
      }}
    >
      {children}
    </CreditCalculatorContext.Provider>
  )
}

export function useCreditCalculator() {
  const ctx = useContext(CreditCalculatorContext)
  if (!ctx) throw new Error('useCreditCalculator must be used inside CreditCalculatorProvider')
  return ctx
}
