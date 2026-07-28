'use client'

import { useState } from 'react'
import { useDenticonCards } from '@/lib/denticonCardStore'
import type { ResolvedStatus } from '@/lib/denticonCardStore'
import type { Office } from '@/lib/practiceData'

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function todayISO()     {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
function parseLocal(s: string) {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

// ── Shared primitives ─────────────────────────────────────────────────────────

// PDDS Green = #257226
const cardCls = (done: boolean) =>
  `rounded-xl p-5 shadow-sm border transition-colors duration-300 ${
    done ? 'bg-[#257226]/5 border-[#257226]' : 'bg-white border-gray-200'
  }`

function CompleteBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[#257226] bg-[#257226]/10 border border-[#257226]/30 rounded-full px-2 py-0.5">
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Complete
    </span>
  )
}

function OfficeBadge({ office }: { office?: Pick<Office, 'name' | 'oid'> }) {
  if (!office) return null
  return (
    <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-100 text-blue-600 rounded-full px-2 py-0.5">
      <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-2M5 21H3m2 0h2M9 7h1m-1 4h1m4-4h1m-1 4h1" />
      </svg>
      <span className="text-[9px] font-semibold">{office.name}</span>
      <span className="text-blue-300 text-[9px]">·</span>
      <span className="text-[9px] font-mono font-bold">{office.oid}</span>
    </span>
  )
}

function CardHeader({ title, office, isComplete }: { title: string; office?: Pick<Office, 'name' | 'oid'>; isComplete?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">{title}</p>
        {isComplete && <CompleteBadge />}
      </div>
      <OfficeBadge office={office} />
    </div>
  )
}

function RowDivider() {
  return <div className="border-t border-gray-100" />
}

/** Editable date — shows formatted date or "Set date" placeholder; click to edit */
function DateRow({ label, value, onChange }: {
  label:    string
  value:    string   // ISO yyyy-mm-dd or ''
  onChange: (iso: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  function save() {
    if (draft) onChange(draft)
    setEditing(false)
  }

  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight">{label}</span>
      {editing ? (
        <input
          type="date"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className="text-[10px] border border-blue-300 rounded px-1.5 py-0.5 text-blue-700 outline-none focus:ring-2 focus:ring-blue-100 flex-shrink-0"
        />
      ) : (
        <button
          onClick={() => { setDraft(value || todayISO()); setEditing(true) }}
          className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors flex-shrink-0 whitespace-nowrap"
        >
          {value
            ? fmtDate(parseLocal(value))
            : <span className="text-gray-400 font-normal italic">Set date</span>
          }
        </button>
      )}
    </div>
  )
}

/** Checkbox — records today's date when checked */
function CheckRow({ label, checked, date, onChange }: {
  label:    string
  checked:  boolean
  date:     string   // ISO or ''
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={onChange}
          className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all cursor-pointer ${
            checked
              ? 'bg-blue-600 border-blue-600 shadow-sm shadow-blue-100'
              : 'bg-white border-gray-300 hover:border-blue-400 hover:bg-blue-50'
          }`}
        >
          {checked && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span className={`text-xs font-medium leading-tight ${checked ? 'text-blue-700' : 'text-gray-600'}`}>
          {label}
        </span>
      </div>
      {checked && date && (
        <span className="text-[11px] font-medium text-gray-500 flex-shrink-0 whitespace-nowrap">
          {fmtDate(parseLocal(date))}
        </span>
      )}
    </div>
  )
}

/** Completed / N/A status toggle */
function ResolvedRow({ label, value, onChange }: {
  label:    string
  value:    ResolvedStatus
  onChange: (v: ResolvedStatus) => void
}) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight">{label}</span>
      <div className="flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => onChange(value === 'completed' ? null : 'completed')}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-all cursor-pointer ${
            value === 'completed'
              ? 'bg-green-500 border-green-500 text-white shadow-sm'
              : 'bg-white border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600'
          }`}
        >
          Completed
        </button>
        <button
          onClick={() => onChange(value === 'na' ? null : 'na')}
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border transition-all cursor-pointer ${
            value === 'na'
              ? 'bg-gray-400 border-gray-400 text-white'
              : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600'
          }`}
        >
          N/A
        </button>
      </div>
    </div>
  )
}

// ── 1. Trial Data Card ────────────────────────────────────────────────────────

export function TrialDataCard({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  function toggleReleased() {
    if (!data.trialReleased) {
      update(id, { trialReleased: true, trialReleasedDate: todayISO() })
    } else {
      update(id, { trialReleased: false, trialReleasedDate: '' })
    }
  }

  const isComplete = data.trialUploadDate !== '' && data.trialReleased

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Trial Data" office={office} isComplete={isComplete} />
      <DateRow  label="Trial Data Upload" value={data.trialUploadDate}  onChange={v => update(id, { trialUploadDate: v })} />
      <RowDivider />
      <CheckRow label="Trial Released"    checked={data.trialReleased}  date={data.trialReleasedDate} onChange={toggleReleased} />
    </div>
  )
}

// ── 2. Audit Card ─────────────────────────────────────────────────────────────

export function AuditCard({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  function toggleFinding() {
    if (!data.findingReceived) {
      update(id, { findingReceived: true, findingDate: todayISO() })
    } else {
      update(id, { findingReceived: false, findingDate: '' })
    }
  }

  const isComplete = data.auditDue !== '' && data.findingReceived && data.issuesResolved !== null

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Audit" office={office} isComplete={isComplete} />
      <DateRow     label="Audit Due"                value={data.auditDue}       onChange={v => update(id, { auditDue: v })} />
      <RowDivider />
      <CheckRow    label="Audit Finding Received"   checked={data.findingReceived} date={data.findingDate} onChange={toggleFinding} />
      <RowDivider />
      <ResolvedRow label="Audit Issues Resolved"    value={data.issuesResolved} onChange={v => update(id, { issuesResolved: v })} />
    </div>
  )
}

// ── 3. Finals Card ────────────────────────────────────────────────────────────

export function FinalsCard({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  function toggleFinalMapping() {
    if (!data.finalMappingRec) {
      update(id, { finalMappingRec: true, finalMappingDate: todayISO() })
    } else {
      update(id, { finalMappingRec: false, finalMappingDate: '' })
    }
  }

  function togglePreFinalApproved() {
    if (!data.preFinalApproved) {
      update(id, { preFinalApproved: true, preFinalApprDate: todayISO() })
    } else {
      update(id, { preFinalApproved: false, preFinalApprDate: '' })
    }
  }

  const isComplete =
    data.finalMappingRec &&
    data.finalExtract   !== '' &&
    data.preFinalUpload !== '' &&
    data.preFinalApproved &&
    data.finalUpload    !== ''

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Finals" office={office} isComplete={isComplete} />
      <CheckRow label="Final Mapping Received"  checked={data.finalMappingRec}  date={data.finalMappingDate} onChange={toggleFinalMapping} />
      <RowDivider />
      <DateRow  label="Final Data Extract"      value={data.finalExtract}       onChange={v => update(id, { finalExtract: v })} />
      <RowDivider />
      <DateRow  label="Pre-Final Data Upload"   value={data.preFinalUpload}     onChange={v => update(id, { preFinalUpload: v })} />
      <RowDivider />
      <CheckRow label="Pre-Final Data Approved" checked={data.preFinalApproved} date={data.preFinalApprDate} onChange={togglePreFinalApproved} />
      <RowDivider />
      <DateRow  label="Final Data Upload"       value={data.finalUpload}        onChange={v => update(id, { finalUpload: v })} />
    </div>
  )
}

// ── 4. Scanned Documents Card ─────────────────────────────────────────────────

export function ScannedDocsCard({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  function toggleReceived() {
    if (!data.docReceived) {
      update(id, { docReceived: true, docReceivedDate: todayISO() })
    } else {
      update(id, { docReceived: false, docReceivedDate: '' })
    }
  }

  function toggleComplete() {
    if (!data.convComplete) {
      update(id, { convComplete: true, convCompleteDate: todayISO() })
    } else {
      update(id, { convComplete: false, convCompleteDate: '' })
    }
  }

  const isComplete = data.docReceived && data.convComplete

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Scanned Documents" office={office} isComplete={isComplete} />
      <CheckRow label="Scanned Document Received"             checked={data.docReceived}  date={data.docReceivedDate}  onChange={toggleReceived} />
      <RowDivider />
      <CheckRow label="Scanned Document Conversion Completed" checked={data.convComplete} date={data.convCompleteDate} onChange={toggleComplete} />
    </div>
  )
}
