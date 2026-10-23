import type { StorageItem } from './types'

export function freedBytes(items: StorageItem[], target: string): number {
  for (const item of items) {
    if (item.path === target) return item.bytes
    const child = item.children.find((entry) => entry.path === target)
    if (child) return child.bytes
  }
  return 0
}

export function isTrashPath(filePath: string): boolean {
  return filePath === '/.Trash' || filePath.endsWith('/.Trash') || filePath.includes('/.Trash/')
}

export function clearTrash(items: StorageItem[]): StorageItem[] {
  return items.flatMap((item) => {
    if (item.shadow && isTrashPath(item.path)) return []
    if (item.id === 'trash') return [{ ...item, bytes: 0, children: [], complete: true }]
    return [item]
  })
}

// `knownBytes` covers paths deeper than an item's listed children, which `freedBytes` cannot see.
export function applyTrash(items: StorageItem[], target: string, knownBytes = 0): StorageItem[] {
  const bytes = freedBytes(items, target) || knownBytes
  return items.flatMap((item) => {
    if (item.path === target) return []
    const child = item.children.find((entry) => entry.path === target)
    if (child) {
      const children = item.children.filter((entry) => entry.path !== target)
      if (item.id === 'node-modules' && children.length === 0) return []
      return [{ ...item, children, bytes: Math.max(0, item.bytes - child.bytes) }]
    }
    if (!item.shadow && item.path && target.startsWith(`${item.path}/`)) {
      const children = item.children.map((entry) =>
        target.startsWith(`${entry.path}/`) ? { ...entry, bytes: Math.max(0, entry.bytes - bytes) } : entry
      )
      return [{ ...item, children, bytes: Math.max(0, item.bytes - bytes) }]
    }
    return [item]
  })
}

// Moving to the Trash frees nothing yet: the bytes now sit in the Trash until it is emptied.
export function addToTrash(items: StorageItem[], bytes: number): StorageItem[] {
  if (bytes <= 0) return items
  return items.map((item) => (item.id === 'trash' ? { ...item, bytes: item.bytes + bytes } : item))
}
