'use client'

import { useState } from 'react'
import { useC9Cards } from '@/lib/cloud9CardStore'
import type { C9Practice } from '@/lib/cloud9PracticeData'

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function todayISO() { return new Date().toISOString().split('T')[0] }
function parseLocal(s: string) {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

// ── Card shell helpers ────────────────────────────────────────────────────────

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

function PracticeBadge({ practice }: { practice?: { name: string } }) {
  if (!practice) return null
  return (
    <span className="inline-flex items-center gap-1 bg-orange-50 border border-orange-100 text-orange-600 rounded-full px-2 py-0.5">
      <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-2M5 21H3m2 0h2M9 7h1m-1 4h1m4-4h1m-1 4h1" />
      </svg>
      <span className="text-[9px] font-semibold">{practice.name}</span>
    </span>
  )
}

function CardHeader({ title, practice, isComplete }: {
  title: string; practice?: { name: string }; isComplete?: boolean
}) {
  return (
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600">{title}</p>
        {isComplete && <CompleteBadge />}
      </div>
      <PracticeBadge practice={practice} />
    </div>
  )
}

function RowDivider() { return <div className="border-t border-gray-100" /> }

// ── Row primitives ────────────────────────────────────────────────────────────

function DateRow({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  function save() { if (draft) onChange(draft); setEditing(false) }
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight">{label}</span>
      {editing ? (
        <input type="date" autoFocus value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className="text-[10px] border border-orange-300 rounded px-1.5 py-0.5 text-orange-700 outline-none focus:ring-2 focus:ring-orange-100 flex-shrink-0" />
      ) : (
        <button onClick={() => { setDraft(value || todayISO()); setEditing(true) }}
          className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline transition-colors flex-shrink-0 whitespace-nowrap">
          {value ? fmtDate(parseLocal(value)) : <span className="text-gray-400 font-normal italic">Set date</span>}
        </button>
      )}
    </div>
  )
}

function CheckRow({ label, checked, date, onChange }: { label: string; checked: boolean; date: string; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <button onClick={onChange}
          className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all cursor-pointer ${
            checked ? 'bg-orange-500 border-orange-500 shadow-sm shadow-orange-100' : 'bg-white border-gray-300 hover:border-orange-400 hover:bg-orange-50'
          }`}>
          {checked && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span className={`text-xs font-medium leading-tight ${checked ? 'text-orange-700' : 'text-gray-600'}`}>{label}</span>
      </div>
      {checked && date && (
        <span className="text-[11px] font-medium text-gray-500 flex-shrink-0 whitespace-nowrap">{fmtDate(parseLocal(date))}</span>
      )}
    </div>
  )
}

function TextRow({ label, value, placeholder, onChange, mono = false }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void; mono?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  function save() { onChange(draft.trim()); setEditing(false) }
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight flex-shrink-0">{label}</span>
      {editing ? (
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
          className={`text-xs border border-orange-300 rounded-lg px-2.5 py-1 text-orange-700 outline-none focus:ring-2 focus:ring-orange-100 w-40 ${mono ? 'font-mono' : ''}`} />
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true) }}
          className={`text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline transition-colors text-right max-w-[170px] truncate ${mono ? 'font-mono' : ''}`}>
          {value || <span className="text-gray-400 font-normal italic">{placeholder}</span>}
        </button>
      )}
    </div>
  )
}

function TextareaRow({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  function save() { onChange(draft.trim()); setEditing(false) }
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        {!editing && (
          <button onClick={() => { setDraft(value); setEditing(true) }}
            className="text-[9px] font-semibold text-orange-500 hover:text-orange-700 transition-colors">
            {value ? 'Edit ✎' : 'Add ✎'}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea autoFocus rows={3} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey) return; if (e.key === 'Enter') { e.preventDefault(); save() } if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
            className="w-full text-xs border border-orange-300 rounded-lg px-2.5 py-1.5 text-gray-700 outline-none focus:ring-2 focus:ring-orange-100 resize-none" placeholder={placeholder} />
          <div className="flex justify-end gap-2 mt-1">
            <button onClick={() => { setDraft(value); setEditing(false) }} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
            <button onClick={save} className="text-[10px] font-bold text-orange-600 hover:text-orange-800">Save</button>
          </div>
        </div>
      ) : (
        <p className={`text-xs leading-relaxed ${value ? 'text-gray-700' : 'text-gray-400 italic'}`}>{value || placeholder}</p>
      )}
    </div>
  )
}

function ToggleRow({ label, value, options, onChange }: {
  label: string; value: string | null; options: string[]; onChange: (v: string | null) => void
}) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight flex-shrink-0">{label}</span>
      <div className="flex gap-1.5">
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(value === opt ? null : opt)}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer whitespace-nowrap ${
              value === opt ? 'bg-orange-500 border-orange-500 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-orange-300 hover:text-orange-600'
            }`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function DropdownRow({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-3">
      <span className="text-xs font-medium text-gray-600 leading-tight">{label}</span>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="appearance-none bg-gray-50 border border-gray-200 rounded-lg pl-2.5 pr-7 py-1 text-[11px] font-semibold text-orange-700 outline-none focus:ring-2 focus:ring-orange-100 cursor-pointer">
          <option value="" disabled>Select…</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  )
}

// ── Card 1: Data Extraction ───────────────────────────────────────────────────

export function C9DataExtractionCard({ practice }: { practice: C9Practice }) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)

  const isComplete =
    d.extractionMethod !== null &&
    d.conversionTicket.trim() !== '' &&
    d.trialExtractDate !== '' &&
    d.prelimUrl !== ''

  function tog(v: string | null) {
    update(practice.id, { extractionMethod: v as 'SFTP' | 'Screen Connect' | null })
  }

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Data Extraction" practice={practice} isComplete={isComplete} />
      <ToggleRow   label="Extraction Method"            value={d.extractionMethod}  options={['SFTP', 'Screen Connect']} onChange={tog} />
      <RowDivider />
      <TextRow     label="Data/Image Conversion Ticket" value={d.conversionTicket}  placeholder="ZD-XXXXXX" onChange={v => update(practice.id, { conversionTicket: v })} mono />
      <RowDivider />
      <DateRow     label="Trial Data/Images Extract"    value={d.trialExtractDate}  onChange={v => update(practice.id, { trialExtractDate: v })} />
      <RowDivider />
      <DropdownRow label="Prelim URL" value={d.prelimUrl} onChange={v => update(practice.id, { prelimUrl: v })}
        options={[{ value: 'prelim1', label: 'Prelim 1' }, { value: 'prelim2', label: 'Prelim 2' }, { value: 'prelim3', label: 'Prelim 3' }]} />
    </div>
  )
}

// ── Card 2: Mappings ──────────────────────────────────────────────────────────

export function C9MappingsCard({ practice }: { practice: C9Practice }) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)

  const isComplete = d.mappingsSent && d.mappingDue !== '' && d.mappingReceived

  function toggleSent() {
    if (!d.mappingsSent) update(practice.id, { mappingsSent: true,  mappingsSentDate: todayISO() })
    else                 update(practice.id, { mappingsSent: false, mappingsSentDate: '' })
  }
  function toggleReceived() {
    if (!d.mappingReceived) update(practice.id, { mappingReceived: true,  mappingRecDate: todayISO() })
    else                    update(practice.id, { mappingReceived: false, mappingRecDate: '' })
  }

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Mappings" practice={practice} isComplete={isComplete} />
      <CheckRow label="Mappings Sent"    checked={d.mappingsSent}    date={d.mappingsSentDate} onChange={toggleSent} />
      <RowDivider />
      <DateRow  label="Mapping Due"      value={d.mappingDue}        onChange={v => update(practice.id, { mappingDue: v })} />
      <RowDivider />
      <CheckRow label="Mapping Received" checked={d.mappingReceived} date={d.mappingRecDate}   onChange={toggleReceived} />
    </div>
  )
}

// ── Card 3: Trial Convert ─────────────────────────────────────────────────────

export function C9TrialConvertCard({ practice }: { practice: C9Practice }) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)

  const isComplete =
    d.trialConvertDate !== '' &&
    d.dataUploadComplete &&
    d.imagesUploadComplete &&
    d.trialReviewCall !== '' &&
    d.trialReleased

  function toggleDataUpload() {
    if (!d.dataUploadComplete) update(practice.id, { dataUploadComplete: true,  dataUploadDate: todayISO() })
    else                       update(practice.id, { dataUploadComplete: false, dataUploadDate: '' })
  }
  function toggleImagesUpload() {
    if (!d.imagesUploadComplete) update(practice.id, { imagesUploadComplete: true,  imagesUploadDate: todayISO() })
    else                         update(practice.id, { imagesUploadComplete: false, imagesUploadDate: '' })
  }
  function toggleReleased() {
    if (!d.trialReleased) update(practice.id, { trialReleased: true,  trialReleasedDate: todayISO() })
    else                  update(practice.id, { trialReleased: false, trialReleasedDate: '' })
  }

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Trial Convert" practice={practice} isComplete={isComplete} />
      <DateRow  label="Trial Convert Date"           value={d.trialConvertDate}     onChange={v => update(practice.id, { trialConvertDate: v })} />
      <RowDivider />
      <CheckRow label="Trial Data Upload Complete"   checked={d.dataUploadComplete}   date={d.dataUploadDate}   onChange={toggleDataUpload} />
      <RowDivider />
      <CheckRow label="Trial Images Upload Complete" checked={d.imagesUploadComplete} date={d.imagesUploadDate} onChange={toggleImagesUpload} />
      <RowDivider />
      <DateRow  label="Trial Review Call"            value={d.trialReviewCall}      onChange={v => update(practice.id, { trialReviewCall: v })} />
      <RowDivider />
      <CheckRow label="Trial Released"               checked={d.trialReleased}      date={d.trialReleasedDate} onChange={toggleReleased} />
    </div>
  )
}

// ── Card 4: Audit ─────────────────────────────────────────────────────────────

export function C9AuditCard({ practice }: { practice: C9Practice }) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)

  const isComplete =
    d.auditDue !== '' &&
    d.auditFindings.trim() !== '' &&
    d.finalDataExtract !== '' &&
    d.timeOfDataPull !== '' &&
    d.finalDataUpload !== ''

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Audit" practice={practice} isComplete={isComplete} />
      <DateRow     label="Audit Due"          value={d.auditDue}         onChange={v => update(practice.id, { auditDue: v })} />
      <RowDivider />
      <TextareaRow label="Audit Findings"     value={d.auditFindings}    placeholder="Enter findings…" onChange={v => update(practice.id, { auditFindings: v })} />
      <RowDivider />
      <DateRow     label="Final Data Extract" value={d.finalDataExtract} onChange={v => update(practice.id, { finalDataExtract: v })} />
      <RowDivider />
      <DateRow     label="Time of Data Pull"  value={d.timeOfDataPull}   onChange={v => update(practice.id, { timeOfDataPull: v })} />
      <RowDivider />
      <DateRow     label="Final Data Upload"  value={d.finalDataUpload}  onChange={v => update(practice.id, { finalDataUpload: v })} />
    </div>
  )
}

// ── Card 5: Cloud 9 Info ──────────────────────────────────────────────────────

export function C9InfoCard({ practice }: { practice: C9Practice }) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)

  const isComplete =
    d.cloud9Url.trim() !== '' &&
    d.agentInstallDate !== '' &&
    d.installComplete &&
    d.cleanupSessionDate !== '' &&
    d.cleanupComplete

  function toggleInstall() {
    if (!d.installComplete) update(practice.id, { installComplete: true,  installDate: todayISO() })
    else                    update(practice.id, { installComplete: false, installDate: '' })
  }
  function toggleCleanup() {
    if (!d.cleanupComplete) update(practice.id, { cleanupComplete: true,  cleanupDate: todayISO() })
    else                    update(practice.id, { cleanupComplete: false, cleanupDate: '' })
  }

  return (
    <div className={cardCls(isComplete)}>
      <CardHeader title="Cloud 9 Info" practice={practice} isComplete={isComplete} />
      <TextRow  label="Cloud 9 URL"                     value={d.cloud9Url}          placeholder="https://…"  onChange={v => update(practice.id, { cloud9Url: v })} />
      <RowDivider />
      <DateRow  label="Cloud 9 Agent Install Date"      value={d.agentInstallDate}   onChange={v => update(practice.id, { agentInstallDate: v })} />
      <RowDivider />
      <CheckRow label="Cloud 9 Install Complete"        checked={d.installComplete}  date={d.installDate}     onChange={toggleInstall} />
      <RowDivider />
      <DateRow  label="Data Cleanup Session Date"       value={d.cleanupSessionDate} onChange={v => update(practice.id, { cleanupSessionDate: v })} />
      <RowDivider />
      <CheckRow label="Data Cleanup and Merge Complete" checked={d.cleanupComplete}  date={d.cleanupDate}     onChange={toggleCleanup} />
    </div>
  )
}
