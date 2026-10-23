import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ActivityTask,
  AppMeta,
  AssistantResult,
  AssistantTarget,
  FileIconSet,
  FolderResult,
  FolderUpdate,
  ItemInfo,
  SavedScan,
  ScanEvent,
  StowApi,
  ThemeChoice,
  TrashBatchResult,
  TrashResult,
  UpdateDownload,
  UpdateInfo,
  UpdateProgress,
  VolumeInfo
} from '@shared/types'

type Listener<T> = (payload: T) => void

function hub<T>(event: string): (listener: Listener<T>) => () => void {
  const listeners = new Set<Listener<T>>()
  let ready: Promise<UnlistenFn> | undefined
  const ensure = (): Promise<UnlistenFn> => {
    ready ??= listen<T>(event, (message) => {
      for (const listener of listeners) listener(message.payload)
    })
    return ready
  }
  void ensure()
  return (listener) => {
    listeners.add(listener)
    void ensure()
    return () => {
      listeners.delete(listener)
    }
  }
}

const onEvent = hub<ScanEvent>('scan:event')
const onFolderUpdate = hub<FolderUpdate>('folder:update')
const onUpdateProgress = hub<UpdateProgress>('update:progress')
const onUpdateRequested = hub<undefined>('update:requested')
const onActivity = hub<ActivityTask[]>('activity:update')

const api: StowApi = {
  meta: () => invoke<AppMeta>('meta'),
  getVolume: () => invoke<VolumeInfo>('getVolume'),
  loadScan: () => invoke<SavedScan | null>('loadScan'),
  emptyTrash: () => invoke<TrashResult>('emptyTrash'),
  scan: () => invoke<{ started: boolean }>('scan'),
  reveal: (filePath) => invoke<void>('reveal', { path: filePath }),
  trash: (filePath) => invoke<TrashResult>('trash', { path: filePath }),
  trashMany: (paths) => invoke<TrashBatchResult>('trashMany', { paths }),
  openFolder: (filePath) => invoke<FolderResult>('openFolder', { path: filePath }),
  goTo: (filePath) => invoke<FolderResult>('goTo', { path: filePath }),
  onFolderUpdate,
  pickFolder: () => invoke<string | null>('pickFolder'),
  info: (filePath) => invoke<ItemInfo | null>('info', { path: filePath }),
  setTheme: (choice: ThemeChoice) => invoke<void>('setTheme', { choice }),
  checkUpdate: () => invoke<UpdateInfo | null>('checkUpdate'),
  downloadUpdate: () => invoke<UpdateDownload>('downloadUpdate'),
  openDownloaded: (file) => invoke<void>('openDownloaded', { file }),
  openReleasePage: () => invoke<void>('openReleasePage'),
  onUpdateProgress,
  onUpdateRequested: (listener) => onUpdateRequested(() => listener()),
  fileIcons: (paths) => invoke<Record<string, FileIconSet>>('fileIcons', { paths }),
  ask: (target: AssistantTarget, prompt: string) => invoke<AssistantResult>('ask', { target, prompt }),
  onEvent,
  activity: () => invoke<ActivityTask[]>('activity'),
  onActivity
}

window.stow = api
