import { useEffect, useReducer, useState } from 'react'
import { initialState, reducer } from '../state'

export function useStow() {
  const available = typeof window.stow !== 'undefined'
  const [state, dispatch] = useReducer(reducer, initialState)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)

  useEffect(() => {
    const api = window.stow
    if (!api) return
    let cancelled = false
    const unsubscribe = api.onEvent((event) => dispatch({ type: 'event', event }))
    void (async () => {
      try {
        const meta = await api.meta()
        if (!cancelled) dispatch({ type: 'meta', version: meta.version })
      } catch {
        // The window still works without a version label.
      }
      try {
        const saved = await api.loadScan()
        if (!cancelled) dispatch({ type: 'saved', scan: saved })
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'saved', scan: null })
          dispatch({
            type: 'action-error',
            message: error instanceof Error ? error.message : 'Could not open the last scan.'
          })
        }
      }
      try {
        const volume = await api.getVolume()
        if (!cancelled) dispatch({ type: 'volume', volume })
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: 'volume-error',
            message: error instanceof Error ? error.message : 'Could not read the disk.'
          })
        }
      }
    })()
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
        dispatch({ type: 'trashed', path: filePath })
        return true
      }
      dispatch({ type: 'action-error', message: result.error ?? 'macOS did not move it.' })
      return false
    } finally {
      setBusyPath(null)
    }
  }

  async function trashMany(paths: string[]): Promise<string[]> {
    const api = window.stow
    if (!api || paths.length === 0) return []
    setBusyPath(paths[0] ?? null)
    dispatch({ type: 'action-error', message: null })
    try {
      const result = await api.trashMany(paths)
      for (const filePath of result.trashed) dispatch({ type: 'trashed', path: filePath })
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
    dispatch({ type: 'action-error', message: null })
    try {
      const result = await api.emptyTrash()
      if (result.ok) {
        dispatch({ type: 'emptied-trash' })
        return true
      }
      dispatch({ type: 'action-error', message: result.error ?? 'Finder did not empty the Trash.' })
      return false
    } finally {
      setEmptying(false)
    }
  }

  function rescan(): void {
    void window.stow?.scan()
  }

  return { available, state, busyPath, emptying, reveal, trash, trashMany, emptyTrash, rescan }
}
