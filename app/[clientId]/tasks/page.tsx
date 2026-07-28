'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/Header'
import { TaskSection } from '@/components/TaskSection'
import { NotificationDrawer } from '@/components/NotificationDrawer'
import { DataMappingFlow } from '@/components/DataMappingFlow'
import { ExtractionSetupCard } from '@/components/ExtractionSetupCard'
import { TrialDataCard, AuditCard, FinalsCard, ScannedDocsCard } from '@/components/RoadmapCards'
import {
  C9DataExtractionCard,
  C9MappingsCard,
  C9TrialConvertCard,
  C9AuditCard,
  C9InfoCard,
} from '@/components/Cloud9RoadmapCards'
import { getClientById } from '@/lib/mockData'
import { useClientTasks } from '@/lib/clientTasksContext'
import { useGoLiveHistory } from '@/lib/goLiveHistory'
import { useGoLiveDates } from '@/lib/goLiveDatesStore'
import { OFFICES } from '@/lib/practiceData'
import { C9_PRACTICES } from '@/lib/cloud9PracticeData'
import { usePracticeWaves } from '@/lib/practiceWavesStore'
import { useCustomOffices } from '@/lib/customOfficesStore'
import type { Office } from '@/lib/practiceData'
import type { C9Practice } from '@/lib/cloud9PracticeData'

// ── Date helpers ─────────────────────────────────────────────────────────────

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

/** "2026-08-15" → "Aug 15, 2026" */
function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Editable go-live date badge ───────────────────────────────────────────────

function GoLiveDateBadge({
  dateISO,
  accentBorder,
  accentText,
  onDateChange,
}: {
  dateISO:      string
  accentBorder: string
  accentText:   string
  onDateChange: (newISO: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(dateISO)

  function save() {
    if (draft && draft !== dateISO) onDateChange(draft)
    setEditing(false)
  }

  return (
    <div className={`flex items-center gap-1.5 border ${accentBorder} bg-white/70 rounded-lg px-3 py-1.5`}>
      <svg className={`w-3 h-3 ${accentText} opacity-60`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Go-Live</span>
      {editing ? (
        <input
          type="date" autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          className={`text-xs border ${accentBorder} rounded px-1.5 py-0.5 ${accentText} outline-none`}
        />
      ) : (
        <button
          onClick={() => { setDraft(dateISO); setEditing(true) }}
          title="Click to change go-live date"
          className={`text-xs font-bold ${accentText} hover:underline cursor-pointer flex items-center gap-1`}
        >
          {isoToDisplay(dateISO)}
          <svg className="w-2.5 h-2.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 13.586 9 14l.414-3z" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ── Styled select wrapper ─────────────────────────────────────────────────────

function StyledSelect({
  value,
  onChange,
  children,
  accent,
}: {
  value:    string
  onChange: (v: string) => void
  children: React.ReactNode
  accent:   string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`appearance-none bg-white/80 border rounded-lg pl-3 pr-8 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-white/60 cursor-pointer ${accent}`}
      >
        {children}
      </select>
      <svg
        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none opacity-60"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const params   = useParams()
  const client   = getClientById(params.clientId as string)
  const { tasks, toggleTask, updateTask, addTask, addTaskToAllWaves, addSubtask, addComment, shiftTaskDates, removeTask, removeSubtask, setWave, completeAllTasks } = useClientTasks()
  const { logChange } = useGoLiveHistory()
  const { allDates, setDate } = useGoLiveDates()
  const { getWave } = usePracticeWaves()
  const { customOffices } = useCustomOffices()

  const phases      = Array.from(new Set(tasks.map(t => t.phase)))
  const allFlat     = tasks.flatMap(t => [t, ...(t.subtasks ?? [])])
  const overallPct  = allFlat.length
    ? Math.round(allFlat.filter(t => t.status === 'complete').length / allFlat.length * 100)
    : 0

  // ── Denticon practice selector state ───────────────────────────────────────
  const [selectedWave,     setSelectedWave]     = useState<1 | 2 | 3>(1)
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>(OFFICES[0].id)

  const allDenticonOffices: Office[] = [
    ...OFFICES,
    ...customOffices
      .filter(o => o.type === 'denticon')
      .map(o => ({ id: o.id, name: o.name, oid: o.oid, wave: o.wave, goLiveDate: '' })),
  ]
  const waveOffices   = allDenticonOffices.filter(o => getWave(o.id, o.wave) === selectedWave)
  const selectedOffice: Office =
    waveOffices.find(o => o.id === selectedOfficeId) ?? waveOffices[0] ?? OFFICES[0]

  function handleWaveChange(val: string) {
    const w = Number(val) as 1 | 2 | 3
    setSelectedWave(w)
    const newWaveOffices = allDenticonOffices.filter(o => getWave(o.id, o.wave) === w)
    setSelectedOfficeId(newWaveOffices[0]?.id ?? OFFICES[0].id)
    setWave(w)
  }

  function handleOfficeChange(val: string) {
    setSelectedOfficeId(val)
  }

  // ── Cloud 9 practice selector state ────────────────────────────────────────
  const [selectedC9Wave,       setSelectedC9Wave]       = useState<1 | 2 | 3>(1)
  const [selectedC9PracticeId, setSelectedC9PracticeId] = useState<string>(C9_PRACTICES[0].id)

  const allC9Practices: C9Practice[] = [
    ...C9_PRACTICES,
    ...customOffices
      .filter(o => o.type === 'cloud9')
      .map(o => ({ id: o.id, name: o.name, wave: o.wave, goLiveDate: '', locations: 0, licenses: 0, currentPms: '' })),
  ]
  const c9WavePractices = allC9Practices.filter(p => getWave(p.id, p.wave) === selectedC9Wave)
  const selectedC9Practice: C9Practice =
    c9WavePractices.find(p => p.id === selectedC9PracticeId) ?? c9WavePractices[0] ?? C9_PRACTICES[0]

  function handleC9WaveChange(val: string) {
    const w = Number(val) as 1 | 2 | 3
    setSelectedC9Wave(w)
    const newC9Practices = allC9Practices.filter(p => getWave(p.id, p.wave) === w)
    setSelectedC9PracticeId(newC9Practices[0]?.id ?? C9_PRACTICES[0].id)
    setWave(w)
  }

  function handleC9PracticeChange(val: string) {
    setSelectedC9PracticeId(val)
  }

  function handleGoLiveDateChange(id: string, newISO: string) {
    const oldISO    = allDates[id]
    const deltaDays = Math.round(
      (new Date(newISO).getTime() - new Date(oldISO).getTime()) / 86_400_000
    )
    setDate(id, newISO)
    shiftTaskDates(deltaDays)
    const practice =
      OFFICES.find(o => o.id === id) ??
      C9_PRACTICES.find(p => p.id === id) ??
      customOffices.find(o => o.id === id)
    logChange({
      practiceId: id,
      practiceName: practice?.name ?? id,
      oldDate: oldISO,
      newDate: newISO,
      source: 'tasks',
    })
  }

  // ── Brand accent ────────────────────────────────────────────────────────────
  const isDenticon = client.software_type === 'denticon'
  const accent = isDenticon
    ? { bg: 'bg-blue-100', border: 'border-blue-200', text: 'text-blue-700', bar: 'bg-blue-600', dot: 'bg-blue-600', select: 'border-blue-200 text-blue-700' }
    : { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', select: 'border-orange-200 text-orange-700' }
  const h1 = isDenticon ? 'Denticon Go-Live Tasks' : 'Cloud 9 Go-Live Tasks'

  return (
    <>
      <Header client={client} currentPage="tasks" showCeoView />

      {/* Banner */}
      <div className={`${accent.bg} border-b ${accent.border}`}>
        <div className="max-w-[1200px] mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-2.5 h-2.5 rounded-full ${accent.dot}`} />
            <span className={`text-xs font-bold uppercase tracking-widest ${accent.text}`}>
              {isDenticon ? 'Denticon' : 'Cloud 9'}
            </span>
          </div>
          <h1 className={`text-2xl font-bold ${accent.text} mb-1`}>{h1}</h1>
          <p className="text-sm text-gray-500">
            Tasks that Planet DDS is completing as part of your onboarding process.
          </p>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-6 py-8">

        {/* ── Practice context card ─────────────────────────────────────────── */}
        <div className="mb-8">
          <div className={`border ${accent.border} rounded-xl px-6 py-5 shadow-sm ${accent.bg}`}>

            {/* Selectors row */}
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Wave</span>
                {isDenticon ? (
                  <StyledSelect value={String(selectedWave)} onChange={handleWaveChange} accent={accent.select}>
                    <option value="1">Wave 1</option>
                    <option value="2">Wave 2</option>
                    <option value="3">Wave 3</option>
                  </StyledSelect>
                ) : (
                  <StyledSelect value={String(selectedC9Wave)} onChange={handleC9WaveChange} accent={accent.select}>
                    <option value="1">Wave 1</option>
                    <option value="2">Wave 2</option>
                    <option value="3">Wave 3</option>
                  </StyledSelect>
                )}
              </div>

              <div className={`w-px h-5 ${accent.border} border-l`} />

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Practice</span>
                {isDenticon ? (
                  <StyledSelect value={selectedOffice.id} onChange={handleOfficeChange} accent={accent.select}>
                    {waveOffices.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </StyledSelect>
                ) : (
                  <StyledSelect value={selectedC9Practice.id} onChange={handleC9PracticeChange} accent={accent.select}>
                    {c9WavePractices.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </StyledSelect>
                )}
              </div>
            </div>

            {/* Selected practice details */}
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Practice</p>
                <p className={`text-lg font-bold ${accent.text} leading-tight`}>
                  {isDenticon ? selectedOffice.name : selectedC9Practice.name}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {isDenticon ? (
                  <>
                    {/* OID */}
                    <div className={`flex items-center gap-1.5 border ${accent.border} bg-white/70 rounded-lg px-3 py-1.5`}>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">OID</span>
                      <span className={`text-xs font-bold font-mono ${accent.text}`}>{selectedOffice.oid}</span>
                    </div>
                    {/* Go-Live — editable */}
                    <GoLiveDateBadge
                      dateISO={allDates[selectedOffice.id] ?? displayToISO(selectedOffice.goLiveDate)}
                      accentBorder={accent.border}
                      accentText={accent.text}
                      onDateChange={newISO => handleGoLiveDateChange(selectedOffice.id, newISO)}
                    />
                  </>
                ) : (
                  <>
                    {/* Go-Live — editable */}
                    <GoLiveDateBadge
                      dateISO={allDates[selectedC9Practice.id] ?? displayToISO(selectedC9Practice.goLiveDate)}
                      accentBorder={accent.border}
                      accentText={accent.text}
                      onDateChange={newISO => handleGoLiveDateChange(selectedC9Practice.id, newISO)}
                    />
                    {/* Locations */}
                    <div className={`flex items-center gap-1.5 border ${accent.border} bg-white/70 rounded-lg px-3 py-1.5`}>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Locations</span>
                      <span className={`text-xs font-bold ${accent.text}`}>{selectedC9Practice.locations}</span>
                    </div>
                    {/* Licenses */}
                    <div className={`flex items-center gap-1.5 border ${accent.border} bg-white/70 rounded-lg px-3 py-1.5`}>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Licenses</span>
                      <span className={`text-xs font-bold ${accent.text}`}>{selectedC9Practice.licenses}</span>
                    </div>
                    {/* Current PMS */}
                    <div className={`flex items-center gap-1.5 border ${accent.border} bg-white/70 rounded-lg px-3 py-1.5`}>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Current PMS</span>
                      <span className={`text-xs font-bold ${accent.text}`}>{selectedC9Practice.currentPms}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/60 mb-4" />

            {/* Progress bar */}
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-xs font-semibold ${accent.text}`}>Overall Progress</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (window.confirm('Mark all tasks as complete? This cannot be undone.')) {
                      completeAllTasks()
                    }
                  }}
                  className={`text-[10px] font-semibold border ${accent.border} ${accent.text} px-2 py-0.5 rounded-lg hover:bg-white/60 transition-colors`}
                >
                  Mark All Complete
                </button>
                <span className={`text-xs font-bold ${accent.text}`}>{overallPct}%</span>
              </div>
            </div>
            <div className="h-2 bg-white/70 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${accent.bar}`}
                style={{ width: `${overallPct}%` }}
              />
            </div>

          </div>
        </div>

        {/* ── Two-column layout ──────────────────────────────────────────────── */}
        <div className="flex gap-6 items-start">

          {/* Left: task checklist — same regardless of office selection */}
          <div className="flex-1 min-w-0">
            {phases.map(phase => (
              <TaskSection
                key={phase}
                phase={phase}
                tasks={tasks.filter(t => t.phase === phase)}
                onToggle={toggleTask}
                onUpdate={updateTask}
                onAddTask={addTask}
                onAddTaskToAll={addTaskToAllWaves}
                onAddSubtask={addSubtask}
                onAddComment={addComment}
                onRemoveTask={removeTask}
                onRemoveSubtask={removeSubtask}
              />
            ))}
          </div>

          {/* Right: roadmap cards — keyed by practice so state resets on switch */}
          {isDenticon ? (
            <div key={selectedOffice.id} className="w-[380px] flex-shrink-0 space-y-4">
              <ExtractionSetupCard office={selectedOffice} />
              <DataMappingFlow     office={selectedOffice} />
              <TrialDataCard       office={selectedOffice} />
              <AuditCard           office={selectedOffice} />
              <FinalsCard          office={selectedOffice} />
              <ScannedDocsCard     office={selectedOffice} />
            </div>
          ) : (
            <div key={selectedC9Practice.id} className="w-[380px] flex-shrink-0 space-y-4">
              <C9DataExtractionCard practice={selectedC9Practice} />
              <C9MappingsCard       practice={selectedC9Practice} />
              <C9TrialConvertCard   practice={selectedC9Practice} />
              <C9AuditCard          practice={selectedC9Practice} />
              <C9InfoCard           practice={selectedC9Practice} />
            </div>
          )}

        </div>
      </div>

      <NotificationDrawer tasks={tasks} tabLabel="PDDS Tasks" />
    </>
  )
}
