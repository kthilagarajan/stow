import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { isDemo } from './demo'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { Scanner } from './scanner'
import { closeStore, openStore, persistTrash, readScan, writeScan } from './store'
import { createWindow, iconFile, installIcon } from './window'

const scanner = new Scanner()

app.setName('Stow')
// Demo mode keeps its own profile, so it never reads or overwrites a real saved scan.
if (isDemo) app.setPath('userData', path.join(app.getPath('temp'), 'stow-demo'))

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
    registerIpc(scanner)
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
