import type { FolderEntry, FolderListing, StorageItem, Verdict } from '@shared/types'

const FILE_EXT = /\.(dmg|pkg|iso|zip|tar|gz|tgz|7z|rar|pdf|mp4|mov|mkv|avi|png|jpe?g|gif|heic|webp|ipa|apk|txt|csv|json|mp3|wav|aiff)$/i

export function canLookInside(filePath: string): boolean {
  if (!filePath) return false
  return !FILE_EXT.test(filePath)
}

// The name exactly as it sits on disk, dots and case included.
export function diskName(filePath: string, fallback: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? fallback
}

// The catalog's friendlier label, when it differs from the name on disk.
export function tagFor(item: StorageItem): string | undefined {
  const name = diskName(item.path, item.title)
  return name === item.title ? undefined : item.title
}

export interface BrowseFrame extends FolderListing {
  label: string
}

export function applyBrowseTrash(stack: BrowseFrame[], target: string): BrowseFrame[] {
  let known = 0
  for (const frame of stack) {
    const entry = frame.entries.find((item) => item.path === target)
    if (entry) known = entry.bytes
  }
  const cut = stack.findIndex((frame) => frame.path === target || frame.path.startsWith(`${target}/`))
  const kept = cut === -1 ? stack : stack.slice(0, cut)
  return kept.map((frame) => {
    const removed = frame.entries.filter((item) => item.path === target || item.path.startsWith(`${target}/`))
    const contains = target.startsWith(`${frame.path}/`)
    if (removed.length === 0 && !contains) return frame
    const delta = removed.reduce((sum, item) => sum + item.bytes, 0) || known
    return {
      ...frame,
      bytes: Math.max(0, frame.bytes - delta),
      entries: frame.entries.filter((item) => item.path !== target && !item.path.startsWith(`${target}/`))
    }
  })
}

// Everything the details pane needs about a folder or file picked while browsing.
export interface FocusDetail {
  title: string
  path: string
  bytes: number
  verdict: Verdict
  summary: string
  detail?: string
  trashable: boolean
  canReveal: boolean
  canOpen: boolean
  kind?: FolderEntry['kind']
  measuring?: boolean
  entries?: { name: string; bytes: number; verdict: Verdict; summary: string }[]
}
