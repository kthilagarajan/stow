import path from 'node:path'
import type { FolderEntry, FolderResult, ItemInfo, SavedScan, StorageChild, StorageItem, VolumeInfo } from '../shared/types'
import { staticRoots } from './catalog'
import { fileIcons } from './icons'

// Demo mode (STOW_DEMO=1) shows a made-up Mac so screenshots never carry a real person's files.
// Titles, verdicts and wording come from the real catalog; only the sizes and names below are invented.

export const isDemo = process.env.STOW_DEMO === '1'

const HOME = '/Users/alex'
const GB = 1_000_000_000
const MB = 1_000_000
const DAY = 86_400_000

const SIZES: Record<string, number> = {
  keychains: 0.02 * GB,
  preferences: 0.03 * GB,
  documents: 18.5 * GB,
  desktop: 2.2 * GB,
  pictures: 34.6 * GB,
  movies: 41.2 * GB,
  music: 8.1 * GB,
  mail: 3.4 * GB,
  messages: 6.7 * GB,
  icloud: 12.4 * GB,
  'app-support': 22.8 * GB,
  applications: 31.5 * GB,
  'user-apps': 2.3 * GB,
  caches: 13.4 * GB,
  logs: 180 * MB,
  trash: 2.6 * GB,
  npm: 6.2 * GB,
  downloads: 9.8 * GB,
  simulators: 8.4 * GB,
  docker: 21.6 * GB,
  pnpm: 11.3 * GB,
  cargo: 2.1 * GB,
  go: 1.3 * GB,
  android: 5 * GB,
  homebrew: 4.2 * GB
}

const CHILDREN: Record<string, [string, number][]> = {
  caches: [
    ['Google', 3.1 * GB],
    ['com.spotify.client', 2.2 * GB],
    ['pnpm', 1.4 * GB],
    ['CocoaPods', 1.1 * GB],
    ['com.apple.Safari', 640 * MB],
    ['Yarn', 420 * MB]
  ],
  npm: [
    ['_cacache', 5.1 * GB],
    ['_npx', 1.1 * GB]
  ],
  downloads: [
    ['Figma-arm64.dmg', 410 * MB],
    ['design-assets', 2.4 * GB],
    ['invoices-2025', 120 * MB]
  ]
}

const LARGE: [string, number, StorageItem['verdict'], boolean, string][] = [
  ['Movies/Holiday 2025.mov', 6.4 * GB, 'keep', false, 'A video of yours. Stow will not move it.'],
  ['Downloads/ubuntu-24.04-desktop-arm64.iso', 3.1 * GB, 'optional', true, 'A disk image. If it is installed, this is usually safe to clear.'],
  ['Documents/Archive/photos-backup.zip', 2.0 * GB, 'keep', false, 'An archive of your files. Stow will not move it.']
]

function child(parent: StorageItem, name: string, bytes: number): StorageChild {
  const file = /[^/]\.\w{2,4}$/.test(name)
  return {
    name,
    path: path.join(parent.path, name),
    bytes,
    verdict: parent.verdict,
    summary: file ? 'An installer you downloaded.' : parent.verdict === 'clear' ? 'A cache. The app rebuilds it.' : 'A folder inside this one.',
    trashable: parent.trashable,
    kind: file ? 'file' : 'folder'
  }
}

function items(): StorageItem[] {
  const roots = staticRoots(HOME)
    .filter((spec) => SIZES[spec.id] !== undefined)
    .map((spec): StorageItem => {
      const item: StorageItem = {
        id: spec.id,
        title: spec.title,
        path: spec.path,
        bytes: SIZES[spec.id] ?? 0,
        verdict: spec.verdict,
        group: spec.group,
        summary: spec.summary,
        detail: spec.detail,
        children: [],
        trashable: spec.trashable,
        liftFromParent: spec.liftFromParent,
        shadow: false,
        complete: true,
        limited: false
      }
      item.children = (CHILDREN[spec.id] ?? []).map(([name, bytes]) => child(item, name, bytes))
      return item
    })
  const large = LARGE.map(([relative, bytes, verdict, trashable, summary]): StorageItem => {
    const filePath = path.join(HOME, relative)
    return {
      id: `large:${filePath}`,
      title: path.basename(filePath),
      path: filePath,
      bytes,
      verdict,
      group: 'Large files',
      summary,
      detail: summary,
      children: [],
      trashable,
      liftFromParent: false,
      shadow: true,
      complete: true,
      limited: false
    }
  })
  return [...roots, ...large]
}

export function demoScan(): SavedScan {
  return { scannedAt: Date.now() - 42 * 60_000, limited: 3, items: items() }
}

export function demoVolume(): VolumeInfo {
  return { name: 'Macintosh HD', totalBytes: 494.4 * GB, usedBytes: 380 * GB, freeBytes: 114.4 * GB }
}

// A stable number from a path, so the same folder always shows the same made-up contents.
function seed(value: string): number {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

const INSIDE = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'blob_storage', 'Crashpad']

export function demoListing(filePath: string): FolderResult {
  const all = items()
  const owner = all.find((item) => item.path === filePath || filePath.startsWith(`${item.path}/`))
  if (!owner) return { ok: false, error: 'There is no folder at that path.' }
  const known = all.find((item) => item.path === filePath)
  const total = known?.bytes ?? owner.children.find((entry) => entry.path === filePath)?.bytes ?? 1 * GB
  const named = known && known.children.length > 0 ? known.children.map((entry) => [entry.name, entry.bytes] as const) : null
  const shares = [0.42, 0.24, 0.15, 0.09, 0.06, 0.04]
  const offset = seed(filePath) % 3
  const rows = named ?? INSIDE.slice(offset, offset + 4).map((name, index) => [name, Math.round(total * (shares[index] ?? 0.02))] as const)
  const entries: FolderEntry[] = rows.map(([name, bytes]) => ({
    name,
    path: path.join(filePath, name),
    bytes,
    kind: /[^/]\.\w{2,4}$/.test(name) ? 'file' : 'folder',
    verdict: owner.verdict,
    summary: owner.verdict === 'clear' ? 'Inside a folder that is safe to clear. The app can rebuild it.' : 'A folder inside this one.',
    trashable: owner.trashable
  }))
  return {
    ok: true,
    listing: {
      path: filePath,
      name: path.basename(filePath),
      bytes: total,
      verdict: owner.verdict,
      summary: known?.summary ?? 'Folders inside this one, largest first.',
      trashable: owner.trashable,
      entries,
      smallerCount: 7,
      smallerBytes: Math.round(total * 0.01),
      limited: false
    }
  }
}

export function demoInfo(filePath: string): ItemInfo {
  const value = seed(filePath)
  const now = Date.now()
  return {
    modified: now - (value % 20) * DAY - 3 * 3_600_000,
    created: now - (300 + (value % 400)) * DAY,
    opened: value % 3 === 0 ? null : now - (value % 9) * DAY,
    items: 4 + (value % 60),
    hidden: path.basename(filePath).startsWith('.'),
    link: false
  }
}

// Every demo folder borrows the icon of a real, ordinary folder.
export async function demoIcons(paths: string[]): Promise<Record<string, string>> {
  const sample = (await fileIcons(['/Library']))['/Library']
  if (!sample) return {}
  return Object.fromEntries(paths.filter((entry) => !/[^/]\.\w{2,4}$/.test(entry)).map((entry) => [entry, sample]))
}
