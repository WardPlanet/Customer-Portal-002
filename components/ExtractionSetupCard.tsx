'use client'

import { useState } from 'react'
import { useDenticonCards } from '@/lib/denticonCardStore'
import type { Office } from '@/lib/practiceData'

// ── Inline editable text field ────────────────────────────────────────────────

function EditableField({
  label,
  value,
  placeholder,
  onChange,
  mono = false,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)

  function save() {
    onChange(draft.trim() || placeholder)
    setEditing(false)
  }

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">{label}</p>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          }}
          className={`w-full text-sm border border-blue-300 rounded-lg px-3 py-1.5 text-blue-700 outline-none focus:ring-2 focus:ring-blue-100 bg-white ${mono ? 'font-mono' : 'font-medium'}`}
        />
      ) : (
        <button
          onClick={() => { setDraft(value); setEditing(true) }}
          className={`w-full text-left text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50 transition-colors group ${
            mono ? 'font-mono text-blue-700' : 'font-medium text-blue-700'
          }`}
        >
          {value || <span className="text-gray-400 font-normal italic">{placeholder}</span>}
          <span className="ml-1.5 text-gray-300 group-hover:text-blue-300 transition-colors text-xs">✎</span>
        </button>
      )}
    </div>
  )
}

// ── SFTP / LMI toggle ─────────────────────────────────────────────────────────

type ExtractionMethod = 'SFTP' | 'LMI' | null

function MethodToggle({
  value,
  onChange,
}: {
  value: ExtractionMethod
  onChange: (v: ExtractionMethod) => void
}) {
  const opts: ExtractionMethod[] = ['SFTP', 'LMI']
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">
        Extraction Method
      </p>
      <div className="flex gap-1.5">
        {opts.map(opt => (
          <button
            key={opt}
            onClick={() => onChange(value === opt ? null : opt)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all cursor-pointer ${
              value === opt
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {opt}
          </button>
        ))}
        {!value && (
          <span className="self-center text-[10px] text-gray-300 italic ml-1">select one</span>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

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

// PDDS Green = #257226
const cardCls = (done: boolean) =>
  `rounded-xl p-5 shadow-sm border transition-colors duration-300 space-y-4 ${
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

export function ExtractionSetupCard({ office }: { office?: Office }) {
  const { getData, update } = useDenticonCards()
  const id   = office?.id ?? ''
  const data = getData(id)

  const isComplete = data.method !== null && data.conversionTicket.trim() !== ''

  return (
    <div className={cardCls(isComplete)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">
            Practice &amp; Extraction Setup
          </p>
          {isComplete && <CompleteBadge />}
        </div>
        <OfficeBadge office={office} />
      </div>

      {/* Row 1: PMS + Extraction Method */}
      <div className="grid grid-cols-2 gap-4">
        <EditableField
          label="Current PMS"
          value={data.pms}
          placeholder="Enter PMS"
          onChange={v => update(id, { pms: v })}
        />
        <MethodToggle
          value={data.method}
          onChange={v => update(id, { method: v })}
        />
      </div>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Row 2: Data Conversion Ticket */}
      <EditableField
        label="Data Conversion Ticket"
        value={data.conversionTicket}
        placeholder="ZD-XXXXXX"
        onChange={v => update(id, { conversionTicket: v })}
        mono
      />
    </div>
  )
}
