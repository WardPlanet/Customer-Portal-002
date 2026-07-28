'use client'

import { createContext, useContext, useState, useEffect } from 'react'

const STORAGE_KEY = 'pdds-custom-offices'

export type CustomOffice = {
  id: string
  name: string
  oid: string
  wave: 1 | 2 | 3
  type: 'denticon' | 'cloud9'
}

type CustomOfficesContextValue = {
  customOffices: CustomOffice[]
  addOffice:     (name: string, oid: string, wave: 1|2|3, type: 'denticon'|'cloud9') => string
  removeOffice:  (id: string) => void
}

const CustomOfficesContext = createContext<CustomOfficesContextValue | null>(null)

export function CustomOfficesProvider({ children }: { children: React.ReactNode }) {
  const [customOffices, setCustomOffices] = useState<CustomOffice[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) return JSON.parse(saved) as CustomOffice[]
      } catch { }
    }
    return []
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(customOffices)) } catch { }
  }, [customOffices])

  function addOffice(name: string, oid: string, wave: 1|2|3, type: 'denticon'|'cloud9'): string {
    const id = `custom-${Date.now()}`
    setCustomOffices(prev => [...prev, { id, name, oid, wave, type }])
    return id
  }

  function removeOffice(id: string) {
    setCustomOffices(prev => prev.filter(o => o.id !== id))
  }

  return (
    <CustomOfficesContext.Provider value={{ customOffices, addOffice, removeOffice }}>
      {children}
    </CustomOfficesContext.Provider>
  )
}

export function useCustomOffices() {
  const ctx = useContext(CustomOfficesContext)
  if (!ctx) throw new Error('useCustomOffices must be used inside CustomOfficesProvider')
  return ctx
}
