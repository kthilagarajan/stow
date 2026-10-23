import type { FolderEntry, FolderListing, FolderUpdate } from './types'

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Largest first from the moment a folder opens. Rows still being measured wait at the end in name
// order, so each one moves once, when its size arrives, instead of the whole list flipping at the end.
export function orderEntries(entries: FolderEntry[]): FolderEntry[] {
  return [...entries].sort((a, b) => {
    if (a.measured !== b.measured) return a.measured ? -1 : 1
    if (a.measured && a.bytes !== b.bytes) return b.bytes - a.bytes
    return byName.compare(a.name, b.name)
  })
}

// Sizes seen so far for one visit to a folder. Patches accumulate, so an update that arrives
// before the listing is on screen is still applied when the listing shows up.
export interface FolderProgress {
  path: string
  token: number
  bytes: number
  sizes: Record<string, number>
  entries: FolderListing['entries'] | null
  smallerCount: number
  smallerBytes: number
  measuring: boolean
  limited: boolean
}

function fillWaiting(entries: FolderListing['entries'], sizes: Record<string, number>): FolderListing['entries'] {
  return entries.map((entry) => {
    const bytes = sizes[entry.path]
    if (bytes === undefined || entry.measured) return entry
    return { ...entry, bytes, measured: true }
  })
}

export function noteFolderUpdate(current: FolderProgress | undefined, update: FolderUpdate): FolderProgress {
  if (current && current.token !== update.token) return current
  const sizes = { ...(current?.sizes ?? {}) }
  for (const entry of update.sizes) sizes[entry.path] = entry.bytes
  const finished = update.entries !== null
  // A folder can finish while some rows are still waiting. A size found by opening one of them still fills that row.
  if (current && !current.measuring && current.entries && !finished) {
    return {
      ...current,
      bytes: update.bytes > 0 ? update.bytes : current.bytes,
      sizes,
      entries: fillWaiting(current.entries, sizes),
      limited: Boolean(current.limited || update.limited)
    }
  }
  const entries = finished ? update.entries : (current?.entries ?? null)
  return {
    path: update.path,
    token: update.token,
    bytes: update.bytes > 0 ? update.bytes : (current?.bytes ?? 0),
    sizes,
    entries: entries ? fillWaiting(entries, sizes) : null,
    smallerCount: finished ? update.smallerCount : (current?.smallerCount ?? 0),
    smallerBytes: finished ? update.smallerBytes : (current?.smallerBytes ?? 0),
    measuring: update.measuring,
    limited: Boolean(current?.limited || update.limited)
  }
}

// A fresh open must not replace sizes already measured with a blank preview.
export function mergeListing(previous: FolderListing | undefined, incoming: FolderListing): FolderListing {
  if (!previous || previous.path !== incoming.path) return incoming
  const prior = new Map(previous.entries.map((entry) => [entry.path, entry]))
  return {
    ...incoming,
    bytes: incoming.bytes > 0 ? incoming.bytes : previous.bytes,
    entries: incoming.entries.map((entry) => {
      const old = prior.get(entry.path)
      if (entry.measured || !old?.measured) return entry
      return { ...entry, bytes: old.bytes, measured: true }
    })
  }
}

export function applyFolderProgress(listing: FolderListing, progress: FolderProgress | undefined): FolderListing {
  if (!progress || progress.path !== listing.path || progress.token !== listing.token) return listing
  if (progress.entries) {
    return {
      ...listing,
      bytes: progress.bytes > 0 ? progress.bytes : listing.bytes,
      entries: progress.entries,
      smallerCount: progress.smallerCount,
      smallerBytes: progress.smallerBytes,
      measuring: progress.measuring,
      limited: listing.limited || progress.limited
    }
  }
  return {
    ...listing,
    bytes: progress.bytes > 0 ? progress.bytes : listing.bytes,
    measuring: progress.measuring,
    limited: listing.limited || progress.limited,
    entries: listing.entries.map((entry) => {
      const bytes = progress.sizes[entry.path]
      return bytes === undefined ? entry : { ...entry, bytes, measured: true }
    })
  }
}
