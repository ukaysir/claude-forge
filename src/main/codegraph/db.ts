// Read-only access to a project's codegraph SQLite index (.codegraph/codegraph.db).
// codegraph owns and writes that DB (its daemon keeps it current via file-watch);
// Forge only ever READS it, for the GraphMAP visualization. We use Node's built-in
// node:sqlite (zero native deps), loaded defensively via dynamic import so the app
// degrades gracefully on a runtime that lacks it instead of crashing at startup.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The slice of node:sqlite's DatabaseSync we use (kept loose to survive runtimes
 *  without bundled types). */
export interface CodegraphDb {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[]
    get(...params: unknown[]): Record<string, unknown> | undefined
  }
  close(): void
}

// Cache the (single) module load. Resolves to the module namespace, or null when
// node:sqlite is unavailable on this runtime.
let sqliteLoad: Promise<{ DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => CodegraphDb } | null> | undefined
function loadSqlite(): Promise<{ DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => CodegraphDb } | null> {
  if (!sqliteLoad) {
    sqliteLoad = import('node:sqlite')
      .then((m) => m as unknown as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => CodegraphDb })
      .catch(() => null)
  }
  return sqliteLoad
}

/** Whether node:sqlite can be loaded at all (false ⇒ GraphMAP shows a notice). */
export async function sqliteAvailable(): Promise<boolean> {
  return (await loadSqlite()) != null
}

/** Absolute path to a project root's codegraph database. */
export function dbPathFor(root: string): string {
  return join(root, '.codegraph', 'codegraph.db')
}

/** Whether a project root has been indexed (its `.codegraph/codegraph.db` exists). */
export function hasIndex(root: string): boolean {
  return !!root && existsSync(dbPathFor(root))
}

// One open handle per DB path, reopened when the file mtime changes (so the map
// reflects the daemon's incremental sync without leaking handles).
const cache = new Map<string, { db: CodegraphDb; mtimeMs: number }>()

/** Open (or reuse) a read-only handle to a root's codegraph DB. null when sqlite
 *  is unavailable, the index is missing, or the file can't be opened. */
export async function openDb(root: string): Promise<CodegraphDb | null> {
  const mod = await loadSqlite()
  if (!mod) return null
  const path = dbPathFor(root)
  if (!existsSync(path)) return null
  let mtimeMs = 0
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    /* fall through with mtime 0 */
  }
  const hit = cache.get(path)
  if (hit && hit.mtimeMs === mtimeMs) return hit.db
  if (hit) {
    try {
      hit.db.close()
    } catch {
      /* ignore */
    }
    cache.delete(path)
  }
  // Prefer a read-only connection; if that fails (e.g. WAL shared-memory quirk
  // when no daemon is running), retry with a normal connection (we only SELECT).
  let db: CodegraphDb | null = null
  try {
    db = new mod.DatabaseSync(path, { readOnly: true })
  } catch {
    try {
      db = new mod.DatabaseSync(path)
    } catch {
      db = null
    }
  }
  if (db) cache.set(path, { db, mtimeMs })
  return db
}
