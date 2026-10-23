import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cn('skeleton block', className)} style={style} aria-hidden />
}

// Widths vary row to row so the placeholder reads as a list, not a grid.
const TITLE = ['w-32', 'w-44', 'w-24', 'w-40', 'w-28', 'w-36']
const SUMMARY = ['w-72', 'w-60', 'w-80', 'w-64', 'w-56', 'w-68']

export function RowSkeletons({ count = 6, compact = false, label }: { count?: number; compact?: boolean; label?: string }) {
  return (
    <div role="status" aria-label={label ?? 'Loading'} className={cn('flex flex-col', compact ? 'gap-0.5' : 'gap-1.5')}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn('bg-fog/35 flex items-center gap-3 px-2', compact ? 'rounded-lg py-1.5' : 'rounded-xl py-2.5')}
          style={{ opacity: 1 - index * (0.6 / count) }}
        >
          <Skeleton className="w-1 self-stretch rounded-full" />
          <Skeleton className={compact ? 'size-6' : 'size-8'} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5 max-w-full', TITLE[index % TITLE.length])} />
            {!compact && <Skeleton className={cn('h-3 max-w-full', SUMMARY[index % SUMMARY.length])} />}
          </span>
          <Skeleton className="h-3.5 w-14" />
          <span className="size-8" />
        </div>
      ))}
    </div>
  )
}

export function FolderSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="fade-in flex min-h-0 flex-1 flex-col" role="status" aria-label="Measuring the folder">
      <div className="px-4 pt-4 pb-3">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 flex items-center gap-3">
          <Skeleton className="size-10" />
          <span className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-16" />
          </span>
        </div>
        <Skeleton className="mt-4 h-9 w-full rounded-lg" />
      </div>
      <div className="px-3">
        <RowSkeletons compact={compact} count={7} label="Measuring the folder" />
      </div>
    </div>
  )
}
