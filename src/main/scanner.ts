import type { ChildProcess } from 'node:child_process'
import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { shell, type WebContents } from 'electron'
import { classifyEntry, classifyLargeFile } from './classify'
import { discoverRoots, type RootSpec } from './catalog'
import { describeChild } from './describe'
import { runCommand } from './exec'
import { applyTrash } from '../shared/items'
import { lookupRecord, pathKeys, stricterVerdict, trashDecision, type TrashRecord } from './guard'
import type {
  EntryKind,
  FolderEntry,
  FolderListing,
  FolderResult,
  ScanEvent,
  StorageChild,
  StorageItem,
  TrashBatchResult,
  TrashResult,
  Verdict
} from '../shared/types'

const LARGE_FILE_BYTES = 500_000_000
const PREVIEW_CHILDREN = 16
const LISTING_CAP = 80
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
}

interface CachedListing {
  path: string
  bytes: number
  entries: MeasuredEntry[]
  limited: boolean
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

function isHeavy(spec: RootSpec): boolean {
  return HEAVY_IDS.has(spec.id) || spec.id.startsWith('xcode:')
}

function validPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string' && filePath.length > 0 && filePath.length <= 4096 && !filePath.includes('\0')
}

export class Scanner {
  private generation = 0
  private processes = new Set<ChildProcess>()
  private registry = new Map<string, TrashRecord>()
  private listings = new Map<string, CachedListing>()
  private sizes = new Map<string, number>()
  private emitted: StorageItem[] = []
  private removed = new Set<string>()
  private home = os.homedir()
  private publish: ((items: StorageItem[], limited: number) => void) | null = null
  private rememberTrash: ((paths: string[]) => void) | null = null

  setPublisher(publish: (items: StorageItem[], limited: number) => void): void {
    this.publish = publish
  }

  setTrashRecorder(remember: (paths: string[]) => void): void {
    this.rememberTrash = remember
  }

  hydrate(items: StorageItem[]): void {
    for (const item of items) this.register(item)
  }

  stop(): void {
    this.generation += 1
    for (const child of this.processes) child.kill('SIGKILL')
    this.processes.clear()
  }

  async start(sender: WebContents): Promise<{ started: boolean }> {
    this.stop()
    const generation = this.generation
    this.registry.clear()
    this.listings.clear()
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
        this.rememberTrash?.([filePath])
      } catch {
        return { ok: true }
      }
    }
    return { ok: true }
  }

  async trashMany(paths: string[]): Promise<TrashBatchResult> {
    const unique = [
      ...new Set(paths.filter((filePath) => typeof filePath === 'string' && filePath.length > 0 && filePath.length <= 4096))
    ].slice(0, 200)
    unique.sort((a, b) => a.length - b.length)
    const trashed: string[] = []
    const covered: string[] = []
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
      } else if (!error) error = result.error
    }
    if (trashed.length > 0) {
      try {
        this.rememberTrash?.(trashed)
      } catch {
        // The files are already in the Trash. The list updates in the window.
      }
    }
    return { trashed, error }
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

  async openFolder(filePath: string): Promise<FolderResult> {
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
      ? { verdict: owner.verdict, trashable: owner.trashable, summary: 'Folders inside this one, largest first.' }
      : classifyEntry(path.basename(real), real, owner)
    if (!owner.exact) this.addRecord(real, self)

    const cached = this.cachedListing(real)
    const measured = cached ?? (await this.readListing(real, generation))
    if (generation !== this.generation) return { ok: false, error: 'The scan started again. Open the folder once it finishes.' }
    if (!measured) return { ok: false, error: 'Stow could not read that folder.' }

    const entries = measured.entries
      .map((entry) => this.toFolderEntry(entry, self))
      .sort((a, b) => b.bytes - a.bytes)
    for (const entry of entries) this.addRecord(entry.path, entry)

    const shown = entries.slice(0, LISTING_CAP)
    const rest = entries.slice(LISTING_CAP)
    return {
      ok: true,
      listing: {
        path: real,
        name: path.basename(real),
        bytes: measured.bytes,
        verdict: self.verdict,
        summary: self.summary,
        trashable: self.trashable,
        entries: shown,
        smallerCount: rest.length,
        smallerBytes: rest.reduce((sum, entry) => sum + entry.bytes, 0),
        limited: measured.limited
      }
    }
  }

  private emit(sender: WebContents, generation: number, event: ScanEvent): void {
    if (generation !== this.generation) return
    if (sender.isDestroyed()) return
    sender.send('scan:event', event)
  }

  private track = (child: ChildProcess): void => {
    this.processes.add(child)
  }

  private release = (child: ChildProcess): void => {
    this.processes.delete(child)
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
  }

  private noteSize(filePath: string, bytes: number): void {
    for (const key of pathKeys(filePath)) this.sizes.set(key, bytes)
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
        limited: limitedOutput(result.stderr) || result.timedOut
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

  private toFolderEntry(entry: MeasuredEntry, parent: { verdict: Verdict; trashable: boolean }): FolderEntry {
    const classified = classifyEntry(entry.name, entry.path, parent)
    return {
      name: entry.name,
      path: entry.path,
      bytes: entry.bytes,
      kind: entry.kind,
      verdict: classified.verdict,
      summary: classified.summary,
      trashable: classified.trashable
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

  private async readListing(folder: string, generation: number): Promise<CachedListing | null> {
    const result = await runCommand('du', ['-d', '1', '-k', folder], 25_000, this.track, this.release, () => generation === this.generation)
    if (generation !== this.generation) return null
    const parsed = parseDu(result.stdout, folder)
    const files = await this.notableFiles(folder, generation)
    if (generation !== this.generation) return null
    const merged = new Map<string, MeasuredEntry>()
    for (const dir of parsed.dirs) {
      const name = path.basename(dir.path)
      if (!name) continue
      merged.set(path.resolve(dir.path), { name, path: dir.path, bytes: dir.bytes, kind: entryKind(name, false) })
    }
    for (const file of files) merged.set(path.resolve(file.path), file)
    const listing: CachedListing = {
      path: folder,
      bytes: parsed.total,
      entries: [...merged.values()].sort((a, b) => b.bytes - a.bytes),
      limited: limitedOutput(result.stderr) || result.timedOut
    }
    this.rememberListing(listing)
    this.noteSize(folder, parsed.total)
    return listing
  }

  private async notableFiles(dir: string, generation: number): Promise<MeasuredEntry[]> {
    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files = dirents.filter((entry) => entry.isFile())
    if (files.length === 0 || files.length > 500) return []
    const found: MeasuredEntry[] = []
    await pool(files, 16, async (file) => {
      if (generation !== this.generation) return
      try {
        const full = path.join(dir, file.name)
        const stat = await fs.lstat(full)
        if (!stat.isFile() || stat.size < 1_000_000) return
        found.push({ name: file.name, path: full, bytes: stat.size, kind: 'file' })
      } catch {
        // Skip unreadable files.
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
