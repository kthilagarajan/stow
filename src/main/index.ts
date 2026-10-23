import { app, BrowserWindow, ipcMain, Menu, nativeImage, type MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileIcons } from './icons'
import { Scanner } from './scanner'
import { clearMeasuredTrash, closeStore, openStore, persistTrash, readScan, writeScan } from './store'
import { readVolume } from './volume'

const scanner = new Scanner()

function iconFile(): string | null {
  const candidates = [path.join(app.getAppPath(), 'build/icon.png'), path.join(__dirname, '../../build/icon.png')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function installIcon(): void {
  const file = iconFile()
  if (!file || process.platform !== 'darwin' || !app.dock) return
  const image = nativeImage.createFromPath(file)
  if (!image.isEmpty()) app.dock.setIcon(image)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Stow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#E4EDF6',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function installMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Stow',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.setName('Stow')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    const icon = iconFile()
    app.setAboutPanelOptions({
      applicationName: 'Stow',
      applicationVersion: app.getVersion(),
      copyright: 'Scanning stays on this Mac.',
      ...(icon ? { iconPath: icon } : {})
    })
    installIcon()
    installMenu()
    openStore()
    const saved = readScan()
    if (saved) scanner.hydrate(saved.items)
    scanner.setPublisher((items, limited) => writeScan({ scannedAt: Date.now(), limited, items }))
    scanner.setTrashRecorder(persistTrash)
    ipcMain.handle('app:meta', () => ({ version: app.getVersion() }))
    ipcMain.handle('volume:get', () => readVolume())
    ipcMain.handle('trash:empty', async () => {
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
    ipcMain.handle('scan:load', () => readScan())
    ipcMain.handle('scan:start', (event) => scanner.start(event.sender))
    ipcMain.handle('item:reveal', (_event, filePath: unknown) => {
      if (typeof filePath !== 'string') return
      return scanner.reveal(filePath)
    })
    ipcMain.handle('item:trash', (_event, filePath: unknown) => {
      if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
        return { ok: false, error: 'That path is not one Stow measured.' }
      }
      return scanner.trash(filePath)
    })
    ipcMain.handle('item:trash-many', (_event, paths: unknown) => {
      if (!Array.isArray(paths)) return { trashed: [], error: 'Nothing was selected.' }
      return scanner.trashMany(paths.filter((entry): entry is string => typeof entry === 'string'))
    })
    ipcMain.handle('folder:open', (_event, filePath: unknown) => {
      if (typeof filePath !== 'string') return { ok: false, error: 'That path is not one Stow measured.' }
      return scanner.openFolder(filePath)
    })
    ipcMain.handle('icons:files', (_event, paths: unknown) => {
      if (!Array.isArray(paths)) return {}
      return fileIcons(paths.filter((entry): entry is string => typeof entry === 'string').slice(0, 80))
    })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    scanner.stop()
    closeStore()
    app.quit()
  })
}
