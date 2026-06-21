// The NOTES tab — a private capture pad for insights and ideas, backed by
// Supabase (online-only). Master/detail: a searchable, pin-able list on the
// left; a focused editor on the right. Edits apply optimistically and persist
// debounced (one PATCH per pause, not per keystroke). Rides the same design
// tokens as the rest of the app, so it stays on-theme by default.
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import Icon from '../Icon'

interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  createdAt: number
  updatedAt: number
}
type NoteInput = Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned'>>

const api = (): typeof window.forge.notes | null =>
  typeof window !== 'undefined' && window.forge?.notes ? window.forge.notes : null

function snippet(n: Note): string {
  const s = n.body.trim().replace(/\s+/g, ' ')
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

/** Compact relative time. */
function ago(ts: number): string {
  const d = Date.now() - ts
  const m = Math.round(d / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export default function NotesView(): JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  // Debounced write buffer: merge pending field edits per id, flush on pause.
  const pending = useRef<Map<string, NoteInput>>(new Map())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  async function reload(): Promise<void> {
    const a = api()
    if (!a) {
      setStatus('error')
      setError('Notes bridge unavailable (run inside the desktop app).')
      return
    }
    try {
      const list = await a.list()
      setNotes(list)
      setActiveId((cur) => cur ?? list[0]?.id ?? null)
      setStatus('ready')
      setError('')
    } catch (e) {
      setStatus('error')
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  useEffect(() => {
    void reload()
    const live = timers.current
    return () => {
      live.forEach((t) => clearTimeout(t))
    }
  }, [])

  const active = notes.find((n) => n.id === activeId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q))
        )
      : notes
    return [...base].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }, [notes, query])

  const pinned = filtered.filter((n) => n.pinned)
  const rest = filtered.filter((n) => !n.pinned)

  /** Optimistic local edit + debounced server persist (per id). */
  function edit(id: string, p: NoteInput, flush = false): void {
    setNotes((list) =>
      list.map((n) => (n.id === id ? { ...n, ...p, updatedAt: Date.now() } : n))
    )
    const merged = { ...(pending.current.get(id) ?? {}), ...p }
    pending.current.set(id, merged)
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    const run = async (): Promise<void> => {
      const patch = pending.current.get(id)
      pending.current.delete(id)
      timers.current.delete(id)
      if (!patch) return
      try {
        await api()?.update(id, patch)
      } catch (e) {
        setError(`Save failed: ${e instanceof Error ? e.message : e}`)
      }
    }
    if (flush) void run()
    else timers.current.set(id, setTimeout(run, 500))
  }

  async function create(): Promise<void> {
    const a = api()
    if (!a) return
    try {
      const n = await a.create({})
      setNotes((list) => [n, ...list])
      setActiveId(n.id)
      setQuery('')
      requestAnimationFrame(() => bodyRef.current?.focus())
    } catch (e) {
      setError(`Create failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function remove(id: string): Promise<void> {
    const prev = notes
    setNotes((list) => {
      const next = list.filter((n) => n.id !== id)
      if (id === activeId) setActiveId(next[0]?.id ?? null)
      return next
    })
    try {
      await api()?.delete(id)
    } catch (e) {
      setNotes(prev) // roll back on failure
      setError(`Delete failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  const tagText = active ? active.tags.join(', ') : ''
  function setTags(v: string): void {
    if (!active) return
    const tags = v
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    edit(active.id, { tags })
  }

  return (
    <div className="nt-root">
      <div className="nt-bar">
        <div className="nt-bar-title">
          <Icon name="notes" className="nt-bar-mark" />
          Notes
          <span className="nt-bar-sub">
            {status === 'ready'
              ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
              : status === 'loading'
                ? 'syncing…'
                : 'offline'}
          </span>
        </div>
        <div className="nt-bar-actions">
          <div className="nt-search">
            <Icon name="inspect" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes and tags"
              aria-label="Search notes"
            />
          </div>
          <button className="nt-new" onClick={() => void create()} disabled={status === 'error'}>
            <Icon name="notes" />
            New note
          </button>
        </div>
      </div>

      {error && (
        <div className="nt-error" role="alert">
          {error}
          <button className="nt-retry" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="nt-body">
        <aside className="nt-list" role="list">
          {status === 'loading' ? (
            <div className="nt-list-empty">
              <p>Loading notes…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="nt-list-empty">
              {query ? (
                <>
                  <p className="nt-empty-strong">No matches</p>
                  <p>Nothing matches “{query}”.</p>
                </>
              ) : (
                <>
                  <p className="nt-empty-strong">No notes yet</p>
                  <p>Capture your first insight.</p>
                </>
              )}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <div className="nt-group">Pinned</div>
                  {pinned.map((n) => (
                    <NoteItem key={n.id} note={n} on={n.id === activeId} onPick={setActiveId} />
                  ))}
                </>
              )}
              {rest.length > 0 && (
                <>
                  {pinned.length > 0 && <div className="nt-group">All notes</div>}
                  {rest.map((n) => (
                    <NoteItem key={n.id} note={n} on={n.id === activeId} onPick={setActiveId} />
                  ))}
                </>
              )}
            </>
          )}
        </aside>

        <section className="nt-editor">
          {!active ? (
            <div className="nt-editor-empty">
              <Icon name="notes" />
              <p className="nt-empty-strong">Nothing selected</p>
              <p>Pick a note on the left, or start a new one.</p>
              <button className="nt-new" onClick={() => void create()} disabled={status === 'error'}>
                <Icon name="notes" />
                New note
              </button>
            </div>
          ) : (
            <>
              <input
                className="nt-title-input"
                value={active.title}
                onChange={(e) => edit(active.id, { title: e.target.value })}
                placeholder="Untitled note"
                aria-label="Note title"
              />
              <div className="nt-tags-row">
                <label className="nt-field-label" htmlFor="nt-tags">
                  Tags
                </label>
                <input
                  id="nt-tags"
                  className="nt-tags-input"
                  value={tagText}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="comma, separated"
                />
              </div>
              <textarea
                ref={bodyRef}
                className="nt-body-input"
                value={active.body}
                onChange={(e) => edit(active.id, { body: e.target.value })}
                placeholder="Write the idea. What did you learn, what does it unblock?"
                aria-label="Note body"
              />
              <div className="nt-editor-foot">
                <span className="nt-stamp">Edited {ago(active.updatedAt)}</span>
                <div className="nt-foot-actions">
                  <button
                    className={`nt-icon-btn ${active.pinned ? 'on' : ''}`}
                    onClick={() => edit(active.id, { pinned: !active.pinned }, true)}
                    title={active.pinned ? 'Unpin' : 'Pin'}
                  >
                    <Icon name="target" />
                    {active.pinned ? 'Pinned' : 'Pin'}
                  </button>
                  <button
                    className="nt-icon-btn nt-del"
                    onClick={() => void remove(active.id)}
                    title="Delete note"
                  >
                    <Icon name="tool" />
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function NoteItem({
  note,
  on,
  onPick
}: {
  note: Note
  on: boolean
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <button
      className={`nt-item ${on ? 'on' : ''}`}
      onClick={() => onPick(note.id)}
      role="listitem"
    >
      <div className="nt-item-head">
        <span className="nt-item-title">{note.title.trim() || 'Untitled note'}</span>
        {note.pinned && <Icon name="target" className="nt-item-pin" />}
      </div>
      {snippet(note) && <span className="nt-item-snippet">{snippet(note)}</span>}
      <div className="nt-item-meta">
        <span className="nt-item-time">{ago(note.updatedAt)}</span>
        {note.tags.length > 0 && (
          <span className="nt-item-tags">
            {note.tags.slice(0, 3).map((t) => (
              <span key={t} className="nt-tag">
                {t}
              </span>
            ))}
          </span>
        )}
      </div>
    </button>
  )
}
