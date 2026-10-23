import { useEffect, useState } from 'react'
import type { FileIconSet } from '@shared/types'
import { useAppearance } from '@/hooks/useTheme'

const cache: Record<string, FileIconSet> = {}

function shown(pair: FileIconSet | undefined, appearance: 'light' | 'dark'): string | undefined {
  if (!pair) return undefined
  const src = pair[appearance] || pair.light || pair.dark
  return src?.startsWith('data:image/png') ? src : undefined
}

function keep(icons: Record<string, FileIconSet>): Record<string, FileIconSet> {
  const kept: Record<string, FileIconSet> = {}
  for (const [filePath, pair] of Object.entries(icons)) {
    if (shown(pair, 'light') || shown(pair, 'dark')) kept[filePath] = pair
  }
  return kept
}

// Loads Finder icons in small batches so the first click is not waiting on the whole set.
export function useFileIcons(paths: string[]): Record<string, string> {
  const appearance = useAppearance()
  const [icons, setIcons] = useState<Record<string, FileIconSet>>(() => ({ ...cache }))
  // Sorted so a folder reordering its rows does not throw away icons that are already on the way.
  const key = [...new Set(paths.filter(Boolean))].sort().slice(0, 80).join('\n')

  useEffect(() => {
    const unique = key.split('\n').filter(Boolean)
    const missing = unique.filter((filePath) => !shown(cache[filePath], 'light') && !shown(cache[filePath], 'dark'))
    const stow = window.stow
    setIcons((current) => {
      let changed = false
      const next = { ...current }
      for (const filePath of unique) {
        const saved = cache[filePath]
        if (saved && next[filePath] !== saved) {
          next[filePath] = saved
          changed = true
        }
      }
      return changed ? next : current
    })
    if (missing.length === 0 || !stow) return
    let cancel = false
    const chunks: string[][] = []
    for (let index = 0; index < missing.length; index += 8) chunks.push(missing.slice(index, index + 8))
    void (async () => {
      for (const chunk of chunks) {
        if (cancel) return
        let result = keep(await stow.fileIcons(chunk))
        if (!cancel && Object.keys(result).length === 0) result = keep(await stow.fileIcons(chunk))
        Object.assign(cache, result)
        if (cancel) return
        setIcons((current) => ({ ...current, ...result }))
      }
    })()
    return () => {
      cancel = true
    }
  }, [key])

  const picked: Record<string, string> = {}
  for (const [filePath, pair] of Object.entries(icons)) {
    const src = shown(pair, appearance)
    if (src) picked[filePath] = src
  }
  return picked
}
