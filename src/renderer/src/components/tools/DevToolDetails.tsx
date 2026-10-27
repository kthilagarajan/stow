import type { DevCleanResult, DevTool } from '@shared/types'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { BIN } from '@/lib/bin'
import { formatBytes } from '@/lib/format'

function sizeLine(tool: DevTool): string | null {
  if (tool.bytes === null) return null
  if (tool.estimate === 'holds') return `${formatBytes(tool.bytes)} in the store. Pruning frees only what no project uses.`
  return tool.bytes > 0 ? `Frees about ${formatBytes(tool.bytes)}.` : 'Nothing to free right now.'
}

// The details pane for a developer tool: what its cleanup removes, and what it printed last time.
export function DevToolDetails({
  tool,
  cleaning,
  result,
  onClean
}: {
  tool: DevTool | null
  cleaning: boolean
  result: DevCleanResult | undefined
  onClean: () => void
}) {
  if (!tool) {
    return (
      <Card className="h-full">
        <CardHeader>
          <h2 className="font-display text-lg tracking-tight">Details</h2>
        </CardHeader>
        <CardContent>
          <p className="text-mist text-sm leading-relaxed">Select a tool to read what its cleanup removes, and the command Stow runs.</p>
        </CardContent>
      </Card>
    )
  }

  const size = sizeLine(tool)
  return (
    <Card className="h-full">
      <CardHeader>
        <h2 className="font-display text-lg leading-tight tracking-tight">{tool.name}</h2>
        {size && <p className="font-mono text-sm">{size}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed">{tool.summary}</p>
        <p className="text-mist text-sm leading-relaxed">{tool.detail}</p>
        {tool.note && <p className="text-sm leading-relaxed">{tool.note}</p>}
        <div>
          <p className="text-mist text-[11px] font-semibold tracking-wide uppercase">Command</p>
          <code className="bg-fog/70 mt-1 block rounded-lg px-2.5 py-2 font-mono text-xs break-all">{tool.command}</code>
        </div>
        <p className="text-mist text-xs leading-relaxed">The tool deletes these itself. They do not go to the {BIN}, so there is no way back.</p>
        <Button variant="destructive" disabled={!tool.ready || cleaning} onClick={onClean}>
          <Eraser aria-hidden />
          {cleaning ? 'Cleaning up…' : 'Clean up'}
        </Button>
        {result && (
          <>
            <Separator />
            <div aria-live="polite">
              <p className={result.ok ? 'text-kelp text-sm font-semibold' : 'text-coral text-sm'}>{result.ok ? 'Done.' : result.error}</p>
              {result.output && (
                <details className="mt-2">
                  <summary className="text-mist text-xs">What {tool.name} printed</summary>
                  <pre className="bg-fog/70 mt-2 max-h-64 overflow-auto rounded-lg px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {result.output}
                  </pre>
                </details>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
