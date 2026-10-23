import type { MouseEvent } from 'react'
import type { StorageItem, TrashTarget, Verdict } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { FileIcon } from '@/components/common/FileIcon'
import { IconAction, ListRow } from '@/components/common/ListRow'
import { SelectionBar } from '@/components/browse/SelectionBar'
import { RowSkeletons } from '@/components/common/Skeletons'
import { useFileIcons } from '@/hooks/useFileIcons'
import { isMultiClick, useSelection } from '@/hooks/useSelection'
import { formatBytes } from '@/lib/format'
import { canLookInside, diskName, tagFor } from '@/lib/browse'
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
  loaded,
  compact,
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
  loaded: boolean
  compact: boolean
  onSelect: (id: string | null) => void
  onOpen: (filePath: string, label: string, summary: string) => void
  onTrashMany: (targets: TrashTarget[]) => void
}) {
  const visible = itemsForShelf(items, shelf, query)
  const groups = groupsFor(visible, shelf)
  const shelfMeta = shelves.find((entry) => entry.id === shelf)
  const icons = useFileIcons(visible.map((item) => item.path))
  const trashable = visible.filter((item) => item.trashable && item.path)
  const selection = useSelection(trashable.map((item) => item.id))
  const picked = trashable.filter((item) => selection.has(item.id))
  let index = 0

  if (!loaded || (scanning && visible.length === 0 && !query)) {
    return <RowSkeletons compact={compact} count={8} label={loaded ? 'Measuring' : 'Opening the last scan'} />
  }

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

  function click(event: MouseEvent, item: StorageItem): void {
    if (isMultiClick(event) && item.trashable && item.path) {
      selection.toggle(item.id, selectedId)
      onSelect(item.id)
      return
    }
    // Clicking the only selected row again lets it go.
    const again = picked.length < 2 && item.id === selectedId
    selection.clear()
    onSelect(again ? null : item.id)
  }

  function toTarget(item: StorageItem): TrashTarget {
    return { path: item.path, title: diskName(item.path, item.title), verdict: item.verdict, summary: item.summary, bytes: item.bytes }
  }

  return (
    <>
      <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-5', picked.length > 1 && 'pb-16')}>
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 id={`group-${group.id}`} className="font-display text-sm tracking-tight">
                {group.label}
              </h2>
              <span className="text-mist font-mono text-[11px]">{formatBytes(sum(group.items))}</span>
            </div>
            <ul className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1.5')}>
              {group.items.map((item) => {
                const deferred = index >= 8
                index += 1
                const selected = picked.length > 1 ? selection.has(item.id) : item.id === selectedId
                const openable = canLookInside(item.path)
                return (
                  <ListRow
                    key={item.id}
                    title={diskName(item.path, item.title)}
                    tag={tagFor(item)}
                    bytes={item.bytes}
                    summary={item.summary}
                    color={barColor(item.verdict)}
                    icon={<FileIcon src={icons[item.path]} kind={openable ? 'folder' : 'file'} className={compact ? 'size-6' : undefined} />}
                    selected={selected}
                    compact={compact}
                    deferred={deferred}
                    index={index - 1}
                    onClick={(event) => click(event, item)}
                    onDoubleClick={openable ? () => onOpen(item.path, diskName(item.path, item.title), item.summary) : undefined}
                    actions={
                      <>
                        {openable ? (
                          <IconAction
                            label="Look inside"
                            icon={ChevronRight}
                            onClick={() => onOpen(item.path, diskName(item.path, item.title), item.summary)}
                          />
                        ) : (
                          <span className="size-8" aria-hidden />
                        )}
                      </>
                    }
                  />
                )
              })}
            </ul>
          </section>
        ))}
        {scanning && <RowSkeletons compact={compact} count={2} label="Measuring" />}
      </div>
      <SelectionBar
        count={picked.length}
        bytes={sum(picked)}
        onClear={selection.clear}
        onTrash={() => onTrashMany(picked.map(toTarget))}
      />
    </>
  )
}
