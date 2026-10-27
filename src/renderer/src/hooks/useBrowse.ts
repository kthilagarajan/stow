import { useEffect, useRef, useState } from 'react'
import type { FolderEntry } from '@shared/types'
import type { Place } from '@shared/places'
import { applyFolderProgress, mergeListing, noteFolderUpdate, orderEntries, type FolderProgress } from '@shared/listing'
import { applyBrowseTrash, canLookInside, type BrowseFrame, type FocusDetail } from '@/lib/browse'

function paint(frame: BrowseFrame, progress: Map<string, FolderProgress>): BrowseFrame {
  const next = applyFolderProgress(frame, progress.get(`${frame.path}\0${frame.token}`))
  return { ...frame, ...next, entries: orderEntries(next.entries), label: frame.label }
}

// Folder browsing: the breadcrumb stack, the row picked inside the current folder, and loading state.
export function useBrowse() {
  const [stack, setStack] = useState<BrowseFrame[]>([])
  const [picked, setPicked] = useState<FolderEntry | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const progress = useRef(new Map<string, FolderProgress>())
  const current = stack.at(-1) ?? null

  useEffect(() => {
    if (!window.stow) return
    return window.stow.onFolderUpdate((update) => {
      const key = `${update.path}\0${update.token}`
      progress.current.set(key, noteFolderUpdate(progress.current.get(key), update))
      setStack((existing) => existing.map((frame) => paint(frame, progress.current)))
      setPicked((entry) => {
        if (!entry) return entry
        const frame = progress.current.get(`${update.path}\0${update.token}`)
        const match = frame?.entries?.find((item) => item.path === entry.path)
        const sized = frame?.sizes?.[entry.path]
        if (match) return match
        if (sized === undefined) return entry
        return { ...entry, bytes: sized, measured: true }
      })
    })
  }, [])

  async function open(filePath: string, label?: string, summary?: string): Promise<void> {
    if (!filePath || !canLookInside(filePath) || !window.stow) return
    setOpening(true)
    setError(null)
    setPicked(null)
    try {
      const result = await window.stow.openFolder(filePath)
      if (!result.ok) {
        setError(result.error)
        return
      }
      const frame: BrowseFrame = {
        ...result.listing,
        label: label || result.listing.name,
        summary: summary || result.listing.summary
      }
      setStack((existing) => {
        const previous = existing.find((entry) => entry.path === frame.path)
        const merged: BrowseFrame = { ...mergeListing(previous, frame), label: frame.label }
        const index = existing.findIndex((entry) => entry.path === frame.path)
        const frames = index >= 0 ? [...existing.slice(0, index), merged] : [...existing, merged]
        return frames.map((entry) => paint(entry, progress.current))
      })
    } finally {
      setOpening(false)
    }
  }

  // Resolves to an error message, or null once the folder is showing. `onOpened` gets the folder as it is on disk.
  async function goTo(filePath: string, onOpened?: (place: Place) => void): Promise<string | null> {
    if (!window.stow) return 'Open this window from the Stow app.'
    setOpening(true)
    setError(null)
    setPicked(null)
    try {
      const result = await window.stow.goTo(filePath)
      if (!result.ok) return result.error
      setStack([paint({ ...result.listing, label: result.listing.name }, progress.current)])
      onOpened?.({ path: result.listing.path, name: result.listing.name })
      return null
    } finally {
      setOpening(false)
    }
  }

  // -1 goes back to the shelf. A folder crumb pulls the sizes collected while it was out of view.
  function crumb(index: number): void {
    setPicked(null)
    setError(null)
    if (index < 0) {
      setStack([])
      return
    }
    const target = stack[index]
    setStack((existing) => existing.slice(0, index + 1))
    if (!target || !window.stow) return
    void window.stow.openFolder(target.path).then((result) => {
      if (!result.ok) return
      setStack((existing) =>
        existing.map((frame) => {
          if (frame.path !== result.listing.path) return frame
          const incoming: BrowseFrame = { ...result.listing, label: frame.label, summary: frame.summary || result.listing.summary }
          return paint({ ...mergeListing(frame, incoming), label: frame.label }, progress.current)
        })
      )
    })
  }

  function reset(): void {
    progress.current.clear()
    setStack([])
    setPicked(null)
    setError(null)
  }

  function forget(paths: string[]): void {
    setStack((existing) => paths.reduce((list, filePath) => applyBrowseTrash(list, filePath), existing))
    setPicked((entry) =>
      entry && paths.some((filePath) => entry.path === filePath || entry.path.startsWith(`${filePath}/`)) ? null : entry
    )
  }

  return { stack, current, picked, opening, error, open, goTo, crumb, reset, forget, pick: setPicked, focus: focusFor(picked, current) }
}

// What the details pane shows while browsing: the picked row, or else the folder being browsed.
function focusFor(picked: FolderEntry | null, current: BrowseFrame | null): FocusDetail | null {
  if (picked) {
    return {
      title: picked.name,
      path: picked.path,
      bytes: picked.bytes,
      verdict: picked.verdict,
      summary: picked.summary,
      trashable: picked.trashable,
      canReveal: true,
      canOpen: picked.kind !== 'file' && canLookInside(picked.path),
      kind: picked.kind,
      measuring: !picked.measured
    }
  }
  if (!current) return null
  return {
    title: current.label,
    path: current.path,
    bytes: current.bytes,
    verdict: current.verdict,
    summary: current.summary,
    trashable: current.trashable,
    canReveal: true,
    canOpen: false,
    kind: 'folder',
    measuring: current.measuring,
    entries: current.entries.slice(0, 12).map((entry) => ({
      name: entry.name,
      bytes: entry.bytes,
      verdict: entry.verdict,
      summary: entry.summary
    }))
  }
}
