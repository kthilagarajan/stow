export type Verdict = 'mandatory' | 'keep' | 'optional' | 'clear'

export interface VolumeInfo {
  name: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

export type EntryKind = 'folder' | 'file' | 'app'

export interface SavedFolderEntry {
  name: string
  path: string
  bytes: number
  kind: EntryKind
  sized: boolean
}

// A folder Stow has listed, including sizes that are still arriving. Stored so leaving the folder does not throw the work away.
export interface SavedFolder {
  path: string
  bytes: number
  limited: boolean
  complete: boolean
  entries: SavedFolderEntry[]
}

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
  // False while this row's size is still on its way. bytes is 0 until then.
  measured: boolean
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
  // True until sizes for this visit have finished arriving.
  measuring: boolean
  // Ties a listing to the measurement that produced it, so a slower older pass cannot overwrite a newer one.
  token: number
}

// A batch of sizes for a folder that is already on screen, or the finished list.
export interface FolderUpdate {
  path: string
  token: number
  bytes: number
  sizes: { path: string; bytes: number }[]
  entries: FolderEntry[] | null
  smallerCount: number
  smallerBytes: number
  measuring: boolean
  limited: boolean
}

// Finder icons drawn for both appearances. The window picks one from the current theme.
export interface FileIconSet {
  light: string
  dark: string
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
  // The zipped app for this Mac's architecture, when the release has one.
  asset: { name: string; url: string; bytes: number } | null
}

export type UpdateProgress = { received: number; total: number }

export type ActivityKind =
  | 'scan'
  | 'folder'
  | 'trash'
  | 'empty-bin'
  | 'volume'
  | 'saved'
  | 'info'
  | 'icons'
  | 'update'
  | 'download'
  | 'tools'
  | 'tool-clean'

// Work running in the background. The window words it from `kind`; `target` is a name as it is on disk.
export interface ActivityTask {
  id: number
  kind: ActivityKind
  target?: string
  done?: number
  total?: number
  startedAt: number
}

export type DevToolId = 'docker' | 'npm' | 'pnpm' | 'yarn' | 'homebrew' | 'pip' | 'go' | 'simulators'

// A developer tool that can clean up after itself. Stow runs only the fixed `command` for each one.
export interface DevTool {
  id: DevToolId
  name: string
  installed: boolean
  // The cleanup can run now (Docker, for example, has to be open).
  ready: boolean
  bytes: number | null
  // 'frees' when bytes is what the cleanup removes; 'holds' when it is everything the tool keeps.
  estimate: 'frees' | 'holds'
  note: string | null
  summary: string
  detail: string
  command: string
}

export interface DevCleanResult {
  ok: boolean
  error?: string
  // What the tool printed, trimmed to the end.
  output: string
  tool: DevTool | null
}

export type UpdateResult = { ok: true } | { ok: false; error: string }

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
  onFolderUpdate: (listener: (update: FolderUpdate) => void) => () => void
  pickFolder: () => Promise<string | null>
  info: (filePath: string) => Promise<ItemInfo | null>
  setTheme: (choice: ThemeChoice) => Promise<void>
  checkUpdate: () => Promise<UpdateInfo | null>
  // Downloads, checks and unpacks the update; installUpdate then swaps it in and restarts Stow.
  downloadUpdate: () => Promise<UpdateResult>
  installUpdate: () => Promise<UpdateResult>
  openReleasePage: () => Promise<void>
  onUpdateProgress: (listener: (progress: UpdateProgress) => void) => () => void
  // The app menu's Check for Updates… item.
  onUpdateRequested: (listener: () => void) => () => void
  fileIcons: (paths: string[]) => Promise<Record<string, FileIconSet>>
  ask: (target: AssistantTarget, prompt: string) => Promise<AssistantResult>
  onEvent: (listener: (event: ScanEvent) => void) => () => void
  activity: () => Promise<ActivityTask[]>
  onActivity: (listener: (tasks: ActivityTask[]) => void) => () => void
  devTools: () => Promise<DevTool[]>
  cleanDevTool: (id: DevToolId) => Promise<DevCleanResult>
}
