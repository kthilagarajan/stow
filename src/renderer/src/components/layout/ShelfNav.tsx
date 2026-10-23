import type { SegmentTotals } from '@shared/segments'
import type { ActivityTask, StorageItem } from '@shared/types'
import { Trash2 } from 'lucide-react'
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
  trashBytes,
  emptying,
  loading,
  activity,
  onEmptyTrash
}: {
  active: ShelfId
  onSelect: (shelf: ShelfId) => void
  totals: SegmentTotals
  items: StorageItem[]
  used: number
  version: string | null
  trashBytes: number
  emptying: boolean
  loading: boolean
  activity: ActivityTask[]
  onEmptyTrash: () => void
}) {
  return (
    <nav aria-label="What to show" className="flex h-full min-h-0 flex-col rounded-2xl px-2 py-3">
      <ul className="flex flex-col gap-1">
        {shelves.map((shelf) => {
          const selected = shelf.id === active
          return (
            <li key={shelf.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(shelf.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-[background-color,box-shadow,transform] duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor',
                  selected ? 'bg-raised ring-line shadow-[0_8px_24px_rgb(var(--shadow)/0.08)] ring-1' : 'hover:bg-raised/60'
                )}
              >
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
              </button>
            </li>
          )
        })}
      </ul>
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
        {version && <p className="text-mist px-1.5 pt-3 text-[11px]">Version {version}</p>}
      </div>
    </nav>
  )
}
