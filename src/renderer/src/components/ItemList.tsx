import { useState } from 'react'
import type { StorageItem, TrashTarget, Verdict } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { FileIcon } from '@/components/FileIcon'
import { useFileIcons } from '@/hooks/useFileIcons'
import { formatBytes } from '@/lib/format'
import { canLookInside } from '@/lib/browse'
import { shelves, verdictOrder, verdicts, type ShelfId } from '@/lib/verdicts'
import { cn } from '@/lib/utils'

interface Group {
  id: string
  label: string
  items: StorageItem[]
}

function matches(item: StorageItem, query: string): boolean {
  if (!query) return true
  const hay = [item.title, item.path, item.summary, item.group, ...item.children.flatMap((child) => [child.name, child.path])]
    .join(' ')
    .toLowerCase()
  return hay.includes(query)
}

export function itemsForShelf(items: StorageItem[], shelf: ShelfId, query: string): StorageItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((item) => {
    if (shelf === 'large') {
      if (!item.shadow) return false
    } else if (item.shadow || (shelf !== 'everything' && item.verdict !== shelf)) {
      return false
    }
    return matches(item, q)
  })
}

function groupsFor(items: StorageItem[], shelf: ShelfId): Group[] {
  const sorted = (list: StorageItem[]) => [...list].sort((a, b) => b.bytes - a.bytes)
  if (shelf === 'large') return [{ id: 'large', label: 'Over 500 MB', items: sorted(items) }]
  if (shelf === 'everything') {
    return verdictOrder
      .map((verdict) => ({
        id: verdict,
        label: verdicts[verdict].label,
        items: sorted(items.filter((item) => item.verdict === verdict))
      }))
      .filter((group) => group.items.length > 0)
  }
  const map = new Map<string, StorageItem[]>()
  for (const item of items) {
    const list = map.get(item.group) ?? []
    list.push(item)
    map.set(item.group, list)
  }
  return [...map.entries()]
    .map(([label, groupItems]) => ({
      id: label,
      label,
      items: sorted(groupItems)
    }))
    .sort((a, b) => sum(b.items) - sum(a.items))
}

function sum(items: StorageItem[]): number {
  return items.reduce((total, item) => total + item.bytes, 0)
}

function barColor(verdict: Verdict): string {
  return verdicts[verdict].bin
}

export function ItemList({
  items,
  shelf,
  query,
  selectedId,
  scanning,
  scanned,
  onSelect,
  onOpen,
  onTrashMany
}: {
  items: StorageItem[]
  shelf: ShelfId
  query: string
  selectedId: string | null
  scanning: boolean
  scanned: boolean
  onSelect: (id: string) => void
  onOpen: (filePath: string, label: string, summary: string) => void
  onTrashMany: (targets: TrashTarget[]) => void
}) {
  const visible = itemsForShelf(items, shelf, query)
  const groups = groupsFor(visible, shelf)
  const shelfMeta = shelves.find((entry) => entry.id === shelf)
  const icons = useFileIcons(visible.map((item) => item.path))
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const trashable = visible.filter((item) => item.trashable && item.path)
  const picked = trashable.filter((item) => checked.has(item.path))
  let index = 0

  if (visible.length === 0) {
    return (
      <p className="text-mist px-1 py-8 text-sm leading-relaxed">
        {query
          ? 'No folders match that filter.'
          : scanning
            ? 'Measuring the usual places where caches and old downloads hide.'
            : scanned
              ? `Nothing in ${shelfMeta?.label ?? 'this shelf'} turned up on the last scan.`
              : 'Nothing has been scanned yet. Use Scan when you want Stow to measure this Mac. The result is kept for the next time you open it.'}
      </p>
    )
  }

  function toggle(filePath: string): void {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {trashable.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => setChecked(new Set(picked.length === trashable.length ? [] : trashable.map((item) => item.path)))}
            className="text-harbor text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
          >
            {picked.length === trashable.length ? 'Clear selection' : 'Select all that can go'}
          </button>
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onTrashMany(
                  picked.map((item) => ({
                    path: item.path,
                    title: item.title,
                    verdict: item.verdict,
                    summary: item.summary,
                    bytes: item.bytes
                  }))
                )
              }
              className="bg-coral rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
            >
              Move {picked.length === 1 ? '1 item' : `${picked.length} items`} to Trash
            </button>
          )}
        </div>
      )}
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 id={`group-${group.id}`} className="font-display text-sm tracking-tight">
              {group.label}
            </h2>
            <span className="text-mist font-mono text-[11px]">{formatBytes(sum(group.items))}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {group.items.map((item) => {
              const deferred = index >= 8
              index += 1
              const selected = item.id === selectedId
              const openable = canLookInside(item.path)
              return (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-stretch rounded-xl border border-transparent bg-white/45',
                    deferred && 'item-deferred',
                    selected && 'bg-sheet'
                  )}
                  style={selected ? { borderColor: barColor(item.verdict) } : undefined}
                >
                  <span className="grid w-8 shrink-0 place-items-center">
                    {item.trashable && item.path ? (
                      <input
                        type="checkbox"
                        checked={checked.has(item.path)}
                        onChange={() => toggle(item.path)}
                        aria-label={`Select ${item.title}`}
                        className="size-4"
                        style={{ accentColor: '#24497A' }}
                      />
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(item.id)}
                    className="flex min-w-0 flex-1 gap-3 py-2.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                  >
                    <span className="mt-0.5 w-1 shrink-0 self-stretch rounded-full" style={{ background: barColor(item.verdict) }} aria-hidden />
                    <FileIcon src={icons[item.path]} kind={openable ? 'folder' : 'file'} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold tracking-tight">{item.title}</span>
                        <span className="shrink-0 font-mono text-sm">{formatBytes(item.bytes)}</span>
                      </span>
                      <span className="text-mist mt-0.5 block truncate text-sm">{item.summary}</span>
                    </span>
                  </button>
                  {openable && (
                    <button
                      type="button"
                      aria-label={`Look inside ${item.title}`}
                      onClick={() => onOpen(item.path, item.title, item.summary)}
                      className="text-harbor hover:bg-fog my-1.5 mr-1.5 grid size-8 shrink-0 place-items-center self-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
