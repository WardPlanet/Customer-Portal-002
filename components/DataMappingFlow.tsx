'use client'

import { useState } from 'react'
import { useDenticonCards } from '@/lib/denticonCardStore'
import type { Office } from '@/lib/practiceData'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function addWeeksISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + n * 7)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function parseLocal(s: string): Date {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day)
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckNode({
  label,
  checked,
  disabled,
  onChange,
  date,
  isLate,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  date: Date | null
  isLate?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-[110px]">
      {/* Custom checkbox */}
      <button
        onClick={!disabled ? onChange : undefined}
        aria-pressed={checked}
        disabled={disabled}
        className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer
          ${disabled
            ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
            : checked
              ? 'border-blue-600 bg-blue-600 shadow-sm shadow-blue-200'
              : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50'
          }`}
      >
        {checked && (
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Label */}
      <p className={`text-xs font-semibold text-center leading-tight ${
        disabled ? 'text-gray-400' : 'text-blue-700'
      }`}>
        {label}
      </p>

      {/* Checked date */}
      {date ? (
        <p className="text-[10px] text-gray-500 font-medium text-center">{fmtDate(date)}</p>
      ) : (
        <p className="text-[10px] text-gray-300 text-center">—</p>
      )}

      {/* Late badge */}
      {isLate && (
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          Received Late
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

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

export function DataMappingFlow({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  // Local editing state for trial date and due date (UI-only, not in store)
  const [editingTrial, setEditingTrial] = useState(false)
  const [trialDraft,   setTrialDraft]   = useState('')
  const [editingDue,   setEditingDue]   = useState(false)
  const [dueDraft,     setDueDraft]     = useState('')

  function saveTrialDate() {
    if (trialDraft) update(id, { trialExtractDate: trialDraft })
    setEditingTrial(false)
  }

  function handleSent() {
    if (data.mappingSent) {
      update(id, {
        mappingSent:         false,
        mappingSentDate:     '',
        mappingReceived:     false,
        mappingReceivedDate: '',
        mappingDue:          '',
      })
    } else {
      const today = todayISO()
      update(id, {
        mappingSent:     true,
        mappingSentDate: today,
        mappingDue:      addWeeksISO(today, 3),
      })
    }
  }

  function handleReceived() {
    if (data.mappingReceived) {
      update(id, { mappingReceived: false, mappingReceivedDate: '' })
    } else {
      update(id, { mappingReceived: true, mappingReceivedDate: todayISO() })
    }
  }

  function saveDue() {
    if (dueDraft) update(id, { mappingDue: dueDraft })
    setEditingDue(false)
  }

  const isLate =
    data.mappingReceived &&
    data.mappingDue !== '' &&
    data.mappingReceivedDate !== '' &&
    data.mappingReceivedDate > data.mappingDue

  const isComplete = data.trialExtractDate !== '' && data.mappingSent && data.mappingReceived

  // Connector fills blue once sent, turns red if late
  const lineColor = isLate ? 'border-red-300' : data.mappingSent ? 'border-blue-400' : 'border-gray-300'

  return (
    <div className={cardCls(isComplete)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">
            Data Extract and Mapping
          </p>
          {isComplete && <CompleteBadge />}
        </div>
        <OfficeBadge office={office} />
      </div>

      {/* Trial Data Extract date row */}
      <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-4">
        <p className="text-[11px] font-semibold text-blue-700">Trial Data Extract</p>
        {editingTrial ? (
          <input
            type="date"
            autoFocus
            value={trialDraft}
            onChange={e => setTrialDraft(e.target.value)}
            onBlur={saveTrialDate}
            onKeyDown={e => { if (e.key === 'Enter') saveTrialDate(); if (e.key === 'Escape') setEditingTrial(false) }}
            className="text-[10px] border border-blue-300 rounded px-1.5 py-0.5 text-blue-700 outline-none focus:ring-2 focus:ring-blue-200 bg-white"
          />
        ) : (
          <button
            onClick={() => { setTrialDraft(data.trialExtractDate || todayISO()); setEditingTrial(true) }}
            className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
          >
            {data.trialExtractDate
              ? fmtDate(parseLocal(data.trialExtractDate))
              : <span className="text-gray-400 font-normal italic">Set date</span>
            }
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100 mb-4" />

      {/* Horizontal flow */}
      <div className="flex items-start">

        {/* Node: Mapping Sent */}
        <CheckNode
          label="Mapping Sent"
          checked={data.mappingSent}
          onChange={handleSent}
          date={data.mappingSentDate ? parseLocal(data.mappingSentDate) : null}
        />

        {/* Connector + due date */}
        <div className="flex-1 flex flex-col items-center justify-center px-3 mt-3">
          {/* Due date label (floats above the line) */}
          <div className="mb-1.5 min-h-[22px] flex items-center justify-center">
            {data.mappingDue ? (
              editingDue ? (
                <input
                  type="date"
                  autoFocus
                  value={dueDraft}
                  onChange={e => setDueDraft(e.target.value)}
                  onBlur={saveDue}
                  onKeyDown={e => { if (e.key === 'Enter') saveDue(); if (e.key === 'Escape') setEditingDue(false) }}
                  className="text-[10px] w-32 border border-blue-300 rounded px-1.5 py-0.5 text-blue-700 outline-none focus:ring-2 focus:ring-blue-200"
                />
              ) : (
                <button
                  onClick={() => { setDueDraft(data.mappingDue); setEditingDue(true) }}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors
                    ${isLate
                      ? 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'
                      : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                    }`}
                >
                  Due {fmtDate(parseLocal(data.mappingDue))}
                </button>
              )
            ) : (
              <span className="text-[10px] text-gray-300 italic">due date set on send</span>
            )}
          </div>

          {/* Dotted connector line */}
          <div className={`w-full border-t-2 border-dashed ${lineColor} transition-colors`} />
        </div>

        {/* Node: Mapping Received */}
        <CheckNode
          label="Mapping Received"
          checked={data.mappingReceived}
          disabled={!data.mappingSent}
          onChange={handleReceived}
          date={data.mappingReceivedDate ? parseLocal(data.mappingReceivedDate) : null}
          isLate={isLate}
        />

      </div>
    </div>
  )
}
