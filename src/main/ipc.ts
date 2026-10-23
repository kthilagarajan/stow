import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { IPC } from '../shared/ipc'
import { openAssistant, type AssistantTarget } from './assistant'
import { fileIcons } from './icons'
import { demoIcons, demoInfo, demoListing, demoScan, demoVolume, isDemo } from './demo'
import { itemInfo } from './info'
import { checkForUpdate, downloadUpdate, openDownloaded, openReleasePage } from './updates'
import type { Scanner } from './scanner'
import { clearMeasuredTrash, readScan } from './store'
import { readVolume } from './volume'
import { windowBackground } from './window'

// The main process side of window.stow. Every handler checks its arguments: the page is not trusted.
export function registerIpc(scanner: Scanner): void {
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdate())
  ipcMain.handle(IPC.downloadUpdate, (event) =>
    downloadUpdate((progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.updateProgress, progress)
    })
  )
  ipcMain.handle(IPC.openReleasePage, () => openReleasePage())
  ipcMain.handle(IPC.openDownloaded, (_event, file: unknown) => (typeof file === 'string' ? openDownloaded(file) : undefined))
  ipcMain.handle(IPC.meta, () => ({ version: app.getVersion() }))
  ipcMain.handle(IPC.volume, () => readVolume())
  ipcMain.handle(IPC.emptyTrash, async () => {
    const result = await scanner.emptyTrash()
    if (result.ok) {
      try {
        clearMeasuredTrash()
      } catch {
        // Finder already emptied the Trash. The window still updates.
      }
    }
    return result
  })
  ipcMain.handle(IPC.loadScan, () => readScan())
  ipcMain.handle(IPC.startScan, (event) => scanner.start(event.sender))
  ipcMain.handle(IPC.reveal, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return
    return scanner.reveal(filePath)
  })
  ipcMain.handle(IPC.trash, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      return { ok: false, error: 'That path is not one Stow measured.' }
    }
    return scanner.trash(filePath)
  })
  ipcMain.handle(IPC.trashMany, (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return { trashed: [], error: 'Nothing was selected.' }
    return scanner.trashMany(paths.filter((entry): entry is string => typeof entry === 'string'))
  })
  ipcMain.handle(IPC.openFolder, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return { ok: false, error: 'That path is not one Stow measured.' }
    return scanner.openFolder(filePath)
  })
  ipcMain.handle(IPC.goTo, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return { ok: false, error: 'Type a folder path, like ~/Projects.' }
    return scanner.goTo(filePath)
  })
  ipcMain.handle(IPC.setTheme, (event, choice: unknown) => {
    if (choice !== 'system' && choice !== 'light' && choice !== 'dark') return
    // Drives the traffic lights, native dialogs, and prefers-color-scheme in the page.
    nativeTheme.themeSource = choice
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(windowBackground())
  })
  ipcMain.handle(IPC.info, (_event, filePath: unknown) => (typeof filePath === 'string' ? itemInfo(filePath) : null))
  ipcMain.handle(IPC.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory', 'showHiddenFiles'] as Array<'openDirectory' | 'showHiddenFiles'>, buttonLabel: 'Go' }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.ask, (_event, target: unknown, prompt: unknown) => {
    if (target !== 'copy' && target !== 'chatgpt' && target !== 'claude' && target !== 'cursor' && target !== 'codex') {
      return { ok: false, error: 'That assistant is not available.' }
    }
    if (typeof prompt !== 'string') return { ok: false, error: 'That prompt is empty.' }
    return openAssistant(target as AssistantTarget, prompt)
  })
  ipcMain.handle(IPC.fileIcons, (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return {}
    return fileIcons(paths.filter((entry): entry is string => typeof entry === 'string').slice(0, 80))
  })
  if (isDemo) useDemoData()
}

// Demo mode swaps every handler that reads or changes the disk for made-up data, and never touches files.
function useDemoData(): void {
  const swap = (channel: string, handler: Parameters<typeof ipcMain.handle>[1]) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
  const refuse = { ok: false, error: 'Demo mode does not move files.' }
  swap(IPC.loadScan, () => demoScan())
  swap(IPC.volume, () => demoVolume())
  swap(IPC.startScan, () => ({ started: false }))
  swap(IPC.openFolder, (_event, filePath: unknown) => (typeof filePath === 'string' ? demoListing(filePath) : refuse))
  swap(IPC.goTo, (_event, filePath: unknown) =>
    typeof filePath === 'string' ? demoListing(filePath.replace(/^~/, '/Users/alex')) : refuse
  )
  swap(IPC.info, (_event, filePath: unknown) => (typeof filePath === 'string' ? demoInfo(filePath) : null))
  swap(IPC.fileIcons, (_event, paths: unknown) =>
    Array.isArray(paths) ? demoIcons(paths.filter((entry): entry is string => typeof entry === 'string')) : {}
  )
  swap(IPC.reveal, () => undefined)
  swap(IPC.trash, () => refuse)
  swap(IPC.trashMany, () => ({ trashed: [], error: refuse.error }))
  swap(IPC.emptyTrash, () => refuse)
  swap(IPC.checkUpdate, () => null)
}
