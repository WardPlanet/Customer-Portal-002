'use client'

import { createContext, useContext, useState, useEffect } from 'react'

export type TrackerNote = {
  id: string
  text: string
  author: string
  timestamp: number
}

type NotesMap  = Record<string, TrackerNote[]>
type ReadMap   = Record<string, number>   // key → last-read timestamp

type TrackerNotesContextValue = {
  getNotes:  (key: string) => TrackerNote[]
  addNote:   (key: string, text: string, author: string) => void
  markRead:  (key: string) => void
  hasUnread: (key: string) => boolean
}

const TrackerNotesContext = createContext<TrackerNotesContextValue | null>(null)

export function TrackerNotesProvider({ children }: { children: React.ReactNode }) {
  const [notesMap, setNotesMap] = useState<NotesMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pdds-tracker-notes')
        if (saved) return JSON.parse(saved) as NotesMap
      } catch { }
    }
    return {}
  })

  const [readMap, setReadMap] = useState<ReadMap>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('pdds-tracker-notes-read')
        if (saved) return JSON.parse(saved) as ReadMap
      } catch { }
    }
    return {}
  })

  useEffect(() => {
    try { localStorage.setItem('pdds-tracker-notes', JSON.stringify(notesMap)) } catch { }
  }, [notesMap])

  useEffect(() => {
    try { localStorage.setItem('pdds-tracker-notes-read', JSON.stringify(readMap)) } catch { }
  }, [readMap])

  function getNotes(key: string) {
    return notesMap[key] ?? []
  }

  function addNote(key: string, text: string, author: string) {
    const note: TrackerNote = {
      id: `note-${Date.now()}`,
      text: text.trim(),
      author: author.trim() || 'Anonymous',
      timestamp: Date.now(),
    }
    setNotesMap(prev => ({ ...prev, [key]: [...(prev[key] ?? []), note] }))
  }

  function markRead(key: string) {
    setReadMap(prev => ({ ...prev, [key]: Date.now() }))
  }

  function hasUnread(key: string): boolean {
    const notes = notesMap[key] ?? []
    if (notes.length === 0) return false
    const lastRead = readMap[key] ?? 0
    return notes.some(n => n.timestamp > lastRead)
  }

  return (
    <TrackerNotesContext.Provider value={{ getNotes, addNote, markRead, hasUnread }}>
      {children}
    </TrackerNotesContext.Provider>
  )
}

export function useTrackerNotes() {
  const ctx = useContext(TrackerNotesContext)
  if (!ctx) throw new Error('useTrackerNotes must be used inside TrackerNotesProvider')
  return ctx
}
