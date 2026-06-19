// Pure transcript/block reducers. Leaf module (docs/MAINTAINABILITY.md Phase 0):
// no JSX, no component imports — depends only on ./types. Extracted verbatim from
// App.tsx — behavior-preserving.
import type { AgentEvent, Block, Todo, Turn } from '../types'

function normTaskStatus(s: string): Todo['status'] {
  return s === 'completed' ? 'completed' : s === 'in_progress' ? 'in_progress' : 'pending'
}

/**
 * Reconstruct the current task list from Task-tool activity across the live
 * transcript. The SDK's models manage work via TaskCreate/TaskUpdate/TaskList
 * (not TodoWrite), so we replay those calls:
 *  - TaskCreate result "Task #<id> created successfully: <subject>" → add task
 *  - TaskUpdate input { taskId, status, subject? }                 → mutate task
 *  - TaskList result "#<id> [<status>] <subject>" (per line)       → snapshot sync
 */
// A single task mutation distilled from one tool block. Extracting these (the
// regex + JSON.parse work) is the only per-block cost; replaying them into the
// task map is cheap. See deriveTasks for why this split matters.
type TaskOp =
  | { op: 'create'; id: string; content: string; activeForm: string | undefined }
  | { op: 'update'; id: string; status?: Todo['status']; content?: string; activeForm?: string }
  | { op: 'delete'; id: string }
  | { op: 'list'; entries: { id: string; content: string; status: Todo['status'] }[] }

// Per-turn extracted task ops, cached by Turn identity. A completed turn keeps a
// stable object ref, so its ops are extracted once and reused on every later
// call; only the active streaming turn (a fresh ref each rAF flush) is
// re-extracted. The WeakMap lets superseded streaming snapshots be GC'd, and
// turns with no Task tools cache an empty array (so they skip the scan next
// time). This makes deriveTasks scale with the active turn, not the whole
// transcript — the long-conversation cost in docs/PERFORMANCE.md. Behavior is
// identical to the previous single-pass scan (same op order, same upserts).
const taskOpsCache = new WeakMap<Turn, TaskOp[]>()

function extractTaskOps(turn: Turn): TaskOp[] {
  const cached = taskOpsCache.get(turn)
  if (cached) return cached
  const ops: TaskOp[] = []
  for (const b of turn.blocks) {
    if (b.kind !== 'tool') continue
    if (b.name === 'TaskCreate') {
      const m = /Task #(\d+) created successfully:\s*([\s\S]+)/.exec(b.result ?? '')
      if (m) {
        let activeForm: string | undefined
        try {
          activeForm = (JSON.parse(b.inputRaw) as { activeForm?: string }).activeForm
        } catch {
          /* still streaming */
        }
        ops.push({ op: 'create', id: m[1], content: m[2].trim(), activeForm })
      }
    } else if (b.name === 'TaskUpdate') {
      try {
        const inp = JSON.parse(b.inputRaw) as {
          taskId?: string | number
          status?: string
          subject?: string
          activeForm?: string
        }
        if (inp.taskId != null) {
          const id = String(inp.taskId)
          if (inp.status === 'deleted') {
            ops.push({ op: 'delete', id })
          } else {
            ops.push({
              op: 'update',
              id,
              ...(inp.status ? { status: normTaskStatus(inp.status) } : {}),
              ...(inp.subject ? { content: inp.subject } : {}),
              ...(inp.activeForm ? { activeForm: inp.activeForm } : {})
            })
          }
        }
      } catch {
        /* partial JSON mid-stream */
      }
    } else if (b.name === 'TaskList') {
      const entries: { id: string; content: string; status: Todo['status'] }[] = []
      for (const line of (b.result ?? '').split('\n')) {
        const m = /^#(\d+)\s+\[([a-z_]+)\]\s+([\s\S]+)$/.exec(line.trim())
        if (m) entries.push({ id: m[1], content: m[3].trim(), status: normTaskStatus(m[2]) })
      }
      if (entries.length) ops.push({ op: 'list', entries })
    }
  }
  taskOpsCache.set(turn, ops)
  return ops
}

export function deriveTasks(turns: Turn[]): Todo[] {
  type T = Todo & { id: string }
  const map = new Map<string, T>()
  const order: string[] = []
  const upsert = (id: string, patch: Partial<T>): void => {
    const cur = map.get(id)
    if (!cur) {
      order.push(id)
      map.set(id, {
        id,
        content: patch.content ?? `Task ${id}`,
        status: patch.status ?? 'pending',
        activeForm: patch.activeForm
      })
    } else {
      map.set(id, { ...cur, ...patch })
    }
  }
  for (const turn of turns) {
    for (const o of extractTaskOps(turn)) {
      if (o.op === 'create') {
        upsert(o.id, { content: o.content, activeForm: o.activeForm })
      } else if (o.op === 'update') {
        const patch: Partial<T> = {}
        if (o.status) patch.status = o.status
        if (o.content) patch.content = o.content
        if (o.activeForm) patch.activeForm = o.activeForm
        upsert(o.id, patch)
      } else if (o.op === 'delete') {
        map.delete(o.id)
        const i = order.indexOf(o.id)
        if (i >= 0) order.splice(i, 1)
      } else {
        for (const e of o.entries) upsert(e.id, { content: e.content, status: e.status })
      }
    }
  }
  return order
    .map((id) => map.get(id))
    .filter((t): t is T => !!t)
    .map(({ content, status, activeForm }) => ({ content, status, activeForm }))
}

/** Apply one streaming event to a turn's ordered block list. */
export function reduceBlocks(blocks: Block[], ev: AgentEvent): Block[] {
  if (ev.type === 'block-start') {
    if (blocks.some((b) => b.id === ev.blockId)) return blocks
    if (ev.kind === 'tool') {
      const t: Block = {
        kind: 'tool',
        id: ev.blockId,
        toolId: ev.toolId ?? ev.blockId,
        name: ev.name ?? 'tool',
        inputRaw: '',
        status: 'running',
        parentToolId: ev.parentToolId ?? null
      }
      return [...blocks, t]
    }
    const t: Block = { kind: ev.kind, id: ev.blockId, text: '' }
    return [...blocks, t]
  }
  if (ev.type === 'block-delta') {
    return blocks.map((b) =>
      b.id === ev.blockId && (b.kind === 'text' || b.kind === 'thinking')
        ? { ...b, text: b.text + ev.text }
        : b
    )
  }
  if (ev.type === 'tool-input') {
    return blocks.map((b) =>
      b.id === ev.blockId && b.kind === 'tool' ? { ...b, inputRaw: b.inputRaw + ev.partialJson } : b
    )
  }
  if (ev.type === 'tool-result') {
    return blocks.map((b) =>
      b.kind === 'tool' && b.toolId === ev.toolId
        ? { ...b, status: ev.ok ? 'ok' : 'error', result: ev.content }
        : b
    )
  }
  return blocks
}

export function parseTodos(input: unknown): Todo[] | null {
  try {
    const o = typeof input === 'string' ? JSON.parse(input) : input
    const todos = (o as { todos?: unknown })?.todos
    if (Array.isArray(todos)) {
      return todos
        .filter((t): t is Todo => !!t && typeof (t as Todo).content === 'string')
        .map((t) => ({
          content: t.content,
          status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
          activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined
        }))
    }
  } catch {
    /* partial JSON while streaming */
  }
  return null
}
