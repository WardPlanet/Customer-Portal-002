'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { Header } from '@/components/Header'
import { useDenticonCards } from '@/lib/denticonCardStore'
import type { OfficeCardData, ResolvedStatus } from '@/lib/denticonCardStore'
import { useC9Cards } from '@/lib/cloud9CardStore'
import type { C9CardData } from '@/lib/cloud9CardStore'
import { OFFICES } from '@/lib/practiceData'
import type { Office } from '@/lib/practiceData'
import { C9_PRACTICES } from '@/lib/cloud9PracticeData'
import type { C9Practice } from '@/lib/cloud9PracticeData'
import { getClientById } from '@/lib/mockData'
import { useClientTasks } from '@/lib/clientTasksContext'
import { useGoLiveHistory } from '@/lib/goLiveHistory'
import { GoLiveHistoryDrawer } from '@/components/GoLiveHistoryDrawer'
import { useGoLiveDates } from '@/lib/goLiveDatesStore'
import { usePracticeWaves } from '@/lib/practiceWavesStore'
import { useTrackerNotes } from '@/lib/trackerNotesStore'
import { useCustomOffices } from '@/lib/customOfficesStore'
import { useTrackerActivityLog } from '@/lib/trackerActivityLog'
import { TrackerActivityDrawer } from '@/components/TrackerActivityDrawer'
import { getDateUrgency, type DateUrgency } from '@/lib/utils'

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmtISO(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function todayISO(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

/** "Aug 15, 2026" → "2026-08-15" */
function displayToISO(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtTimestamp(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

// ── Notes modal ───────────────────────────────────────────────────────────────

function TrackerNotesModal({
  title,
  noteKey,
  accentColor,
  onClose,
}: {
  title: string
  noteKey: string
  accentColor: 'blue' | 'orange'
  onClose: () => void
}) {
  const { getNotes, addNote, markRead } = useTrackerNotes()
  const notes = getNotes(noteKey)

  const [author, setAuthor] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pdds-tracker-note-author') ?? ''
    }
    return ''
  })
  const [text, setText] = useState('')

  useEffect(() => {
    markRead(noteKey)
  }, [noteKey, markRead])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleAuthorChange(v: string) {
    setAuthor(v)
    try { localStorage.setItem('pdds-tracker-note-author', v) } catch { }
  }

  function submit() {
    if (!text.trim()) return
    addNote(noteKey, text, author)
    setText('')
  }

  const accent = accentColor === 'blue'
    ? { header: 'bg-blue-700', btn: 'bg-blue-600 hover:bg-blue-700', ring: 'focus:ring-blue-200' }
    : { header: 'bg-orange-600', btn: 'bg-orange-500 hover:bg-orange-600', ring: 'focus:ring-orange-200' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]">
        <div className={`${accent.header} text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between`}>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest opacity-70">Notes</div>
            <div className="text-sm font-bold leading-tight">{title}</div>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 transition-opacity p-1 rounded">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 min-h-0">
          {notes.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-4">No notes yet.</p>
          ) : notes.map(note => (
            <div key={note.id} className="bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold text-gray-700">{note.author}</span>
                <span className="text-[9px] text-gray-400 whitespace-nowrap">{fmtTimestamp(note.timestamp)}</span>
              </div>
              <p className="text-xs text-gray-600 whitespace-pre-wrap">{note.text}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-5 py-4 space-y-2.5">
          <input
            value={author}
            onChange={e => handleAuthorChange(e.target.value)}
            placeholder="Your name"
            className={`w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 ${accent.ring} focus:border-transparent`}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() }
            }}
            placeholder="Add a note… (Cmd+Enter to save)"
            rows={3}
            className={`w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 ${accent.ring} focus:border-transparent resize-none`}
          />
          <button
            onClick={submit}
            disabled={!text.trim()}
            className={`w-full text-xs font-semibold text-white py-2 rounded-lg transition-colors ${accent.btn} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Add Note
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Completion helpers ────────────────────────────────────────────────────────

function extractionComplete(d: OfficeCardData) {
  return d.method !== null && d.conversionTicket.trim() !== ''
}
function mappingComplete(d: OfficeCardData) {
  return d.trialExtractDate !== '' && d.mappingSent && d.mappingReceived
}
function trialComplete(d: OfficeCardData) {
  return d.trialUploadDate !== '' && d.trialReleased
}
function auditComplete(d: OfficeCardData) {
  return d.auditDue !== '' && d.findingReceived && d.issuesResolved !== null
}
function finalsComplete(d: OfficeCardData) {
  return (
    d.finalMappingRec &&
    d.finalExtract   !== '' &&
    d.preFinalUpload !== '' &&
    d.preFinalApproved &&
    d.finalUpload    !== ''
  )
}
function scannedDocsComplete(d: OfficeCardData) {
  return d.docReceived && d.convComplete
}

// ── Tailwind colour tokens ────────────────────────────────────────────────────

const DONE_BG   = 'bg-[#257226]/5'
const DONE_TEXT = 'text-[#257226]'

const DATE_URGENCY_STYLES: Record<NonNullable<DateUrgency>, string> = {
  'overdue':     'bg-red-100 text-red-700 border border-red-200',
  'red':         'bg-red-100 text-red-700 border border-red-200',
  'dark-orange': 'bg-orange-200 text-orange-800 border border-orange-300',
  'orange':      'bg-orange-100 text-orange-700 border border-orange-200',
  'yellow':      'bg-yellow-100 text-yellow-700 border border-yellow-200',
}

// Section header colour map
const SEC_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  setup:  { bg: 'bg-blue-700',   text: 'text-white', border: 'border-blue-700'   },
  map:    { bg: 'bg-violet-700', text: 'text-white', border: 'border-violet-700' },
  trial:  { bg: 'bg-teal-600',   text: 'text-white', border: 'border-teal-600'   },
  audit:  { bg: 'bg-amber-600',  text: 'text-white', border: 'border-amber-600'  },
  finals: { bg: 'bg-green-700',  text: 'text-white', border: 'border-green-700'  },
  docs:   { bg: 'bg-rose-600',   text: 'text-white', border: 'border-rose-600'   },
}

// ── Cell primitives ───────────────────────────────────────────────────────────

/** Editable text cell — click to edit inline */
function TextCell({
  value,
  placeholder,
  onChange,
  mono = false,
  done = false,
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
  mono?: boolean
  done?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function save() {
    onChange(draft.trim())
    setEditing(false)
  }

  const baseCls = `w-full px-1.5 py-0.5 text-xs rounded border outline-none ${mono ? 'font-mono' : ''}`

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`${baseCls} border-blue-300 bg-white text-blue-700 focus:ring-1 focus:ring-blue-200`}
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(value); setEditing(true) }}
      className={`w-full text-left text-xs px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors truncate ${
        done ? DONE_TEXT : ''
      } ${mono ? 'font-mono' : ''}`}
    >
      {value || <span className="text-gray-300 italic">{placeholder}</span>}
    </button>
  )
}

/** Editable date cell */
function DateCell({
  value,
  onChange,
  done = false,
}: {
  value: string
  onChange: (iso: string) => void
  done?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const urgency = value ? getDateUrgency(value, done ? 'complete' : 'not_started') : null

  function save() {
    if (draft) onChange(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
        className="w-full text-[10px] border border-blue-300 rounded px-1 py-0.5 text-blue-700 outline-none focus:ring-1 focus:ring-blue-200 bg-white"
      />
    )
  }

  const textCls = urgency
    ? `rounded px-1 py-0.5 ${DATE_URGENCY_STYLES[urgency]}`
    : done ? DONE_TEXT : 'text-gray-600'

  return (
    <button
      onClick={() => { setDraft(value || todayISO()); setEditing(true) }}
      className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors whitespace-nowrap ${textCls}`}
    >
      {value
        ? <>{fmtISO(value)}{urgency === 'overdue' && ' ⚠'}</>
        : <span className="text-gray-300">—</span>
      }
    </button>
  )
}

/** Bool + date stamp cell: checkbox + date beside it when checked */
function BoolDateCell({
  checked,
  date,
  onToggle,
  done = false,
}: {
  checked: boolean
  date: string
  onToggle: () => void
  done?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onToggle}
        className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all cursor-pointer ${
          checked
            ? 'bg-blue-600 border-blue-600'
            : 'bg-white border-gray-300 hover:border-blue-400'
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      {checked && date && (
        <span className={`text-[10px] whitespace-nowrap ${done ? DONE_TEXT : 'text-gray-500'}`}>
          {fmtISO(date)}
        </span>
      )}
    </div>
  )
}

/** SFTP / LMI toggle pills */
function MethodCell({
  value,
  onChange,
  options = ['SFTP', 'LMI'],
}: {
  value:    string | null
  onChange: (v: string | null) => void
  options?: string[]
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(value === opt ? null : opt)}
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border transition-all cursor-pointer ${
            value === opt
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

/** Completed / N/A pills */
function ResolvedCell({
  value,
  onChange,
}: {
  value: ResolvedStatus
  onChange: (v: ResolvedStatus) => void
}) {
  return (
    <div className="flex gap-1">
      <button
        onClick={() => onChange(value === 'completed' ? null : 'completed')}
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border transition-all cursor-pointer ${
          value === 'completed'
            ? 'bg-green-500 border-green-500 text-white'
            : 'bg-white border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600'
        }`}
      >
        Done
      </button>
      <button
        onClick={() => onChange(value === 'na' ? null : 'na')}
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border transition-all cursor-pointer ${
          value === 'na'
            ? 'bg-gray-400 border-gray-400 text-white'
            : 'bg-white border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600'
        }`}
      >
        N/A
      </button>
    </div>
  )
}

// ── Wave divider row ──────────────────────────────────────────────────────────

function WaveDivider({ wave }: { wave: number }) {
  const [showNotes, setShowNotes] = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const { hasUnread } = useTrackerNotes()
  const noteKey = `denticon-wave-${wave}`
  const unread = hasUnread(noteKey)

  return (
    <>
      <tr>
        {/* Keep first 3 cells sticky so the wave label stays pinned */}
        <td className="sticky left-0 z-10 bg-blue-700 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 w-10">
          W{wave}
        </td>
        <td className="sticky left-10 z-10 bg-blue-700 w-10 py-1.5" />
        <td className="sticky left-20 z-10 bg-blue-700 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 w-32 shadow-[2px_0_6px_-1px_rgba(0,0,0,0.15)]">
          <div className="flex items-center justify-between gap-1">
            <span>Wave {wave}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAdd(true)}
                title="Add office to this wave"
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                onClick={() => setShowNotes(true)}
                title="Wave notes"
                className="relative flex items-center opacity-50 hover:opacity-100 transition-opacity"
              >
                {unread && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-blue-700" />
                )}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          </div>
        </td>
        <td colSpan={30} className="bg-blue-700 py-1.5" />
      </tr>
      {showNotes && createPortal(
        <TrackerNotesModal
          title={`Wave ${wave}`}
          noteKey={noteKey}
          accentColor="blue"
          onClose={() => setShowNotes(false)}
        />,
        document.body
      )}
      {showAdd && createPortal(
        <AddOfficeModal
          wave={wave as 1 | 2 | 3}
          type="denticon"
          onClose={() => setShowAdd(false)}
        />,
        document.body
      )}
    </>
  )
}

// ── Section group header cells ────────────────────────────────────────────────

type SectionKey = 'setup' | 'map' | 'trial' | 'audit' | 'finals' | 'docs'

function SectionTh({
  label,
  colSpan,
  section,
}: {
  label: string
  colSpan: number
  section: SectionKey
}) {
  const c = SEC_COLORS[section]
  return (
    <th
      colSpan={colSpan}
      className={`${c.bg} ${c.text} sticky top-0 z-10 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20`}
    >
      {label}
    </th>
  )
}

// ── Column header ─────────────────────────────────────────────────────────────

function ColTh({ label, section }: { label: string; section: SectionKey }) {
  const c = SEC_COLORS[section]
  return (
    <th className={`${c.bg} ${c.text} sticky top-6 z-10 opacity-80 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[80px]`}>
      {label}
    </th>
  )
}

// ── Data row ──────────────────────────────────────────────────────────────────

function OfficeRow({
  office,
  currentWave,
  onWaveChange,
  goLiveDate,
  onGoLiveDateChange,
}: {
  office: Office
  currentWave: 1 | 2 | 3
  onWaveChange: (w: 1 | 2 | 3) => void
  goLiveDate: string
  onGoLiveDateChange: (newISO: string) => void
}) {
  const { getData, update } = useDenticonCards()
  const d = getData(office.id)
  const [showNotes, setShowNotes] = useState(false)
  const { hasUnread } = useTrackerNotes()
  const noteKey = `office-${office.id}`
  const unread = hasUnread(noteKey)

  const doneSetup  = extractionComplete(d)
  const doneMap    = mappingComplete(d)
  const doneTrial  = trialComplete(d)
  const doneAudit  = auditComplete(d)
  const doneFinals = finalsComplete(d)
  const doneDocs   = scannedDocsComplete(d)

  const cellBase = 'px-2 py-1 border-b border-gray-100 border-r border-gray-100 align-middle'

  const sectionCls = (done: boolean) =>
    `${cellBase} ${done ? DONE_BG : ''}`

  return (
    <>
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Sticky identity columns */}
      <td className="sticky left-0 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-1 py-1 w-10">
        <select
          value={currentWave}
          onChange={e => onWaveChange(Number(e.target.value) as 1 | 2 | 3)}
          title="Reassign wave"
          className="text-[10px] font-bold text-blue-700 bg-transparent border-none outline-none cursor-pointer w-full appearance-none text-center hover:text-blue-500 transition-colors"
        >
          <option value={1}>W1</option>
          <option value={2}>W2</option>
          <option value={3}>W3</option>
        </select>
      </td>
      <td className="sticky left-10 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 text-[10px] font-mono text-gray-600 w-10">
        {office.oid}
      </td>
      <td className="sticky left-20 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 w-32 max-w-[128px]">
        <div className="flex items-center gap-1 min-w-0">
          <span className="truncate text-xs font-semibold text-gray-800 flex-1">{office.name}</span>
          <button
            onClick={() => setShowNotes(true)}
            title="Notes"
            className="relative flex-shrink-0 flex items-center opacity-25 hover:opacity-75 text-blue-600 transition-opacity"
          >
            {unread && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </td>

      {/* Go-Live date */}
      <td className="px-1 py-1 border-b border-gray-100 border-r border-amber-100 bg-amber-50/40 min-w-[90px]">
        <DateCell value={goLiveDate} onChange={onGoLiveDateChange} />
      </td>

      {/* Practice & Extraction Setup (3) */}
      <td className={sectionCls(doneSetup)}>
        <TextCell value={d.pms} placeholder="PMS" onChange={v => update(office.id, { pms: v })} done={doneSetup} />
      </td>
      <td className={sectionCls(doneSetup)}>
        <MethodCell value={d.method} onChange={v => update(office.id, { method: v as 'SFTP' | 'LMI' | null })} />
      </td>
      <td className={sectionCls(doneSetup)}>
        <TextCell value={d.conversionTicket} placeholder="ZD-XXXXXX" onChange={v => update(office.id, { conversionTicket: v })} mono done={doneSetup} />
      </td>

      {/* Data Extract & Mapping (6) */}
      <td className={sectionCls(doneMap)}>
        <DateCell value={d.trialExtractDate} onChange={v => update(office.id, { trialExtractDate: v })} done={doneMap} />
      </td>
      <td className={sectionCls(doneMap)}>
        <BoolDateCell
          checked={d.mappingSent}
          date={d.mappingSentDate}
          onToggle={() => {
            if (d.mappingSent) {
              update(office.id, { mappingSent: false, mappingSentDate: '', mappingReceived: false, mappingReceivedDate: '', mappingDue: '' })
            } else {
              const t = todayISO()
              const due = addWeeksISO(t, 3)
              update(office.id, { mappingSent: true, mappingSentDate: t, mappingDue: due })
            }
          }}
          done={doneMap}
        />
      </td>
      <td className={sectionCls(doneMap)}>
        <DateCell value={d.mappingSentDate} onChange={v => update(office.id, { mappingSentDate: v })} done={doneMap} />
      </td>
      <td className={sectionCls(doneMap)}>
        <DateCell value={d.mappingDue} onChange={v => update(office.id, { mappingDue: v })} done={doneMap} />
      </td>
      <td className={sectionCls(doneMap)}>
        <BoolDateCell
          checked={d.mappingReceived}
          date={d.mappingReceivedDate}
          onToggle={() => {
            if (d.mappingReceived) {
              update(office.id, { mappingReceived: false, mappingReceivedDate: '' })
            } else {
              update(office.id, { mappingReceived: true, mappingReceivedDate: todayISO() })
            }
          }}
          done={doneMap}
        />
      </td>
      <td className={sectionCls(doneMap)}>
        <DateCell value={d.mappingReceivedDate} onChange={v => update(office.id, { mappingReceivedDate: v })} done={doneMap} />
      </td>

      {/* Trial Data (3) */}
      <td className={sectionCls(doneTrial)}>
        <DateCell value={d.trialUploadDate} onChange={v => update(office.id, { trialUploadDate: v })} done={doneTrial} />
      </td>
      <td className={sectionCls(doneTrial)}>
        <BoolDateCell
          checked={d.trialReleased}
          date={d.trialReleasedDate}
          onToggle={() => {
            if (d.trialReleased) {
              update(office.id, { trialReleased: false, trialReleasedDate: '' })
            } else {
              update(office.id, { trialReleased: true, trialReleasedDate: todayISO() })
            }
          }}
          done={doneTrial}
        />
      </td>
      <td className={sectionCls(doneTrial)}>
        <DateCell value={d.trialReleasedDate} onChange={v => update(office.id, { trialReleasedDate: v })} done={doneTrial} />
      </td>

      {/* Audit (4) */}
      <td className={sectionCls(doneAudit)}>
        <DateCell value={d.auditDue} onChange={v => update(office.id, { auditDue: v })} done={doneAudit} />
      </td>
      <td className={sectionCls(doneAudit)}>
        <BoolDateCell
          checked={d.findingReceived}
          date={d.findingDate}
          onToggle={() => {
            if (d.findingReceived) {
              update(office.id, { findingReceived: false, findingDate: '' })
            } else {
              update(office.id, { findingReceived: true, findingDate: todayISO() })
            }
          }}
          done={doneAudit}
        />
      </td>
      <td className={sectionCls(doneAudit)}>
        <DateCell value={d.findingDate} onChange={v => update(office.id, { findingDate: v })} done={doneAudit} />
      </td>
      <td className={sectionCls(doneAudit)}>
        <ResolvedCell value={d.issuesResolved} onChange={v => update(office.id, { issuesResolved: v })} />
      </td>

      {/* Finals (7) */}
      <td className={sectionCls(doneFinals)}>
        <BoolDateCell
          checked={d.finalMappingRec}
          date={d.finalMappingDate}
          onToggle={() => {
            if (d.finalMappingRec) {
              update(office.id, { finalMappingRec: false, finalMappingDate: '' })
            } else {
              update(office.id, { finalMappingRec: true, finalMappingDate: todayISO() })
            }
          }}
          done={doneFinals}
        />
      </td>
      <td className={sectionCls(doneFinals)}>
        <DateCell value={d.finalMappingDate} onChange={v => update(office.id, { finalMappingDate: v })} done={doneFinals} />
      </td>
      <td className={sectionCls(doneFinals)}>
        <DateCell value={d.finalExtract} onChange={v => update(office.id, { finalExtract: v })} done={doneFinals} />
      </td>
      <td className={sectionCls(doneFinals)}>
        <DateCell value={d.preFinalUpload} onChange={v => update(office.id, { preFinalUpload: v })} done={doneFinals} />
      </td>
      <td className={sectionCls(doneFinals)}>
        <BoolDateCell
          checked={d.preFinalApproved}
          date={d.preFinalApprDate}
          onToggle={() => {
            if (d.preFinalApproved) {
              update(office.id, { preFinalApproved: false, preFinalApprDate: '' })
            } else {
              update(office.id, { preFinalApproved: true, preFinalApprDate: todayISO() })
            }
          }}
          done={doneFinals}
        />
      </td>
      <td className={sectionCls(doneFinals)}>
        <DateCell value={d.preFinalApprDate} onChange={v => update(office.id, { preFinalApprDate: v })} done={doneFinals} />
      </td>
      <td className={sectionCls(doneFinals)}>
        <DateCell value={d.finalUpload} onChange={v => update(office.id, { finalUpload: v })} done={doneFinals} />
      </td>

      {/* Scanned Docs (4) */}
      <td className={sectionCls(doneDocs)}>
        <BoolDateCell
          checked={d.docReceived}
          date={d.docReceivedDate}
          onToggle={() => {
            if (d.docReceived) {
              update(office.id, { docReceived: false, docReceivedDate: '' })
            } else {
              update(office.id, { docReceived: true, docReceivedDate: todayISO() })
            }
          }}
          done={doneDocs}
        />
      </td>
      <td className={sectionCls(doneDocs)}>
        <DateCell value={d.docReceivedDate} onChange={v => update(office.id, { docReceivedDate: v })} done={doneDocs} />
      </td>
      <td className={sectionCls(doneDocs)}>
        <BoolDateCell
          checked={d.convComplete}
          date={d.convCompleteDate}
          onToggle={() => {
            if (d.convComplete) {
              update(office.id, { convComplete: false, convCompleteDate: '' })
            } else {
              update(office.id, { convComplete: true, convCompleteDate: todayISO() })
            }
          }}
          done={doneDocs}
        />
      </td>
      <td className={sectionCls(doneDocs)}>
        <DateCell value={d.convCompleteDate} onChange={v => update(office.id, { convCompleteDate: v })} done={doneDocs} />
      </td>
    </tr>
    {showNotes && createPortal(
      <TrackerNotesModal
        title={office.name}
        noteKey={noteKey}
        accentColor="blue"
        onClose={() => setShowNotes(false)}
      />,
      document.body
    )}
    </>
  )
}

// ── Helper used in OfficeRow (must be defined before use) ─────────────────────

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

// ── Cloud 9 section colors ────────────────────────────────────────────────────

const C9_SEC_COLORS = {
  extraction: { bg: 'bg-orange-700', text: 'text-white' },
  mappings:   { bg: 'bg-orange-600', text: 'text-white' },
  trial:      { bg: 'bg-amber-600',  text: 'text-white' },
  audit:      { bg: 'bg-rose-700',   text: 'text-white' },
  info:       { bg: 'bg-slate-600',  text: 'text-white' },
} as const
type C9SecKey = keyof typeof C9_SEC_COLORS

// ── Cloud 9 completion helpers ────────────────────────────────────────────────

function c9ExtractionComplete(d: C9CardData) {
  return d.extractionMethod !== null && d.conversionTicket !== '' && d.trialExtractDate !== '' && d.prelimUrl !== ''
}
function c9MappingsComplete(d: C9CardData) {
  return d.mappingsSent && d.mappingDue !== '' && d.mappingReceived
}
function c9TrialComplete(d: C9CardData) {
  return d.trialConvertDate !== '' && d.dataUploadComplete && d.imagesUploadComplete && d.trialReviewCall !== '' && d.trialReleased
}
function c9AuditComplete(d: C9CardData) {
  return d.auditDue !== '' && d.auditFindings !== '' && d.finalDataExtract !== '' && d.timeOfDataPull !== '' && d.finalDataUpload !== ''
}
function c9InfoComplete(d: C9CardData) {
  return d.cloud9Url !== '' && d.agentInstallDate !== '' && d.installComplete && d.cleanupSessionDate !== '' && d.cleanupComplete
}

// ── Cloud 9 header cell helpers ───────────────────────────────────────────────

function C9SectionTh({ label, colSpan, section }: { label: string; colSpan: number; section: C9SecKey }) {
  const c = C9_SEC_COLORS[section]
  return (
    <th colSpan={colSpan} className={`${c.bg} ${c.text} sticky top-0 z-10 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20`}>
      {label}
    </th>
  )
}

function C9ColTh({ label, section }: { label: string; section: C9SecKey }) {
  const c = C9_SEC_COLORS[section]
  return (
    <th className={`${c.bg} ${c.text} sticky top-6 z-10 opacity-80 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[80px]`}>
      {label}
    </th>
  )
}

// ── Cloud 9 wave divider ──────────────────────────────────────────────────────

function C9WaveDivider({ wave }: { wave: number }) {
  const [showNotes, setShowNotes] = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const { hasUnread } = useTrackerNotes()
  const noteKey = `c9-wave-${wave}`
  const unread = hasUnread(noteKey)

  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 bg-orange-600 text-white text-[10px] font-bold uppercase tracking-widest px-2 py-1.5 w-10">
          W{wave}
        </td>
        <td className="sticky left-10 z-10 bg-orange-600 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 w-[100px] shadow-[2px_0_6px_-1px_rgba(0,0,0,0.15)]">
          <div className="flex items-center justify-between gap-1">
            <span>Wave {wave}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowAdd(true)}
                title="Add practice to this wave"
                className="opacity-50 hover:opacity-100 transition-opacity"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                onClick={() => setShowNotes(true)}
                title="Wave notes"
                className="relative flex items-center opacity-50 hover:opacity-100 transition-opacity"
              >
                {unread && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-orange-600" />
                )}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
          </div>
        </td>
        <td colSpan={26} className="bg-orange-600 py-1.5" />
      </tr>
      {showNotes && createPortal(
        <TrackerNotesModal
          title={`Wave ${wave}`}
          noteKey={noteKey}
          accentColor="orange"
          onClose={() => setShowNotes(false)}
        />,
        document.body
      )}
      {showAdd && createPortal(
        <AddOfficeModal
          wave={wave as 1 | 2 | 3}
          type="cloud9"
          onClose={() => setShowAdd(false)}
        />,
        document.body
      )}
    </>
  )
}

// ── Cloud 9 data row ──────────────────────────────────────────────────────────

function C9PracticeRow({
  practice,
  currentWave,
  onWaveChange,
  goLiveDate,
  onGoLiveDateChange,
}: {
  practice: C9Practice
  currentWave: 1 | 2 | 3
  onWaveChange: (w: 1 | 2 | 3) => void
  goLiveDate: string
  onGoLiveDateChange: (newISO: string) => void
}) {
  const { getData, update } = useC9Cards()
  const d = getData(practice.id)
  const [showNotes, setShowNotes] = useState(false)
  const { hasUnread } = useTrackerNotes()
  const noteKey = `practice-${practice.id}`
  const unread = hasUnread(noteKey)

  const doneExtraction = c9ExtractionComplete(d)
  const doneMappings   = c9MappingsComplete(d)
  const doneTrial      = c9TrialComplete(d)
  const doneAudit      = c9AuditComplete(d)
  const doneInfo       = c9InfoComplete(d)

  const cellBase = 'px-2 py-1 border-b border-gray-100 border-r border-gray-100 align-middle'
  const sec = (done: boolean) => `${cellBase} ${done ? DONE_BG : ''}`

  function todayISO() {
    const d = new Date()
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
  }

  return (
    <>
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Sticky identity */}
      <td className="sticky left-0 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-1 py-1 w-10">
        <select
          value={currentWave}
          onChange={e => onWaveChange(Number(e.target.value) as 1 | 2 | 3)}
          title="Reassign wave"
          className="text-[10px] font-bold text-orange-600 bg-transparent border-none outline-none cursor-pointer w-full appearance-none text-center hover:text-orange-400 transition-colors"
        >
          <option value={1}>W1</option>
          <option value={2}>W2</option>
          <option value={3}>W3</option>
        </select>
      </td>
      <td className="sticky left-10 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 w-[100px] max-w-[100px]">
        <div className="flex items-center gap-1 min-w-0">
          <span className="truncate text-xs font-semibold text-gray-800 flex-1">{practice.name}</span>
          <button
            onClick={() => setShowNotes(true)}
            title="Notes"
            className="relative flex-shrink-0 flex items-center opacity-25 hover:opacity-75 text-orange-600 transition-opacity"
          >
            {unread && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </td>

      {/* Go-Live */}
      <td className="px-1 py-1 border-b border-gray-100 border-r border-amber-100 bg-amber-50/40 min-w-[90px]">
        <DateCell value={goLiveDate} onChange={onGoLiveDateChange} />
      </td>

      {/* Data Extraction (4) */}
      <td className={sec(doneExtraction)}>
        <MethodCell
          value={d.extractionMethod as 'SFTP' | 'LMI' | null}
          onChange={v => update(practice.id, { extractionMethod: v as 'SFTP' | 'Screen Connect' | null })}
          options={['SFTP', 'Screen Connect']}
        />
      </td>
      <td className={sec(doneExtraction)}>
        <TextCell value={d.conversionTicket} placeholder="ZD-XXXXXX" onChange={v => update(practice.id, { conversionTicket: v })} mono done={doneExtraction} />
      </td>
      <td className={sec(doneExtraction)}>
        <DateCell value={d.trialExtractDate} onChange={v => update(practice.id, { trialExtractDate: v })} done={doneExtraction} />
      </td>
      <td className={sec(doneExtraction)}>
        <TextCell value={d.prelimUrl} placeholder="URL" onChange={v => update(practice.id, { prelimUrl: v })} done={doneExtraction} />
      </td>

      {/* Mappings (5) */}
      <td className={sec(doneMappings)}>
        <BoolDateCell checked={d.mappingsSent} date={d.mappingsSentDate}
          onToggle={() => {
            if (!d.mappingsSent) update(practice.id, { mappingsSent: true,  mappingsSentDate: todayISO() })
            else                 update(practice.id, { mappingsSent: false, mappingsSentDate: '' })
          }}
          done={doneMappings} />
      </td>
      <td className={sec(doneMappings)}>
        <DateCell value={d.mappingsSentDate} onChange={v => update(practice.id, { mappingsSentDate: v })} done={doneMappings} />
      </td>
      <td className={sec(doneMappings)}>
        <DateCell value={d.mappingDue} onChange={v => update(practice.id, { mappingDue: v })} done={doneMappings} />
      </td>
      <td className={sec(doneMappings)}>
        <BoolDateCell checked={d.mappingReceived} date={d.mappingRecDate}
          onToggle={() => {
            if (!d.mappingReceived) update(practice.id, { mappingReceived: true,  mappingRecDate: todayISO() })
            else                    update(practice.id, { mappingReceived: false, mappingRecDate: '' })
          }}
          done={doneMappings} />
      </td>
      <td className={sec(doneMappings)}>
        <DateCell value={d.mappingRecDate} onChange={v => update(practice.id, { mappingRecDate: v })} done={doneMappings} />
      </td>

      {/* Trial Convert (5) */}
      <td className={sec(doneTrial)}>
        <DateCell value={d.trialConvertDate} onChange={v => update(practice.id, { trialConvertDate: v })} done={doneTrial} />
      </td>
      <td className={sec(doneTrial)}>
        <BoolDateCell checked={d.dataUploadComplete} date={d.dataUploadDate}
          onToggle={() => {
            if (!d.dataUploadComplete) update(practice.id, { dataUploadComplete: true,  dataUploadDate: todayISO() })
            else                       update(practice.id, { dataUploadComplete: false, dataUploadDate: '' })
          }}
          done={doneTrial} />
      </td>
      <td className={sec(doneTrial)}>
        <BoolDateCell checked={d.imagesUploadComplete} date={d.imagesUploadDate}
          onToggle={() => {
            if (!d.imagesUploadComplete) update(practice.id, { imagesUploadComplete: true,  imagesUploadDate: todayISO() })
            else                         update(practice.id, { imagesUploadComplete: false, imagesUploadDate: '' })
          }}
          done={doneTrial} />
      </td>
      <td className={sec(doneTrial)}>
        <DateCell value={d.trialReviewCall} onChange={v => update(practice.id, { trialReviewCall: v })} done={doneTrial} />
      </td>
      <td className={sec(doneTrial)}>
        <BoolDateCell checked={d.trialReleased} date={d.trialReleasedDate}
          onToggle={() => {
            if (!d.trialReleased) update(practice.id, { trialReleased: true,  trialReleasedDate: todayISO() })
            else                  update(practice.id, { trialReleased: false, trialReleasedDate: '' })
          }}
          done={doneTrial} />
      </td>

      {/* Audit (5) */}
      <td className={sec(doneAudit)}>
        <DateCell value={d.auditDue} onChange={v => update(practice.id, { auditDue: v })} done={doneAudit} />
      </td>
      <td className={sec(doneAudit)}>
        <TextCell value={d.auditFindings} placeholder="Findings" onChange={v => update(practice.id, { auditFindings: v })} done={doneAudit} />
      </td>
      <td className={sec(doneAudit)}>
        <DateCell value={d.finalDataExtract} onChange={v => update(practice.id, { finalDataExtract: v })} done={doneAudit} />
      </td>
      <td className={sec(doneAudit)}>
        <DateCell value={d.timeOfDataPull} onChange={v => update(practice.id, { timeOfDataPull: v })} done={doneAudit} />
      </td>
      <td className={sec(doneAudit)}>
        <DateCell value={d.finalDataUpload} onChange={v => update(practice.id, { finalDataUpload: v })} done={doneAudit} />
      </td>

      {/* Cloud 9 Info (5) */}
      <td className={sec(doneInfo)}>
        <TextCell value={d.cloud9Url} placeholder="https://…" onChange={v => update(practice.id, { cloud9Url: v })} done={doneInfo} />
      </td>
      <td className={sec(doneInfo)}>
        <DateCell value={d.agentInstallDate} onChange={v => update(practice.id, { agentInstallDate: v })} done={doneInfo} />
      </td>
      <td className={sec(doneInfo)}>
        <BoolDateCell checked={d.installComplete} date={d.installDate}
          onToggle={() => {
            if (!d.installComplete) update(practice.id, { installComplete: true,  installDate: todayISO() })
            else                    update(practice.id, { installComplete: false, installDate: '' })
          }}
          done={doneInfo} />
      </td>
      <td className={sec(doneInfo)}>
        <DateCell value={d.cleanupSessionDate} onChange={v => update(practice.id, { cleanupSessionDate: v })} done={doneInfo} />
      </td>
      <td className={sec(doneInfo)}>
        <BoolDateCell checked={d.cleanupComplete} date={d.cleanupDate}
          onToggle={() => {
            if (!d.cleanupComplete) update(practice.id, { cleanupComplete: true,  cleanupDate: todayISO() })
            else                    update(practice.id, { cleanupComplete: false, cleanupDate: '' })
          }}
          done={doneInfo} />
      </td>
    </tr>
    {showNotes && createPortal(
      <TrackerNotesModal
        title={practice.name}
        noteKey={noteKey}
        accentColor="orange"
        onClose={() => setShowNotes(false)}
      />,
      document.body
    )}
    </>
  )
}

// ── Add office / practice modal ───────────────────────────────────────────────

function AddOfficeModal({
  wave,
  type,
  onClose,
}: {
  wave: 1 | 2 | 3
  type: 'denticon' | 'cloud9'
  onClose: () => void
}) {
  const { addOffice } = useCustomOffices()
  const [name, setName] = useState('')
  const [oid,  setOid]  = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit() {
    if (!name.trim()) return
    addOffice(name.trim(), oid.trim(), wave, type)
    onClose()
  }

  const accentBg  = type === 'denticon' ? 'bg-blue-700'               : 'bg-orange-600'
  const accentBtn = type === 'denticon' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'
  const accentRing = type === 'denticon' ? 'focus:ring-blue-200'       : 'focus:ring-orange-200'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className={`${accentBg} text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between`}>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest opacity-70">
              {type === 'denticon' ? 'Denticon' : 'Cloud 9'}
            </div>
            <div className="text-sm font-bold leading-tight">Add to Wave {wave}</div>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 transition-opacity p-1 rounded">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
              Practice Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="Enter practice name"
              className={`w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 ${accentRing} focus:border-transparent`}
            />
          </div>
          {type === 'denticon' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">OID</label>
              <input
                value={oid}
                onChange={e => setOid(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder="e.g. 12345"
                className={`w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 ${accentRing} focus:border-transparent`}
              />
            </div>
          )}
          <button
            onClick={submit}
            disabled={!name.trim()}
            className={`w-full text-sm font-semibold text-white py-2 rounded-lg transition-colors ${accentBtn} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Add Office
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Placeholder table (shared sticky cols, empty content area) ───────────────

function DenticonPlaceholderTable({
  label,
  allDates,
  onGoLiveDateChange,
}: {
  label: string
  allDates: Record<string, string>
  onGoLiveDateChange: (id: string, newISO: string) => void
}) {
  const waves: (1 | 2 | 3)[] = [1, 2, 3]
  const { getWave, setWave: setPracticeWave } = usePracticeWaves()
  return (
    <div className="overflow-auto rounded-xl border border-gray-200 shadow-sm" style={{ maxHeight: 'calc(100vh - 205px)' }}>
      <table className="border-collapse text-xs w-full">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">Wave</th>
            <th className="sticky left-10 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">OID</th>
            <th className="sticky left-20 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-32">Practice</th>
            <th className="sticky top-0 z-10 bg-amber-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20 min-w-[90px]">Go-Live</th>
            <th className="sticky top-0 z-10 bg-gray-700 text-white/40 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center" colSpan={10}>
              {label} — Columns coming soon
            </th>
          </tr>
          <tr>
            <th className="sticky left-0 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
            <th className="sticky left-10 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
            <th className="sticky left-20 top-6 z-30 bg-gray-600 border-r border-white/10 w-32" />
            <th className="sticky top-6 z-10 bg-amber-600 text-white opacity-90 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[90px]">Target Date</th>
            <th colSpan={10} className="sticky top-6 z-10 bg-gray-600 border-r border-white/10" />
          </tr>
        </thead>
        <tbody>
          {waves.map(wave => {
            const waveOffices = OFFICES.filter(o => getWave(o.id, o.wave) === wave)
            return (
              <>
                <WaveDivider key={`ph-d-wave-${wave}`} wave={wave} />
                {waveOffices.length === 0 ? (
                  <tr key={`ph-d-wave-${wave}-empty`}>
                    <td colSpan={15} className="text-center text-[10px] text-gray-300 italic py-2 border-b border-gray-100">
                      No offices assigned to Wave {wave}
                    </td>
                  </tr>
                ) : waveOffices.map(office => (
                  <tr key={office.id} className="hover:bg-gray-50 transition-colors">
                    <td className="sticky left-0 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-1 py-1 w-10">
                      <select
                        value={getWave(office.id, office.wave)}
                        onChange={e => setPracticeWave(office.id, Number(e.target.value) as 1 | 2 | 3)}
                        title="Reassign wave"
                        className="text-[10px] font-bold text-blue-700 bg-transparent border-none outline-none cursor-pointer w-full appearance-none text-center hover:text-blue-500 transition-colors"
                      >
                        <option value={1}>W1</option>
                        <option value={2}>W2</option>
                        <option value={3}>W3</option>
                      </select>
                    </td>
                    <td className="sticky left-10 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 text-[10px] font-mono text-gray-600 w-10">{office.oid}</td>
                    <td className="sticky left-20 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 text-xs font-semibold text-gray-800 w-32 truncate max-w-[128px]">{office.name}</td>
                    <td className="px-1 py-1 border-b border-gray-100 border-r border-amber-100 bg-amber-50/40 min-w-[90px]">
                      <DateCell value={allDates[office.id] ?? ''} onChange={v => onGoLiveDateChange(office.id, v)} />
                    </td>
                    <td colSpan={10} className="border-b border-gray-100 px-3 py-1 text-gray-300 text-[10px] italic">—</td>
                  </tr>
                ))}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function C9PlaceholderTable({
  label,
  allDates,
  onGoLiveDateChange,
}: {
  label: string
  allDates: Record<string, string>
  onGoLiveDateChange: (id: string, newISO: string) => void
}) {
  const waves: (1 | 2 | 3)[] = [1, 2, 3]
  const { getWave, setWave: setPracticeWave } = usePracticeWaves()
  return (
    <div className="overflow-auto rounded-xl border border-orange-200 shadow-sm" style={{ maxHeight: 'calc(100vh - 205px)' }}>
      <table className="border-collapse text-xs w-full">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">Wave</th>
            <th className="sticky left-10 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-[100px]">Practice</th>
            <th className="sticky top-0 z-10 bg-amber-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20 min-w-[90px]">Go-Live</th>
            <th className="sticky top-0 z-10 bg-gray-700 text-white/40 text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center" colSpan={10}>
              {label} — Columns coming soon
            </th>
          </tr>
          <tr>
            <th className="sticky left-0 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
            <th className="sticky left-10 top-6 z-30 bg-gray-600 border-r border-white/10 w-[100px]" />
            <th className="sticky top-6 z-10 bg-amber-600 text-white opacity-90 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[90px]">Target Date</th>
            <th colSpan={10} className="sticky top-6 z-10 bg-gray-600 border-r border-white/10" />
          </tr>
        </thead>
        <tbody>
          {waves.map(wave => {
            const wavePractices = C9_PRACTICES.filter(p => getWave(p.id, p.wave) === wave)
            return (
              <>
                <C9WaveDivider key={`ph-c9-wave-${wave}`} wave={wave} />
                {wavePractices.length === 0 ? (
                  <tr key={`ph-c9-wave-${wave}-empty`}>
                    <td colSpan={13} className="text-center text-[10px] text-gray-300 italic py-2 border-b border-gray-100">
                      No practices assigned to Wave {wave}
                    </td>
                  </tr>
                ) : wavePractices.map(practice => (
                  <tr key={practice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="sticky left-0 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-1 py-1 w-10">
                      <select
                        value={getWave(practice.id, practice.wave)}
                        onChange={e => setPracticeWave(practice.id, Number(e.target.value) as 1 | 2 | 3)}
                        title="Reassign wave"
                        className="text-[10px] font-bold text-orange-600 bg-transparent border-none outline-none cursor-pointer w-full appearance-none text-center hover:text-orange-400 transition-colors"
                      >
                        <option value={1}>W1</option>
                        <option value={2}>W2</option>
                        <option value={3}>W3</option>
                      </select>
                    </td>
                    <td className="sticky left-10 z-10 bg-white border-b border-gray-100 border-r border-gray-200 px-2 py-1 text-xs font-semibold text-gray-800 w-[100px] truncate max-w-[100px]">{practice.name}</td>
                    <td className="px-1 py-1 border-b border-gray-100 border-r border-amber-100 bg-amber-50/40 min-w-[90px]">
                      <DateCell value={allDates[practice.id] ?? ''} onChange={v => onGoLiveDateChange(practice.id, v)} />
                    </td>
                    <td colSpan={10} className="border-b border-gray-100 px-3 py-1 text-gray-300 text-[10px] italic">—</td>
                  </tr>
                ))}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrackerPage() {
  const params = useParams()
  const client = getClientById(params.clientId as string)
  const { shiftTaskDates } = useClientTasks()
  const { history, logChange, clearHistory } = useGoLiveHistory()
  const { allDates, setDate } = useGoLiveDates()
  const { getWave, setWave: setPracticeWave } = usePracticeWaves()
  const { customOffices } = useCustomOffices()
  const { activityLog, clearActivityLog } = useTrackerActivityLog()
  const [historyOpen,     setHistoryOpen]     = useState(false)
  const [activityLogOpen, setActivityLogOpen] = useState(false)
  const [software,        setSoftware]        = useState<'denticon' | 'cloud9'>('denticon')

  type DenticonTab = 'conversion' | 'image' | 'audit' | 'integrations'
  type Cloud9Tab   = 'conversion' | 'urls'  | 'integrations'
  const [denticonTab, setDenticonTab] = useState<DenticonTab>('conversion')
  const [cloud9Tab,   setCloud9Tab]   = useState<Cloud9Tab>('conversion')

  const DENTICON_TABS: { id: DenticonTab; label: string }[] = [
    { id: 'conversion',   label: 'Data Conversion Rollout'   },
    // { id: 'image',        label: 'Image Conversion & Install' },
    // { id: 'audit',        label: 'Audit Findings'            },
    // { id: 'integrations', label: 'Denticon Integrations'     },
  ]
  const CLOUD9_TABS: { id: Cloud9Tab; label: string }[] = [
    { id: 'conversion',   label: 'Cloud 9 Conversion Rollout' },
    // { id: 'urls',         label: 'URLs'                        },
    // { id: 'integrations', label: 'Cloud 9 Integrations'        },
  ]

  function handleGoLiveDateChange(id: string, newISO: string) {
    const oldISO = allDates[id]
    if (!oldISO || !newISO || oldISO === newISO) return
    const delta = Math.round(
      (new Date(newISO).getTime() - new Date(oldISO).getTime()) / 86_400_000
    )
    const practice =
      OFFICES.find(o => o.id === id) ??
      C9_PRACTICES.find(p => p.id === id) ??
      customOffices.find(o => o.id === id)
    setDate(id, newISO)
    shiftTaskDates(delta)
    logChange({
      practiceId:   id,
      practiceName: practice?.name ?? id,
      oldDate:      oldISO,
      newDate:      newISO,
      source:       'tracker',
    })
  }

  // Group by wave
  const waves: (1 | 2 | 3)[] = [1, 2, 3]

  return (
    <>
      <Header client={client} currentPage="tracker" showCeoView />

      {/* Page header */}
      <div className="bg-blue-50 border-b border-blue-200">
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-blue-600" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-700">Denticon</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className={`text-xl font-bold ${software === 'denticon' ? 'text-blue-700' : 'text-orange-600'}`}>
                {software === 'denticon' ? 'Denticon Tracker' : 'Cloud 9 Tracker'}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Live spreadsheet — edits here sync with the right-side cards on the Tasks page and vice versa.
              </p>
            </div>

            {/* Software toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 flex-shrink-0">
              <button
                onClick={() => setSoftware('denticon')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  software === 'denticon'
                    ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Denticon
              </button>
              <button
                onClick={() => setSoftware('cloud9')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  software === 'cloud9'
                    ? 'bg-white text-orange-600 shadow-sm border border-orange-200'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Cloud 9
              </button>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setActivityLogOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Field Log
                {activityLog.length > 0 && (
                  <span className="ml-0.5 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {activityLog.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Go-Live History
                {history.length > 0 && (
                  <span className="ml-0.5 bg-amber-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {history.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Sub-tab row */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {(software === 'denticon' ? DENTICON_TABS : CLOUD9_TABS).map(tab => {
              const isActive = software === 'denticon'
                ? denticonTab === tab.id
                : cloud9Tab   === (tab.id as Cloud9Tab)
              const activeClass = software === 'denticon'
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-orange-600 text-white border-orange-600'
              return (
                <button
                  key={tab.id}
                  onClick={() => software === 'denticon'
                    ? setDenticonTab(tab.id as DenticonTab)
                    : setCloud9Tab(tab.id as Cloud9Tab)
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    isActive
                      ? activeClass
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">

      {/* ── Denticon placeholder tabs ──────────────────────────────────────── */}
      {software === 'denticon' && denticonTab !== 'conversion' && (
        <DenticonPlaceholderTable
          label={DENTICON_TABS.find(t => t.id === denticonTab)?.label ?? ''}
          allDates={allDates}
          onGoLiveDateChange={handleGoLiveDateChange}
        />
      )}

      {/* ── Denticon table ─────────────────────────────────────────────────── */}
      {software === 'denticon' && denticonTab === 'conversion' && (
        <div className="overflow-auto rounded-xl border border-gray-200 shadow-sm" style={{ maxHeight: 'calc(100vh - 205px)' }}>
          <table className="border-collapse text-xs" style={{ minWidth: '1600px' }}>
            <thead>
              {/* Group header row */}
              <tr>
                {/* Sticky identity headers */}
                <th className="sticky left-0 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">
                  Wave
                </th>
                <th className="sticky left-10 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">
                  OID
                </th>
                <th className="sticky left-20 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-32">
                  Practice
                </th>

                {/* Go-Live */}
                <th className="sticky top-0 z-10 bg-amber-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20 min-w-[90px]">
                  Go-Live
                </th>

                {/* Section group headers */}
                <SectionTh label="Practice &amp; Extraction Setup" colSpan={3} section="setup"  />
                <SectionTh label="Data Extract &amp; Mapping"      colSpan={6} section="map"    />
                <SectionTh label="Trial Data"                       colSpan={3} section="trial"  />
                <SectionTh label="Audit"                            colSpan={4} section="audit"  />
                <SectionTh label="Finals"                           colSpan={7} section="finals" />
                <SectionTh label="Scanned Docs"                     colSpan={4} section="docs"   />
              </tr>

              {/* Column header row */}
              <tr>
                {/* Sticky — empty */}
                <th className="sticky left-0 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
                <th className="sticky left-10 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
                <th className="sticky left-20 top-6 z-30 bg-gray-600 border-r border-white/10 w-32" />

                {/* Go-Live sub-header */}
                <th className="sticky top-6 z-10 bg-amber-600 text-white opacity-90 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[90px]">
                  Target Date
                </th>

                {/* Setup cols */}
                <ColTh label="Current PMS"   section="setup"  />
                <ColTh label="Method"         section="setup"  />
                <ColTh label="Conv. Ticket"   section="setup"  />

                {/* Mapping cols */}
                <ColTh label="Trial Extract"  section="map" />
                <ColTh label="Mapping Sent"   section="map" />
                <ColTh label="Sent Date"       section="map" />
                <ColTh label="Mapping Due"    section="map" />
                <ColTh label="Mapping Rec'd"  section="map" />
                <ColTh label="Rec'd Date"      section="map" />

                {/* Trial cols */}
                <ColTh label="Upload Date"    section="trial" />
                <ColTh label="Released"       section="trial" />
                <ColTh label="Released Date"  section="trial" />

                {/* Audit cols */}
                <ColTh label="Audit Due"      section="audit" />
                <ColTh label="Finding Rec'd"  section="audit" />
                <ColTh label="Finding Date"   section="audit" />
                <ColTh label="Issues Resolved" section="audit" />

                {/* Finals cols */}
                <ColTh label="Final Mapping Rec" section="finals" />
                <ColTh label="Final Map. Date"   section="finals" />
                <ColTh label="Final Extract"     section="finals" />
                <ColTh label="Pre-Final Upload"  section="finals" />
                <ColTh label="Pre-Final Appr."   section="finals" />
                <ColTh label="Appr. Date"        section="finals" />
                <ColTh label="Final Upload"      section="finals" />

                {/* Docs cols */}
                <ColTh label="Doc Received"   section="docs" />
                <ColTh label="Doc Rec. Date"  section="docs" />
                <ColTh label="Conv. Complete" section="docs" />
                <ColTh label="Conv. Date"     section="docs" />
              </tr>
            </thead>

            <tbody>
              {waves.map(wave => {
                const staticOffices = OFFICES.filter(o => getWave(o.id, o.wave) === wave)
                const customDenticon = customOffices
                  .filter(o => o.type === 'denticon' && getWave(o.id, o.wave) === wave)
                  .map(o => ({ id: o.id, name: o.name, oid: o.oid, wave: o.wave, goLiveDate: '' } as Office))
                const waveOffices = [...staticOffices, ...customDenticon]
                return (
                  <>
                    <WaveDivider key={`wave-${wave}`} wave={wave} />
                    {waveOffices.length === 0 ? (
                      <tr key={`wave-${wave}-empty`}>
                        <td colSpan={32} className="text-center text-[10px] text-gray-300 italic py-2 border-b border-gray-100">
                          No offices assigned to Wave {wave}
                        </td>
                      </tr>
                    ) : waveOffices.map(office => (
                      <OfficeRow
                        key={office.id}
                        office={office}
                        currentWave={getWave(office.id, office.wave)}
                        onWaveChange={w => setPracticeWave(office.id, w)}
                        goLiveDate={allDates[office.id] ?? ''}
                        onGoLiveDateChange={newISO => handleGoLiveDateChange(office.id, newISO)}
                      />
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Cloud 9 placeholder tabs ───────────────────────────────────────── */}
      {software === 'cloud9' && cloud9Tab !== 'conversion' && (
        <C9PlaceholderTable
          label={CLOUD9_TABS.find(t => t.id === cloud9Tab)?.label ?? ''}
          allDates={allDates}
          onGoLiveDateChange={handleGoLiveDateChange}
        />
      )}

      {/* ── Cloud 9 table ──────────────────────────────────────────────────── */}
      {software === 'cloud9' && cloud9Tab === 'conversion' && (
        <div className="overflow-auto rounded-xl border border-orange-200 shadow-sm" style={{ maxHeight: 'calc(100vh - 205px)' }}>
          <table className="border-collapse text-xs" style={{ minWidth: '1400px' }}>
            <thead>
              {/* Group header row */}
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-10">Wave</th>
                <th className="sticky left-10 top-0 z-30 bg-gray-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 border-r border-white/20 w-[100px]">Practice</th>
                {/* Go-Live */}
                <th className="sticky top-0 z-10 bg-amber-700 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1.5 text-center border-r border-white/20 min-w-[90px]">Go-Live</th>
                <C9SectionTh label="Data Extraction" colSpan={4} section="extraction" />
                <C9SectionTh label="Mappings"         colSpan={5} section="mappings"   />
                <C9SectionTh label="Trial Convert"    colSpan={5} section="trial"      />
                <C9SectionTh label="Audit"            colSpan={5} section="audit"      />
                <C9SectionTh label="Cloud 9 Info"     colSpan={5} section="info"       />
              </tr>
              {/* Column header row */}
              <tr>
                <th className="sticky left-0 top-6 z-30 bg-gray-600 border-r border-white/10 w-10" />
                <th className="sticky left-10 top-6 z-30 bg-gray-600 border-r border-white/10 w-[100px]" />
                <th className="sticky top-6 z-10 bg-amber-600 text-white opacity-90 text-[8px] font-semibold uppercase tracking-wide px-2 py-1 whitespace-nowrap border-r border-white/10 min-w-[90px]">Target Date</th>
                {/* Extraction */}
                <C9ColTh label="Method"       section="extraction" />
                <C9ColTh label="Conv. Ticket" section="extraction" />
                <C9ColTh label="Trial Extract" section="extraction" />
                <C9ColTh label="Prelim URL"   section="extraction" />
                {/* Mappings */}
                <C9ColTh label="Map Sent"     section="mappings" />
                <C9ColTh label="Sent Date"    section="mappings" />
                <C9ColTh label="Map Due"      section="mappings" />
                <C9ColTh label="Map Rec'd"    section="mappings" />
                <C9ColTh label="Rec'd Date"   section="mappings" />
                {/* Trial */}
                <C9ColTh label="Convert Date" section="trial" />
                <C9ColTh label="Data Upload"  section="trial" />
                <C9ColTh label="Img Upload"   section="trial" />
                <C9ColTh label="Review Call"  section="trial" />
                <C9ColTh label="Released"     section="trial" />
                {/* Audit */}
                <C9ColTh label="Audit Due"    section="audit" />
                <C9ColTh label="Findings"     section="audit" />
                <C9ColTh label="Final Extract" section="audit" />
                <C9ColTh label="Data Pull"    section="audit" />
                <C9ColTh label="Final Upload" section="audit" />
                {/* Info */}
                <C9ColTh label="C9 URL"       section="info" />
                <C9ColTh label="Agent Install" section="info" />
                <C9ColTh label="Install ✓"    section="info" />
                <C9ColTh label="Cleanup Date" section="info" />
                <C9ColTh label="Cleanup ✓"    section="info" />
              </tr>
            </thead>
            <tbody>
              {waves.map(wave => {
                const staticPractices = C9_PRACTICES.filter(p => getWave(p.id, p.wave) === wave)
                const customC9 = customOffices
                  .filter(o => o.type === 'cloud9' && getWave(o.id, o.wave) === wave)
                  .map(o => ({ id: o.id, name: o.name, wave: o.wave, goLiveDate: '', locations: 0, licenses: 0, currentPms: '' } as C9Practice))
                const wavePractices = [...staticPractices, ...customC9]
                return (
                  <>
                    <C9WaveDivider key={`c9-wave-${wave}`} wave={wave} />
                    {wavePractices.length === 0 ? (
                      <tr key={`c9-wave-${wave}-empty`}>
                        <td colSpan={28} className="text-center text-[10px] text-gray-300 italic py-2 border-b border-gray-100">
                          No practices assigned to Wave {wave}
                        </td>
                      </tr>
                    ) : wavePractices.map(practice => (
                      <C9PracticeRow
                        key={practice.id}
                        practice={practice}
                        currentWave={getWave(practice.id, practice.wave)}
                        onWaveChange={w => setPracticeWave(practice.id, w)}
                        goLiveDate={allDates[practice.id] ?? ''}
                        onGoLiveDateChange={newISO => handleGoLiveDateChange(practice.id, newISO)}
                      />
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      </div>

      <GoLiveHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        history={history}
        onClear={clearHistory}
      />

      <TrackerActivityDrawer
        open={activityLogOpen}
        onClose={() => setActivityLogOpen(false)}
        log={activityLog}
        onClear={clearActivityLog}
      />
    </>
  )
}
