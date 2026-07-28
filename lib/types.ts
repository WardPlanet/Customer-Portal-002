export type SoftwareType = 'denticon' | 'cloud9'
export type TaskStatus   = 'not_started' | 'in_progress' | 'complete'
export type Audience     = 'client' | 'internal' | 'both'

export type Comment = {
  id: string
  author: string
  text: string
  created_at: string
}

export type AssigneeTeam = 'pdds' | 'client'

export type Task = {
  id: string
  template_id: string
  parent_task_id: string | null
  phase: string
  title: string
  audience: Audience
  status: TaskStatus
  due_date: string
  assignee_user_id: string | null
  assignee_team?: AssigneeTeam | null
  assignee_name?: string | null
  sort_order: number
  subtasks?: Task[]
  comments?: Comment[]
}

export type Client = {
  id: string
  name: string
  software_type: SoftwareType
  go_live_date: string
  wave: string
}
