'use client'

import { useState, useEffect, useRef } from 'react'
import type { CreditOffice } from '@/lib/creditConfig'
import type { CreditNote } from '@/lib/creditCalculatorStore'

const AUTHOR_NAME = 'IC Rep' // placeholder until auth exists

function formatTimestamp(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

type CreditNotesSidebarProps = {
  office:       CreditOffice
  comments:     CreditNote[]
  onAddComment: (note: CreditNote) => void
  onClose:      () => void
}

export function CreditNotesSidebar({ office, comments, onAddComment, onClose }: CreditNotesSidebarProps) {
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onAddComment({ id: Date.now(), author: AUTHOR_NAME, text: trimmed, timestamp: new Date().toISOString() })
    setText('')
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/25 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-[380px] max-w-[95vw] bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-200">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Notes</div>
            <div className="text-base font-bold text-gray-900">{office.name}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-lg px-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {comments.length === 0 && (
            <p className="text-gray-300 text-sm text-center mt-8">No notes yet. Add the first one below.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="bg-gray-50 rounded-xl px-3.5 py-3">
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="font-semibold text-sm text-gray-900">{c.author}</span>
                <span className="text-[11px] text-gray-300">{formatTimestamp(c.timestamp)}</span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{c.text}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t border-gray-200 px-5 py-4">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a note..."
            rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e) }}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm resize-none"
          />
          <div className="flex justify-between items-center mt-2">
            <span className="text-[11px] text-gray-300">⌘↵ to submit</span>
            <button type="submit" disabled={!text.trim()} className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              Post Note
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}
