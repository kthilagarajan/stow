import type { SegmentTotals } from '@shared/segments'
import { Clock } from 'lucide-react'
import type { ShelfId } from '@/lib/verdicts'
import { verdicts } from '@/lib/verdicts'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Piece {
  id: string
  label: string
  bytes: number
  color: string
  ink: string
  shelf: ShelfId | null
  striped?: boolean
}

function piecesFrom(totals: SegmentTotals): Piece[] {
  return [
    { id: 'clear', label: verdicts.clear.label, bytes: totals.clear, color: verdicts.clear.bin, ink: verdicts.clear.ink, shelf: 'clear' },
    { id: 'optional', label: verdicts.optional.label, bytes: totals.optional, color: verdicts.optional.bin, ink: verdicts.optional.ink, shelf: 'optional' },
    { id: 'keep', label: verdicts.keep.label, bytes: totals.keep, color: verdicts.keep.bin, ink: verdicts.keep.ink, shelf: 'keep' },
    { id: 'mandatory', label: verdicts.mandatory.label, bytes: totals.mandatory, color: verdicts.mandatory.bin, ink: verdicts.mandatory.ink, shelf: 'mandatory' },
    { id: 'other', label: 'Not sorted', bytes: totals.other, color: '#8EA0B5', ink: '#152033', shelf: null },
    { id: 'free', label: 'Free', bytes: totals.free, color: 'transparent', ink: 'var(--ink)', shelf: null, striped: true }
  ]
}

export function StorageWall({
  totals,
  active,
  onSelect,
  ready,
  note
}: {
  totals: SegmentTotals
  active: ShelfId
  onSelect: (shelf: ShelfId) => void
  ready: boolean
  note: string
}) {
  if (!ready) {
    return (
      <div aria-hidden>
        <div className="skeleton h-[92px] rounded-[22px]" />
        <div className="mt-2.5 flex gap-4">
          {[20, 16, 24, 18, 20, 12].map((width, index) => (
            <span key={index} className="skeleton h-3" style={{ width: `${width * 4}px` }} />
          ))}
        </div>
      </div>
    )
  }

  const pieces = piecesFrom(totals).filter((piece) => piece.bytes > 0 || piece.id === 'free')
  const span = pieces.reduce((sum, piece) => sum + piece.bytes, 0) || 1

  return (
    <div>
      <div className="bg-well flex h-[92px] gap-1 rounded-[22px] p-1.5" role="group" aria-label="How this disk is divided">
        {pieces.map((piece) => {
          const wide = piece.bytes / span > 0.11
          const className = cn(
            'bin-segment flex min-w-3 flex-col justify-end overflow-hidden rounded-2xl px-3 py-2 text-left',
            piece.striped && 'bin-free',
            piece.shelf && active === piece.shelf && 'ring-ink ring-2 ring-offset-2 ring-offset-well'
          )
          const style = {
            flexGrow: Math.max(piece.bytes, 1),
            flexBasis: 0,
            background: piece.striped ? undefined : piece.color,
            color: piece.ink
          }
          const label = (
            <span className={cn('min-w-0', !wide && 'sr-only')}>
              <span className="block truncate text-[11px] font-semibold tracking-tight">{piece.label}</span>
              <span className="font-mono text-sm leading-none">{formatBytes(piece.bytes)}</span>
            </span>
          )
          if (!piece.shelf) {
            return (
              <div key={piece.id} className={className} style={style} aria-label={`${piece.label}, ${formatBytes(piece.bytes)}`}>
                {label}
              </div>
            )
          }
          return (
            <button
              key={piece.id}
              type="button"
              className={className}
              style={style}
              aria-pressed={active === piece.shelf}
              aria-label={`${piece.label}, ${formatBytes(piece.bytes)}`}
              onClick={() => onSelect(piece.shelf as ShelfId)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {piecesFrom(totals).map((piece) => (
            <li key={piece.id} className="flex items-center gap-1.5 text-xs">
              <span
                className={cn('size-2 rounded-full', piece.striped && 'bin-free border-line border')}
                style={{ background: piece.striped ? undefined : piece.color }}
                aria-hidden
              />
              <span className="text-ink">{piece.label}</span>
              <span className="text-mist font-mono">{formatBytes(piece.bytes)}</span>
            </li>
          ))}
        </ul>
        <p role="status" className="text-mist flex shrink-0 items-center gap-1.5 text-xs">
          <Clock className="size-3.5" aria-hidden />
          {note}
        </p>
      </div>
    </div>
  )
}
