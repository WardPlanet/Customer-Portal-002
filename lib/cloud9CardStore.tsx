'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { C9_PRACTICES } from '@/lib/cloud9PracticeData'
import { useTrackerActivityLog } from '@/lib/trackerActivityLog'
import { useCustomOffices } from '@/lib/customOfficesStore'

// ── Field label maps ──────────────────────────────────────────────────────────

const DATE_FIELD_LABELS: Partial<Record<keyof C9CardData, string>> = {
  trialExtractDate:   'Trial Extract Date',
  mappingsSentDate:   'Mapping Sent Date',
  mappingDue:         'Mapping Due',
  mappingRecDate:     'Mapping Received Date',
  trialConvertDate:   'Trial Convert Date',
  dataUploadDate:     'Data Upload Date',
  imagesUploadDate:   'Images Upload Date',
  trialReviewCall:    'Trial Review Call',
  trialReleasedDate:  'Trial Released Date',
  auditDue:           'Audit Due',
  finalDataExtract:   'Final Data Extract',
  timeOfDataPull:     'Time of Data Pull',
  finalDataUpload:    'Final Data Upload',
  agentInstallDate:   'Agent Install Date',
  installDate:        'Install Date',
  cleanupSessionDate: 'Cleanup Session Date',
  cleanupDate:        'Cleanup Date',
}

const BOOL_FIELD_LABELS: Partial<Record<keyof C9CardData, string>> = {
  mappingsSent:         'Mappings Sent',
  mappingReceived:      'Mapping Received',
  dataUploadComplete:   'Data Upload Complete',
  imagesUploadComplete: 'Images Upload Complete',
  trialReleased:        'Trial Released',
  installComplete:      'Install Complete',
  cleanupComplete:      'Cleanup Complete',
}

function fmtDateDisplay(iso: string): string {
  if (!iso) return '(cleared)'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Shared type ───────────────────────────────────────────────────────────────

export type C9CardData = {
  // Data Extraction
  extractionMethod:  'SFTP' | 'Screen Connect' | null
  conversionTicket:  string
  trialExtractDate:  string
  prelimUrl:         string

  // Mappings
  mappingsSent:      boolean
  mappingsSentDate:  string
  mappingDue:        string
  mappingReceived:   boolean
  mappingRecDate:    string

  // Trial Convert
  trialConvertDate:     string
  dataUploadComplete:   boolean
  dataUploadDate:       string
  imagesUploadComplete: boolean
  imagesUploadDate:     string
  trialReviewCall:      string
  trialReleased:        boolean
  trialReleasedDate:    string

  // Audit
  auditDue:          string
  auditFindings:     string
  finalDataExtract:  string
  timeOfDataPull:    string
  finalDataUpload:   string

  // Cloud 9 Info
  cloud9Url:          string
  agentInstallDate:   string
  installComplete:    boolean
  installDate:        string
  cleanupSessionDate: string
  cleanupComplete:    boolean
  cleanupDate:        string
}

export const defaultC9Data: C9CardData = {
  extractionMethod:  null,
  conversionTicket:  '',
  trialExtractDate:  '',
  prelimUrl:         '',

  mappingsSent:      false,
  mappingsSentDate:  '',
  mappingDue:        '',
  mappingReceived:   false,
  mappingRecDate:    '',

  trialConvertDate:     '',
  dataUploadComplete:   false,
  dataUploadDate:       '',
  imagesUploadComplete: false,
  imagesUploadDate:     '',
  trialReviewCall:      '',
  trialReleased:        false,
  trialReleasedDate:    '',

  auditDue:          '',
  auditFindings:     '',
  finalDataExtract:  '',
  timeOfDataPull:    '',
  finalDataUpload:   '',

  cloud9Url:          '',
  agentInstallDate:   '',
  installComplete:    false,
  installDate:        '',
  cleanupSessionDate: '',
  cleanupComplete:    false,
  cleanupDate:        '',
}

// ── Context ───────────────────────────────────────────────────────────────────

type C9CardsContextValue = {
  getData: (practiceId: string) => C9CardData
  update:  (practiceId: string, patch: Partial<C9CardData>) => void
}

const C9CardsContext = createContext<C9CardsContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

const C9_CARDS_KEY = 'pdds-c9-cards'

export function Cloud9CardProvider({ children }: { children: React.ReactNode }) {
  const { logActivity } = useTrackerActivityLog()
  const { customOffices } = useCustomOffices()

  const [store, setStore] = useState<Record<string, C9CardData>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(C9_CARDS_KEY)
        if (saved) return JSON.parse(saved) as Record<string, C9CardData>
      } catch { /* ignore */ }
    }
    const map: Record<string, C9CardData> = {}
    C9_PRACTICES.forEach(p => { map[p.id] = { ...defaultC9Data } })
    return map
  })

  useEffect(() => {
    try { localStorage.setItem(C9_CARDS_KEY, JSON.stringify(store)) } catch { /* quota */ }
  }, [store])

  function getData(practiceId: string): C9CardData {
    return store[practiceId] ?? { ...defaultC9Data }
  }

  function update(practiceId: string, patch: Partial<C9CardData>) {
    const current = store[practiceId] ?? { ...defaultC9Data }
    const entityName =
      C9_PRACTICES.find(p => p.id === practiceId)?.name ??
      customOffices.find(o => o.id === practiceId)?.name ??
      practiceId

    for (const [field, newVal] of Object.entries(patch)) {
      const key = field as keyof C9CardData
      const oldVal = (current as Record<string, unknown>)[field]
      if (oldVal === newVal) continue

      const dateLabel = DATE_FIELD_LABELS[key]
      if (dateLabel) {
        logActivity({
          software: 'cloud9',
          entityId: practiceId,
          entityName,
          fieldLabel: dateLabel,
          oldDisplay: fmtDateDisplay(oldVal as string),
          newDisplay: fmtDateDisplay(newVal as string),
        })
        continue
      }

      const boolLabel = BOOL_FIELD_LABELS[key]
      if (boolLabel) {
        logActivity({
          software: 'cloud9',
          entityId: practiceId,
          entityName,
          fieldLabel: boolLabel,
          oldDisplay: oldVal ? 'Yes' : 'No',
          newDisplay: newVal ? 'Yes' : 'No',
        })
      }
    }

    setStore(prev => ({
      ...prev,
      [practiceId]: { ...(prev[practiceId] ?? { ...defaultC9Data }), ...patch },
    }))
  }

  return (
    <C9CardsContext.Provider value={{ getData, update }}>
      {children}
    </C9CardsContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useC9Cards() {
  const ctx = useContext(C9CardsContext)
  if (!ctx) throw new Error('useC9Cards must be used inside Cloud9CardProvider')
  return ctx
}
