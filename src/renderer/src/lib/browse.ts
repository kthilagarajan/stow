import type { FolderListing } from '@shared/types'

const FILE_EXT = /\.(dmg|pkg|iso|zip|tar|gz|tgz|7z|rar|pdf|mp4|mov|mkv|avi|png|jpe?g|gif|heic|webp|ipa|apk|txt|csv|json|mp3|wav|aiff)$/i

export function canLookInside(filePath: string): boolean {
  if (!filePath) return false
  return !FILE_EXT.test(filePath)
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
