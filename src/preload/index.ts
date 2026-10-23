import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FolderResult, ScanEvent, StowApi, TrashResult, VolumeInfo } from '../shared/types'

const api: StowApi = {
  getVolume: () => ipcRenderer.invoke('volume:get') as Promise<VolumeInfo>,
  scan: () => ipcRenderer.invoke('scan:start') as Promise<{ started: boolean }>,
  reveal: (filePath) => ipcRenderer.invoke('item:reveal', filePath) as Promise<void>,
  trash: (filePath) => ipcRenderer.invoke('item:trash', filePath) as Promise<TrashResult>,
  openFolder: (filePath) => ipcRenderer.invoke('folder:open', filePath) as Promise<FolderResult>,
  fileIcons: (paths) => ipcRenderer.invoke('icons:files', paths) as Promise<Record<string, string>>,
  onEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: ScanEvent) => listener(payload)
    ipcRenderer.on('scan:event', wrapped)
    return () => {
      ipcRenderer.removeListener('scan:event', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('stow', api)
