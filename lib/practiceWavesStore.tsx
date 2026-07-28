'use client'

import { createContext, useContext, useState, useEffect } from 'react'

type WaveNum = 1 | 2 | 3
type WaveMap = Record<string, WaveNum>

type PracticeWavesContextValue = {
  allWaves:  WaveMap
  getWave:   (id: string, defaultWave: WaveNum) => WaveNum
  setWave:   (id: string, wave: WaveNum) => void
}

const PracticeWavesContext = createContext<PracticeWavesContextValue | null>(null)

export function PracticeWavesProvider({ children }: { children: React.ReactNode }) {
  const [allWaves, setAllWaves] = useState<WaveMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pdds-practice-waves')
        if (saved) return JSON.parse(saved) as WaveMap
      } catch { /* ignore */ }
    }
    return {}
  })

  useEffect(() => {
    try { localStorage.setItem('pdds-practice-waves', JSON.stringify(allWaves)) } catch { /* quota */ }
  }, [allWaves])

  function getWave(id: string, defaultWave: WaveNum): WaveNum {
    return (allWaves[id] as WaveNum | undefined) ?? defaultWave
  }

  function setWave(id: string, wave: WaveNum) {
    setAllWaves(prev => ({ ...prev, [id]: wave }))
  }

  return (
    <PracticeWavesContext.Provider value={{ allWaves, getWave, setWave }}>
      {children}
    </PracticeWavesContext.Provider>
  )
}

export function usePracticeWaves() {
  const ctx = useContext(PracticeWavesContext)
  if (!ctx) throw new Error('usePracticeWaves must be used inside PracticeWavesProvider')
  return ctx
}
