import { useEffect, useReducer, useState } from 'react'
import { initialState, reducer } from '../state'

export function useStow() {
  const available = typeof window.stow !== 'undefined'
  const [state, dispatch] = useReducer(reducer, initialState)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  useEffect(() => {
    const api = window.stow
    if (!api) return
    let cancelled = false
    const unsubscribe = api.onEvent((event) => dispatch({ type: 'event', event }))
    void (async () => {
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
      if (!cancelled) await api.scan()
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

  function rescan(): void {
    void window.stow?.scan()
  }

  return { available, state, busyPath, reveal, trash, rescan }
}
