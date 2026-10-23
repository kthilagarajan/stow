import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppMeta,
  AssistantResult,
  AssistantTarget,
  FolderResult,
  ItemInfo,
  SavedScan,
  ScanEvent,
  StowApi,
  ThemeChoice,
  UpdateDownload,
  UpdateInfo,
  UpdateProgress,
  TrashBatchResult,
  TrashResult,
  VolumeInfo
} from '../shared/types'
import { IPC } from '../shared/ipc'

const api: StowApi = {
  meta: () => ipcRenderer.invoke(IPC.meta) as Promise<AppMeta>,
  getVolume: () => ipcRenderer.invoke(IPC.volume) as Promise<VolumeInfo>,
  loadScan: () => ipcRenderer.invoke(IPC.loadScan) as Promise<SavedScan | null>,
  emptyTrash: () => ipcRenderer.invoke(IPC.emptyTrash) as Promise<TrashResult>,
  scan: () => ipcRenderer.invoke(IPC.startScan) as Promise<{ started: boolean }>,
  reveal: (filePath) => ipcRenderer.invoke(IPC.reveal, filePath) as Promise<void>,
  trash: (filePath) => ipcRenderer.invoke(IPC.trash, filePath) as Promise<TrashResult>,
  trashMany: (paths) => ipcRenderer.invoke(IPC.trashMany, paths) as Promise<TrashBatchResult>,
  openFolder: (filePath) => ipcRenderer.invoke(IPC.openFolder, filePath) as Promise<FolderResult>,
  goTo: (filePath) => ipcRenderer.invoke(IPC.goTo, filePath) as Promise<FolderResult>,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder) as Promise<string | null>,
  info: (filePath) => ipcRenderer.invoke(IPC.info, filePath) as Promise<ItemInfo | null>,
  setTheme: (choice: ThemeChoice) => ipcRenderer.invoke(IPC.setTheme, choice) as Promise<void>,
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate) as Promise<UpdateInfo | null>,
  downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate) as Promise<UpdateDownload>,
  openDownloaded: (file: string) => ipcRenderer.invoke(IPC.openDownloaded, file) as Promise<void>,
  openReleasePage: () => ipcRenderer.invoke(IPC.openReleasePage) as Promise<void>,
  onUpdateProgress: (listener) => {
    const wrapped = (_event: IpcRendererEvent, progress: UpdateProgress) => listener(progress)
    ipcRenderer.on(IPC.updateProgress, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC.updateProgress, wrapped)
    }
  },
  onUpdateRequested: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(IPC.updateRequested, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC.updateRequested, wrapped)
    }
  },
  fileIcons: (paths) => ipcRenderer.invoke(IPC.fileIcons, paths) as Promise<Record<string, string>>,
  ask: (target: AssistantTarget, prompt: string) => ipcRenderer.invoke(IPC.ask, target, prompt) as Promise<AssistantResult>,
  onEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: ScanEvent) => listener(payload)
    ipcRenderer.on(IPC.scanEvent, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC.scanEvent, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('stow', api)
