import type { Task, Client } from './types'

// ── Clients ───────────────────────────────────────────────────────────────────
const DENTICON_CLIENT: Client = {
  id:            'onboarding-template-001',
  name:          'PDDS Onboarding Template',
  software_type: 'denticon',
  go_live_date:  '2026-09-01',   // ← update per client
  wave:          'Wave 1',
}

const CLOUD9_CLIENT: Client = {
  id:            'onboarding-template-c9-001',
  name:          'PDDS Onboarding Template',
  software_type: 'cloud9',
  go_live_date:  '2026-09-01',
  wave:          'Wave 1',
}

const ALL_CLIENTS: Record<string, Client> = {
  'onboarding-template-001':      DENTICON_CLIENT,
  'onboarding-template-c9-001':   CLOUD9_CLIENT,
}

export function getClientById(id: string): Client {
  return ALL_CLIENTS[id] ?? DENTICON_CLIENT
}

// ── Placeholder PDDS task list (Denticon) ─────────────────────────────────────
// Replace these with real task assignments before sharing with the client.
export const MOCK_CLIENT_TASKS: Task[] = [
  {
    id: 'd-1', template_id: 'd-1', parent_task_id: null, sort_order: 1,
    phase: 'Step 1 — Discovery', title: 'Kick-off call scheduled', audience: 'both',
    status: 'not_started', due_date: '2026-07-01', assignee_name: 'PDDS Team',
    assignee_user_id: null,
  },
  {
    id: 'd-2', template_id: 'd-2', parent_task_id: null, sort_order: 2,
    phase: 'Step 1 — Discovery', title: 'Onboarding questionnaire sent', audience: 'client',
    status: 'not_started', due_date: '2026-07-07', assignee_name: null,
    assignee_user_id: null,
    subtasks: [
      { id: 'd-2a', template_id: 'd-2a', parent_task_id: 'd-2', sort_order: 1, phase: 'Step 1 — Discovery', title: 'Practice locations confirmed', audience: 'client', status: 'not_started', due_date: '2026-07-07', assignee_name: null, assignee_user_id: null },
      { id: 'd-2b', template_id: 'd-2b', parent_task_id: 'd-2', sort_order: 2, phase: 'Step 1 — Discovery', title: 'Current PMS version documented', audience: 'client', status: 'not_started', due_date: '2026-07-07', assignee_name: null, assignee_user_id: null },
    ],
  },
  {
    id: 'd-3', template_id: 'd-3', parent_task_id: null, sort_order: 3,
    phase: 'Step 2 — Configuration', title: 'System configuration completed', audience: 'both',
    status: 'not_started', due_date: '2026-07-21', assignee_name: 'PDDS Team',
    assignee_user_id: null,
  },
  {
    id: 'd-4', template_id: 'd-4', parent_task_id: null, sort_order: 4,
    phase: 'Step 2 — Configuration', title: 'User accounts created', audience: 'internal',
    status: 'not_started', due_date: '2026-07-28', assignee_name: null,
    assignee_user_id: null,
  },
  {
    id: 'd-5', template_id: 'd-5', parent_task_id: null, sort_order: 5,
    phase: 'Step 3 — Training', title: 'Staff training session 1 completed', audience: 'both',
    status: 'not_started', due_date: '2026-08-11', assignee_name: null,
    assignee_user_id: null,
  },
  {
    id: 'd-6', template_id: 'd-6', parent_task_id: null, sort_order: 6,
    phase: 'Step 3 — Training', title: 'Staff training session 2 completed', audience: 'both',
    status: 'not_started', due_date: '2026-08-18', assignee_name: null,
    assignee_user_id: null,
  },
  {
    id: 'd-7', template_id: 'd-7', parent_task_id: null, sort_order: 7,
    phase: 'Step 4 — Go-Live', title: 'Go-live readiness sign-off', audience: 'both',
    status: 'not_started', due_date: '2026-08-31', assignee_name: 'PDDS Team',
    assignee_user_id: null,
  },
]

// Cloud 9 task list — mirrors structure, update separately
export const MOCK_CLOUD9_CLIENT_TASKS: Task[] = MOCK_CLIENT_TASKS.map(t => ({
  ...t,
  id: t.id.replace('d-', 'c9-'),
  subtasks: t.subtasks?.map(s => ({ ...s, id: s.id.replace('d-', 'c9-') })),
}))

export function getClientPDDSTasks(clientId: string): Task[] {
  if (clientId.includes('c9')) return MOCK_CLOUD9_CLIENT_TASKS
  return MOCK_CLIENT_TASKS
}
