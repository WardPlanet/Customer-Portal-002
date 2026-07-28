'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { getClientPDDSTasks } from '@/lib/mockData'
import type { Task, Comment } from '@/lib/types'
import type { UpdateFn } from '@/components/TaskSection'

export const DENTICON_ID = 'onboarding-template-001'
export const CLOUD9_ID   = 'onboarding-template-c9-001'

const ALL_IDS  = [DENTICON_ID, CLOUD9_ID] as const
const WAVES    = [1, 2, 3] as const
type WaveNum   = 1 | 2 | 3

// All 6 wave-keyed task lists are initialised upfront.
// Key format: "${clientId}-wave-${wave}"
function waveKey(clientId: string, wave: WaveNum) {
  return `${clientId}-wave-${wave}`
}

type AllTasks = Record<string, Task[]>

type ClientTasksContextValue = {
  tasks:               Task[]
  allTasks:            AllTasks
  currentWave:         WaveNum
  setWave:             (w: WaveNum) => void
  toggleTask:          (id: string) => void
  updateTask:          UpdateFn
  addTask:             (phase: string, title: string, assigneeName: string, dueDate: string) => void
  addTaskToAllWaves:   (phase: string, title: string, assigneeName: string, dueDate: string) => void
  addSubtask:          (parentId: string, title: string, assigneeName: string, dueDate: string) => void
  addComment:          (taskId: string, text: string, author: string) => void
  shiftTaskDates:      (deltaDays: number) => void
  removeTask:          (id: string) => void
  removeSubtask:       (parentId: string, subtaskId: string) => void
  completeAllTasks:    () => void
}

const ClientTasksContext = createContext<ClientTasksContextValue | null>(null)

export function ClientTasksProvider({
  clientId,
  children,
}: {
  clientId: string
  children: React.ReactNode
}) {
  const TASKS_KEY = `pdds-tasks-${clientId}`

  const [currentWave, setCurrentWave] = useState<WaveNum>(1)

  // Initialise all 6 wave-keyed lists — seed from localStorage if available
  const [allTasks, setAllTasks] = useState<AllTasks>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`pdds-tasks-${clientId}`)
        if (saved) return JSON.parse(saved) as AllTasks
      } catch { /* ignore */ }
    }
    const map: AllTasks = {}
    ALL_IDS.forEach(id =>
      WAVES.forEach(w => {
        map[waveKey(id, w)] = getClientPDDSTasks(id)
      })
    )
    return map
  })

  // Persist allTasks to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem(TASKS_KEY, JSON.stringify(allTasks)) } catch { /* quota */ }
  }, [allTasks, TASKS_KEY])

  const activeKey = waveKey(clientId, currentWave)
  const tasks: Task[] = allTasks[activeKey] ?? []

  function setWave(w: WaveNum) {
    setCurrentWave(w)
  }

  function mutateCurrent(fn: (prev: Task[]) => Task[]) {
    setAllTasks(prev => ({ ...prev, [activeKey]: fn(prev[activeKey] ?? []) }))
  }

  function toggleTask(id: string) {
    mutateCurrent(prev =>
      prev.map(task => {
        if (task.id === id)
          return { ...task, status: task.status === 'complete' ? 'not_started' : 'complete' }
        if (task.subtasks)
          return {
            ...task,
            subtasks: task.subtasks.map(sub =>
              sub.id === id
                ? { ...sub, status: sub.status === 'complete' ? 'not_started' : 'complete' }
                : sub
            ),
          }
        return task
      })
    )
  }

  const updateTask: UpdateFn = (id, field, value) => {
    const stored = (field === 'assignee_team' || field === 'assignee_name') && value === ''
      ? null
      : value
    mutateCurrent(prev =>
      prev.map(task => {
        if (task.id === id) return { ...task, [field]: stored }
        if (task.subtasks)
          return {
            ...task,
            subtasks: task.subtasks.map(sub =>
              sub.id === id ? { ...sub, [field]: stored } : sub
            ),
          }
        return task
      })
    )
  }

  function addTask(phase: string, title: string, assigneeName: string, dueDate: string) {
    mutateCurrent(prev => {
      const maxSort = prev.filter(t => t.phase === phase).reduce((m, t) => Math.max(m, t.sort_order), 0)
      const newTask: Task = {
        id:               `task-${Date.now()}`,
        template_id:      `task-${Date.now()}`,
        parent_task_id:   null,
        phase,
        title,
        audience:         'both',
        status:           'not_started',
        due_date:         dueDate,
        assignee_user_id: null,
        assignee_name:    assigneeName || null,
        sort_order:       maxSort + 1,
        comments:         [],
      }
      return [...prev, newTask]
    })
  }

  function addTaskToAllWaves(phase: string, title: string, assigneeName: string, dueDate: string) {
    const ts = Date.now()
    setAllTasks(prev => {
      const next = { ...prev }
      WAVES.forEach((w, idx) => {
        const key = waveKey(clientId, w)
        const waveTasks = prev[key] ?? []
        const maxSort = waveTasks.filter(t => t.phase === phase).reduce((m, t) => Math.max(m, t.sort_order), 0)
        const newTask: Task = {
          id:               `task-${ts}-${idx}`,
          template_id:      `task-${ts}-${idx}`,
          parent_task_id:   null,
          phase,
          title,
          audience:         'both',
          status:           'not_started',
          due_date:         dueDate,
          assignee_user_id: null,
          assignee_name:    assigneeName || null,
          sort_order:       maxSort + 1,
          comments:         [],
        }
        next[key] = [...waveTasks, newTask]
      })
      return next
    })
  }

  function addSubtask(parentId: string, title: string, assigneeName: string, dueDate: string) {
    mutateCurrent(prev =>
      prev.map(task => {
        if (task.id !== parentId) return task
        const newSubtask: Task = {
          id:               `sub-${Date.now()}`,
          template_id:      `sub-${Date.now()}`,
          parent_task_id:   parentId,
          phase:            task.phase,
          title,
          audience:         'both',
          status:           'not_started',
          due_date:         dueDate,
          assignee_user_id: null,
          assignee_name:    assigneeName || null,
          sort_order:       (task.subtasks?.length ?? 0) + 1,
          comments:         [],
        }
        return { ...task, subtasks: [...(task.subtasks ?? []), newSubtask] }
      })
    )
  }

  function removeTask(id: string) {
    mutateCurrent(prev => prev.filter(task => task.id !== id))
  }

  function removeSubtask(parentId: string, subtaskId: string) {
    mutateCurrent(prev =>
      prev.map(task =>
        task.id !== parentId ? task : {
          ...task,
          subtasks: (task.subtasks ?? []).filter(sub => sub.id !== subtaskId),
        }
      )
    )
  }

  function addDays(iso: string, days: number): string {
    if (!iso) return ''
    const [y, m, d] = iso.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() + days)
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
  }

  function shiftTaskDates(deltaDays: number) {
    if (deltaDays === 0) return
    mutateCurrent(prev =>
      prev.map(task => ({
        ...task,
        due_date: task.due_date ? addDays(task.due_date, deltaDays) : '',
        subtasks: task.subtasks?.map(sub => ({
          ...sub,
          due_date: sub.due_date ? addDays(sub.due_date, deltaDays) : '',
        })),
      }))
    )
  }

  function completeAllTasks() {
    mutateCurrent(prev =>
      prev.map(task => ({
        ...task,
        status: 'complete' as const,
        subtasks: task.subtasks?.map(sub => ({ ...sub, status: 'complete' as const })),
      }))
    )
  }

  function addComment(taskId: string, text: string, author: string) {
    const newComment: Comment = {
      id:         `comment-${Date.now()}`,
      author,
      text,
      created_at: new Date().toISOString(),
    }
    mutateCurrent(prev =>
      prev.map(task => {
        if (task.id === taskId)
          return { ...task, comments: [...(task.comments ?? []), newComment] }
        if (task.subtasks?.some(sub => sub.id === taskId)) {
          return {
            ...task,
            subtasks: task.subtasks.map(sub =>
              sub.id === taskId
                ? { ...sub, comments: [...(sub.comments ?? []), newComment] }
                : sub
            ),
          }
        }
        return task
      })
    )
  }

  return (
    <ClientTasksContext.Provider
      value={{
        tasks, allTasks, currentWave, setWave,
        toggleTask, updateTask, addTask, addTaskToAllWaves, addSubtask, addComment,
        shiftTaskDates, removeTask, removeSubtask, completeAllTasks,
      }}
    >
      {children}
    </ClientTasksContext.Provider>
  )
}

export function useClientTasks() {
  const ctx = useContext(ClientTasksContext)
  if (!ctx) throw new Error('useClientTasks must be used inside ClientTasksProvider')
  return ctx
}

// Helper for external callers that need to read a specific wave slice
export function waveTaskKey(clientId: string, wave: 1 | 2 | 3) {
  return `${clientId}-wave-${wave}`
}
