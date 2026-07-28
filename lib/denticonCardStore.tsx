'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { OFFICES } from '@/lib/practiceData'
import { useTrackerActivityLog } from '@/lib/trackerActivityLog'
import { useCustomOffices } from '@/lib/customOfficesStore'

// ── Field label maps ──────────────────────────────────────────────────────────

const DATE_FIELD_LABELS: Partial<Record<keyof OfficeCardData, string>> = {
  trialExtractDate:    'Trial Extract Date',
  mappingSentDate:     'Mapping Sent Date',
  mappingDue:          'Mapping Due',
  mappingReceivedDate: 'Mapping Received Date',
  trialUploadDate:     'Trial Upload Date',
  trialReleasedDate:   'Trial Released Date',
  auditDue:            'Audit Due',
  findingDate:         'Finding Date',
  finalMappingDate:    'Final Mapping Date',
  finalExtract:        'Final Extract',
  preFinalUpload:      'Pre-Final Upload',
  preFinalApprDate:    'Pre-Final Approval Date',
  finalUpload:         'Final Upload',
  docReceivedDate:     'Doc Received Date',
  convCompleteDate:    'Conversion Complete Date',
}

const BOOL_FIELD_LABELS: Partial<Record<keyof OfficeCardData, string>> = {
  mappingSent:      'Mapping Sent',
  mappingReceived:  'Mapping Received',
  trialReleased:    'Trial Released',
  findingReceived:  'Finding Received',
  finalMappingRec:  'Final Mapping Received',
  preFinalApproved: 'Pre-Final Approved',
  docReceived:      'Doc Received',
  convComplete:     'Conversion Complete',
}

function fmtDateDisplay(iso: string): string {
  if (!iso) return '(cleared)'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Shared types ──────────────────────────────────────────────────────────────

export type ResolvedStatus = 'completed' | 'na' | null

export type OfficeCardData = {
  // ExtractionSetupCard
  pms:              string
  method:           'SFTP' | 'LMI' | null
  conversionTicket: string

  // DataMappingFlow — all dates as ISO "YYYY-MM-DD" or ''
  trialExtractDate:    string
  mappingSent:         boolean
  mappingSentDate:     string
  mappingDue:          string
  mappingReceived:     boolean
  mappingReceivedDate: string

  // TrialDataCard
  trialUploadDate:  string
  trialReleased:    boolean
  trialReleasedDate:string

  // AuditCard
  auditDue:         string
  findingReceived:  boolean
  findingDate:      string
  issuesResolved:   ResolvedStatus

  // FinalsCard
  finalMappingRec:  boolean
  finalMappingDate: string
  finalExtract:     string
  preFinalUpload:   string
  preFinalApproved: boolean
  preFinalApprDate: string
  finalUpload:      string

  // ScannedDocsCard
  docReceived:      boolean
  docReceivedDate:  string
  convComplete:     boolean
  convCompleteDate: string
}

export const defaultOfficeData: OfficeCardData = {
  pms:              'Fuse',
  method:           null,
  conversionTicket: '',

  trialExtractDate:    '',
  mappingSent:         false,
  mappingSentDate:     '',
  mappingDue:          '',
  mappingReceived:     false,
  mappingReceivedDate: '',

  trialUploadDate:   '',
  trialReleased:     false,
  trialReleasedDate: '',

  auditDue:        '',
  findingReceived: false,
  findingDate:     '',
  issuesResolved:  null,

  finalMappingRec:  false,
  finalMappingDate: '',
  finalExtract:     '',
  preFinalUpload:   '',
  preFinalApproved: false,
  preFinalApprDate: '',
  finalUpload:      '',

  docReceived:      false,
  docReceivedDate:  '',
  convComplete:     false,
  convCompleteDate: '',
}

// ── Context ───────────────────────────────────────────────────────────────────

type DenticonCardsContextValue = {
  getData: (officeId: string) => OfficeCardData
  update:  (officeId: string, patch: Partial<OfficeCardData>) => void
}

const DenticonCardsContext = createContext<DenticonCardsContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

const DENTICON_CARDS_KEY = 'pdds-denticon-cards'

export function DenticonCardProvider({ children }: { children: React.ReactNode }) {
  const { logActivity } = useTrackerActivityLog()
  const { customOffices } = useCustomOffices()

  const [store, setStore] = useState<Record<string, OfficeCardData>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(DENTICON_CARDS_KEY)
        if (saved) return JSON.parse(saved) as Record<string, OfficeCardData>
      } catch { /* ignore */ }
    }
    const map: Record<string, OfficeCardData> = {}
    OFFICES.forEach(o => { map[o.id] = { ...defaultOfficeData } })
    return map
  })

  useEffect(() => {
    try { localStorage.setItem(DENTICON_CARDS_KEY, JSON.stringify(store)) } catch { /* quota */ }
  }, [store])

  function getData(officeId: string): OfficeCardData {
    return store[officeId] ?? { ...defaultOfficeData }
  }

  function update(officeId: string, patch: Partial<OfficeCardData>) {
    const current = store[officeId] ?? { ...defaultOfficeData }
    const entityName =
      OFFICES.find(o => o.id === officeId)?.name ??
      customOffices.find(o => o.id === officeId)?.name ??
      officeId

    for (const [field, newVal] of Object.entries(patch)) {
      const key = field as keyof OfficeCardData
      const oldVal = (current as Record<string, unknown>)[field]
      if (oldVal === newVal) continue

      const dateLabel = DATE_FIELD_LABELS[key]
      if (dateLabel) {
        logActivity({
          software: 'denticon',
          entityId: officeId,
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
          software: 'denticon',
          entityId: officeId,
          entityName,
          fieldLabel: boolLabel,
          oldDisplay: oldVal ? 'Yes' : 'No',
          newDisplay: newVal ? 'Yes' : 'No',
        })
      }
    }

    setStore(prev => ({
      ...prev,
      [officeId]: { ...(prev[officeId] ?? { ...defaultOfficeData }), ...patch },
    }))
  }

  return (
    <DenticonCardsContext.Provider value={{ getData, update }}>
      {children}
    </DenticonCardsContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDenticonCards() {
  const ctx = useContext(DenticonCardsContext)
  if (!ctx) throw new Error('useDenticonCards must be used inside DenticonCardProvider')
  return ctx
}
