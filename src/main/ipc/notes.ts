// Notes IPC — CRUD over the Supabase-backed notes store. Thin pass-through;
// all network + mapping lives in ../notes/store. Mirrors the persona/memory
// channel pattern (docs/MAINTAINABILITY.md Phase 4).
import type { IpcMain } from 'electron'
import { listNotes, createNote, updateNote, deleteNote, type NoteInput } from '../notes/store'

export function register(ipc: IpcMain): void {
  ipc.handle('notes:list', () => listNotes())
  ipc.handle('notes:create', (_e, input: NoteInput) => createNote(input))
  ipc.handle('notes:update', (_e, id: string, patch: NoteInput) => updateNote(id, patch))
  ipc.handle('notes:delete', (_e, id: string) => deleteNote(id))
}
