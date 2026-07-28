// Parse an ISO date string (YYYY-MM-DD) as a local date to avoid UTC-offset shifts.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function isOverdue(dueDate: string, status: string): boolean {
  if (status === 'complete') return false
  return parseLocalDate(dueDate) < new Date()
}

export function isApproaching(dueDate: string, status: string, days = 3): boolean {
  if (status === 'complete') return false
  const diff = (parseLocalDate(dueDate).getTime() - Date.now()) / 86400000
  return diff >= 0 && diff <= days
}

export type DateUrgency = 'overdue' | 'red' | 'dark-orange' | 'orange' | 'yellow' | null

/**
 * Returns an urgency level based on how close a due date is.
 * Returns null for completed tasks or dates more than 7 days away.
 */
export function getDateUrgency(dueDate: string, status: string): DateUrgency {
  if (status === 'complete') return null
  const diff = (parseLocalDate(dueDate).getTime() - Date.now()) / 86400000
  if (diff < 0)  return 'overdue'
  if (diff <= 1) return 'red'
  if (diff <= 2) return 'dark-orange'
  if (diff <= 4) return 'orange'
  if (diff <= 7) return 'yellow'
  return null
}
