import type { FolderEntry, StorageItem, TrashTarget, Verdict } from '@shared/types'
import { AskButton } from '@/components/dialogs/AskDialog'
import { ChevronRight, FolderOpen, FolderSearch, Trash2 } from 'lucide-react'
import { ActionTile } from '@/components/common/ActionTile'
import { IconAction } from '@/components/common/ListRow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { FileIcon } from '@/components/common/FileIcon'
import { Skeleton } from '@/components/common/Skeletons'
import { Metadata } from '@/components/inspector/Metadata'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFileIcons } from '@/hooks/useFileIcons'
import { canLookInside, diskName, tagFor, type FocusDetail } from '@/lib/browse'
import { formatBytes } from '@/lib/format'
import type { PromptSubject } from '@/lib/prompt'
import { verdicts } from '@/lib/verdicts'
import { BIN } from '@/lib/bin'

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
        measuring={focus.measuring}
        entries={focus.entries}
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
            <div className="min-w-0 pt-1">
              <h2 className="font-display text-lg leading-tight tracking-tight break-all">{diskName(item.path, item.title)}</h2>
              {tagFor(item) && <p className="text-mist mt-0.5 text-xs">{item.title}</p>}
            </div>
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
        {canReveal && <Metadata path={item.path} />}
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
                    <div className="flex items-center gap-2">
                      <FileIcon src={icons[child.path]} kind={child.kind ?? (openable ? 'folder' : 'file')} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-semibold">{child.name}</span>
                          <span className="shrink-0 font-mono text-xs">{formatBytes(child.bytes)}</span>
                        </span>
                      </span>
                      {openable && (
                        <span className="-mr-1.5">
                          <IconAction label={`Look inside ${child.name}`} icon={ChevronRight} onClick={() => onOpen(child.path, child.name, child.summary)} />
                        </span>
                      )}
                      </div>
                    <div className="mt-1 flex items-start gap-2">
                      <p className="text-mist min-w-0 flex-1 pt-1 text-xs leading-relaxed">{child.summary}</p>
                      <div className="-mr-1.5 -mb-1 flex shrink-0">
                        <IconAction label="Reveal in Finder" icon={FolderSearch} onClick={() => onReveal(child.path)} />
                        {child.trashable && (
                          <IconAction
                            danger
                            label={busyPath === child.path ? 'Moving…' : `Move to ${BIN}`}
                            icon={Trash2}
                            disabled={busyPath === child.path}
                            onClick={() =>
                              onTrash({
                                path: child.path,
                                title: child.name,
                                verdict: child.verdict,
                                summary: child.summary,
                                bytes: child.bytes
                              })
                            }
                          />
                        )}
                      </div>
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
        <Actions
          subject={{
            title: diskName(item.path, item.title),
            path: item.id === 'node-modules' ? 'Inside your project folders' : item.path,
            bytes: item.bytes,
            verdict: item.verdict,
            summary: item.summary,
            detail: item.detail,
            entries: item.children.map((child) => ({
              name: child.name,
              bytes: child.bytes,
              verdict: child.verdict,
              summary: child.summary
            }))
          }}
          canOpen={canLookInside(item.path)}
          canReveal={canReveal}
          trashable={item.trashable}
          busy={busyPath === item.path}
          onOpen={() => onOpen(item.path, diskName(item.path, item.title), item.summary)}
          onReveal={() => onReveal(item.path)}
          onTrash={() =>
            onTrash({ path: item.path, title: diskName(item.path, item.title), verdict: item.verdict, summary: item.summary, bytes: item.bytes })
          }
        />
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
  measuring = false,
  entries,
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
            <h2 className="font-display min-w-0 pt-1 text-lg leading-tight tracking-tight break-all">{title}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={style.badge}>{style.label}</Badge>
            </TooltipTrigger>
            <TooltipContent>{style.instruction}</TooltipContent>
          </Tooltip>
        </div>
        <p className="font-mono text-sm">
          {measuring && bytes === 0 ? <Skeleton className="inline-block h-4 w-16 align-middle" /> : formatBytes(bytes)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-mist break-all font-mono text-[11px] leading-relaxed">{path}</p>
        <Metadata path={path} />
        <Separator />
        <p className="text-sm leading-relaxed">{detail || summary}</p>
        <Actions
          subject={{ title, path, bytes, verdict, summary, detail, entries }}
          canOpen={canOpen}
          canReveal={canReveal}
          trashable={trashable}
          busy={busyPath === path}
          onOpen={() => onOpen(path, title, summary)}
          onReveal={() => onReveal(path)}
          onTrash={() => onTrash({ path, title, verdict, summary, bytes })}
        />
        {actionError && <p className="text-coral text-sm leading-relaxed">{actionError}</p>}
      </CardContent>
    </Card>
  )
}

function Actions({
  subject,
  canOpen,
  canReveal,
  trashable,
  busy,
  onOpen,
  onReveal,
  onTrash
}: {
  subject: PromptSubject
  canOpen: boolean
  canReveal: boolean
  trashable: boolean
  busy: boolean
  onOpen: () => void
  onReveal: () => void
  onTrash: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid auto-cols-fr grid-flow-col gap-2">
        {canOpen && <ActionTile icon={FolderOpen} label="Look inside" hint="Browse what this folder holds" onClick={onOpen} />}
        {canReveal && <ActionTile icon={FolderSearch} label="Reveal" hint="Reveal in Finder" onClick={onReveal} />}
        <AskButton subject={subject} />
      </div>
      {trashable && (
        <Button variant="destructive" className="h-10 w-full" disabled={busy} onClick={onTrash}>
          <Trash2 aria-hidden />
          {busy ? 'Moving…' : `Move to ${BIN}`}
          {!busy && subject.bytes > 0 && <span className="font-mono text-xs font-normal opacity-80">{formatBytes(subject.bytes)}</span>}
        </Button>
      )}
    </div>
  )
}
