import { useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '@shared/types'

const RECHECK_MS = 6 * 60 * 60 * 1000

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

// Watches GitHub releases for a newer Stow and downloads it on request.
export function useUpdate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True when the person asked from the menu, so "you're up to date" is worth saying.
  const [requested, setRequested] = useState(false)

  async function check(): Promise<void> {
    const api = window.stow
    if (!api) return
    setPhase((current) => (current === 'downloading' || current === 'ready' ? current : 'checking'))
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
    setFile(result.file)
    setPhase('ready')
    await api.openDownloaded(result.file)
  }

  return {
    info,
    phase,
    progress,
    file,
    error,
    requested,
    request: () => {
      setRequested(true)
      void check()
    },
    dismiss: () => setRequested(false),
    download,
    openInstaller: () => (file ? window.stow?.openDownloaded(file) : undefined),
    openRelease: () => window.stow?.openReleasePage()
  }
}

export type Update = ReturnType<typeof useUpdate>
