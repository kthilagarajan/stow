import { useMemo, useState } from 'react'
import type { FolderEntry, TrashTarget } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileIcon } from '@/components/FileIcon'
import { useFileIcons } from '@/hooks/useFileIcons'
import { formatBytes } from '@/lib/format'
import { canLookInside, type BrowseFrame } from '@/lib/browse'
import { verdicts } from '@/lib/verdicts'
import { cn } from '@/lib/utils'

export function FolderBrowser({
  stack,
  shelfLabel,
  opening,
  error,
  busyPath,
  onCrumb,
  onOpen,
  onPick,
  onTrash,
  onTrashMany
}: {
  stack: BrowseFrame[]
  shelfLabel: string
  opening: boolean
  error: string | null
  busyPath: string | null
  onCrumb: (index: number) => void
  onOpen: (entry: FolderEntry) => void
  onPick: (entry: FolderEntry) => void
  onTrash: (target: TrashTarget) => void
  onTrashMany: (targets: TrashTarget[]) => void
}) {
  const frame = stack[stack.length - 1]
  const [query, setQuery] = useState('')
  const icons = useFileIcons(frame ? [frame.path, ...frame.entries.map((entry) => entry.path)] : [])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const q = query.trim().toLowerCase()
  const entries = useMemo(() => {
    if (!frame) return []
    if (!q) return frame.entries
    return frame.entries.filter((entry) => `${entry.name} ${entry.path} ${entry.summary}`.toLowerCase().includes(q))
  }, [frame, q])

  if (!frame) return null

  const trashable = entries.filter((entry) => entry.trashable)
  const picked = trashable.filter((entry) => checked.has(entry.path))

  function toggle(filePath: string): void {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
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
              <p className="text-mist mt-1 font-mono text-xs">{formatBytes(frame.bytes)}</p>
            </div>
          </div>
        </div>
        <p className="text-mist mt-2 text-sm leading-relaxed">{frame.summary}</p>
        <search className="mt-3">
          <label htmlFor="folder-filter" className="sr-only">
            Filter folders inside {frame.label}
          </label>
          <input
            id="folder-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name"
            spellCheck={false}
            autoComplete="off"
            className="border-line bg-fog/70 focus-visible:outline-harbor h-9 w-full rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </search>
        {trashable.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setChecked(new Set(picked.length === trashable.length ? [] : trashable.map((entry) => entry.path)))}
              className="text-harbor text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
            >
              {picked.length === trashable.length ? 'Clear selection' : 'Select all that can go'}
            </button>
            {picked.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  onTrashMany(
                    picked.map((entry) => ({
                      path: entry.path,
                      title: entry.name,
                      verdict: entry.verdict,
                      summary: entry.summary,
                      bytes: entry.bytes
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
        {opening && (
          <p role="status" className="text-mist mt-2 text-xs">
            Measuring the next folder
          </p>
        )}
        {error && <p className="text-coral mt-2 text-sm leading-relaxed">{error}</p>}
        {frame.limited && (
          <p className="text-mist mt-2 text-xs leading-relaxed">macOS hid some files here, so this size may be low.</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {entries.length === 0 ? (
          <p className="text-mist px-1 py-8 text-sm leading-relaxed">
            {q ? 'No folders match that filter.' : 'Nothing large enough to list in this folder.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entries.map((entry, index) => {
              const openable = entry.kind !== 'file' && canLookInside(entry.path)
              const color = verdicts[entry.verdict].bin
              return (
                <li
                  key={entry.path}
                  className={cn('flex items-stretch gap-1 rounded-xl border border-transparent bg-white/45', index >= 8 && 'item-deferred')}
                >
                  <span className="grid w-8 shrink-0 place-items-center">
                    {entry.trashable ? (
                      <input
                        type="checkbox"
                        checked={checked.has(entry.path)}
                        onChange={() => toggle(entry.path)}
                        aria-label={`Select ${entry.name}`}
                        className="size-4"
                        style={{ accentColor: '#24497A' }}
                      />
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (openable) onOpen(entry)
                      else onPick(entry)
                    }}
                    className="flex min-w-0 flex-1 gap-3 py-2.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                  >
                    <span className="mt-0.5 w-1 shrink-0 self-stretch rounded-full" style={{ background: color }} aria-hidden />
                    <FileIcon src={icons[entry.path]} kind={entry.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold tracking-tight">{entry.name}</span>
                        <span className="shrink-0 font-mono text-sm">{formatBytes(entry.bytes)}</span>
                      </span>
                      <span className="text-mist mt-0.5 block truncate text-sm">{entry.summary}</span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1 pr-2">
                    {entry.trashable && (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyPath === entry.path}
                        onClick={() =>
                          onTrash({
                            path: entry.path,
                            title: entry.name,
                            verdict: entry.verdict,
                            summary: entry.summary,
                            bytes: entry.bytes
                          })
                        }
                      >
                        {busyPath === entry.path ? 'Moving…' : 'Trash'}
                      </Button>
                    )}
                    {openable && (
                      <button
                        type="button"
                        aria-label={`Look inside ${entry.name}`}
                        onClick={() => onOpen(entry)}
                        className="text-harbor hover:bg-fog grid size-8 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {frame.smallerCount > 0 && !q && (
          <p className="text-mist px-1 pt-3 text-xs leading-relaxed">
            {frame.smallerCount === 1 ? '1 smaller item' : `${frame.smallerCount} smaller items`}, {formatBytes(frame.smallerBytes)} together.
          </p>
        )}
      </div>
    </div>
  )
}
