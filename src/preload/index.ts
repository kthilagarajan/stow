import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AppMeta, FolderResult, SavedScan, ScanEvent, StowApi, TrashBatchResult, TrashResult, VolumeInfo } from '../shared/types'

const api: StowApi = {
  meta: () => ipcRenderer.invoke('app:meta') as Promise<AppMeta>,
  getVolume: () => ipcRenderer.invoke('volume:get') as Promise<VolumeInfo>,
  loadScan: () => ipcRenderer.invoke('scan:load') as Promise<SavedScan | null>,
  emptyTrash: () => ipcRenderer.invoke('trash:empty') as Promise<TrashResult>,
  scan: () => ipcRenderer.invoke('scan:start') as Promise<{ started: boolean }>,
  reveal: (filePath) => ipcRenderer.invoke('item:reveal', filePath) as Promise<void>,
  trash: (filePath) => ipcRenderer.invoke('item:trash', filePath) as Promise<TrashResult>,
  trashMany: (paths) => ipcRenderer.invoke('item:trash-many', paths) as Promise<TrashBatchResult>,
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
