'use client'

import { useState } from 'react'
import Link from 'next/link'
import { getOfficesByWave } from '@/lib/practiceData'
import { getC9PracticesByWave } from '@/lib/cloud9PracticeData'

// ── Static mock progress (per office / practice) ───────────────────────────
// In a real app these would come from a persistent data store.

const OFFICE_PCT: Record<string, number> = {
  'w1-01': 60, 'w1-02': 45, 'w1-03': 30, 'w1-04': 20, 'w1-05': 10,
  'w2-01':  0, 'w2-02':  0, 'w2-03':  0, 'w2-04':  0, 'w2-05':  0,
  'w3-01':  0, 'w3-02':  0, 'w3-03':  0, 'w3-04':  0, 'w3-05':  0,
}

const C9_PCT: Record<string, number> = {
  'c9-w1-01': 15,
  'c9-w2-01':  0,
  'c9-w3-01':  0,
}

function avg(nums: number[]) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0
}

function waveStatus(pct: number): 'in_progress' | 'not_started' | 'complete' {
  if (pct === 0)   return 'not_started'
  if (pct === 100) return 'complete'
  return 'in_progress'
}

const STATUS_STYLES = {
  in_progress:  { label: 'In Progress',  cls: 'bg-blue-100 text-blue-700' },
  not_started:  { label: 'Not Started',  cls: 'bg-gray-100 text-gray-500' },
  complete:     { label: 'Complete',     cls: 'bg-[#257226]/10 text-[#257226]' },
}

// ── Circular progress (SVG donut) ─────────────────────────────────────────
function CircularProgress({ pct, size = 88 }: { pct: number; size?: number }) {
  const r   = (size - 12) / 2          // radius (6px stroke on each side)
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  return (
    <svg width={size} height={size} className="-rotate-90">
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={7} />
      {/* Fill */}
      {pct > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="#0069DC" strokeWidth={7}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      )}
    </svg>
  )
}

// ── Thin progress bar ─────────────────────────────────────────────────────
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── Wave summary card (top row) ───────────────────────────────────────────
function WaveSummaryCard({ wave }: { wave: 1 | 2 | 3 }) {
  const offices   = getOfficesByWave(wave)
  const c9        = getC9PracticesByWave(wave)
  const dPct      = avg(offices.map(o => OFFICE_PCT[o.id] ?? 0))
  const c9Pct     = avg(c9.map(p => C9_PCT[p.id] ?? 0))
  const combined  = avg([dPct, c9Pct])
  const status    = waveStatus(combined)
  const { label, cls } = STATUS_STYLES[status]
  const locCount  = offices.length + c9.reduce((s, p) => s + p.locations, 0)

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-3 ${
      status === 'in_progress' ? 'border-blue-200' : 'border-gray-200'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xl font-black text-gray-900">Wave {wave}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${cls}`}>{label}</span>
      </div>

      {/* Donut + pct */}
      <div className="flex items-center justify-center py-1 relative">
        <CircularProgress pct={combined} />
        <span className="absolute text-base font-bold text-gray-800">{combined}%</span>
      </div>

      {/* Sub-bars */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] font-semibold text-gray-500 flex-shrink-0">Denticon</span>
          <MiniBar pct={dPct} color="bg-blue-600" />
          <span className="text-[11px] font-bold text-blue-600 w-8 text-right flex-shrink-0">{dPct}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] font-semibold text-gray-500 flex-shrink-0">Cloud 9</span>
          <MiniBar pct={c9Pct} color="bg-orange-500" />
          <span className="text-[11px] font-bold text-orange-500 w-8 text-right flex-shrink-0">{c9Pct}%</span>
        </div>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-gray-400 text-center">{locCount} locations</p>
    </div>
  )
}

// ── Expanded office / practice rows ──────────────────────────────────────
function OfficeRow({ name, subtitle, pct, color }: {
  name: string; subtitle: string; pct: number; color: string
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-t border-gray-100 first:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate">{name}</p>
        <p className="text-[10px] text-gray-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 w-40 flex-shrink-0">
        <MiniBar pct={pct} color={color} />
        <span className={`text-[10px] font-bold w-7 text-right flex-shrink-0 ${color === 'bg-blue-600' ? 'text-blue-600' : 'text-orange-500'}`}>{pct}%</span>
      </div>
    </div>
  )
}

// ── Wave breakdown card (bottom section) ─────────────────────────────────
function WaveBreakdownCard({
  wave, product, expanded, onToggle,
}: {
  wave: 1 | 2 | 3
  product: 'denticon' | 'cloud9'
  expanded: boolean
  onToggle: () => void
}) {
  const isDenticon = product === 'denticon'
  const offices    = getOfficesByWave(wave)
  const c9         = getC9PracticesByWave(wave)
  const pct        = isDenticon
    ? avg(offices.map(o => OFFICE_PCT[o.id] ?? 0))
    : avg(c9.map(p => C9_PCT[p.id] ?? 0))
  const status      = waveStatus(pct)
  const { label }   = STATUS_STYLES[status]
  const borderCls   = isDenticon ? 'border-blue-200' : 'border-orange-200'
  const textCls     = isDenticon ? 'text-blue-700'   : 'text-orange-600'
  const barColor    = isDenticon ? 'bg-blue-600'      : 'bg-orange-500'
  const bgCls       = isDenticon ? 'bg-blue-50'       : 'bg-orange-50'
  const title       = `Wave ${wave} — ${isDenticon ? 'Denticon' : 'Cloud 9'}`

  return (
    <div className={`rounded-2xl border ${borderCls} overflow-hidden`}>
      {/* Card header */}
      <div className={`${bgCls} px-5 py-4`}>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-sm font-bold ${textCls}`}>{title}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[status].cls}`}>{pct}%</span>
        </div>
        <p className="text-xs text-gray-500 mb-2">{label}</p>
        <div className="h-1.5 bg-white/70 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Expanded rows */}
      {expanded && (
        <div className="px-5 pb-3 bg-white">
          {isDenticon
            ? offices.map(o => (
                <OfficeRow
                  key={o.id}
                  name={o.name}
                  subtitle={`OID ${o.oid} · Go-live ${o.goLiveDate}`}
                  pct={OFFICE_PCT[o.id] ?? 0}
                  color="bg-blue-600"
                />
              ))
            : c9.map(p => (
                <OfficeRow
                  key={p.id}
                  name={p.name}
                  subtitle={`${p.locations} locations · ${p.licenses} licenses · Go-live ${p.goLiveDate}`}
                  pct={C9_PCT[p.id] ?? 0}
                  color="bg-orange-500"
                />
              ))
          }
        </div>
      )}

      {/* Toggle */}
      <button
        onClick={onToggle}
        className={`w-full px-5 py-3 text-left text-xs font-semibold ${textCls} hover:underline transition-colors bg-white border-t ${borderCls}`}
      >
        {expanded ? 'Hide Details ▲' : `View ${isDenticon ? 'Offices' : 'Practices'} ▶`}
      </button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────
const WAVES = [1, 2, 3] as const
type WaveKey = `${1|2|3}-${'denticon'|'cloud9'}`

export default function CeoPage() {
  const [expandedCards, setExpandedCards] = useState<Set<WaveKey>>(new Set())
  const [allExpanded, setAllExpanded]     = useState(false)

  function toggleCard(key: WaveKey) {
    setExpandedCards(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function expandAll() {
    const all = new Set<WaveKey>()
    WAVES.forEach(w => { all.add(`${w}-denticon`); all.add(`${w}-cloud9`) })
    setExpandedCards(all)
    setAllExpanded(true)
  }

  function collapseAll() {
    setExpandedCards(new Set())
    setAllExpanded(false)
  }

  // Summary stats
  const wavesInProgress = WAVES.filter(w => {
    const dPct  = avg(getOfficesByWave(w).map(o => OFFICE_PCT[o.id] ?? 0))
    const c9Pct = avg(getC9PracticesByWave(w).map(p => C9_PCT[p.id] ?? 0))
    return waveStatus(avg([dPct, c9Pct])) === 'in_progress'
  }).length
  const wavesComplete = WAVES.filter(w => {
    const dPct  = avg(getOfficesByWave(w).map(o => OFFICE_PCT[o.id] ?? 0))
    const c9Pct = avg(getC9PracticesByWave(w).map(p => C9_PCT[p.id] ?? 0))
    return waveStatus(avg([dPct, c9Pct])) === 'complete'
  }).length
  const wavesNotStarted = WAVES.length - wavesInProgress - wavesComplete
  const totalPractices  = getOfficesByWave(1).length + getOfficesByWave(2).length + getOfficesByWave(3).length
                        + getC9PracticesByWave(1).length + getC9PracticesByWave(2).length + getC9PracticesByWave(3).length

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top nav ──────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-blue-600 flex-shrink-0">
                <span className="text-[9px] font-black text-white leading-none">P</span>
              </span>
              <span className="text-[13px] font-bold tracking-wide text-blue-700 leading-none">
                Planet <span className="text-blue-600">DDS</span>
              </span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm font-semibold text-gray-800">CEO View</span>
          </div>
          <Link
            href="/onboarding-template-001/dashboard"
            className="text-xs font-semibold text-gray-400 hover:text-blue-600 transition-colors"
          >
            ← Back to Portal
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">

        {/* ── Page title ───────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold text-blue-700 mb-1">Onboarding Overview</h1>
          <p className="text-sm text-gray-500">Overall go-live progress across all waves and products.</p>
        </div>

        {/* ── Wave Progress (top cards) ─────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-900">Wave Progress</h2>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs font-semibold text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />Denticon
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />Cloud 9
              </span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <div className="grid grid-cols-3 gap-5">
              {WAVES.map(w => <WaveSummaryCard key={w} wave={w} />)}
            </div>
          </div>
        </section>

        {/* ── Wave Breakdown (expandable) ───────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">Wave Breakdown</h2>
              {/* Checkbox legend */}
              <div className="flex items-center gap-4 mt-1">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="w-3.5 h-3.5 rounded border-2 border-blue-400 inline-block" />Denticon
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <span className="w-3.5 h-3.5 rounded border-2 border-orange-400 inline-block" />Cloud 9
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={expandAll}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                Expand All
              </button>
              <button onClick={collapseAll}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                Collapse All
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {WAVES.map(w => (
              <div key={w} className="grid grid-cols-2 gap-4">
                <WaveBreakdownCard
                  wave={w} product="denticon"
                  expanded={expandedCards.has(`${w}-denticon`)}
                  onToggle={() => toggleCard(`${w}-denticon`)}
                />
                <WaveBreakdownCard
                  wave={w} product="cloud9"
                  expanded={expandedCards.has(`${w}-cloud9`)}
                  onToggle={() => toggleCard(`${w}-cloud9`)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ── Summary stat tiles ────────────────────────────────────────── */}
        <section>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Practices', value: totalPractices },
              { label: 'Waves In Progress', value: wavesInProgress },
              { label: 'Waves Completed',   value: wavesComplete   },
              { label: 'Waves Not Started', value: wavesNotStarted },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-2xl shadow-sm px-6 py-5 text-center">
                <p className="text-xs text-gray-500 mb-2">{label}</p>
                <p className="text-3xl font-black text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </section>

      </main>
    </div>
  )
}
