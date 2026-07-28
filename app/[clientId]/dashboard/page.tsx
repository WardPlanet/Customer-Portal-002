'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/Header'
import { ZendeskTickets } from '@/components/ZendeskTickets'
import { JourneyTracker } from '@/components/JourneyTracker'
import { NotificationDrawer } from '@/components/NotificationDrawer'
import { CreditSummary } from '@/components/CreditSummary'
import { getClientById } from '@/lib/mockData'
import { useClientTasks, DENTICON_ID, CLOUD9_ID, waveTaskKey } from '@/lib/clientTasksContext'
import { useGoLiveDates } from '@/lib/goLiveDatesStore'
import { useCreditCalculator } from '@/lib/creditCalculatorStore'
import { formatDate } from '@/lib/utils'

type StatusKey = 'on_track' | 'in_progress' | 'not_started'

const STATUS_BADGE: Record<StatusKey, { label: string; classes: string }> = {
  on_track:    { label: 'On Track',    classes: 'bg-green-100 text-green-700 border-green-200' },
  in_progress: { label: 'In Progress', classes: 'bg-blue-100 text-blue-700 border-blue-200'   },
  not_started: { label: 'Not Started', classes: 'bg-gray-100 text-gray-500 border-gray-200'   },
}

function StatusCard({ label, status }: { label: string; status: StatusKey }) {
  const badge = STATUS_BADGE[status]
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm flex flex-col gap-1.5">
      <p className="text-xs font-medium text-gray-500 leading-tight">{label}</p>
      <span className={`self-start text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.classes}`}>
        {badge.label}
      </span>
    </div>
  )
}

export default function DashboardPage() {
  const params = useParams()
  const clientId = params.clientId as string
  const client = getClientById(clientId)
  const { tasks, allTasks } = useClientTasks()

  const [denticonWave, setDenticonWave] = useState<1|2|3>(1)
  const [cloud9Wave,   setCloud9Wave]   = useState<1|2|3>(1)

  // Go-live card controls
  const [goLiveSoftware, setGoLiveSoftware] = useState<'denticon' | 'cloud9'>('denticon')
  const [goLiveWave,     setGoLiveWave]     = useState<1|2|3>(1)
  const { getWaveTargetDate } = useGoLiveDates()
  const goLiveDate = getWaveTargetDate(goLiveSoftware, goLiveWave)
  const { summary: creditSummary, config: creditConfig } = useCreditCalculator()

  const denticonTasks = allTasks[waveTaskKey(DENTICON_ID, denticonWave)] ?? []
  const cloud9Tasks   = allTasks[waveTaskKey(CLOUD9_ID,   cloud9Wave)]   ?? []

  return (
    <>
      <Header client={client} currentPage="dashboard" showCeoView />
      <main className="max-w-6xl mx-auto px-6 py-10">

        {/* Welcome */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-blue-700 mb-1">Welcome Back, {client.name} Team</h1>
          <p className="text-sm text-gray-500">Here&apos;s your onboarding progress overview.</p>
        </div>

        {/* Go-live date + Credit summary */}
        <div className="mb-6 flex flex-col lg:flex-row items-stretch gap-6">
          <div className={`flex flex-col justify-center gap-4 ${goLiveSoftware === 'denticon' ? 'bg-blue-700' : 'bg-orange-600'} text-white rounded-2xl px-6 py-4 shadow-sm transition-colors flex-shrink-0`}>
            {/* Software toggle */}
            <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 self-start">
              <button
                onClick={() => setGoLiveSoftware('denticon')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${goLiveSoftware === 'denticon' ? 'bg-white text-blue-700' : 'text-white/70 hover:text-white'}`}
              >
                Denticon
              </button>
              <button
                onClick={() => setGoLiveSoftware('cloud9')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${goLiveSoftware === 'cloud9' ? 'bg-white text-orange-600' : 'text-white/70 hover:text-white'}`}
              >
                Cloud 9
              </button>
            </div>
            {/* Date + wave row */}
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-0.5">Target Go-Live Date</p>
                <p className="text-2xl font-bold font-mono tracking-tight">
                  {goLiveDate ? formatDate(goLiveDate) : '—'}
                </p>
              </div>
              <div className="w-px h-10 bg-white/30" />
              <div>
                <p className="text-xs text-white/60 mb-1">Wave</p>
                <div className="relative">
                  <select
                    value={goLiveWave}
                    onChange={e => setGoLiveWave(Number(e.target.value) as 1|2|3)}
                    className="appearance-none bg-white/20 border border-white/30 text-white text-sm font-semibold rounded-lg pl-2 pr-6 py-0.5 outline-none cursor-pointer focus:ring-2 focus:ring-white/30"
                  >
                    <option value={1} className="text-gray-800 bg-white">Wave 1</option>
                    <option value={2} className="text-gray-800 bg-white">Wave 2</option>
                    <option value={3} className="text-gray-800 bg-white">Wave 3</option>
                  </select>
                  <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/70 pointer-events-none"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <Link
            href={`/${client.id}/credit-calculator`}
            className="block w-full lg:flex-1 lg:min-w-0 rounded-2xl hover:shadow-md transition-shadow"
          >
            <CreditSummary summary={creditSummary} totalOffices={creditConfig.totalOffices} />
          </Link>
        </div>

        {/* Status badges */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          <StatusCard label="Overall Project"         status="not_started" />
          <StatusCard label="Denticon Implementation" status="not_started" />
          <StatusCard label="Cloud 9 Implementation"  status="not_started" />
          <StatusCard label="Token Transfer"          status="not_started" />
          <StatusCard label="Data Conversion"         status="not_started" />
        </div>

        {/* Zendesk */}
        <div className="mb-8">
          <ZendeskTickets clientLabel={client.name} />
        </div>

        {/* Journey Trackers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Denticon */}
          <div className="bg-white border-2 border-blue-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-600" />
                <h2 className="text-sm font-bold text-gray-900">Denticon Journey</h2>
              </div>
              <div className="relative">
                <select
                  value={denticonWave}
                  onChange={e => setDenticonWave(Number(e.target.value) as 1|2|3)}
                  className="appearance-none bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold rounded-lg pl-3 pr-7 py-1.5 outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                >
                  <option value={1}>Wave 1</option>
                  <option value={2}>Wave 2</option>
                  <option value={3}>Wave 3</option>
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-blue-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <JourneyTracker tasks={denticonTasks} colorScheme="blue" />
          </div>

          {/* Cloud 9 */}
          <div className="bg-white border-2 border-orange-200 rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <h2 className="text-sm font-bold text-gray-900">Cloud 9 Journey</h2>
              </div>
              <div className="relative">
                <select
                  value={cloud9Wave}
                  onChange={e => setCloud9Wave(Number(e.target.value) as 1|2|3)}
                  className="appearance-none bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold rounded-lg pl-3 pr-7 py-1.5 outline-none focus:ring-2 focus:ring-orange-100 cursor-pointer"
                >
                  <option value={1}>Wave 1</option>
                  <option value={2}>Wave 2</option>
                  <option value={3}>Wave 3</option>
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-orange-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <JourneyTracker tasks={cloud9Tasks} colorScheme="orange" />
          </div>
        </div>

      </main>
      <NotificationDrawer tasks={tasks} tabLabel="All Tasks" />
    </>
  )
}
