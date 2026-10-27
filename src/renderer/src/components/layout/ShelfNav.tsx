import type { SegmentTotals } from '@shared/segments'
import type { Place } from '@shared/places'
import type { ActivityTask, StorageItem } from '@shared/types'
import type { ReactNode } from 'react'
import { Clock, Folder, Plus, TerminalSquare, Trash2, X } from 'lucide-react'
import { IconAction } from '@/components/common/ListRow'
import { Skeleton } from '@/components/common/Skeletons'
import { ActivityStatus } from '@/components/layout/ActivityStatus'
import { formatBytes } from '@/lib/format'
import { shelves, type ShelfId } from '@/lib/verdicts'
import { cn } from '@/lib/utils'
import { BIN } from '@/lib/bin'

function shelfBytes(id: ShelfId, totals: SegmentTotals, items: StorageItem[], used: number): number {
  if (id === 'everything') return used
  if (id === 'large') return items.filter((item) => item.shadow).reduce((sum, item) => sum + item.bytes, 0)
  return totals[id]
}

export function ShelfNav({
  active,
  onSelect,
  totals,
  items,
  used,
  version,
  note,
  trashBytes,
  emptying,
  loading,
  activity,
  tools,
  onTools,
  places,
  activePlace,
  onPlace,
  onAddPlace,
  onRemovePlace,
  onEmptyTrash
}: {
  active: ShelfId
  onSelect: (shelf: ShelfId) => void
  totals: SegmentTotals
  items: StorageItem[]
  used: number
  version: string | null
  // When the disk was last scanned, or what the scan is doing now.
  note: string
  trashBytes: number
  emptying: boolean
  loading: boolean
  activity: ActivityTask[]
  // The developer tools view is showing instead of a shelf.
  tools: boolean
  onTools: () => void
  places: Place[]
  // The sidebar folder open in the middle pane, if any.
  activePlace: string | null
  onPlace: (place: Place) => void
  onAddPlace: () => void
  onRemovePlace: (filePath: string) => void
  onEmptyTrash: () => void
}) {
  const shelfShowing = !tools && !activePlace
  return (
    <nav aria-label="What to show" className="flex h-full min-h-0 flex-col rounded-2xl px-2 py-3">
      <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-1">
          {shelves.map((shelf) => (
            <li key={shelf.id}>
              <NavButton selected={shelfShowing && shelf.id === active} onClick={() => onSelect(shelf.id)}>
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-md"
                  style={{ background: `color-mix(in srgb, ${shelf.color} 14%, transparent)`, color: shelf.color }}
                  aria-hidden
                >
                  <shelf.icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{shelf.label}</span>
                {loading ? (
                  <Skeleton className="h-3 w-12" />
                ) : (
                  <span className="fade-in text-mist font-mono text-[11px]">{formatBytes(shelfBytes(shelf.id, totals, items, used))}</span>
                )}
              </NavButton>
            </li>
          ))}
          <li className="mt-2">
            <NavButton selected={tools} onClick={onTools}>
              <span className="bg-harbor/10 text-harbor grid size-6 shrink-0 place-items-center rounded-md" aria-hidden>
                <TerminalSquare className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">Developer tools</span>
            </NavButton>
          </li>
        </ul>
        <section aria-labelledby="places-title" className="mt-4">
          <div className="flex items-center justify-between pr-0.5 pl-2.5">
            <h2 id="places-title" className="text-mist text-[11px] font-semibold tracking-wide uppercase">
              Folders
            </h2>
            <IconAction label="Add a folder" icon={Plus} onClick={onAddPlace} />
          </div>
          {places.length === 0 ? (
            <p className="text-mist px-2.5 pt-1 text-xs leading-relaxed">Folders you go to are kept here.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {places.map((place) => (
                <li key={place.path} className="group/place relative">
                  <NavButton selected={activePlace === place.path} onClick={() => onPlace(place)} title={place.path}>
                    <span className="text-mist grid size-6 shrink-0 place-items-center" aria-hidden>
                      <Folder className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate pr-6 text-sm font-semibold tracking-tight">{place.name}</span>
                  </NavButton>
                  <span className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 transition-opacity group-hover/place:opacity-100 focus-within:opacity-100">
                    <IconAction label={`Remove ${place.name} from the sidebar`} icon={X} onClick={() => onRemovePlace(place.path)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="mt-auto px-1 pt-4">
        <ActivityStatus tasks={activity} />
        <button
          type="button"
          onClick={onEmptyTrash}
          disabled={emptying}
          className="border-coral/30 text-coral hover:bg-coral/10 focus-visible:outline-harbor w-full rounded-xl border px-2.5 py-2 text-left disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Trash2 className="size-4" aria-hidden />
              {emptying ? 'Emptying…' : `Empty ${BIN}`}
            </span>
            {/* Without Full Disk Access macOS hides what is in the bin, so 0 means "unknown", not "empty". */}
            {trashBytes > 0 && <span className="font-mono text-[11px]">{formatBytes(trashBytes)}</span>}
          </span>
        </button>
        <p role="status" className="text-mist flex items-center gap-1.5 px-1.5 pt-3 text-xs">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{note}</span>
        </p>
        {version && <p className="text-mist/70 px-1.5 pt-1 text-[11px]">Version {version}</p>}
      </div>
    </nav>
  )
}

function NavButton({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor',
        selected ? 'bg-raised ring-line shadow-[0_8px_24px_rgb(var(--shadow)/0.08)] ring-1' : 'hover:bg-raised/60'
      )}
    >
      {children}
    </button>
  )
}
