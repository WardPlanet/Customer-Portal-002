'use client'

import { useEffect, useRef, useState } from 'react'

type ZDComment = { id: number; body: string; html_body: string; public: boolean; created_at: string; author_id: number }
type ZDTicketDetail = { id: number; subject: string; status: string; priority: string | null; created_at: string; updated_at: string; description: string; requester_id: number }
type Props = { ticketId: number | null; onClose: () => void }

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  new:     { label: 'New',     classes: 'bg-purple-100 text-purple-700' },
  open:    { label: 'Open',    classes: 'bg-blue-100 text-blue-700'     },
  pending: { label: 'Pending', classes: 'bg-yellow-100 text-yellow-700' },
  hold:    { label: 'On Hold', classes: 'bg-orange-100 text-orange-700' },
  solved:  { label: 'Solved',  classes: 'bg-green-100 text-green-700'   },
  closed:  { label: 'Closed',  classes: 'bg-gray-100 text-gray-500'     },
}
function getStatusStyle(s: string) { return STATUS_STYLES[s] ?? { label: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), classes: 'bg-gray-100 text-gray-600' } }
function formatDateTime(d: string) { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }

function CommentBubble({ comment, requesterId, authorName }: { comment: ZDComment; requesterId: number; authorName: string }) {
  const isRequester = comment.author_id === requesterId
  return (
    <div className={`flex flex-col gap-1 ${isRequester ? 'items-start' : 'items-end'}`}>
      <span className="text-[11px] font-semibold text-gray-500 px-1">{authorName}</span>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isRequester ? 'bg-gray-100 text-gray-800' : 'bg-blue-600 text-white'}`}>
        <p className="whitespace-pre-wrap">{comment.body}</p>
      </div>
      <span className="text-[10px] text-gray-400 px-1">{formatDateTime(comment.created_at)}</span>
    </div>
  )
}

export function TicketDrawer({ ticketId, onClose }: Props) {
  const [ticket, setTicket]         = useState<ZDTicketDetail | null>(null)
  const [comments, setComments]     = useState<ZDComment[]>([])
  const [userNames, setUserNames]   = useState<Record<number, string>>({})
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [reply, setReply]           = useState('')
  const [teamName, setTeamName]     = useState(() => typeof window !== 'undefined' ? localStorage.getItem('pdds-reply-name') ?? '' : '')
  const [sending, setSending]       = useState(false)
  const [sendError, setSendError]   = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const isOpen = ticketId !== null

  function handleNameChange(val: string) { setTeamName(val); localStorage.setItem('pdds-reply-name', val) }

  useEffect(() => {
    if (ticketId === null) return
    setTicket(null); setComments([]); setUserNames({}); setError(null); setReply(''); setSendError(null); setSendSuccess(false); setLoading(true)
    fetch(`/api/zendesk/tickets/${ticketId}`)
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.error); setTicket(data.ticket); setComments(data.comments ?? []); setUserNames(data.userNames ?? {}) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { if (comments.length > 0) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [comments])
  useEffect(() => { function h(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h) }, [onClose])

  async function handleSend() {
    if (!reply.trim() || !teamName.trim() || !ticketId) return
    setSending(true); setSendError(null); setSendSuccess(false)
    try {
      const res = await fetch(`/api/zendesk/tickets/${ticketId}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: `${teamName.trim()} (PDDS Team):\n\n${reply.trim()}`, isPublic: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to send reply')
      const r = await fetch(`/api/zendesk/tickets/${ticketId}`)
      const d = await r.json()
      setComments(d.comments ?? []); setTicket(d.ticket); setUserNames(d.userNames ?? {})
      setReply(''); setSendSuccess(true); setTimeout(() => setSendSuccess(false), 3000)
    } catch (e) { setSendError(e instanceof Error ? e.message : 'Failed to send') }
    finally { setSending(false) }
  }

  const s = ticket ? getStatusStyle(ticket.status) : null
  const zdSubdomain = process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN ?? 'planetdds'

  return (
    <>
      <div className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed top-0 right-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            {loading ? (
              <div className="space-y-2 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4" /><div className="h-3 bg-gray-200 rounded w-1/3" /></div>
            ) : ticket ? (
              <>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-gray-400">#{ticket.id}</span>
                  {s && <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.classes}`}>{s.label}</span>}
                </div>
                <h2 className="text-sm font-bold text-gray-900 leading-snug">{ticket.subject}</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">Last updated {formatDateTime(ticket.updated_at)}</p>
              </>
            ) : error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {ticket && (
              <a href={`https://${zdSubdomain}.zendesk.com/agent/tickets/${ticket.id}`} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-blue-600 hover:underline font-medium">Open in ZenDesk ↗</a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {loading ? (
            <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className={`flex flex-col gap-1 ${i % 2 === 0 ? 'items-start' : 'items-end'}`}><div className={`h-16 bg-gray-100 rounded-2xl ${i % 2 === 0 ? 'w-3/4' : 'w-2/3'}`} /><div className="h-3 bg-gray-100 rounded w-24" /></div>)}</div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center"><p className="text-sm text-red-500 text-center">{error}</p></div>
          ) : comments.length === 0 ? (
            <div className="flex-1 flex items-center justify-center"><p className="text-sm text-gray-400">No comments yet.</p></div>
          ) : (
            <>{comments.map(c => <CommentBubble key={c.id} comment={c} requesterId={ticket?.requester_id ?? 0} authorName={userNames[c.author_id] ?? 'Unknown'} />)}<div ref={bottomRef} /></>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-4 flex-shrink-0">
          <input type="text" value={teamName} onChange={e => handleNameChange(e.target.value)} placeholder="Your name (e.g. Sarah — PDDS Team)"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 mb-3" />
          <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" rows={4}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend() }} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-gray-400">
              {sendSuccess ? <span className="text-green-600 font-medium">✓ Reply sent!</span> : sendError ? <span className="text-red-500">{sendError}</span> : 'Ctrl+Enter to send'}
            </span>
            <button onClick={handleSend} disabled={!reply.trim() || !teamName.trim() || sending}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-200 disabled:cursor-not-allowed">
              {sending ? 'Sending…' : 'Send Reply'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
