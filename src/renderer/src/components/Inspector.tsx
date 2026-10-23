import type { FolderEntry, StorageItem, TrashTarget, Verdict } from '@shared/types'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { FileIcon } from '@/components/FileIcon'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFileIcons } from '@/hooks/useFileIcons'
import { canLookInside } from '@/lib/browse'
import { formatBytes } from '@/lib/format'
import { verdicts } from '@/lib/verdicts'

export interface FocusDetail {
  title: string
  path: string
  bytes: number
  verdict: Verdict
  summary: string
  detail?: string
  trashable: boolean
  canReveal: boolean
  canOpen: boolean
  kind?: FolderEntry['kind']
}

export function Inspector({
  item,
  focus,
  busyPath,
  actionError,
  onReveal,
  onTrash,
  onOpen
}: {
  item: StorageItem | null
  focus: FocusDetail | null
  busyPath: string | null
  actionError: string | null
  onReveal: (filePath: string) => void
  onTrash: (target: TrashTarget) => void
  onOpen: (filePath: string, label: string, summary: string) => void
}) {
  const icons = useFileIcons([item?.path ?? '', ...(item?.children.map((child) => child.path) ?? [])])

  if (focus) {
    return (
      <DetailCard
        title={focus.title}
        path={focus.path}
        bytes={focus.bytes}
        verdict={focus.verdict}
        summary={focus.summary}
        detail={focus.detail}
        trashable={focus.trashable}
        canReveal={focus.canReveal}
        canOpen={focus.canOpen}
        kind={focus.kind}
        busyPath={busyPath}
        actionError={actionError}
        onReveal={onReveal}
        onTrash={onTrash}
        onOpen={onOpen}
      />
    )
  }

  if (!item) {
    return (
      <Card className="h-full">
        <CardHeader>
          <h2 className="font-display text-lg tracking-tight">Details</h2>
        </CardHeader>
        <CardContent>
          <p className="text-mist text-sm leading-relaxed">Select a folder to read why it is on this shelf, and what Stow will do with it.</p>
        </CardContent>
      </Card>
    )
  }

  const style = verdicts[item.verdict]
  const pathLabel = item.id === 'node-modules' ? 'Inside your project folders' : item.path
  const canReveal = Boolean(item.path) && item.id !== 'node-modules'
  const spread = item.children.length === 0 && item.bytes > 5_000_000 && item.complete

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <FileIcon src={icons[item.path]} kind={canLookInside(item.path) ? 'folder' : 'file'} />
            <h2 className="font-display min-w-0 pt-1 text-lg leading-tight tracking-tight">{item.title}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={style.badge}>{style.label}</Badge>
            </TooltipTrigger>
            <TooltipContent>{style.instruction}</TooltipContent>
          </Tooltip>
        </div>
        <p className="font-mono text-sm">{formatBytes(item.bytes)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-mist break-all font-mono text-[11px] leading-relaxed">{pathLabel}</p>
        <Separator />
        {item.children.length > 0 ? (
          <Tabs defaultValue="inside">
            <TabsList aria-label="Folder details">
              <TabsTrigger value="inside">Inside</TabsTrigger>
              <TabsTrigger value="why">Why</TabsTrigger>
            </TabsList>
            <TabsContent value="why">
              <p className="text-sm leading-relaxed">{item.detail}</p>
            </TabsContent>
            <TabsContent value="inside">
              <ul className="flex flex-col gap-2">
                {item.children.map((child) => {
                  const openable = canLookInside(child.path)
                  return (
                  <li key={child.path} className="rounded-xl bg-fog/80 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (openable) onOpen(child.path, child.name, child.summary)
                      }}
                      aria-label={openable ? `Look inside ${child.name}` : child.name}
                      className="flex w-full items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                    >
                      <FileIcon src={icons[child.path]} kind={child.kind ?? (openable ? 'folder' : 'file')} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-semibold">{child.name}</span>
                          <span className="shrink-0 font-mono text-xs">{formatBytes(child.bytes)}</span>
                        </span>
                      </span>
                      {openable && <ChevronRight className="text-harbor size-4 shrink-0" aria-hidden />}
                    </button>
                    <p className="text-mist mt-1 text-xs leading-relaxed">{child.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => onReveal(child.path)}>
                        Reveal in Finder
                      </Button>
                      {child.trashable && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyPath === child.path}
                          onClick={() =>
                            onTrash({
                              path: child.path,
                              title: child.name,
                              verdict: child.verdict,
                              summary: child.summary
                            })
                          }
                        >
                          {busyPath === child.path ? 'Moving…' : 'Move to Trash'}
                        </Button>
                      )}
                    </div>
                  </li>
                  )
                })}
              </ul>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm leading-relaxed">{item.detail}</p>
        )}
        {spread && <p className="text-mist text-xs leading-relaxed">The space is spread across smaller files.</p>}
        <div className="flex flex-wrap gap-2">
          {canLookInside(item.path) && (
            <Button variant="outline" onClick={() => onOpen(item.path, item.title, item.summary)}>
              Look inside
            </Button>
          )}
          {canReveal && (
            <Button variant="outline" onClick={() => onReveal(item.path)}>
              Reveal in Finder
            </Button>
          )}
          {item.trashable && (
            <Button
              variant="destructive"
              disabled={busyPath === item.path}
              onClick={() =>
                onTrash({
                  path: item.path,
                  title: item.title,
                  verdict: item.verdict,
                  summary: item.summary
                })
              }
            >
              {busyPath === item.path ? 'Moving…' : 'Move to Trash'}
            </Button>
          )}
        </div>
        {actionError && <p className="text-coral text-sm leading-relaxed">{actionError}</p>}
      </CardContent>
    </Card>
  )
}

function DetailCard({
  title,
  path,
  bytes,
  verdict,
  summary,
  detail,
  trashable,
  canReveal,
  canOpen,
  kind,
  busyPath,
  actionError,
  onReveal,
  onTrash,
  onOpen
}: FocusDetail & {
  busyPath: string | null
  actionError: string | null
  onReveal: (filePath: string) => void
  onTrash: (target: TrashTarget) => void
  onOpen: (filePath: string, label: string, summary: string) => void
}) {
  const style = verdicts[verdict]
  const icons = useFileIcons([path])
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <FileIcon src={icons[path]} kind={kind ?? (canOpen ? 'folder' : 'file')} />
            <h2 className="font-display min-w-0 pt-1 text-lg leading-tight tracking-tight">{title}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={style.badge}>{style.label}</Badge>
            </TooltipTrigger>
            <TooltipContent>{style.instruction}</TooltipContent>
          </Tooltip>
        </div>
        <p className="font-mono text-sm">{formatBytes(bytes)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-mist break-all font-mono text-[11px] leading-relaxed">{path}</p>
        <Separator />
        <p className="text-sm leading-relaxed">{detail || summary}</p>
        <div className="flex flex-wrap gap-2">
          {canOpen && (
            <Button variant="outline" onClick={() => onOpen(path, title, summary)}>
              Look inside
            </Button>
          )}
          {canReveal && (
            <Button variant="outline" onClick={() => onReveal(path)}>
              Reveal in Finder
            </Button>
          )}
          {trashable && (
            <Button
              variant="destructive"
              disabled={busyPath === path}
              onClick={() => onTrash({ path, title, verdict, summary })}
            >
              {busyPath === path ? 'Moving…' : 'Move to Trash'}
            </Button>
          )}
        </div>
        {actionError && <p className="text-coral text-sm leading-relaxed">{actionError}</p>}
      </CardContent>
    </Card>
  )
}
