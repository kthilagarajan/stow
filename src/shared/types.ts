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
}

export interface TrashTarget {
  path: string
  title: string
  verdict: Verdict
  summary: string
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

export interface StowApi {
  getVolume: () => Promise<VolumeInfo>
  scan: () => Promise<{ started: boolean }>
  reveal: (filePath: string) => Promise<void>
  trash: (filePath: string) => Promise<TrashResult>
  openFolder: (filePath: string) => Promise<FolderResult>
  fileIcons: (paths: string[]) => Promise<Record<string, string>>
  onEvent: (listener: (event: ScanEvent) => void) => () => void
}
