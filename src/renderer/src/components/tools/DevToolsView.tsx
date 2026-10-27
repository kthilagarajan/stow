import type { DevTool, DevToolId } from '@shared/types'
import { RefreshCw, TerminalSquare } from 'lucide-react'
import { ListRow } from '@/components/common/ListRow'
import { RowSkeletons } from '@/components/common/Skeletons'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buttonVariants } from '@/components/ui/button'
import { verdicts } from '@/lib/verdicts'

// The middle pane for developer tools: one row per tool found on this Mac.
export function DevToolsView({
  tools,
  checking,
  selectedId,
  compact,
  onSelect,
  onCheck
}: {
  tools: DevTool[] | null
  checking: boolean
  selectedId: DevToolId | null
  compact: boolean
  onSelect: (id: DevToolId | null) => void
  onCheck: () => void
}) {
  const found = tools?.filter((tool) => tool.installed).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)) ?? []
  const missing = tools?.filter((tool) => !tool.installed) ?? []

  return (
    <>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display text-[1.65rem] leading-none tracking-tight">Developer tools</h1>
          <button type="button" disabled={checking} onClick={onCheck} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <RefreshCw className={checking ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
        {!compact && (
          <p className="text-mist mt-2 text-sm leading-relaxed">
            Package managers and Docker keep downloads and leftovers. Each one cleans up with its own command, which Stow runs for you after you confirm.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-3 pb-4">
            {!tools ? (
              <RowSkeletons compact={compact} count={5} label="Checking developer tools" />
            ) : (
              <>
                {found.length === 0 && <p className="text-mist px-1 py-6 text-center text-sm">None of these tools are on this Mac.</p>}
                <ul className="flex flex-col gap-1.5">
                  {found.map((tool, index) => (
                    <ListRow
                      key={tool.id}
                      index={index}
                      title={tool.name}
                      tag={tool.estimate === 'holds' ? 'whole store' : undefined}
                      bytes={tool.bytes ?? 0}
                      pending={checking}
                      summary={tool.note ?? tool.summary}
                      color={tool.ready ? verdicts.clear.bin : 'var(--mist)'}
                      icon={<TerminalSquare className="text-harbor size-5 shrink-0" aria-hidden />}
                      selected={tool.id === selectedId}
                      compact={compact}
                      onClick={() => onSelect(tool.id === selectedId ? null : tool.id)}
                    />
                  ))}
                </ul>
                {missing.length > 0 && (
                  <p className="text-mist px-1 pt-4 text-xs leading-relaxed">Not found on this Mac: {missing.map((tool) => tool.name).join(', ')}.</p>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}
