'use client'

import type { Task } from '@/lib/types'

type PhaseStatus = 'complete' | 'in_progress' | 'not_started'

function getPhaseStatus(tasks: Task[]): PhaseStatus {
  const all = tasks.flatMap(t => [t, ...(t.subtasks ?? [])])
  const complete = all.filter(t => t.status === 'complete').length
  if (complete === all.length) return 'complete'
  if (complete > 0) return 'in_progress'
  return 'not_started'
}

type JourneyTrackerProps = {
  tasks: Task[]
  colorScheme?: 'blue' | 'orange'
}

export function JourneyTracker({ tasks, colorScheme = 'blue' }: JourneyTrackerProps) {
  const phases = Array.from(new Set(tasks.map(t => t.phase)))

  const dotComplete  = colorScheme === 'blue' ? 'bg-blue-600 border-blue-600'   : 'bg-orange-500 border-orange-500'
  const dotProgress  = colorScheme === 'blue' ? 'border-blue-400 bg-blue-50'    : 'border-orange-400 bg-orange-50'
  const ringColor    = colorScheme === 'blue' ? 'ring-blue-300'                  : 'ring-orange-300'
  const lineComplete = colorScheme === 'blue' ? 'bg-blue-300'                    : 'bg-orange-300'
  const textColor    = colorScheme === 'blue' ? 'text-blue-700'                  : 'text-orange-700'
  const countColor   = colorScheme === 'blue' ? 'text-blue-500'                  : 'text-orange-500'

  return (
    <div className="space-y-0">
      {phases.map((phase, idx) => {
        const phaseTasks = tasks.filter(t => t.phase === phase)
        const status = getPhaseStatus(phaseTasks)
        const all = phaseTasks.flatMap(t => [t, ...(t.subtasks ?? [])])
        const complete = all.filter(t => t.status === 'complete').length
        const isLast = idx === phases.length - 1

        return (
          <div key={phase} className="flex gap-3">
            {/* Dot + line */}
            <div className="flex flex-col items-center">
              <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
                status === 'complete'   ? dotComplete :
                status === 'in_progress' ? `${dotProgress} ring-2 ${ringColor} animate-pulse` :
                'bg-gray-100 border-gray-300'
              }`}>
                {status === 'complete' && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 mt-1 mb-1 min-h-[20px] ${status === 'complete' ? lineComplete : 'bg-gray-200'}`} />
              )}
            </div>

            {/* Content */}
            <div className="pb-4 flex-1 min-w-0">
              <p className={`text-xs font-semibold leading-tight ${
                status === 'complete'    ? textColor :
                status === 'in_progress' ? textColor :
                'text-gray-500'
              }`}>
                {phase}
              </p>
              <p className={`text-[11px] mt-0.5 ${
                status === 'complete'    ? countColor :
                status === 'in_progress' ? countColor :
                'text-gray-400'
              }`}>
                {complete}/{all.length} tasks complete
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
