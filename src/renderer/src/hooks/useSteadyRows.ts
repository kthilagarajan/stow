import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const SLIDE = { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }

// Rows that settle calmly while sizes arrive. While `moving` and the pointer is over the list, rows
// keep their places so nothing shifts under the cursor; otherwise a row that changes place slides there.
export function useSteadyRows<T extends { path: string }>(rows: T[], moving: boolean) {
  const list = useRef<HTMLUListElement>(null)
  const [hovered, setHovered] = useState(false)
  const held = hovered && moving
  const order = useRef<string[]>([])
  const tops = useRef(new Map<string, number>())

  const shown = useMemo(() => {
    if (!held) return rows
    const place = new Map(order.current.map((path, index) => [path, index]))
    const last = order.current.length
    return [...rows].sort((a, b) => (place.get(a.path) ?? last) - (place.get(b.path) ?? last))
  }, [rows, held])

  const keys = shown.map((row) => row.path).join('\0')

  useLayoutEffect(() => {
    order.current = shown.map((row) => row.path)
    const ul = list.current
    const next = new Map<string, number>()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    Array.from(ul?.children ?? []).forEach((child, index) => {
      const path = shown[index]?.path
      if (!path || !(child instanceof HTMLElement)) return
      const top = child.offsetTop
      next.set(path, top)
      const before = tops.current.get(path)
      if (still || before === undefined || before === top) return
      child.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], SLIDE)
    })
    tops.current = next
    // Only a change of order or membership moves rows; a new size on its own does not.
  }, [keys])

  return {
    rows: shown,
    list,
    hover: { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }
  }
}
