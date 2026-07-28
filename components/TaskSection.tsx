'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import confetti from 'canvas-confetti'
import type { Task, Comment, AssigneeTeam } from '@/lib/types'
import { formatDate, isOverdue, getDateUrgency, type DateUrgency } from '@/lib/utils'

export type UpdateFn = (id: string, field: 'title' | 'due_date' | 'assignee_name' | 'assignee_team', value: string) => void

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCommentTime(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CommentIcon({ count, active }: { count: number; active: boolean }) {
  return (
    <span className={`flex items-center gap-0.5 text-xs transition-colors ${active ? 'text-blue-600' : count > 0 ? 'text-gray-400 hover:text-blue-600' : 'text-gray-300 hover:text-gray-500'}`}>
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      {count > 0 && <span className="font-medium">{count}</span>}
    </span>
  )
}

// ── Inline editable fields ────────────────────────────────────────────────────

function EditablePhase({ phase, onRename }: { phase: string; onRename: (o: string, n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(phase)
  function save() {
    const t = draft.trim()
    if (t && t !== phase) onRename(phase, t)
    setEditing(false)
  }
  if (editing) return (
    <input autoFocus className="text-xs font-bold tracking-widest bg-transparent border-b-2 border-blue-400 outline-none text-gray-700 uppercase min-w-0 w-64"
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(phase); setEditing(false) } }} />
  )
  return (
    <h3 title="Click to rename step" onClick={() => setEditing(true)}
      className="text-xs font-bold uppercase tracking-widest text-gray-600 cursor-text hover:text-blue-600 transition-colors">
      {phase} <span className="text-gray-300 font-normal normal-case tracking-normal">✎</span>
    </h3>
  )
}

function EditableTitle({ id, title, complete, onUpdate, isPlaceholder }: { id: string; title: string; complete: boolean; onUpdate?: UpdateFn; isPlaceholder?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  function save() { const t = draft.trim(); if (t) onUpdate?.(id, 'title', t); setEditing(false) }
  if (editing) return (
    <input autoFocus placeholder="Enter task description..."
      className="flex-1 min-w-0 text-sm font-medium border-b-2 border-blue-400 outline-none bg-transparent text-gray-800"
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(title); setEditing(false) } }} />
  )
  return (
    <span title={complete ? undefined : 'Click to edit'} onClick={() => { if (!complete) setEditing(true) }}
      className={`flex-1 min-w-0 text-sm leading-snug truncate ${complete ? 'line-through text-gray-400 cursor-default font-medium' : isPlaceholder ? 'italic text-gray-400 cursor-text hover:text-blue-500' : 'font-medium text-gray-800 cursor-text hover:text-blue-700'}`}>
      {title}
    </span>
  )
}

function AssignmentCell({ id, team, memberName, onUpdate }: {
  id:         string
  team?:      AssigneeTeam | null
  memberName?: string | null
  onUpdate?:  UpdateFn
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState(memberName ?? '')

  function selectTeam(t: AssigneeTeam) {
    // clicking the already-active team deselects it
    onUpdate?.(id, 'assignee_team', team === t ? '' : t)
    if (team === t) onUpdate?.(id, 'assignee_name', '')
  }

  function saveName() {
    onUpdate?.(id, 'assignee_name', nameDraft.trim())
    setEditingName(false)
  }

  const teamStyles: Record<AssigneeTeam, { active: string; inactive: string }> = {
    pdds:   { active: 'bg-blue-600 text-white border-blue-600',      inactive: 'bg-white text-gray-400 border-gray-200 hover:border-blue-300 hover:text-blue-600' },
    client: { active: 'bg-green-600 text-white border-green-600',    inactive: 'bg-white text-gray-400 border-gray-200 hover:border-green-300 hover:text-green-600' },
  }

  return (
    <div className="flex-shrink-0 hidden sm:flex flex-col gap-1 w-32">
      {/* Row 1 — team toggle pills */}
      <div className="flex gap-1">
        {(['pdds', 'client'] as AssigneeTeam[]).map(t => (
          <button
            key={t}
            onClick={() => selectTeam(t)}
            className={`flex-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border transition-colors leading-none ${
              team === t ? teamStyles[t].active : teamStyles[t].inactive
            }`}
          >
            {t === 'pdds' ? 'PDDS' : 'Client'}
          </button>
        ))}
      </div>

      {/* Row 2 — member name (only shown when a team is selected) */}
      {team && (
        editingName ? (
          <input
            autoFocus
            value={nameDraft}
            placeholder="Member name…"
            onChange={e => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') { setNameDraft(memberName ?? ''); setEditingName(false) }
            }}
            className="w-full text-[11px] border-b border-blue-400 outline-none bg-transparent text-gray-700 placeholder-gray-300"
          />
        ) : (
          <button
            onClick={() => { setNameDraft(memberName ?? ''); setEditingName(true) }}
            className={`text-left text-[11px] leading-tight truncate transition-colors ${
              memberName ? 'text-gray-600 hover:text-blue-600' : 'text-gray-300 italic hover:text-blue-400'
            }`}
          >
            {memberName || '+ Member'}
          </button>
        )
      )}
    </div>
  )
}

const DATE_URGENCY_STYLES: Record<NonNullable<DateUrgency>, string> = {
  'overdue':     'bg-red-100 text-red-700 border border-red-200',
  'red':         'bg-red-100 text-red-700 border border-red-200',
  'dark-orange': 'bg-orange-200 text-orange-800 border border-orange-300',
  'orange':      'bg-orange-100 text-orange-700 border border-orange-200',
  'yellow':      'bg-yellow-100 text-yellow-700 border border-yellow-200',
}

function EditableDate({ id, dueDate, status, onUpdate }: { id: string; dueDate: string; status: string; onUpdate?: UpdateFn }) {
  const [editing, setEditing] = useState(false)
  const urgency = getDateUrgency(dueDate, status)

  if (editing) return (
    <input autoFocus type="date"
      className="text-xs border border-blue-300 rounded px-1.5 py-0.5 outline-none focus:border-blue-500 bg-white"
      defaultValue={dueDate} onChange={e => { onUpdate?.(id, 'due_date', e.target.value); setEditing(false) }} onBlur={() => setEditing(false)} />
  )

  const pillClass = urgency
    ? `rounded-md px-1.5 py-0.5 ${DATE_URGENCY_STYLES[urgency]}`
    : 'text-gray-400 hover:text-blue-600'

  return (
    <span
      title="Click to change date"
      onClick={() => setEditing(true)}
      className={`text-xs whitespace-nowrap font-medium cursor-pointer hover:underline transition-colors flex-shrink-0 ${pillClass}`}
    >
      {formatDate(dueDate)}{urgency === 'overdue' && ' ⚠'}
    </span>
  )
}

// ── Comment panel ─────────────────────────────────────────────────────────────

function CommentPanel({
  taskId, comments, onAddComment, indent = false,
}: {
  taskId: string
  comments?: Comment[]
  onAddComment?: (taskId: string, text: string, author: string) => void
  indent?: boolean
}) {
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('pdds-reply-name') ?? '' : ''
  )

  function handleAuthorChange(val: string) {
    setAuthor(val)
    localStorage.setItem('pdds-reply-name', val)
  }

  function submit() {
    if (!text.trim() || !author.trim()) return
    onAddComment?.(taskId, text.trim(), author.trim())
    setText('')
  }

  return (
    <div className={`border-t border-gray-100 bg-gray-50/60 py-3 ${indent ? 'pl-10 pr-4' : 'px-4'}`}>
      {(comments ?? []).length > 0 && (
        <div className="space-y-2.5 mb-3">
          {comments!.map(c => (
            <div key={c.id} className="flex gap-2.5">
              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {c.author[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-500">
                  <span className="font-semibold text-gray-700">{c.author}</span>
                  {' · '}
                  <span>{formatCommentTime(c.created_at)}</span>
                </p>
                <p className="text-xs text-gray-700 mt-0.5 leading-relaxed">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <input
          placeholder="Your name"
          value={author}
          onChange={e => handleAuthorChange(e.target.value)}
          className="w-28 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white flex-shrink-0"
        />
        <input
          placeholder="Add a comment…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || !author.trim()}
          className="text-xs font-semibold px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          Post
        </button>
      </div>
    </div>
  )
}

// ── Notes modal ───────────────────────────────────────────────────────────────

function TaskNotesModal({
  taskId,
  taskTitle,
  comments,
  onAddComment,
  onClose,
}: {
  taskId: string
  taskTitle: string
  comments?: Comment[]
  onAddComment?: (taskId: string, text: string, author: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [author, setAuthor] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('pdds-reply-name') ?? '' : ''
  )
  const listRef = useRef<HTMLDivElement>(null)

  function handleAuthorChange(val: string) {
    setAuthor(val)
    localStorage.setItem('pdds-reply-name', val)
  }

  function submit() {
    if (!text.trim() || !author.trim()) return
    onAddComment?.(taskId, text.trim(), author.trim())
    setText('')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [comments?.length])

  return typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0 pr-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Notes</p>
            <h2 className="text-sm font-semibold text-gray-800 leading-snug">{taskTitle}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors mt-0.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Notes list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {(comments ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No notes yet. Add the first one below.</p>
          ) : (
            comments!.map(c => (
              <div key={c.id} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {c.author[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 mb-1">
                    <span className="font-semibold text-gray-700">{c.author}</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span>{formatCommentTime(c.created_at)}</span>
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add note form */}
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60 rounded-b-2xl">
          <div className="flex gap-2 items-center">
            <input
              placeholder="Your name"
              value={author}
              onChange={e => handleAuthorChange(e.target.value)}
              className="w-28 text-xs border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white flex-shrink-0"
            />
            <input
              autoFocus
              placeholder="Add a note…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
            />
            <button
              onClick={submit}
              disabled={!text.trim() || !author.trim()}
              className="text-xs font-semibold px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null
}

// ── Add task / subtask inline forms ───────────────────────────────────────────

function AddItemForm({
  label, onAdd, onCancel, indent = false, showApplyToAll = false,
}: {
  label: string
  onAdd: (title: string, assignee: string, dueDate: string, applyToAll: boolean) => void
  onCancel: () => void
  indent?: boolean
  showApplyToAll?: boolean
}) {
  const [title, setTitle]           = useState('')
  const [assignee, setAssignee]     = useState('')
  const [dueDate, setDueDate]       = useState('')
  const [applyToAll, setApplyToAll] = useState(false)

  function submit() {
    if (!title.trim() || !dueDate) return
    onAdd(title.trim(), assignee.trim(), dueDate, applyToAll)
    setTitle(''); setAssignee(''); setDueDate(''); setApplyToAll(false)
  }

  return (
    <div className={`border border-blue-200 rounded-lg p-3 bg-blue-50/40 ${indent ? 'mx-1' : 'mt-2'}`}>
      <input
        autoFocus
        placeholder={`${label} title…`}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-2 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
      />
      <div className="flex gap-2 mb-2">
        <input
          placeholder="Assignee"
          value={assignee}
          onChange={e => setAssignee(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
        />
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!title.trim() || !dueDate}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add {label}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
        {showApplyToAll && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={e => setApplyToAll(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
            />
            Apply to all waves
          </label>
        )}
      </div>
    </div>
  )
}

// ── Kebab menu ────────────────────────────────────────────────────────────────

type KebabItem = {
  label:     string
  icon:      React.ReactNode
  onClick:   () => void
  danger?:   boolean
}

function KebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.right - 160 })
    }
    setOpen(o => !o)
  }

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) close()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, close])

  return (
    <div className="flex-shrink-0">
      <button
        ref={btnRef}
        onClick={toggle}
        title="More options"
        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5"  cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[160px]"
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); item.onClick(); close() }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium transition-colors text-left ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="w-3.5 h-3.5 flex-shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Subtask row ───────────────────────────────────────────────────────────────

function SubtaskRow({
  task, parentId, onToggle, onUpdate, onAddComment, onRemoveSubtask,
}: {
  task: Task
  parentId: string
  onToggle: (id: string) => void
  onUpdate?: UpdateFn
  onAddComment?: (taskId: string, text: string, author: string) => void
  onRemoveSubtask?: (parentId: string, subtaskId: string) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const complete = task.status === 'complete'
  const commentCount = task.comments?.length ?? 0

  const kebabItems: KebabItem[] = [
    {
      label:   'Add Note',
      icon:    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
      onClick: () => setNotesOpen(true),
    },
    {
      label:   'Remove Subtask',
      icon:    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
      onClick: () => onRemoveSubtask?.(parentId, task.id),
      danger:  true,
    },
  ]

  return (
    <div>
      <div className="flex items-center gap-3 pl-10 pr-3 py-2.5 border-t border-gray-100 hover:bg-blue-50/30">
        <button onClick={() => onToggle(task.id)}
          className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${complete ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400'}`}>
          {complete && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </button>
        <EditableTitle id={task.id} title={task.title} complete={complete} onUpdate={onUpdate} />
        <AssignmentCell id={task.id} team={task.assignee_team} memberName={task.assignee_name} onUpdate={onUpdate} />
        <EditableDate id={task.id} dueDate={task.due_date} status={task.status} onUpdate={onUpdate} />
        {commentCount > 0 && (
          <button onClick={() => setNotesOpen(true)} title="Notes" className="flex-shrink-0">
            <CommentIcon count={commentCount} active={notesOpen} />
          </button>
        )}
        <KebabMenu items={kebabItems} />
      </div>
      {notesOpen && (
        <TaskNotesModal
          taskId={task.id}
          taskTitle={task.title}
          comments={task.comments}
          onAddComment={onAddComment}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </div>
  )
}

// ── Parent task row ───────────────────────────────────────────────────────────

function ParentTaskRow({
  task, onToggle, onUpdate, onAddSubtask, onAddComment, onRemoveTask, onRemoveSubtask,
}: {
  task: Task
  onToggle: (id: string) => void
  onUpdate?: UpdateFn
  onAddSubtask?: (parentId: string, title: string, assignee: string, dueDate: string) => void
  onAddComment?: (taskId: string, text: string, author: string) => void
  onRemoveTask?: (id: string) => void
  onRemoveSubtask?: (parentId: string, subtaskId: string) => void
}) {
  const [subtasksOpen, setSubtasksOpen]     = useState(false)
  const [showAddSubtask, setShowAddSubtask] = useState(false)
  const [notesOpen, setNotesOpen]           = useState(false)
  const hasSubtasks = (task.subtasks?.length ?? 0) > 0
  const complete = task.status === 'complete'
  const commentCount = task.comments?.length ?? 0

  function handleAddSubtask(title: string, assignee: string, dueDate: string, _applyToAll: boolean) {
    onAddSubtask?.(task.id, title, assignee, dueDate)
    setShowAddSubtask(false)
  }

  function openSubtaskForm() {
    setSubtasksOpen(true)
    setShowAddSubtask(true)
  }

  const kebabItems: KebabItem[] = [
    {
      label:   'Add Note',
      icon:    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
      onClick: () => setNotesOpen(true),
    },
    {
      label:   'Add Subtask',
      icon:    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>,
      onClick: openSubtaskForm,
    },
    {
      label:   'Remove Task',
      icon:    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
      onClick: () => onRemoveTask?.(task.id),
      danger:  true,
    },
  ]

  return (
    <div className={`border rounded-lg mb-2 overflow-hidden transition-all ${complete ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
      {/* Main row */}
      <div className={`flex items-center gap-3 px-4 py-3 ${complete ? 'hover:bg-blue-50/60' : 'hover:bg-gray-50'}`}>
        <button onClick={() => onToggle(task.id)}
          className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${complete ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 hover:border-blue-400'}`}>
          {complete && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </button>
        <EditableTitle id={task.id} title={task.title} complete={complete} onUpdate={onUpdate} />
        <AssignmentCell id={task.id} team={task.assignee_team} memberName={task.assignee_name} onUpdate={onUpdate} />
        <EditableDate id={task.id} dueDate={task.due_date} status={task.status} onUpdate={onUpdate} />

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          {/* Comment count badge (if any) */}
          {commentCount > 0 && (
            <button onClick={() => setNotesOpen(true)} title="Notes">
              <CommentIcon count={commentCount} active={notesOpen} />
            </button>
          )}

          {/* Expand subtasks toggle */}
          {hasSubtasks && (
            <button
              onClick={() => setSubtasksOpen(o => !o)}
              className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 font-medium flex-shrink-0"
            >
              {subtasksOpen ? '▲' : `▼ ${task.subtasks!.length}`}
            </button>
          )}

          <KebabMenu items={kebabItems} />
        </div>
      </div>

      {/* Subtask area */}
      {subtasksOpen && (
        <div className={complete ? 'bg-blue-50/30' : 'bg-gray-50/50'}>
          {task.subtasks?.map(sub => (
            <SubtaskRow
              key={sub.id} task={sub} parentId={task.id}
              onToggle={onToggle} onUpdate={onUpdate}
              onAddComment={onAddComment} onRemoveSubtask={onRemoveSubtask}
            />
          ))}
          {showAddSubtask ? (
            <div className="px-4 py-3 border-t border-gray-100">
              <AddItemForm
                label="Subtask"
                onAdd={handleAddSubtask}
                onCancel={() => setShowAddSubtask(false)}
                indent
              />
            </div>
          ) : (
            <button
              onClick={() => setShowAddSubtask(true)}
              className="w-full flex items-center gap-1.5 px-10 py-2.5 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50/40 transition-colors border-t border-gray-100"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add subtask
            </button>
          )}
        </div>
      )}

      {notesOpen && (
        <TaskNotesModal
          taskId={task.id}
          taskTitle={task.title}
          comments={task.comments}
          onAddComment={onAddComment}
          onClose={() => setNotesOpen(false)}
        />
      )}
    </div>
  )
}

// ── Progress bar color ────────────────────────────────────────────────────────

function progressBarColor(pct: number) {
  if (pct <= 40) return 'bg-red-400'
  if (pct <= 60) return 'bg-orange-400'
  if (pct <= 80) return 'bg-yellow-400'
  return 'bg-green-500'
}

// ── TaskSection ───────────────────────────────────────────────────────────────

type TaskSectionProps = {
  phase: string
  tasks: Task[]
  onToggle: (id: string) => void
  onUpdate?: UpdateFn
  onPhaseRename?: (o: string, n: string) => void
  onAddTask?: (phase: string, title: string, assignee: string, dueDate: string) => void
  onAddTaskToAll?: (phase: string, title: string, assignee: string, dueDate: string) => void
  onAddSubtask?: (parentId: string, title: string, assignee: string, dueDate: string) => void
  onAddComment?: (taskId: string, text: string, author: string) => void
  onRemoveTask?: (id: string) => void
  onRemoveSubtask?: (parentId: string, subtaskId: string) => void
}

export function TaskSection({ phase, tasks, onToggle, onUpdate, onPhaseRename, onAddTask, onAddTaskToAll, onAddSubtask, onAddComment, onRemoveTask, onRemoveSubtask }: TaskSectionProps) {
  const [collapsed, setCollapsed]       = useState(false)
  const [showAddTask, setShowAddTask]   = useState(false)
  const allTasks = tasks.flatMap(t => [t, ...(t.subtasks ?? [])])
  const completeCount = allTasks.filter(t => t.status === 'complete').length
  const pct = allTasks.length ? Math.round((completeCount / allTasks.length) * 100) : 0
  const prevPct = useRef(pct)

  useEffect(() => {
    if (pct === 100 && prevPct.current < 100) confetti({ particleCount: 180, spread: 90, origin: { y: 0.6 } })
    prevPct.current = pct
  }, [pct])

  function handleAddTask(title: string, assignee: string, dueDate: string, applyToAll: boolean) {
    if (applyToAll && onAddTaskToAll) {
      onAddTaskToAll(phase, title, assignee, dueDate)
    } else {
      onAddTask?.(phase, title, assignee, dueDate)
    }
    setShowAddTask(false)
  }

  return (
    <div className="mb-5 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
        {onPhaseRename
          ? <EditablePhase phase={phase} onRename={onPhaseRename} />
          : <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600">{phase}</h3>
        }
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 hidden sm:block">{completeCount}/{allTasks.length} complete</span>
          <button onClick={() => setCollapsed(c => !c)} className="text-xs text-blue-500 hover:text-blue-700 font-medium">
            {collapsed ? 'SHOW ▼' : 'HIDE ▲'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-5 py-4">
          {tasks.map(task => (
            <ParentTaskRow
              key={task.id}
              task={task}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onAddSubtask={onAddSubtask}
              onAddComment={onAddComment}
              onRemoveTask={onRemoveTask}
              onRemoveSubtask={onRemoveSubtask}
            />
          ))}

          {/* Add task */}
          {showAddTask ? (
            <AddItemForm
              label="Task"
              onAdd={handleAddTask}
              onCancel={() => setShowAddTask(false)}
              showApplyToAll={!!onAddTaskToAll}
            />
          ) : (
            <button
              onClick={() => setShowAddTask(true)}
              className="mt-2 w-full flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg border border-dashed border-gray-200 hover:border-blue-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add task to {phase}
            </button>
          )}

          {/* Progress bar */}
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${progressBarColor(pct)}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-400 font-medium w-8 text-right">{pct}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
