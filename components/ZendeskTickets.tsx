'use client'

import { useEffect, useState, useCallback } from 'react'
import { TicketDrawer } from '@/components/TicketDrawer'

type ZDTicket = { id: number; subject: string; status: string; priority: string | null; created_at: string; updated_at: string }

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  new:     { label: 'New',     classes: 'bg-purple-100 text-purple-700' },
  open:    { label: 'Open',    classes: 'bg-blue-100 text-blue-700'     },
  pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-700' },
  hold:    { label: 'On Hold', classes: 'bg-orange-100 text-orange-700' },
  solved:  { label: 'Solved',  classes: 'bg-green-100 text-green-700'   },
  closed:  { label: 'Closed',  classes: 'bg-gray-100 text-gray-500'     },
}

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { label: status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), classes: 'bg-gray-100 text-gray-600' }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000), hours = Math.floor(diff / 3_600_000), mins = Math.floor(diff / 60_000)
  if (days > 0) return `${days}d ago`; if (hours > 0) return `${hours}h ago`; return `${mins}m ago`
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-16" /><div className="h-4 bg-gray-200 rounded flex-1" />
      <div className="h-5 bg-gray-200 rounded w-16" /><div className="h-4 bg-gray-200 rounded w-12" />
    </div>
  )
}

export function ZendeskTickets({ clientLabel }: { clientLabel?: string }) {
  const [tickets, setTickets]           = useState<ZDTicket[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [lastSync, setLastSync]         = useState<Date | null>(null)
  const [collapsed, setCollapsed]       = useState(false)
  const [activeTicketId, setActiveTicketId] = useState<number | null>(null)
  const [filter, setFilter]             = useState<ZDTicket['status'] | 'all'>('all')

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/zendesk/tickets')
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()
      setTickets(data.tickets ?? []); setLastSync(new Date()); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load tickets') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTickets(); const i = setInterval(fetchTickets, 60_000); return () => clearInterval(i) }, [fetchTickets])

  const visible = tickets.filter(t => t.status !== 'closed' && (filter === 'all' || t.status === filter))
  const counts  = tickets.reduce<Record<string, number>>((a, t) => { if (t.status !== 'closed') a[t.status] = (a[t.status] ?? 0) + 1; return a }, {})
  const FILTERS = [
    { key: 'all' as const,     label: `All (${tickets.filter(t => t.status !== 'closed').length})` },
    { key: 'open' as const,    label: `Open (${counts.open ?? 0})`    },
    { key: 'pending' as const, label: `Pending (${counts.pending ?? 0})` },
    { key: 'hold' as const,    label: `On Hold (${counts.hold ?? 0})` },
    { key: 'solved' as const,  label: `Solved (${counts.solved ?? 0})` },
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Support Tickets</h2>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">via ZenDesk{clientLabel ? ` · ${clientLabel}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && !collapsed && <span className="text-[10px] text-gray-400">Updated {timeAgo(lastSync.toISOString())}</span>}
          {collapsed && !loading && <span className="text-[11px] text-gray-400 font-medium">{tickets.filter(t => t.status !== 'closed').length} tickets</span>}
          {!collapsed && (
            <button onClick={fetchTickets} className="text-gray-400 hover:text-blue-600 transition-colors" title="Refresh">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          )}
          <button onClick={() => setCollapsed(c => !c)} className="text-gray-400 hover:text-blue-600 transition-colors">
            <svg className={`w-4 h-4 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex gap-2 px-6 pt-3 pb-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${filter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}`}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      <TicketDrawer ticketId={activeTicketId} onClose={() => setActiveTicketId(null)} />

      {!collapsed && (
        <div className="px-6 pb-4">
          {loading ? (<><SkeletonRow /><SkeletonRow /><SkeletonRow /></>) :
           error   ? (<div className="py-6 text-center"><p className="text-sm text-red-500 font-medium">{error}</p><button onClick={fetchTickets} className="mt-2 text-xs text-blue-600 hover:underline">Try again</button></div>) :
           visible.length === 0 ? (<div className="py-8 text-center"><p className="text-sm text-gray-400">No {filter === 'all' ? '' : filter} tickets found.</p></div>) : (
            <div className="divide-y divide-gray-50">
              {visible.map(ticket => {
                const s = getStatusStyle(ticket.status)
                return (
                  <button key={ticket.id} onClick={() => setActiveTicketId(ticket.id)}
                    className="w-full flex items-center gap-3 py-3 group hover:bg-gray-50 -mx-1 px-1 rounded-lg transition-colors text-left">
                    <span className="text-[11px] font-mono text-gray-400 w-14 flex-shrink-0">#{ticket.id}</span>
                    <span className="flex-1 text-sm text-gray-800 group-hover:text-blue-700 font-medium leading-snug line-clamp-1 transition-colors">{ticket.subject}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${s.classes}`}>{s.label}</span>
                    <span className="text-[11px] text-gray-400 w-12 text-right flex-shrink-0">{timeAgo(ticket.created_at)}</span>
                    <svg className="w-3 h-3 text-gray-300 group-hover:text-blue-500 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
