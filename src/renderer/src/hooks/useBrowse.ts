import { useState } from 'react'
import type { FolderEntry } from '@shared/types'
import { applyBrowseTrash, canLookInside, type BrowseFrame, type FocusDetail } from '@/lib/browse'

// Folder browsing: the breadcrumb stack, the row picked inside the current folder, and loading state.
export function useBrowse() {
  const [stack, setStack] = useState<BrowseFrame[]>([])
  const [picked, setPicked] = useState<FolderEntry | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = stack.at(-1) ?? null

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
        const index = existing.findIndex((entry) => entry.path === frame.path)
        if (index >= 0) return [...existing.slice(0, index), frame]
        return [...existing, frame]
      })
    } finally {
      setOpening(false)
    }
  }

  // Resolves to an error message, or null once the folder is showing.
  async function goTo(filePath: string): Promise<string | null> {
    if (!window.stow) return 'Open this window from the Stow app.'
    const result = await window.stow.goTo(filePath)
    if (!result.ok) return result.error
    setError(null)
    setPicked(null)
    setStack([{ ...result.listing, label: result.listing.name }])
    return null
  }

  // -1 goes back to the shelf.
  function crumb(index: number): void {
    setPicked(null)
    setError(null)
    setStack((existing) => (index < 0 ? [] : existing.slice(0, index + 1)))
  }

  function reset(): void {
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
      kind: picked.kind
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
    entries: current.entries.slice(0, 12).map((entry) => ({
      name: entry.name,
      bytes: entry.bytes,
      verdict: entry.verdict,
      summary: entry.summary
    }))
  }
}
