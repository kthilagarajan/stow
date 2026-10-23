import { useEffect, useState, type MouseEvent } from 'react'

export function isMultiClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey
}

// Finder-style picking: a plain click keeps one row, ⌘-click adds or removes rows.
// Escape clears, ⌘A picks every row in `all`.
export function useSelection(all: string[]) {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set())
  const allKey = all.join('\n')

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, dialog[open]')) return
      if (event.key === 'Escape') setKeys(new Set())
      if (event.key === 'a' && (event.metaKey || event.ctrlKey) && all.length > 0) {
        event.preventDefault()
        setKeys(new Set(all))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allKey])

  const visible = new Set(all)
  const picked = [...keys].filter((key) => visible.has(key))

  return {
    picked,
    has: (key: string) => picked.includes(key),
    clear: () => setKeys(new Set()),
    // `anchor` is the row already showing in the details pane, so the first ⌘-click keeps it.
    toggle: (key: string, anchor?: string | null) =>
      setKeys((current) => {
        const next = new Set([...current].filter((entry) => visible.has(entry)))
        if (next.size === 0 && anchor && anchor !== key && visible.has(anchor)) next.add(anchor)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
  }
}
