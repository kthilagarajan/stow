import { useEffect, useState } from 'react'

// Shared across the window so a remounted list shows real icons at once instead of placeholders.
const cache: Record<string, string> = {}

export function useFileIcons(paths: string[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>(() => ({ ...cache }))
  const key = [...new Set(paths.filter(Boolean))].slice(0, 80).join('\n')

  useEffect(() => {
    const unique = key.split('\n').filter(Boolean)
    const missing = unique.filter((filePath) => !(filePath in cache))
    if (missing.length === 0 || !window.stow) return
    let cancel = false
    void window.stow.fileIcons(missing).then((result) => {
      Object.assign(cache, result)
      if (!cancel) setIcons((current) => ({ ...current, ...result }))
    })
    return () => {
      cancel = true
    }
  }, [key])

  return icons
}
