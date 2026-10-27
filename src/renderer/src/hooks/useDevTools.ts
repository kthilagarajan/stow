import { useState } from 'react'
import type { DevCleanResult, DevTool, DevToolId } from '@shared/types'

// Developer tools: what each one holds, and the last cleanup it ran. Nothing is read until the view first opens.
export function useDevTools() {
  const [tools, setTools] = useState<DevTool[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [cleaning, setCleaning] = useState<DevToolId | null>(null)
  const [results, setResults] = useState<Partial<Record<DevToolId, DevCleanResult>>>({})

  async function check(): Promise<void> {
    if (!window.stow || checking) return
    setChecking(true)
    try {
      setTools(await window.stow.devTools())
    } finally {
      setChecking(false)
    }
  }

  async function clean(id: DevToolId): Promise<void> {
    if (!window.stow || cleaning) return
    setCleaning(id)
    try {
      const result = await window.stow.cleanDevTool(id)
      setResults((existing) => ({ ...existing, [id]: result }))
      const fresh = result.tool
      if (fresh) setTools((existing) => existing?.map((tool) => (tool.id === fresh.id ? fresh : tool)) ?? existing)
    } finally {
      setCleaning(null)
    }
  }

  return { tools, checking, cleaning, results, check, clean }
}
