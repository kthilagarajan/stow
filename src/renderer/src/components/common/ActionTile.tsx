import type { LucideIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function ActionTile({
  icon: Icon,
  label,
  hint,
  onClick,
  iconClassName
}: {
  icon: LucideIcon
  label: string
  hint: string
  onClick: () => void
  iconClassName?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="group/tile border-line bg-sheet hover:bg-fog flex min-w-0 flex-col items-center gap-1.5 rounded-xl border px-1 pt-2.5 pb-2 text-xs font-semibold tracking-tight transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor active:scale-[0.97]"
        >
          <Icon
            className={cn('text-harbor size-[18px] transition-transform group-hover/tile:-translate-y-0.5 motion-reduce:transition-none', iconClassName)}
            aria-hidden
          />
          <span className="max-w-full truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
