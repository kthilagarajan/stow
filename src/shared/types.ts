export type Verdict = 'mandatory' | 'keep' | 'optional' | 'clear'

export interface VolumeInfo {
  name: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

export type EntryKind = 'folder' | 'file' | 'app'

export interface StorageChild {
  name: string
  path: string
  bytes: number
  verdict: Verdict
  summary: string
  trashable: boolean
  kind?: EntryKind
}

export interface StorageItem {
  id: string
  title: string
  path: string
  bytes: number
  verdict: Verdict
  group: string
  summary: string
  detail: string
  children: StorageChild[]
  trashable: boolean
  liftFromParent: boolean
  shadow: boolean
  complete: boolean
  limited: boolean
}

export interface ScanEvent {
  type: 'start' | 'status' | 'item' | 'done' | 'error'
  total?: number
  completed?: number
  message?: string
  item?: StorageItem
  limited?: number
}

export interface TrashResult {
  ok: boolean
  error?: string
  // Size Stow had measured for what moved, when it knew one.
  bytes?: number
}

export interface TrashTarget {
  path: string
  title: string
  verdict: Verdict
  summary: string
  bytes?: number
}

export interface TrashBatchResult {
  trashed: string[]
  error?: string
  // Measured sizes of the paths that actually moved. Paths inside one of them are left out.
  sizes?: Record<string, number>
}

export interface SavedScan {
  scannedAt: number
  limited: number
  items: StorageItem[]
}

export interface FolderEntry {
  name: string
  path: string
  bytes: number
  kind: EntryKind
  verdict: Verdict
  summary: string
  trashable: boolean
}

export interface FolderListing {
  path: string
  name: string
  bytes: number
  verdict: Verdict
  summary: string
  trashable: boolean
  entries: FolderEntry[]
  smallerCount: number
  smallerBytes: number
  limited: boolean
}

export type FolderResult = { ok: true; listing: FolderListing } | { ok: false; error: string }

export type AssistantTarget = 'copy' | 'chatgpt' | 'claude' | 'cursor' | 'codex'

export interface AssistantResult {
  ok: boolean
  notice?: string
  error?: string
}

export interface AppMeta {
  version: string
}

export interface ItemInfo {
  modified: number
  created: number | null
  opened: number | null
  items: number | null
  hidden: boolean
  link: boolean
}

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface UpdateInfo {
  version: string
  // Release notes as written on GitHub, shown as plain text.
  notes: string
  pageUrl: string
  // The disk image for this Mac's architecture, when the release has one.
  asset: { name: string; url: string; bytes: number } | null
}

export type UpdateProgress = { received: number; total: number }

export type UpdateDownload = { ok: true; file: string } | { ok: false; error: string }

export interface StowApi {
  meta: () => Promise<AppMeta>
  getVolume: () => Promise<VolumeInfo>
  loadScan: () => Promise<SavedScan | null>
  emptyTrash: () => Promise<TrashResult>
  scan: () => Promise<{ started: boolean }>
  reveal: (filePath: string) => Promise<void>
  trash: (filePath: string) => Promise<TrashResult>
  trashMany: (paths: string[]) => Promise<TrashBatchResult>
  openFolder: (filePath: string) => Promise<FolderResult>
  goTo: (filePath: string) => Promise<FolderResult>
  pickFolder: () => Promise<string | null>
  info: (filePath: string) => Promise<ItemInfo | null>
  setTheme: (choice: ThemeChoice) => Promise<void>
  checkUpdate: () => Promise<UpdateInfo | null>
  downloadUpdate: () => Promise<UpdateDownload>
  openDownloaded: (file: string) => Promise<void>
  openReleasePage: () => Promise<void>
  onUpdateProgress: (listener: (progress: UpdateProgress) => void) => () => void
  // The app menu's Check for Updates… item.
  onUpdateRequested: (listener: () => void) => () => void
  fileIcons: (paths: string[]) => Promise<Record<string, string>>
  ask: (target: AssistantTarget, prompt: string) => Promise<AssistantResult>
  onEvent: (listener: (event: ScanEvent) => void) => () => void
}
