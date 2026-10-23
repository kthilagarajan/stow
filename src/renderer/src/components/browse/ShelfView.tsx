import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import type { StorageItem, TrashTarget } from '@shared/types'
import { ItemList } from '@/components/browse/ItemList'
import { MultiHint } from '@/components/browse/SelectionBar'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Shelf } from '@/lib/verdicts'

// The middle pane before you open a folder: one shelf of scanned places, with a filter.
export function ShelfView({
  shelf,
  items,
  selectedId,
  scanning,
  scanned,
  loaded,
  compact,
  error,
  onSelect,
  onOpen,
  onTrashMany
}: {
  shelf: Shelf
  items: StorageItem[]
  selectedId: string | null
  scanning: boolean
  scanned: boolean
  loaded: boolean
  compact: boolean
  error: string | null
  onSelect: (id: string | null) => void
  onOpen: (filePath: string, label: string, summary: string) => void
  onTrashMany: (targets: TrashTarget[]) => void
}) {
  const [query, setQuery] = useState('')
  const filterId = useId()

  return (
    <>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display text-[1.65rem] leading-none tracking-tight">{shelf.label}</h1>
          <MultiHint />
        </div>
        {!compact && <p className="text-mist mt-2 text-sm leading-relaxed">{shelf.instruction}</p>}
        <search className="relative mt-3">
          <label htmlFor={filterId} className="sr-only">
            Filter the list
          </label>
          <Search className="text-mist pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <input
            id={filterId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or path"
            spellCheck={false}
            autoComplete="off"
            className="border-line bg-fog/70 focus-visible:outline-harbor h-9 w-full rounded-lg border pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </search>
        {error && <p className="text-coral mt-2 text-sm leading-relaxed">{error}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-3 pb-4">
            <ItemList
              items={items}
              shelf={shelf.id}
              query={query}
              selectedId={selectedId}
              scanning={scanning}
              scanned={scanned}
              loaded={loaded}
              compact={compact}
              onSelect={onSelect}
              onOpen={onOpen}
              onTrashMany={onTrashMany}
            />
          </div>
        </ScrollArea>
      </div>
    </>
  )
}
