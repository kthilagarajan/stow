import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ListRow({
  title,
  tag,
  bytes,
  summary,
  color,
  icon,
  selected,
  compact,
  deferred,
  index = 0,
  onClick,
  onDoubleClick,
  actions
}: {
  title: string
  // A friendlier label shown next to the on-disk name when they differ.
  tag?: string
  bytes: number
  summary: string
  color: string
  icon: ReactNode
  selected: boolean
  compact: boolean
  deferred?: boolean
  // Position in the list, used to stagger the entrance.
  index?: number
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDoubleClick?: () => void
  actions?: ReactNode
}) {
  return (
    <li
      className={cn(
        'group rise flex items-center transition-[background-color,box-shadow] duration-200 has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-harbor/40',
        compact ? 'rounded-lg' : 'rounded-xl',
        selected ? 'bg-raised shadow-[0_4px_16px_rgba(21,32,51,0.10)] ring-1 ring-harbor/20' : 'bg-fog/35 hover:bg-fog/80',
        deferred && (compact ? 'item-deferred-compact' : 'item-deferred')
      )}
      style={{ '--i': index } as CSSProperties}
    >
      <button
        type="button"
        aria-pressed={selected}
        title={compact ? summary : undefined}
        onClick={(event) => {
          // The second click of a double-click opens; it should not undo the first click's selection.
          if (event.detail < 2) onClick(event)
        }}
        onDoubleClick={onDoubleClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 pr-2 pl-2 text-left outline-none select-none',
          compact ? 'rounded-lg py-1.5' : 'rounded-xl py-2.5'
        )}
      >
        <span
          className={cn('w-1 shrink-0 rounded-full', compact ? 'h-5' : 'self-stretch')}
          style={{ background: color }}
          aria-hidden
        />
        {icon}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2 leading-tight">
            <span className={cn('truncate font-semibold tracking-tight', compact && 'text-sm', selected && 'text-harbor')}>{title}</span>
            {tag && <span className="text-mist shrink-0 text-xs">{tag}</span>}
          </span>
          {!compact && <span className="text-mist block truncate text-sm leading-snug">{summary}</span>}
        </span>
        <span className={cn('shrink-0 font-mono', compact ? 'text-xs' : 'text-sm')}>{formatBytes(bytes)}</span>
      </button>
      {actions && <span className="flex shrink-0 items-center gap-0.5 pr-1.5">{actions}</span>}
    </li>
  )
}

export function IconAction({
  label,
  icon: Icon,
  onClick,
  danger,
  disabled
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'grid size-8 place-items-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor disabled:opacity-40',
            danger ? 'text-coral hover:bg-coral/10' : 'text-harbor hover:bg-fog'
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
