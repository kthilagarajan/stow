import { useEffect, useMemo, useState } from 'react'
import { segmentTotals } from '@shared/segments'
import type { TrashTarget } from '@shared/types'
import { FolderBrowser } from '@/components/browse/FolderBrowser'
import { ShelfView } from '@/components/browse/ShelfView'
import { FolderSkeleton } from '@/components/common/Skeletons'
import { EmptyTrashDialog } from '@/components/dialogs/EmptyTrashDialog'
import { GoToDialog } from '@/components/dialogs/GoToDialog'
import { TrashDialog } from '@/components/dialogs/TrashDialog'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import { Inspector } from '@/components/inspector/Inspector'
import { AccessNote } from '@/components/layout/AccessNote'
import { AppHeader } from '@/components/layout/AppHeader'
import { ShelfNav } from '@/components/layout/ShelfNav'
import { StorageWall } from '@/components/layout/StorageWall'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useActivity } from '@/hooks/useActivity'
import { useBrowse } from '@/hooks/useBrowse'
import { useShortcut } from '@/hooks/useShortcut'
import { useCompact } from '@/hooks/useStoredFlag'
import { useStow } from '@/hooks/useStow'
import { useUpdate } from '@/hooks/useUpdate'
import { formatScannedAt } from '@/lib/format'
import { shelves, type ShelfId } from '@/lib/verdicts'

export function App() {
  const { available, state, busyPath, emptying, reveal, trashMany, emptyTrash, rescan } = useStow()
  const browse = useBrowse()
  const update = useUpdate()
  const activity = useActivity()
  const [shelf, setShelf] = useState<ShelfId>('everything')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [trashTargets, setTrashTargets] = useState<TrashTarget[] | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [goingTo, setGoingTo] = useState(false)
  const [compact, setCompact] = useCompact()
  const activeShelf = shelves.find((entry) => entry.id === shelf) ?? shelves[0]

  useShortcut('g', () => setGoingTo(true), { shift: true })

  // Switching shelves starts fresh: no folder open, nothing in the details pane.
  useEffect(() => {
    browse.reset()
    setSelectedId(null)
  }, [shelf])

  // A fresh scan replaces every row, so nothing picked before still means anything.
  useEffect(() => {
    if (state.scanning && state.completed === 0) {
      setSelectedId(null)
      browse.reset()
    }
  }, [state.scanning, state.completed])

  const totals = useMemo(
    () => segmentTotals(state.items, state.volume?.usedBytes ?? 0, state.volume?.freeBytes ?? 0),
    [state.items, state.volume]
  )
  const selected = state.items.find((item) => item.id === selectedId) ?? null
  const progress = state.total > 0 ? Math.min(100, (state.completed / state.total) * 100) : 0
  const trashItem = state.items.find((item) => item.id === 'trash')
  const openPath = (filePath: string, label?: string, summary?: string) => void browse.open(filePath, label, summary)

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
        <AppHeader
          volume={state.volume}
          scanning={state.scanning}
          scanned={state.done}
          progress={progress}
          compact={compact}
          onToggleCompact={() => setCompact(!compact)}
          onGoTo={() => setGoingTo(true)}
          onScan={rescan}
          update={
            update.info
              ? { version: update.info.version, downloading: update.phase === 'downloading', onOpen: update.request }
              : null
          }
        />

        <section className="px-5 pb-4" aria-label="Disk">
          {state.volumeError && <p className="text-coral mb-2 text-sm">{state.volumeError}</p>}
          <StorageWall
            totals={totals}
            active={shelf}
            onSelect={setShelf}
            ready={Boolean(state.volume)}
            note={state.scanning || !state.scannedAt ? state.status : formatScannedAt(state.scannedAt)}
          />
          {state.done && <AccessNote limited={state.limited} />}
        </section>

        <div className="grid min-h-0 flex-1 grid-cols-[244px_minmax(0,1fr)_332px] gap-3 px-3 pb-3">
          <ShelfNav
            active={shelf}
            onSelect={setShelf}
            totals={totals}
            items={state.items}
            used={state.volume?.usedBytes ?? 0}
            version={state.version}
            trashBytes={trashItem?.bytes ?? 0}
            loading={!state.loaded || !state.volume}
            emptying={emptying}
            activity={activity}
            onEmptyTrash={() => setConfirmEmpty(true)}
          />
          <main className="bg-sheet flex min-h-0 min-w-0 flex-col rounded-2xl">
            {browse.opening && !browse.current ? (
              <FolderSkeleton compact={compact} />
            ) : browse.current ? (
              <FolderBrowser
                stack={browse.stack}
                shelfLabel={activeShelf.label}
                opening={browse.opening}
                error={browse.error}
                pickedPath={browse.picked?.path ?? null}
                compact={compact}
                onCrumb={browse.crumb}
                onOpen={(entry) => openPath(entry.path, entry.name, entry.summary)}
                onPick={browse.pick}
                onTrashMany={setTrashTargets}
              />
            ) : (
              <ShelfView
                shelf={activeShelf}
                items={state.items}
                selectedId={selectedId}
                scanning={state.scanning}
                scanned={state.done}
                loaded={state.loaded}
                compact={compact}
                error={browse.error}
                onSelect={setSelectedId}
                onOpen={openPath}
                onTrashMany={setTrashTargets}
              />
            )}
          </main>
          <aside className="min-h-0 min-w-0" aria-label="Details">
            <ScrollArea className="h-full">
              <div key={browse.focus?.path ?? selected?.id ?? 'none'} className="fade-in h-full">
                <Inspector
                  item={selected}
                  focus={browse.focus}
                  busyPath={busyPath}
                  actionError={state.actionError}
                  onReveal={(filePath) => void reveal(filePath)}
                  onTrash={(target) => setTrashTargets([target])}
                  onOpen={openPath}
                />
              </div>
            </ScrollArea>
          </aside>
        </div>
      </div>
      <UpdateDialog update={update} current={state.version} />
      <GoToDialog open={goingTo} onClose={() => setGoingTo(false)} onGo={browse.goTo} />
      <EmptyTrashDialog
        open={confirmEmpty}
        bytes={trashItem?.bytes ?? 0}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => {
          const trashPath = trashItem?.path
          setConfirmEmpty(false)
          void emptyTrash().then((ok) => {
            if (ok && trashPath) browse.forget([trashPath])
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
          void trashMany(targets).then((trashed) => {
            if (trashed.length > 0) browse.forget(trashed)
          })
        }}
      />
    </TooltipProvider>
  )
}
