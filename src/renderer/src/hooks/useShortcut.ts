import { useEffect, useRef } from 'react'

// A window-wide ⌘ shortcut, such as useShortcut('g', open, { shift: true }) for ⇧⌘G.
export function useShortcut(key: string, handler: () => void, options: { shift?: boolean } = {}): void {
  const latest = useRef(handler)
  latest.current = handler
  const shift = Boolean(options.shift)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== key || !event.metaKey || event.shiftKey !== shift) return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, shift])
}
