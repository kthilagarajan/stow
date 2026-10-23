import { useEffect, useState } from 'react'
import type { ActivityTask } from '@shared/types'

// Work that finishes sooner than this never shows, so quick reads do not flicker in the list.
const SETTLE_MS = 250

type Seen = { task: ActivityTask; seenAt: number }

// What Rust is doing in the background, for the activity list.
export function useActivity(): ActivityTask[] {
  const [seen, setSeen] = useState<Seen[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const stow = window.stow
    if (!stow) return
    let live = true
    let heard = false
    const take = (tasks: ActivityTask[]): void => {
      const at = Date.now()
      setSeen((current) => {
        const earlier = new Map(current.map((entry) => [entry.task.id, entry.seenAt]))
        return tasks.map((task) => ({ task, seenAt: earlier.get(task.id) ?? at }))
      })
    }
    const unsubscribe = stow.onActivity((tasks) => {
      heard = true
      if (live) take(tasks)
    })
    void stow.activity().then((tasks) => {
      if (live && !heard) take(tasks)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const settling = seen.filter((entry) => now - entry.seenAt < SETTLE_MS)
  const nextAt = settling.length > 0 ? Math.min(...settling.map((entry) => entry.seenAt)) + SETTLE_MS : null

  useEffect(() => {
    if (nextAt === null) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [nextAt])

  return seen.filter((entry) => now - entry.seenAt >= SETTLE_MS).map((entry) => entry.task)
}
