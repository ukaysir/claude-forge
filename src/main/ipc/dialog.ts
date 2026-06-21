// Native OS dialogs exposed to the renderer. Currently just a folder picker,
// shared by the chat "working folder" control and the GraphMAP root selector.
// No model, no tokens — a thin wrapper over Electron's dialog module.
import { BrowserWindow, dialog, type IpcMain } from 'electron'

export function register(ipc: IpcMain): void {
  // Pick a single directory. Resolves to its absolute path, or null if canceled.
  ipc.handle('dialog:pick-folder', async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const] }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
}
