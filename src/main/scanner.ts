import type { ChildProcess } from 'node:child_process'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shell, type WebContents } from 'electron'
import { classifyEntry, classifyLargeFile } from './classify'
import { discoverRoots, type RootSpec } from './catalog'
import { describeChild } from './describe'
import { runCommand, streamCommand } from './exec'
import { IPC } from '../shared/ipc'
import { applyTrash } from '../shared/items'
import { lookupRecord, pathKeys, stricterVerdict, trashDecision, type TrashRecord } from './guard'
import type {
  EntryKind,
  FolderEntry,
  FolderResult,
  FolderUpdate,
  SavedFolder,
  ScanEvent,
  StorageChild,
  StorageItem,
  TrashBatchResult,
  TrashResult,
  Verdict
} from '../shared/types'

const LARGE_FILE_BYTES = 500_000_000
const PREVIEW_CHILDREN = 16
const SHOW_CAP = 500
const FILE_ROOTS = new Set(['downloads', 'desktop', 'trash'])
const HEAVY_IDS = new Set([
  'pictures',
  'movies',
  'music',
  'mail',
  'messages',
  'icloud',
  'documents',
  'app-support',
  'applications',
  'caches',
  'simulators',
  'homebrew',
  'homebrew-intel',
  'docker',
  'android',
  'ios-backups'
])

interface MeasuredEntry {
  name: string
  path: string
  bytes: number
  kind: EntryKind
  // False until this row's size has actually been read. A 0 then means empty, not "still waiting".
  sized?: boolean
}

interface RunningJob {
  path: string
  token: number
  generation: number
  self: { verdict: Verdict; trashable: boolean; summary: string }
  entries: MeasuredEntry[]
  bytes: number
  limited: boolean
  measuring: boolean
  // True once du has reported this folder's own total, so child updates must not replace it.
  bytesFromDu: boolean
  saveTimer: NodeJS.Timeout | null
  sender?: WebContents
}

interface CachedListing {
  path: string
  bytes: number
  entries: MeasuredEntry[]
  limited: boolean
  complete: boolean
  // True when entries are every file and folder, not only what the scan previewed.
  full: boolean
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  let index = 0
  async function worker(): Promise<void> {
    for (;;) {
      const current = index
      index += 1
      if (current >= items.length) return
      await fn(items[current] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
}

function parseDu(stdout: string, rootPath: string): { total: number; dirs: { path: string; bytes: number }[] } {
  const dirs: { path: string; bytes: number }[] = []
  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const blocks = Number(line.slice(0, tab))
    const entryPath = line.slice(tab + 1)
    if (!Number.isFinite(blocks) || !entryPath) continue
    dirs.push({ path: entryPath, bytes: blocks * 1024 })
  }
  const resolvedRoot = path.resolve(rootPath)
  const rootLine = dirs.find((entry) => path.resolve(entry.path) === resolvedRoot) ?? dirs.at(-1)
  return {
    total: rootLine?.bytes ?? 0,
    dirs: dirs.filter((entry) => entry !== rootLine)
  }
}

function limitedOutput(stderr: string): boolean {
  return /permission denied|operation not permitted/i.test(stderr)
}

function entryKind(name: string, file: boolean): EntryKind {
  if (file) return 'file'
  if (name.toLowerCase().endsWith('.app')) return 'app'
  return 'folder'
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

// Undefined when du never reported this row, so a partial walk is not stored as 0 KB.
function recordedSize(entry: MeasuredEntry, files: Map<string, number>, dirs: Map<string, number>): number | undefined {
  if (entry.kind === 'file') return files.has(entry.path) ? files.get(entry.path) : undefined
  const resolved = path.resolve(entry.path)
  if (dirs.has(resolved)) return dirs.get(resolved)
  const base = path.basename(entry.path)
  let found: number | undefined
  for (const [key, value] of dirs) {
    if (path.basename(key) !== base) continue
    if (found !== undefined) return undefined
    found = value
  }
  return found
}

function isHeavy(spec: RootSpec): boolean {
  return HEAVY_IDS.has(spec.id) || spec.id.startsWith('xcode:')
}

function validPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && filePath.length > 0 && filePath.length <= 4096 && !filePath.includes('\0')
}

export interface TrashedPath {
  path: string
  bytes: number
}

export class Scanner {
  private generation = 0
  private processes = new Set<ChildProcess>()
  private registry = new Map<string, TrashRecord>()
  private listings = new Map<string, CachedListing>()
  // Folder listings the person has opened. Kept apart from the scan so a rescan cannot wipe them.
  private folders = new Map<string, CachedListing>()
  private running = new Map<string, RunningJob>()
  private sizes = new Map<string, number>()
  private saveFolder?: (folder: SavedFolder) => void
  private removeFolder?: (folderPath: string) => void
  private listener?: WebContents
  private groups = new Set<ChildProcess>()
  private emitted: StorageItem[] = []
  private removed = new Set<string>()
  private home = os.homedir()
  private listingTokens = new Map<string, number>()
  private publish: ((items: StorageItem[], limited: number) => void) | null = null
  private rememberTrash: ((moved: TrashedPath[]) => void) | null = null

  setPublisher(publish: (items: StorageItem[], limited: number) => void): void {
    this.publish = publish
  }

  setTrashRecorder(remember: (moved: TrashedPath[]) => void): void {
    this.rememberTrash = remember
  }

  setFolderStore(save: (folder: SavedFolder) => void, remove: (folderPath: string) => void): void {
    this.saveFolder = save
    this.removeFolder = remove
  }

  hydrateFolders(saved: SavedFolder[]): void {
    for (const folder of saved) {
      if (!folder.path || folder.entries.length === 0 && folder.bytes === 0 && !folder.complete) continue
      const listing: CachedListing = {
        path: folder.path,
        bytes: folder.bytes,
        limited: folder.limited,
        complete: folder.complete,
        full: true,
        entries: folder.entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          bytes: entry.bytes,
          kind: entry.kind,
          sized: folder.complete || entry.sized
        }))
      }
      this.rememberFolder(listing)
      if (folder.complete && folder.bytes > 0) this.noteSize(folder.path, folder.bytes)
      for (const entry of listing.entries) {
        if (entry.sized && entry.bytes > 0) this.noteSize(entry.path, entry.bytes)
      }
    }
  }

  hydrate(items: StorageItem[]): void {
    for (const item of items) this.register(item)
  }

  stop(): void {
    this.generation += 1
    for (const child of this.processes) this.stopChild(child)
    this.processes.clear()
  }

  async start(sender: WebContents): Promise<{ started: boolean }> {
    this.stop()
    const generation = this.generation
    this.registry.clear()
    this.listings.clear()
    this.listingTokens.clear()
    this.dropRunning()
    this.sizes.clear()
    this.emitted = []
    this.removed.clear()
    this.home = os.homedir()
    const current = () => generation === this.generation

    if (process.platform !== 'darwin') {
      this.emit(sender, generation, { type: 'error', message: 'Stow reads disks on macOS.' })
      return { started: false }
    }

    const specs = await discoverRoots(this.home)
    if (!current()) return { started: false }
    const light = specs.filter((spec) => !isHeavy(spec))
    const heavy = specs.filter((spec) => isHeavy(spec))
    const total = specs.length + 2
    let completed = 0
    let limited = 0
    this.emit(sender, generation, { type: 'start', total, completed, message: 'Starting the scan' })

    const measureOne = async (spec: RootSpec): Promise<void> => {
      if (!current()) return
      this.emit(sender, generation, {
        type: 'status',
        message: `Measuring ${spec.title}`,
        completed,
        total
      })
      try {
        const item = await this.measure(spec, generation)
        if (!current() || !item) return
        if (item.limited || !item.complete) limited += 1
        this.register(item)
        this.note(item)
        this.emit(sender, generation, { type: 'item', item })
      } catch {
        limited += 1
      } finally {
        completed += 1
      }
    }

    await pool(light, 4, measureOne)
    if (!current()) return { started: false }
    await pool(heavy, 2, measureOne)

    if (!current()) return { started: false }
    this.emit(sender, generation, {
      type: 'status',
      message: 'Looking for project dependencies',
      completed,
      total
    })
    const dependencies = await this.findDependencies(generation)
    if (dependencies) {
      this.register(dependencies)
      this.note(dependencies)
      this.emit(sender, generation, { type: 'item', item: dependencies })
    }
    completed += 1

    if (!current()) return { started: false }
    this.emit(sender, generation, {
      type: 'status',
      message: 'Looking for large files',
      completed,
      total
    })
    const large = await this.findLargeFiles(generation)
    for (const item of large) {
      this.register(item)
      this.note(item)
      this.emit(sender, generation, { type: 'item', item })
    }
    completed += 1
    let snapshot = this.emitted
    for (const filePath of this.removed) snapshot = applyTrash(snapshot, filePath)
    try {
      this.publish?.(snapshot, limited)
    } catch {
      // The scan is still shown. The next successful scan writes the database.
    }
    this.emit(sender, generation, { type: 'done', limited, completed, total, message: 'Scan finished' })
    return { started: true }
  }

  async reveal(filePath: string): Promise<void> {
    const real = await this.real(filePath)
    if (!real || !this.owner(real)) return
    shell.showItemInFolder(real)
  }

  async trash(filePath: string, options?: { persist?: boolean }): Promise<TrashResult> {
    const real = await this.real(filePath)
    if (!real) return { ok: false, error: 'That path is no longer there.' }
    const record = lookupRecord(this.registry, filePath) ?? lookupRecord(this.registry, real)
    const decision = trashDecision(real, this.home, record)
    if (!decision.ok) return decision
    const bytes = this.measuredSize(real)
    try {
      await shell.trashItem(real)
    } catch {
      return { ok: false, error: 'macOS did not move it. It may be in use, or protected.' }
    }
    this.forget(real)
    this.removed.add(filePath)
    this.removed.add(real)
    if (options?.persist !== false) {
      try {
        this.rememberTrash?.([{ path: filePath, bytes: bytes ?? 0 }])
      } catch {
        return { ok: true, bytes }
      }
    }
    return { ok: true, bytes }
  }

  async trashMany(paths: string[]): Promise<TrashBatchResult> {
    const unique = [
      ...new Set(paths.filter((filePath) => typeof filePath === 'string' && filePath.length > 0 && filePath.length <= 4096))
    ].slice(0, 200)
    unique.sort((a, b) => a.length - b.length)
    const trashed: string[] = []
    const covered: string[] = []
    const sizes: Record<string, number> = {}
    let error: string | undefined
    for (const filePath of unique) {
      if (covered.some((parent) => filePath === parent || filePath.startsWith(`${parent}/`))) {
        trashed.push(filePath)
        continue
      }
      const result = await this.trash(filePath, { persist: false })
      if (result.ok) {
        trashed.push(filePath)
        covered.push(filePath)
        if (result.bytes !== undefined) sizes[filePath] = result.bytes
      } else if (!error) error = result.error
    }
    if (trashed.length > 0) {
      try {
        this.rememberTrash?.(covered.map((filePath) => ({ path: filePath, bytes: sizes[filePath] ?? 0 })))
      } catch {
        // The files are already in the Trash. The list updates in the window.
      }
    }
    return { trashed, error, sizes }
  }

  async emptyTrash(): Promise<TrashResult> {
    if (process.platform !== 'darwin') return { ok: false, error: 'Stow empties the Trash on macOS.' }
    const result = await runCommand(
      'osascript',
      ['-e', 'tell application "Finder" to empty trash'],
      180_000,
      this.track,
      this.release,
      () => true
    )
    if (result.code !== 0) {
      return { ok: false, error: 'Finder did not empty the Trash. Nothing was permanently deleted.' }
    }
    this.forget(path.join(this.home, '.Trash'))
    return { ok: true }
  }

  // A folder the person typed or picked. Outside the scanned places it starts as "keep", so only the
  // caches, installers, and dependencies Stow recognises inside it can go to the Trash.
  async goTo(filePath: string, sender?: WebContents): Promise<FolderResult> {
    if (!validPath(filePath)) return { ok: false, error: 'Type a folder path, like ~/Projects.' }
    const expanded = filePath.trim().replace(/^~(?=$|\/)/, this.home)
    if (!path.isAbsolute(expanded)) return { ok: false, error: 'Start the path with / or ~/.' }
    const real = await this.real(expanded)
    if (!real) return { ok: false, error: 'There is no folder at that path.' }
    try {
      if (!(await fs.stat(real)).isDirectory()) return { ok: false, error: 'That is a file. Pick the folder it sits in.' }
    } catch {
      return { ok: false, error: 'There is no folder at that path.' }
    }
    if (!this.owner(real)) this.addRecord(real, { verdict: 'keep', trashable: false })
    return this.openFolder(real, sender)
  }

  // Names come back immediately. Sizes follow on folder:update so the window is not stuck on du.
  async openFolder(filePath: string, sender?: WebContents): Promise<FolderResult> {
    if (!validPath(filePath)) return { ok: false, error: 'That path is not one Stow measured.' }
    const real = await this.real(filePath)
    if (!real) return { ok: false, error: 'That folder is no longer there.' }
    const generation = this.generation
    const owner = this.owner(real)
    if (!owner) return { ok: false, error: 'Stow has not measured that folder yet.' }

    let info: { isDirectory: () => boolean }
    try {
      info = await fs.lstat(real)
    } catch {
      return { ok: false, error: 'That folder is no longer there.' }
    }
    if (!info.isDirectory()) return { ok: false, error: 'That is a file. Reveal it in Finder to open it.' }

    const self = owner.exact
      ? { verdict: owner.verdict, trashable: owner.trashable, summary: 'Files and folders inside this one, largest first.' }
      : classifyEntry(path.basename(real), real, owner)
    if (!owner.exact) this.addRecord(real, self)

    if (sender && !sender.isDestroyed()) this.listener = sender
    const running = this.running.get(real)
    if (running && running.generation === this.generation) {
      if (sender && !sender.isDestroyed()) running.sender = sender
      return this.jobResult(running)
    }

    const saved = this.folderListing(real)
    if (saved?.full && saved.complete) return this.listingResult(real, self, saved, false, 0)

    const preview = await this.previewEntries(real)
    if (generation !== this.generation) return { ok: false, error: 'The scan started again. Open the folder once it finishes.' }
    if (!preview) return { ok: false, error: 'Stow could not read that folder.' }
    if (saved?.full) this.reuseSizes(preview, saved.entries)

    const already = this.running.get(real)
    if (already && already.generation === this.generation) {
      if (sender && !sender.isDestroyed()) already.sender = sender
      return this.jobResult(already)
    }

    const known = saved?.bytes || this.knownSize(real) || 0
    if (preview.length === 0) {
      return this.listingResult(real, self, { path: real, bytes: known, entries: [], limited: false, complete: true, full: true }, false, 0)
    }

    const token = (this.listingTokens.get(real) ?? 0) + 1
    this.listingTokens.set(real, token)
    const job: RunningJob = {
      path: real,
      token,
      generation,
      self,
      entries: preview,
      bytes: known,
      limited: saved?.limited ?? false,
      measuring: true,
      bytesFromDu: false,
      saveTimer: null,
      sender
    }
    this.running.set(real, job)
    for (const entry of preview) {
      const listed = this.toFolderEntry(entry, self, entry.sized === true)
      this.addRecord(listed.path, listed)
    }
    const task = this.measureFolder(real, job)
    if (!sender || sender.isDestroyed()) return (await task) ?? this.jobResult(job)
    void task.catch(() => undefined)
    return this.jobResult(job)
  }

  private jobResult(job: RunningJob): Extract<FolderResult, { ok: true }> {
    return this.listingResult(
      job.path,
      job.self,
      { path: job.path, bytes: job.bytes, entries: job.entries, limited: job.limited, complete: !job.measuring, full: true },
      job.measuring,
      job.token
    )
  }

  private listingResult(
    real: string,
    self: { verdict: Verdict; trashable: boolean; summary: string },
    measured: CachedListing,
    measuring: boolean,
    token: number
  ): Extract<FolderResult, { ok: true }> {
    const entries = measured.entries
      .map((entry) => {
        let bytes = entry.bytes
        let sized = entry.sized === true
        if (!sized) {
          const known = this.knownSize(entry.path)
          if (known !== undefined) {
            bytes = known
            sized = true
          }
        }
        return this.toFolderEntry({ ...entry, bytes }, self, sized)
      })
      .sort((a, b) => (measuring ? byName(a, b) : b.bytes - a.bytes || byName(a, b)))
    const shown = entries.slice(0, SHOW_CAP)
    const rest = entries.slice(SHOW_CAP)
    return {
      ok: true,
      listing: {
        path: real,
        name: path.basename(real) || real,
        bytes: measured.bytes,
        verdict: self.verdict,
        summary: self.summary,
        trashable: self.trashable,
        entries: shown,
        smallerCount: rest.length,
        smallerBytes: rest.reduce((sum, entry) => sum + entry.bytes, 0),
        limited: measured.limited,
        measuring,
        token
      }
    }
  }

  private async previewEntries(folder: string): Promise<MeasuredEntry[] | null> {
    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return null
    }
    const entries: MeasuredEntry[] = []
    for (const dirent of dirents) {
      if (!dirent.name || dirent.name === '.' || dirent.name === '..') continue
      const directory = dirent.isDirectory()
      entries.push({
        name: dirent.name,
        path: path.join(folder, dirent.name),
        bytes: 0,
        kind: entryKind(dirent.name, !directory),
        sized: false
      })
    }
    return entries
  }

  // Keeps running when the person opens another folder. A second open of this path joins the same job.
  private async measureFolder(folder: string, job: RunningJob): Promise<FolderResult | null> {
    const token = job.token
    const current = () => this.generation === job.generation && this.running.get(folder) === job
    const directories = job.entries.filter((entry) => entry.kind !== 'file' && !entry.sized)
    const files = job.entries.filter((entry) => entry.kind === 'file' && !entry.sized)
    const dirSizes = new Map<string, number>()
    const fileSizes = new Map<string, number>()
    for (const entry of job.entries) {
      if (!entry.sized) continue
      if (entry.kind === 'file') fileSizes.set(entry.path, entry.bytes)
      else dirSizes.set(path.resolve(entry.path), entry.bytes)
    }
    const previewPaths = new Map(job.entries.map((entry) => [path.resolve(entry.path), entry]))
    let pendingLine = ''
    let batch: { path: string; bytes: number }[] = []
    let flushTimer: NodeJS.Timeout | null = null
    let closed = false

    const emit = (measuring: boolean, entries: FolderEntry[] | null, smallerCount = 0, smallerBytes = 0): void => {
      if ((closed && measuring) || !current()) return
      if (measuring) this.scheduleSave(job)
      const sender = job.sender
      if (!sender || sender.isDestroyed()) return
      const sizes = batch
      batch = []
      const update: FolderUpdate = {
        path: folder,
        token,
        bytes: job.bytes,
        sizes,
        entries,
        smallerCount,
        smallerBytes,
        measuring,
        limited: job.limited
      }
      sender.send(IPC.folderUpdate, update)
    }

    const queue = (entry: MeasuredEntry, bytes: number): void => {
      entry.bytes = bytes
      entry.sized = true
      if (entry.kind === 'file') fileSizes.set(entry.path, bytes)
      else dirSizes.set(path.resolve(entry.path), bytes)
      batch.push({ path: entry.path, bytes })
      if (batch.length >= 40) {
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        emit(true, null)
        return
      }
      if (flushTimer) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        if (batch.length > 0) emit(true, null)
      }, 80)
    }

    const takeDu = (text: string): void => {
      pendingLine += text
      let nl = pendingLine.indexOf('\n')
      while (nl >= 0) {
        const line = pendingLine.slice(0, nl).trim()
        pendingLine = pendingLine.slice(nl + 1)
        nl = pendingLine.indexOf('\n')
        const cleaned = line.replace(/^[^\d]+/, '')
        const tab = cleaned.indexOf('\t')
        if (tab <= 0) continue
        const blocks = Number(cleaned.slice(0, tab))
        const entryPath = cleaned.slice(tab + 1).trim()
        if (!Number.isFinite(blocks) || !entryPath) continue
        const bytes = blocks * 1024
        const resolved = path.resolve(entryPath)
        if (resolved === path.resolve(folder)) {
          job.bytes = bytes
          job.bytesFromDu = true
          if (flushTimer) clearTimeout(flushTimer)
          flushTimer = null
          emit(true, null)
          continue
        }
        dirSizes.set(resolved, bytes)
        const base = path.basename(resolved)
        const named = job.entries.filter((entry) => entry.kind !== 'file' && path.basename(entry.path) === base)
        const known = previewPaths.get(resolved) ?? (named.length === 1 ? named[0] : undefined)
        if (known && known.kind !== 'file') queue(known, bytes)
      }
    }

    try {
      await Promise.all([
        pool(files, 24, async (file) => {
          if (!current()) return
          try {
            const stat = await fs.lstat(file.path)
            queue(file, stat.isDirectory() ? 0 : stat.size)
          } catch {
            queue(file, 0)
          }
        }),
        directories.length === 0
          ? Promise.resolve()
          : (async () => {
              const runDu = async (): Promise<boolean> => {
                // script gives du a terminal, so each folder is printed when it finishes instead of all at once.
                const result = await streamCommand(
                  'script',
                  ['-q', '/dev/null', 'du', '-d', '1', '-k', folder],
                  120_000,
                  this.track,
                  this.release,
                  current,
                  takeDu,
                  true
                )
                if (pendingLine.trim()) takeDu('\n')
                pendingLine = ''
                job.limited = job.limited || limitedOutput(result.stderr)
                return result.timedOut
              }
              if ((await runDu()) && current()) await runDu()
            })()
      ])
    } catch {
      job.limited = true
    }

    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    closed = true
    if (!current()) return null

    let unresolved = false
    for (const entry of job.entries) {
      if (entry.sized) continue
      const recorded = recordedSize(entry, fileSizes, dirSizes)
      const known = recorded ?? this.knownSize(entry.path)
      if (known === undefined) {
        unresolved = true
        continue
      }
      entry.bytes = known
      entry.sized = true
    }
    if (!job.bytesFromDu) {
      job.bytes = job.entries.reduce((sum, entry) => sum + (entry.sized ? entry.bytes : 0), 0)
    }
    job.entries.sort((a, b) => b.bytes - a.bytes || byName(a, b))
    const complete = !unresolved
    job.measuring = false
    const listing = this.snapshot(job, complete)
    this.rememberFolder(listing)
    for (const entry of job.entries) {
      if (entry.sized) this.noteSize(entry.path, entry.bytes)
    }
    if (complete || job.bytesFromDu) this.bubble(folder, job.bytes)
    this.scheduleSave(job, complete)

    const result = this.listingResult(folder, job.self, listing, false, token)
    for (const entry of result.listing.entries) this.addRecord(entry.path, entry)
    batch = []
    closed = false
    emit(false, result.listing.entries, result.listing.smallerCount, result.listing.smallerBytes)
    closed = true
    if (this.running.get(folder) === job) this.running.delete(folder)
    return result
  }

  // A folder measured by opening it also fills that row in the folder it sits in.
  private bubble(childPath: string, bytes: number): void {
    this.noteSize(childPath, bytes)
    const parentPath = path.dirname(childPath)
    if (!parentPath || parentPath === childPath) return
    const parent = this.running.get(parentPath)
    if (parent && parent.generation === this.generation) {
      const entry = parent.entries.find((item) => item.path === childPath)
      if (!entry) return
      entry.bytes = bytes
      entry.sized = true
      if (!parent.bytesFromDu) {
        parent.bytes = parent.entries.reduce((sum, item) => sum + (item.sized ? item.bytes : 0), 0)
      }
      this.pushSize(parent.sender, parent.path, parent.token, parent.bytes, entry.path, bytes, parent.measuring, parent.limited)
      this.scheduleSave(parent)
      return
    }
    const saved = this.folderListing(parentPath)
    if (!saved || path.resolve(saved.path) !== path.resolve(parentPath)) return
    const row = saved.entries.find((item) => item.path === childPath)
    if (!row) return
    row.bytes = bytes
    row.sized = true
    if (saved.entries.every((item) => item.sized)) saved.complete = true
    const token = this.listingTokens.get(parentPath) ?? 0
    this.pushSize(this.listener, parentPath, token, saved.bytes, childPath, bytes, false, saved.limited)
    try {
      this.saveFolder?.({
        path: saved.path,
        bytes: saved.bytes,
        limited: saved.limited,
        complete: saved.complete,
        entries: saved.entries.map((item) => ({
          name: item.name,
          path: item.path,
          bytes: item.bytes,
          kind: item.kind,
          sized: item.sized === true
        }))
      })
    } catch {
      // The size is still in memory for this visit.
    }
  }

  private pushSize(
    sender: WebContents | undefined,
    folder: string,
    token: number,
    folderBytes: number,
    entryPath: string,
    bytes: number,
    measuring: boolean,
    limited: boolean
  ): void {
    if (!sender || sender.isDestroyed()) return
    const update: FolderUpdate = {
      path: folder,
      token,
      bytes: folderBytes,
      sizes: [{ path: entryPath, bytes }],
      entries: null,
      smallerCount: 0,
      smallerBytes: 0,
      measuring,
      limited
    }
    sender.send(IPC.folderUpdate, update)
  }

  private snapshot(job: RunningJob, complete: boolean): CachedListing {
    return {
      path: job.path,
      bytes: job.bytes,
      entries: job.entries.map((entry) => ({ ...entry })),
      limited: job.limited,
      complete,
      full: true
    }
  }

  private scheduleSave(job: RunningJob, done?: boolean): void {
    const write = (): void => {
      if (job.generation !== this.generation) return
      if (done === undefined && this.running.get(job.path) !== job) return
      const listing = this.snapshot(job, done === true)
      this.rememberFolder(listing)
      try {
        this.saveFolder?.({
          path: listing.path,
          bytes: listing.bytes,
          limited: listing.limited,
          complete: listing.complete,
          entries: listing.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            bytes: entry.bytes,
            kind: entry.kind,
            sized: entry.sized === true
          }))
        })
      } catch {
        // The sizes are still in memory for this visit.
      }
    }
    if (done !== undefined) {
      if (job.saveTimer) clearTimeout(job.saveTimer)
      job.saveTimer = null
      write()
      return
    }
    if (job.saveTimer) return
    job.saveTimer = setTimeout(() => {
      job.saveTimer = null
      write()
    }, 400)
  }

  private rememberFolder(listing: CachedListing): void {
    for (const key of pathKeys(listing.path)) this.folders.set(key, listing)
  }

  private folderListing(filePath: string): CachedListing | undefined {
    for (const key of pathKeys(filePath)) {
      const listing = this.folders.get(key)
      if (listing) return listing
    }
    return undefined
  }

  private reuseSizes(preview: MeasuredEntry[], saved: MeasuredEntry[]): void {
    const prior = new Map(saved.map((entry) => [entry.path, entry]))
    for (const entry of preview) {
      const old = prior.get(entry.path)
      if (!old?.sized) continue
      entry.bytes = old.bytes
      entry.sized = true
    }
  }

  private dropRunning(prefix?: string): void {
    for (const [folder, job] of this.running) {
      const related =
        !prefix || folder === prefix || folder.startsWith(`${prefix}/`) || prefix.startsWith(`${folder}/`)
      if (!related) continue
      if (job.saveTimer) clearTimeout(job.saveTimer)
      job.saveTimer = null
      this.running.delete(folder)
    }
  }

  private emit(sender: WebContents, generation: number, event: ScanEvent): void {
    if (generation !== this.generation) return
    if (sender.isDestroyed()) return
    sender.send(IPC.scanEvent, event)
  }

  private track = (child: ChildProcess, group = false): void => {
    this.processes.add(child)
    if (group) this.groups.add(child)
  }

  private stopChild(child: ChildProcess): void {
    if (this.groups.has(child) && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    } else {
      child.kill('SIGKILL')
    }
    this.groups.delete(child)
  }

  private release = (child: ChildProcess): void => {
    this.processes.delete(child)
    this.groups.delete(child)
  }

  private async real(filePath: string): Promise<string | null> {
    try {
      return await fs.realpath(filePath)
    } catch {
      return null
    }
  }

  private note(item: StorageItem): void {
    this.emitted = [...this.emitted.filter((entry) => entry.id !== item.id), item]
  }

  private register(item: StorageItem): void {
    const childPaths = new Set(item.children.map((child) => path.normalize(child.path)))
    if (item.path && !childPaths.has(path.normalize(item.path))) this.addRecord(item.path, item)
    for (const child of item.children) this.addRecord(child.path, child)
  }

  private addRecord(filePath: string, record: { verdict: Verdict; trashable: boolean }): void {
    if (!filePath) return
    for (const key of pathKeys(filePath)) {
      const existing = this.registry.get(key)
      if (!existing) {
        this.registry.set(key, { verdict: record.verdict, trashable: record.trashable })
        continue
      }
      this.registry.set(key, {
        verdict: stricterVerdict(existing.verdict, record.verdict),
        trashable: existing.trashable && record.trashable
      })
    }
  }

  private owner(filePath: string): (TrashRecord & { exact: boolean }) | null {
    const exact = lookupRecord(this.registry, filePath)
    if (exact) return { ...exact, exact: true }
    let bestKey = ''
    let best: TrashRecord | null = null
    for (const form of pathKeys(filePath)) {
      for (const [key, record] of this.registry) {
        if (form.startsWith(`${key}/`) && key.length > bestKey.length) {
          bestKey = key
          best = record
        }
      }
    }
    if (!best) return null
    return { ...best, exact: false }
  }

  private forget(realPath: string): void {
    const keys = new Set(pathKeys(realPath))
    for (const key of this.registry.keys()) {
      if (keys.has(key) || key.startsWith(`${realPath}/`) || [...keys].some((form) => key.startsWith(`${form}/`))) {
        this.registry.delete(key)
      }
    }
    for (const key of [...this.listings.keys()]) {
      const listing = this.listings.get(key)
      if (!listing) continue
      const listed = pathKeys(listing.path)
      const related = [...keys].some((form) =>
        listed.some((item) => item === form || item.startsWith(`${form}/`) || form.startsWith(`${item}/`))
      )
      if (related) this.listings.delete(key)
    }
    for (const key of [...this.folders.keys()]) {
      const listing = this.folders.get(key)
      if (!listing) continue
      if (listing.path === realPath || listing.path.startsWith(`${realPath}/`) || realPath.startsWith(`${listing.path}/`)) {
        this.folders.delete(key)
      }
    }
    this.dropRunning(realPath)
    try {
      this.removeFolder?.(realPath)
    } catch {
      // The in-memory listing is already gone.
    }
  }

  private noteSize(filePath: string, bytes: number): void {
    for (const key of pathKeys(filePath)) this.sizes.set(key, bytes)
  }

  // The size from the last measurement of this path, either as a measured folder or as a row in its parent's listing.
  private measuredSize(realPath: string): number | undefined {
    const known = this.knownSize(realPath)
    if (known !== undefined) return known
    return this.cachedListing(path.dirname(realPath))?.entries.find((entry) => entry.path === realPath)?.bytes
  }

  private knownSize(filePath: string): number | undefined {
    for (const key of pathKeys(filePath)) {
      const value = this.sizes.get(key)
      if (value !== undefined) return value
    }
    return undefined
  }

  private insideMeasured(filePath: string): boolean {
    for (const form of pathKeys(filePath)) {
      for (const key of this.sizes.keys()) {
        if (form.startsWith(`${key}/`)) return true
      }
    }
    return false
  }

  private rememberListing(listing: CachedListing): void {
    for (const key of pathKeys(listing.path)) this.listings.set(key, listing)
  }

  private cachedListing(filePath: string): CachedListing | undefined {
    for (const key of pathKeys(filePath)) {
      const listing = this.listings.get(key)
      if (listing) return listing
    }
    return undefined
  }

  private async measure(spec: RootSpec, generation: number): Promise<StorageItem | null> {
    const args = spec.expand ? ['-d', '1', '-k', spec.path] : ['-sk', spec.path]
    const result = await runCommand('du', args, spec.timeoutMs, this.track, this.release, () => generation === this.generation)
    if (generation !== this.generation) return null
    const parsed = parseDu(result.stdout, spec.path)
    const fileChildren = spec.expand && FILE_ROOTS.has(spec.id) ? await this.topLevelFiles(spec.path, generation) : []
    if (generation !== this.generation) return null

    const merged = new Map<string, MeasuredEntry>()
    for (const dir of parsed.dirs) {
      const name = path.basename(dir.path)
      if (!name || dir.bytes < 1) continue
      merged.set(path.resolve(dir.path), {
        name,
        path: dir.path,
        bytes: dir.bytes,
        kind: entryKind(name, false)
      })
    }
    for (const file of fileChildren) {
      merged.set(path.resolve(file.path), file)
    }

    const entries = [...merged.values()].sort((a, b) => b.bytes - a.bytes)
    if (spec.expand) {
      this.rememberListing({
        path: spec.path,
        bytes: parsed.total,
        entries,
        limited: limitedOutput(result.stderr) || result.timedOut,
        complete: true,
        full: false
      })
    }
    this.noteSize(spec.path, parsed.total)
    for (const entry of entries) this.noteSize(entry.path, entry.bytes)

    const parent = { verdict: spec.verdict, trashable: spec.trashable }
    const children = entries
      .filter((entry) => entry.bytes >= 1_000_000)
      .slice(0, PREVIEW_CHILDREN)
      .map((entry) => this.child(spec, entry, parent))
    const limited = limitedOutput(result.stderr)
    let detail = spec.detail
    if (result.timedOut) {
      detail += ' Stow stopped measuring this folder so the rest of the scan could finish. The size may be low.'
    } else if (limited) {
      detail += ' macOS hid some files here, so this size may be low.'
    }

    return {
      id: spec.id,
      title: spec.title,
      path: spec.path,
      bytes: parsed.total,
      verdict: spec.verdict,
      group: spec.group,
      summary: spec.summary,
      detail,
      children,
      trashable: spec.trashable,
      liftFromParent: spec.liftFromParent,
      shadow: false,
      complete: !result.timedOut,
      limited
    }
  }

  private child(
    spec: RootSpec,
    entry: MeasuredEntry,
    parent: { verdict: Verdict; trashable: boolean }
  ): StorageChild {
    const classified = classifyEntry(entry.name, entry.path, parent)
    const described = describeChild(spec.id, entry.name)
    const trashable = spec.childTrash ? spec.childTrash(entry.name) : classified.trashable
    return {
      name: entry.name,
      path: entry.path,
      bytes: entry.bytes,
      kind: entry.kind,
      verdict: classified.verdict,
      summary: classified.verdict === spec.verdict ? described : classified.summary,
      trashable
    }
  }

  private toFolderEntry(
    entry: MeasuredEntry,
    parent: { verdict: Verdict; trashable: boolean },
    measured: boolean
  ): FolderEntry {
    const classified = classifyEntry(entry.name, entry.path, parent)
    // A path the scan already labelled keeps that label, so browsing a parent cannot loosen or tighten it.
    const known = lookupRecord(this.registry, entry.path)
    if (known) {
      classified.verdict = known.verdict
      classified.trashable = known.trashable
    }
    return {
      name: entry.name,
      path: entry.path,
      bytes: entry.bytes,
      kind: entry.kind,
      verdict: classified.verdict,
      summary: classified.summary,
      trashable: classified.trashable,
      measured
    }
  }

  private async topLevelFiles(dir: string, generation: number): Promise<MeasuredEntry[]> {
    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files = dirents.filter((entry) => entry.isFile())
    if (files.length > 400) return []
    const found: MeasuredEntry[] = []
    await pool(files, 16, async (file) => {
      if (generation !== this.generation) return
      try {
        const full = path.join(dir, file.name)
        const stat = await fs.lstat(full)
        if (!stat.isFile() || stat.size < 1_000_000) return
        found.push({ name: file.name, path: full, bytes: stat.size, kind: 'file' })
      } catch {
        // Unreadable file. The folder total still includes what du could see.
      }
    })
    return found
  }

  private async findDependencies(generation: number): Promise<StorageItem | null> {
    const names = ['Projects', 'Developer', 'dev', 'code', 'src', 'repos', 'work', 'playground']
    const roots: string[] = []
    for (const name of names) {
      const full = path.join(this.home, name)
      try {
        await fs.access(full)
        roots.push(full)
      } catch {
        // Folder is not there.
      }
    }
    if (roots.length === 0 || generation !== this.generation) return null

    const found = await runCommand(
      'find',
      [...roots, '-maxdepth', '5', '-type', 'd', '-name', 'node_modules', '-prune', '-print'],
      20_000,
      this.track,
      this.release,
      () => generation === this.generation
    )
    const paths = found.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.includes(`${path.sep}Library${path.sep}`))
      .slice(0, 40)
    const children: StorageChild[] = []
    await pool(paths, 3, async (folder) => {
      if (generation !== this.generation) return
      const known = this.knownSize(folder)
      const bytes = known ?? (await this.directoryBytes(folder, generation))
      if (bytes < 1_000_000) return
      const project = path.basename(path.dirname(folder))
      children.push({
        name: `${project}/node_modules`,
        path: folder,
        bytes,
        kind: 'folder',
        verdict: 'optional',
        summary: describeChild('node-modules', project),
        trashable: true
      })
    })
    if (children.length === 0) return null
    children.sort((a, b) => b.bytes - a.bytes)
    const bytes = children.reduce((sum, child) => sum + child.bytes, 0)
    return {
      id: 'node-modules',
      title: 'Project dependencies',
      path: '',
      bytes,
      verdict: 'optional',
      group: 'Developer',
      summary: 'node_modules folders inside your projects. The projects stay.',
      detail:
        'These are installed dependencies, not your source. Move one project’s folder to the Trash if you are not working on it. The next install downloads it again. The space is already inside the folder that holds the project.',
      children,
      trashable: false,
      liftFromParent: true,
      shadow: false,
      complete: !found.timedOut,
      limited: false
    }
  }

  private async findLargeFiles(generation: number): Promise<StorageItem[]> {
    const found = await runCommand(
      'mdfind',
      ['-onlyin', this.home, `kMDItemFSSize >= ${LARGE_FILE_BYTES}`],
      15_000,
      this.track,
      this.release,
      () => generation === this.generation
    )
    const paths = found.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 80)
    const files: StorageItem[] = []
    let directoryBudget = 8
    await pool(paths, 6, async (filePath) => {
      if (generation !== this.generation || files.length >= 40) return
      try {
        const stat = await fs.lstat(filePath)
        let bytes = 0
        if (stat.isSymbolicLink()) return
        if (stat.isFile()) {
          bytes = stat.size
        } else if (stat.isDirectory()) {
          const known = this.knownSize(filePath)
          if (known !== undefined) {
            bytes = known
          } else if (this.insideMeasured(filePath) || directoryBudget <= 0) {
            return
          } else {
            directoryBudget -= 1
            bytes = await this.directoryBytes(filePath, generation)
          }
        }
        if (bytes < LARGE_FILE_BYTES) return
        const classified = classifyLargeFile(filePath)
        const name = path.basename(filePath)
        files.push({
          id: `large:${filePath}`,
          title: name,
          path: filePath,
          bytes,
          verdict: classified.verdict,
          group: 'Large files',
          summary: classified.summary,
          detail: classified.detail,
          children: [],
          trashable: classified.trashable,
          liftFromParent: false,
          shadow: true,
          complete: true,
          limited: false
        })
      } catch {
        // Spotlight can list files that have since moved.
      }
    })
    files.sort((a, b) => b.bytes - a.bytes)
    return files.slice(0, 40)
  }

  private async directoryBytes(folder: string, generation: number): Promise<number> {
    const known = this.knownSize(folder)
    if (known !== undefined) return known
    const measured = await runCommand('du', ['-sk', folder], 12_000, this.track, this.release, () => generation === this.generation)
    const total = parseDu(measured.stdout, folder).total
    if (total > 0) this.noteSize(folder, total)
    return total
  }
}
