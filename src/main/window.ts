import { app, BrowserWindow, nativeImage, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export function iconFile(): string | null {
  const candidates = [path.join(app.getAppPath(), 'build/icon.png'), path.join(__dirname, '../../build/icon.png')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export function installIcon(): void {
  const file = iconFile()
  if (!file || process.platform !== 'darwin' || !app.dock) return
  const image = nativeImage.createFromPath(file)
  if (!image.isEmpty()) app.dock.setIcon(image)
}

// Matches --fog in the renderer's light and dark palettes, so the window never flashes the wrong colour.
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0E1520' : '#E4EDF6'
}

export function createWindow(): void {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Stow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 23 },
    backgroundColor: windowBackground(),
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
