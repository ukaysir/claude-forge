// Notes store — backed by Supabase (PostgREST) over plain fetch, no SDK dep
// (Forge's lazy/native ethos: Node 24 ships global fetch, PostgREST is a REST
// API, so a thin client beats pulling in @supabase/supabase-js). Single-user,
// online-only: the publishable key is public by design and protected by RLS.
//
// Config resolves from env first (SUPABASE_URL / SUPABASE_ANON_KEY) so the
// embedded defaults can be overridden without a rebuild.

const URL = (process.env.SUPABASE_URL || 'https://vdxgbylqdrlkxuhmhhni.supabase.co').replace(
  /\/+$/,
  ''
)
const KEY =
  process.env.SUPABASE_ANON_KEY || 'sb_publishable_o87rL1izmw9yEV9iIVredw_XEW8rAyN'

const REST = `${URL}/rest/v1/notes`

/** A note as the renderer consumes it (timestamps are epoch ms). */
export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** Fields a caller may set when creating/updating. */
export type NoteInput = Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned'>>

interface Row {
  id: string
  title: string
  body: string
  tags: string[] | null
  pinned: boolean
  created_at: string
  updated_at: string
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra
  }
}

function toNote(r: Row): Note {
  return {
    id: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    pinned: !!r.pinned,
    createdAt: Date.parse(r.created_at) || 0,
    updatedAt: Date.parse(r.updated_at) || 0
  }
}

async function req(url: string, init: RequestInit): Promise<Row[]> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Supabase ${res.status} ${res.statusText}: ${text.slice(0, 300)}`)
  }
  if (res.status === 204) return []
  const body = await res.text()
  return body ? (JSON.parse(body) as Row[]) : []
}

/** All notes, pinned first then most-recently edited. */
export async function listNotes(): Promise<Note[]> {
  const rows = await req(`${REST}?select=*&order=pinned.desc,updated_at.desc`, {
    method: 'GET',
    headers: headers()
  })
  return rows.map(toNote)
}

/** Insert a note; returns the created row. */
export async function createNote(input: NoteInput = {}): Promise<Note> {
  const payload = {
    title: input.title ?? '',
    body: input.body ?? '',
    tags: input.tags ?? [],
    pinned: input.pinned ?? false
  }
  const rows = await req(REST, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(payload)
  })
  return toNote(rows[0])
}

/** Patch a note by id; returns the updated row. */
export async function updateNote(id: string, patch: NoteInput): Promise<Note> {
  const clean: Record<string, unknown> = {}
  if (patch.title !== undefined) clean.title = patch.title
  if (patch.body !== undefined) clean.body = patch.body
  if (patch.tags !== undefined) clean.tags = patch.tags
  if (patch.pinned !== undefined) clean.pinned = patch.pinned
  const rows = await req(`${REST}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(clean)
  })
  return toNote(rows[0])
}

/** Delete a note by id. */
export async function deleteNote(id: string): Promise<void> {
  await req(`${REST}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers()
  })
}
