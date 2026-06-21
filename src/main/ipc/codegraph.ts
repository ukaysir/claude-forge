// GraphMAP IPC: read a project's codegraph index and return aggregated graph
// data for the GraphMAP tab. Read-only; no model, no tokens (see ../codegraph).
import type { IpcMain } from 'electron'
import {
  codegraphOverview,
  codegraphSearch,
  codegraphStatus,
  codegraphSymbols,
  type OverviewOpts
} from '../codegraph'

export function register(ipc: IpcMain): void {
  ipc.handle('codegraph:status', (_e, root: string) => codegraphStatus(root))
  ipc.handle('codegraph:overview', (_e, root: string, opts: OverviewOpts) =>
    codegraphOverview(root, opts)
  )
  ipc.handle('codegraph:symbols', (_e, root: string, file: string) => codegraphSymbols(root, file))
  ipc.handle('codegraph:search', (_e, root: string, query: string) => codegraphSearch(root, query))
}
