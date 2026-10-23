import { useEffect, useState } from 'react'

export function useFileIcons(paths: string[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({})
  const key = [...new Set(paths.filter(Boolean))].slice(0, 80).join('\n')

  useEffect(() => {
    const unique = key.split('\n').filter(Boolean)
    if (unique.length === 0 || !window.stow) return
    let cancel = false
    void window.stow.fileIcons(unique).then((result) => {
      if (!cancel) setIcons((current) => ({ ...current, ...result }))
    })
    return () => {
      cancel = true
    }
  }, [key])

  return icons
}
