import { useEffect, useId, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { segmentTotals } from '@shared/segments'
import type { FolderEntry, TrashTarget } from '@shared/types'
import mark from '@/assets/icon.png'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EmptyTrashDialog } from '@/components/EmptyTrashDialog'
import { FolderBrowser } from '@/components/FolderBrowser'
import { Inspector, type FocusDetail } from '@/components/Inspector'
import { ItemList } from '@/components/ItemList'
import { ShelfNav } from '@/components/ShelfNav'
import { StorageWall } from '@/components/StorageWall'
import { TrashDialog } from '@/components/TrashDialog'
import { useStow } from '@/hooks/useStow'
import { applyBrowseTrash, canLookInside, type BrowseFrame } from '@/lib/browse'
import { formatBytes, formatScannedAt } from '@/lib/format'
import { diskLede } from '@/lib/lede'
import { shelves, type ShelfId } from '@/lib/verdicts'

export function App() {
  const { available, state, busyPath, emptying, reveal, trashMany, emptyTrash, rescan } = useStow()
  const [shelf, setShelf] = useState<ShelfId>('everything')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trashTargets, setTrashTargets] = useState<TrashTarget[] | null>(null)
  const [stack, setStack] = useState<BrowseFrame[]>([])
  const [picked, setPicked] = useState<FolderEntry | null>(null)
  const [opening, setOpening] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const filterId = useId()
  const activeShelf = shelves.find((entry) => entry.id === shelf) ?? shelves[0]

  useEffect(() => {
    setStack([])
    setPicked(null)
    setBrowseError(null)
  }, [shelf])

  useEffect(() => {
    if (state.scanning && state.completed === 0) {
      setSelectedId(null)
      setStack([])
      setPicked(null)
      setBrowseError(null)
    }
  }, [state.scanning, state.completed])

  const totals = useMemo(
    () => segmentTotals(state.items, state.volume?.usedBytes ?? 0, state.volume?.freeBytes ?? 0),
    [state.items, state.volume]
  )
  const selected = state.items.find((item) => item.id === selectedId) ?? null
  const percent = state.total > 0 ? Math.min(100, (state.completed / state.total) * 100) : 0
  const trashItem = state.items.find((item) => item.id === 'trash')
  const current = stack.at(-1) ?? null
  const focus: FocusDetail | null = picked
    ? {
        title: picked.name,
        path: picked.path,
        bytes: picked.bytes,
        verdict: picked.verdict,
        summary: picked.summary,
        trashable: picked.trashable,
        canReveal: true,
        canOpen: picked.kind !== 'file' && canLookInside(picked.path),
        kind: picked.kind
      }
    : current
      ? {
          title: current.label,
          path: current.path,
          bytes: current.bytes,
          verdict: current.verdict,
          summary: current.summary,
          trashable: current.trashable,
          canReveal: true,
          canOpen: false,
          kind: 'folder'
        }
      : null

  async function openPath(filePath: string, label?: string, summary?: string): Promise<void> {
    if (!filePath || !canLookInside(filePath) || !window.stow) return
    setOpening(true)
    setBrowseError(null)
    setPicked(null)
    try {
      const result = await window.stow.openFolder(filePath)
      if (!result.ok) {
        setBrowseError(result.error)
        return
      }
      const frame: BrowseFrame = {
        ...result.listing,
        label: label || result.listing.name,
        summary: summary || result.listing.summary
      }
      setStack((existing) => {
        const index = existing.findIndex((entry) => entry.path === frame.path)
        if (index >= 0) return [...existing.slice(0, index), frame]
        return [...existing, frame]
      })
    } finally {
      setOpening(false)
    }
  }

  function openEntry(entry: FolderEntry): void {
    void openPath(entry.path, entry.name, entry.summary)
  }

  if (!available) {
    return (
      <main className="grid h-full place-items-center px-6">
        <p className="max-w-sm text-center text-sm leading-relaxed">Open this window from the Stow app to read this Mac.</p>
      </main>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <header className="drag relative flex items-center justify-between gap-4 px-5 pt-4 pb-3 pl-24">
          <div className="flex items-center gap-3">
            <img src={mark} alt="" width={36} height={36} draggable={false} className="size-9" />
            <div>
              <p className="font-display text-[22px] leading-none tracking-tight">Stow</p>
              <p className="text-mist mt-1 text-xs">What can go, and what stays</p>
              <p className="text-mist mt-1 text-xs">{state.scannedAt ? formatScannedAt(state.scannedAt) : 'No scan yet'}</p>
            </div>
          </div>
          <div className="no-drag flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-semibold tracking-tight">{state.volume?.name ?? 'Macintosh HD'}</p>
              <p className="text-mist font-mono text-[11px]">
                {state.volume
                  ? `${formatBytes(state.volume.freeBytes)} free of ${formatBytes(state.volume.totalBytes)}`
                  : 'Reading the disk'}
              </p>
            </div>
            <div className="w-36 text-right">
              <Button
                onClick={rescan}
                disabled={state.scanning}
                aria-label={state.scanning ? 'Scanning' : state.done ? 'Scan again' : 'Scan'}
              >
                <RefreshCw className={state.scanning ? 'motion-safe:animate-spin' : undefined} aria-hidden />
                {state.scanning ? 'Scanning' : state.done ? 'Scan again' : 'Scan'}
              </Button>
              <p role="status" className="text-mist mt-1 truncate text-[11px]">
                {state.status}
              </p>
            </div>
          </div>
          {state.scanning && (
            <Progress value={percent} aria-label="Scan progress" className="absolute inset-x-0 bottom-0 h-1 rounded-none" />
          )}
        </header>

        <section className="px-5 pb-4" aria-label="Disk">
          {state.volumeError && <p className="text-coral mb-2 text-sm">{state.volumeError}</p>}
          <StorageWall totals={totals} active={shelf} onSelect={setShelf} ready={Boolean(state.volume)} />
          <p className="mt-3 max-w-4xl text-[15px] leading-relaxed">{diskLede(totals, state.done)}</p>
          {state.done && state.limited > 0 && (
            <p className="text-mist mt-1 max-w-4xl text-xs leading-relaxed">
              macOS hid files in {state.limited === 1 ? 'one folder' : `${state.limited} folders`}, so those sizes may be low.
              Full Disk Access in System Settings lets Stow see them.
            </p>
          )}
        </section>

        <div className="grid min-h-0 flex-1 grid-cols-[228px_minmax(0,1fr)_332px] gap-3 px-3 pb-3">
          <ShelfNav
            active={shelf}
            onSelect={setShelf}
            totals={totals}
            items={state.items}
            used={state.volume?.usedBytes ?? 0}
            version={state.version}
            trashBytes={trashItem?.bytes ?? 0}
            emptying={emptying}
            onEmptyTrash={() => setConfirmEmpty(true)}
          />
          <main className="bg-sheet flex min-h-0 min-w-0 flex-col rounded-2xl">
            {current ? (
              <FolderBrowser
                key={current.path}
                stack={stack}
                shelfLabel={activeShelf?.label ?? 'Everything'}
                opening={opening}
                error={browseError}
                busyPath={busyPath}
                onCrumb={(index) => {
                  setPicked(null)
                  setBrowseError(null)
                  setStack((existing) => (index < 0 ? [] : existing.slice(0, index + 1)))
                }}
                onOpen={openEntry}
                onPick={setPicked}
                onTrash={(target) => setTrashTargets([target])}
                onTrashMany={setTrashTargets}
              />
            ) : (
              <>
                <div className="px-4 pt-4 pb-3">
                  <h1 className="font-display text-[1.65rem] leading-none tracking-tight">{activeShelf?.label}</h1>
                  <p className="text-mist mt-2 text-sm leading-relaxed">{activeShelf?.instruction}</p>
                  <search className="mt-3">
                    <label htmlFor={filterId} className="sr-only">
                      Filter the list
                    </label>
                    <input
                      id={filterId}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter by name or path"
                      spellCheck={false}
                      autoComplete="off"
                      className="border-line bg-fog/70 focus-visible:outline-harbor h-9 w-full rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                  </search>
                  {browseError && <p className="text-coral mt-2 text-sm leading-relaxed">{browseError}</p>}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="px-3 pb-4">
                      <ItemList
                        items={state.items}
                        shelf={shelf}
                        query={query}
                        selectedId={selectedId}
                        scanning={state.scanning}
                        scanned={state.done}
                        onSelect={setSelectedId}
                        onOpen={(filePath, label, summary) => void openPath(filePath, label, summary)}
                        onTrashMany={setTrashTargets}
                      />
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </main>
          <aside className="min-h-0 min-w-0" aria-label="Details">
            <ScrollArea className="h-full">
              <Inspector
                item={selected}
                focus={focus}
                busyPath={busyPath}
                actionError={state.actionError}
                onReveal={(filePath) => void reveal(filePath)}
                onTrash={(target) => setTrashTargets([target])}
                onOpen={(filePath, label, summary) => void openPath(filePath, label, summary)}
              />
            </ScrollArea>
          </aside>
        </div>
      </div>
      <EmptyTrashDialog
        open={confirmEmpty}
        bytes={trashItem?.bytes ?? 0}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => {
          const trashPath = trashItem?.path
          setConfirmEmpty(false)
          void emptyTrash().then((ok) => {
            if (!ok || !trashPath) return
            setStack((existing) => applyBrowseTrash(existing, trashPath))
            setPicked(null)
          })
        }}
      />
      <TrashDialog
        targets={trashTargets}
        onCancel={() => setTrashTargets(null)}
        onConfirm={() => {
          const targets = trashTargets
          setTrashTargets(null)
          if (!targets || targets.length === 0) return
          void trashMany(targets.map((target) => target.path)).then((trashed) => {
            if (trashed.length === 0) return
            setStack((existing) => trashed.reduce((list, filePath) => applyBrowseTrash(list, filePath), existing))
            setPicked((entry) =>
              entry && trashed.some((filePath) => entry.path === filePath || entry.path.startsWith(`${filePath}/`)) ? null : entry
            )
          })
        }}
      />
    </TooltipProvider>
  )
}
