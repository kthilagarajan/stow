import { useEffect, useReducer, useState } from 'react'
import type { TrashTarget } from '@shared/types'
import { initialState, reducer } from '../state'

export function useStow() {
  const available = typeof window.stow !== 'undefined'
  const [state, dispatch] = useReducer(reducer, initialState)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)
  const [emptyError, setEmptyError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.stow
    if (!api) return
    let cancelled = false
    const unsubscribe = api.onEvent((event) => dispatch({ type: 'event', event }))
    // Independent reads, so the shelves fill in as soon as each one answers.
    api
      .meta()
      .then((meta) => {
        if (!cancelled) dispatch({ type: 'meta', version: meta.version })
      })
      .catch(() => {
        // The window still works without a version label.
      })
    api
      .loadScan()
      .then((saved) => {
        if (!cancelled) dispatch({ type: 'saved', scan: saved })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        dispatch({ type: 'saved', scan: null })
        dispatch({ type: 'action-error', message: error instanceof Error ? error.message : 'Could not open the last scan.' })
      })
    api
      .getVolume()
      .then((volume) => {
        if (!cancelled) dispatch({ type: 'volume', volume })
      })
      .catch((error: unknown) => {
        if (!cancelled) dispatch({ type: 'volume-error', message: error instanceof Error ? error.message : 'Could not read the disk.' })
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [available])

  async function reveal(filePath: string): Promise<void> {
    await window.stow?.reveal(filePath)
  }

  async function trash(filePath: string): Promise<boolean> {
    const api = window.stow
    if (!api) return false
    setBusyPath(filePath)
    dispatch({ type: 'action-error', message: null })
    try {
      const result = await api.trash(filePath)
      if (result.ok) {
        dispatch({ type: 'trashed', path: filePath, bytes: result.bytes ?? 0, inside: false })
        return true
      }
      dispatch({ type: 'action-error', message: result.error ?? 'macOS did not move it.' })
      return false
    } finally {
      setBusyPath(null)
    }
  }

  async function trashMany(targets: TrashTarget[]): Promise<string[]> {
    const api = window.stow
    const paths = targets.map((target) => target.path)
    if (!api || paths.length === 0) return []
    setBusyPath(paths[0] ?? null)
    dispatch({ type: 'action-error', message: null })
    try {
      const result = await api.trashMany(paths)
      const moved = new Set(result.trashed)
      for (const filePath of result.trashed) {
        const inside = [...moved].some((other) => filePath.startsWith(`${other}/`))
        const bytes = result.sizes?.[filePath] ?? targets.find((target) => target.path === filePath)?.bytes ?? 0
        dispatch({ type: 'trashed', path: filePath, bytes, inside })
      }
      if (result.error) dispatch({ type: 'action-error', message: result.error })
      return result.trashed
    } finally {
      setBusyPath(null)
    }
  }

  async function emptyTrash(): Promise<boolean> {
    const api = window.stow
    if (!api) return false
    setEmptying(true)
    setEmptyError(null)
    try {
      const result = await api.emptyTrash()
      if (result.ok) {
        dispatch({ type: 'emptied-trash' })
        return true
      }
      // No error means the person cancelled, which needs no message.
      setEmptyError(result.error ?? null)
      return false
    } finally {
      setEmptying(false)
    }
  }

  function rescan(): void {
    void window.stow?.scan()
  }

  return { available, state, busyPath, emptying, emptyError, dismissEmptyError: () => setEmptyError(null), reveal, trash, trashMany, emptyTrash, rescan }
}
