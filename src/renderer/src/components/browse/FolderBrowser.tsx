import { useEffect, useMemo, useState } from 'react'
import type { FolderEntry, TrashTarget } from '@shared/types'
import { ChevronRight, Search } from 'lucide-react'
import { FileIcon } from '@/components/common/FileIcon'
import { IconAction, ListRow } from '@/components/common/ListRow'
import { MultiHint, SelectionBar } from '@/components/browse/SelectionBar'
import { RowSkeletons, Skeleton } from '@/components/common/Skeletons'
import { useFileIcons } from '@/hooks/useFileIcons'
import { isMultiClick, useSelection } from '@/hooks/useSelection'
import { formatBytes } from '@/lib/format'
import { canLookInside, type BrowseFrame } from '@/lib/browse'
import { verdicts } from '@/lib/verdicts'
import { cn } from '@/lib/utils'

export function FolderBrowser({
  stack,
  shelfLabel,
  opening,
  error,
  pickedPath,
  compact,
  onCrumb,
  onOpen,
  onPick,
  onTrashMany
}: {
  stack: BrowseFrame[]
  shelfLabel: string
  opening: boolean
  error: string | null
  pickedPath: string | null
  compact: boolean
  onCrumb: (index: number) => void
  onOpen: (entry: FolderEntry) => void
  onPick: (entry: FolderEntry | null) => void
  onTrashMany: (targets: TrashTarget[]) => void
}) {
  const frame = stack[stack.length - 1]
  const [query, setQuery] = useState('')
  const icons = useFileIcons(frame ? [frame.path, ...frame.entries.map((entry) => entry.path)] : [])
  const q = query.trim().toLowerCase()
  const framePath = frame?.path

  // The browser stays mounted while you move between folders; only the filter starts fresh.
  useEffect(() => {
    setQuery('')
  }, [framePath])
  const entries = useMemo(() => {
    if (!frame) return []
    if (!q) return frame.entries
    return frame.entries.filter((entry) => `${entry.name} ${entry.path} ${entry.summary}`.toLowerCase().includes(q))
  }, [frame, q])

  const trashable = entries.filter((entry) => entry.trashable)
  const selection = useSelection(trashable.map((entry) => entry.path))

  if (!frame) return null

  const picked = trashable.filter((entry) => selection.has(entry.path))

  function toTarget(entry: FolderEntry): TrashTarget {
    return { path: entry.path, title: entry.name, verdict: entry.verdict, summary: entry.summary, bytes: entry.bytes }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4 pb-3">
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => onCrumb(-1)}
            className="text-mist hover:text-ink rounded-md px-1.5 py-0.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
          >
            {shelfLabel}
          </button>
          {stack.map((entry, index) => {
            const last = index === stack.length - 1
            return (
              <span key={entry.path} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="text-mist size-3.5 shrink-0" aria-hidden />
                {last ? (
                  <span className="truncate text-sm font-semibold">{entry.label}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCrumb(index)}
                    className="text-mist hover:text-ink max-w-40 truncate rounded-md px-1.5 py-0.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                  >
                    {entry.label}
                  </button>
                )}
              </span>
            )
          })}
        </nav>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <FileIcon src={icons[frame.path]} kind="folder" className="size-10" />
            <div className="min-w-0">
              <h1 className="font-display truncate text-[1.65rem] leading-none tracking-tight">{frame.label}</h1>
              {frame.measuring && frame.bytes === 0 ? (
                <Skeleton className="mt-1 h-3 w-16" />
              ) : (
                <p className="text-mist mt-1 font-mono text-xs">{formatBytes(frame.bytes)}</p>
              )}
            </div>
          </div>
          {trashable.length > 1 && <MultiHint />}
        </div>
        {!compact && <p className="text-mist mt-2 text-sm leading-relaxed">{frame.summary}</p>}
        <search className="relative mt-3">
          <label htmlFor="folder-filter" className="sr-only">
            Filter folders inside {frame.label}
          </label>
          <Search className="text-mist pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <input
            id="folder-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name"
            spellCheck={false}
            autoComplete="off"
            className="border-line bg-fog/70 focus-visible:outline-harbor h-9 w-full rounded-lg border pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </search>
        {frame.measuring && !opening && (
          <p className="text-mist mt-2 flex items-center gap-2 text-xs leading-relaxed" role="status">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            Measuring sizes
          </p>
        )}
        {error && <p className="text-coral mt-2 text-sm leading-relaxed">{error}</p>}
        {frame.limited && (
          <p className="text-mist mt-2 text-xs leading-relaxed">macOS hid some files here, so this size may be low.</p>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn('h-full overflow-auto px-3 pt-1', picked.length > 1 ? 'pb-20' : 'pb-4')}>
          {opening ? (
            <RowSkeletons compact={compact} count={Math.min(8, Math.max(3, entries.length))} label="Measuring the next folder" />
          ) : entries.length === 0 ? (
            <p className="text-mist px-1 py-8 text-sm leading-relaxed">
              {q ? 'Nothing matches that filter.' : 'This folder is empty.'}
            </p>
          ) : (
            <ul className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1.5')}>
              {entries.map((entry, index) => {
                const openable = entry.kind !== 'file' && canLookInside(entry.path)
                const selected = picked.length > 1 ? selection.has(entry.path) : entry.path === pickedPath
                return (
                  <ListRow
                    key={entry.path}
                    title={entry.name}
                    bytes={entry.bytes}
                    pending={!entry.measured}
                    summary={entry.summary}
                    color={verdicts[entry.verdict].bin}
                    icon={<FileIcon src={icons[entry.path]} kind={entry.kind} className={compact ? 'size-6' : undefined} />}
                    selected={selected}
                    compact={compact}
                    deferred={index >= 8}
                  index={index}
                    onClick={(event) => {
                      if (isMultiClick(event) && entry.trashable) {
                        selection.toggle(entry.path, pickedPath)
                        onPick(entry)
                        return
                      }
                      const again = picked.length < 2 && entry.path === pickedPath
                      selection.clear()
                      onPick(again ? null : entry)
                    }}
                    onDoubleClick={openable ? () => onOpen(entry) : undefined}
                    actions={
                      <>
                        {openable ? (
                          <IconAction label="Look inside" icon={ChevronRight} onClick={() => onOpen(entry)} />
                        ) : (
                          <span className="size-8" aria-hidden />
                        )}
                      </>
                    }
                  />
                )
              })}
            </ul>
          )}
          {frame.smallerCount > 0 && !q && !opening && !frame.measuring && (
            <p className="text-mist px-1 pt-3 text-xs leading-relaxed">
              {frame.smallerCount === 1 ? '1 smaller item' : `${frame.smallerCount} smaller items`}, {formatBytes(frame.smallerBytes)} together.
            </p>
          )}
        </div>
        <SelectionBar
          count={picked.length}
          bytes={picked.reduce((total, entry) => total + entry.bytes, 0)}
          onClear={selection.clear}
          onTrash={() => onTrashMany(picked.map(toTarget))}
        />
      </div>
    </div>
  )
}
