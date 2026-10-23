import type { SegmentTotals } from '@shared/segments'
import type { StorageItem } from '@shared/types'
import { formatBytes } from '@/lib/format'
import { shelves, type ShelfId } from '@/lib/verdicts'
import { cn } from '@/lib/utils'

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
  used
}: {
  active: ShelfId
  onSelect: (shelf: ShelfId) => void
  totals: SegmentTotals
  items: StorageItem[]
  used: number
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
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor',
                  selected ? 'bg-sheet shadow-[0_8px_24px_rgba(21,32,51,0.05)]' : 'hover:bg-white/70'
                )}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: shelf.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{shelf.label}</span>
                <span className="text-mist font-mono text-[11px]">{formatBytes(shelfBytes(shelf.id, totals, items, used))}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-mist mt-auto px-2.5 pt-4 text-[11px] leading-relaxed">
        Move to Trash leaves a way back. Scanning stays on this Mac.
      </p>
    </nav>
  )
}
