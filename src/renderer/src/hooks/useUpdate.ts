import { useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '@shared/types'

const RECHECK_MS = 6 * 60 * 60 * 1000

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'

// Watches GitHub releases for a newer Stow, downloads it on request, and restarts into it.
export function useUpdate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True when the person asked from the menu, so "you're up to date" is worth saying.
  const [requested, setRequested] = useState(false)

  async function check(): Promise<void> {
    const api = window.stow
    if (!api) return
    setPhase((current) => (current === 'downloading' || current === 'ready' || current === 'installing' ? current : 'checking'))
    const found = await api.checkUpdate()
    setInfo(found)
    setPhase((current) => (current === 'checking' ? 'idle' : current))
  }

  useEffect(() => {
    const api = window.stow
    if (!api) return
    const first = window.setTimeout(() => void check(), 4000)
    const again = window.setInterval(() => void check(), RECHECK_MS)
    const offProgress = api.onUpdateProgress(setProgress)
    const offRequest = api.onUpdateRequested(() => {
      setRequested(true)
      void check()
    })
    return () => {
      window.clearTimeout(first)
      window.clearInterval(again)
      offProgress()
      offRequest()
    }
  }, [])

  async function download(): Promise<void> {
    const api = window.stow
    if (!api) return
    setPhase('downloading')
    setError(null)
    setProgress(null)
    const result = await api.downloadUpdate()
    if (!result.ok) {
      setPhase('error')
      setError(result.error)
      return
    }
    setPhase('ready')
  }

  async function install(): Promise<void> {
    const api = window.stow
    if (!api) return
    setPhase('installing')
    setError(null)
    // On success Stow quits here and the new version opens in its place.
    const result = await api.installUpdate()
    if (!result.ok) {
      setPhase('ready')
      setError(result.error)
    }
  }

  return {
    info,
    phase,
    progress,
    error,
    requested,
    request: () => {
      setRequested(true)
      void check()
    },
    dismiss: () => setRequested(false),
    download,
    install,
    openRelease: () => window.stow?.openReleasePage()
  }
}

export type Update = ReturnType<typeof useUpdate>
