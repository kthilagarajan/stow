import type { StorageItem, Verdict } from './types'

export interface SegmentTotals {
  mandatory: number
  keep: number
  optional: number
  clear: number
  other: number
  free: number
}

function isInside(parent: string, child: string): boolean {
  if (!parent || !child) return false
  return child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

function nodesOf(item: StorageItem): { path: string; bytes: number }[] {
  if (item.liftFromParent && item.children.length > 0) {
    return item.children.map((child) => ({ path: child.path, bytes: child.bytes }))
  }
  return [{ path: item.path, bytes: item.bytes }]
}

function owningParent(parents: StorageItem[], childPath: string): StorageItem | undefined {
  let best: StorageItem | undefined
  for (const parent of parents) {
    if (!isInside(parent.path, childPath)) continue
    if (!best || parent.path.length > best.path.length) best = parent
  }
  return best
}

function directlyContains(outer: StorageItem, inner: StorageItem, parents: StorageItem[]): boolean {
  if (outer.id === inner.id || outer.path === inner.path) return false
  if (!isInside(outer.path, inner.path)) return false
  return !parents.some(
    (mid) =>
      mid.id !== outer.id &&
      mid.id !== inner.id &&
      mid.path !== outer.path &&
      mid.path !== inner.path &&
      isInside(outer.path, mid.path) &&
      isInside(mid.path, inner.path)
  )
}

export function segmentTotals(items: StorageItem[], used: number, free: number): SegmentTotals {
  const totals: SegmentTotals = {
    mandatory: 0,
    keep: 0,
    optional: 0,
    clear: 0,
    other: 0,
    free: Math.max(0, free)
  }
  const parents = items.filter((item) => !item.shadow && !item.liftFromParent)
  const subtracted = new Map<string, number>()

  for (const item of items) {
    if (item.shadow || !item.liftFromParent) continue
    for (const node of nodesOf(item)) {
      const parent = owningParent(parents, node.path)
      if (parent?.complete) {
        totals[item.verdict] += node.bytes
        subtracted.set(parent.id, (subtracted.get(parent.id) ?? 0) + node.bytes)
      } else if (!parent) {
        totals[item.verdict] += node.bytes
      }
    }
  }

  for (const parent of parents) {
    let left = parent.bytes - (subtracted.get(parent.id) ?? 0)
    for (const other of parents) {
      if (directlyContains(parent, other, parents)) left -= other.bytes
    }
    totals[parent.verdict] += Math.max(0, left)
  }

  const classified = totals.mandatory + totals.keep + totals.optional + totals.clear
  totals.other = Math.max(0, used - classified)
  return totals
}

export function bytesFor(totals: SegmentTotals, verdict: Verdict): number {
  return totals[verdict]
}
