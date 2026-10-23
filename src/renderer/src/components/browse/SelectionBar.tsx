import { Trash2, X } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import { BIN } from '@/lib/bin'

export function SelectionBar({ count, bytes, onTrash, onClear }: { count: number; bytes: number; onTrash: () => void; onClear: () => void }) {
  if (count < 2) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label={`${count} selected`}
        className="selection-bar bg-chrome pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 pl-4 text-white shadow-[0_18px_48px_rgba(21,32,51,0.28)]"
      >
        <span className="text-sm font-semibold tracking-tight">{count} selected</span>
        <span className="pr-2 pl-1.5 font-mono text-[11px] text-white/60">{formatBytes(bytes)}</span>
        <button
          type="button"
          onClick={onTrash}
          className="bg-coral hover:bg-coral/90 flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Trash2 className="size-4" aria-hidden />
          Move to {BIN}
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="grid size-8 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

export function MultiHint() {
  return (
    <span className="text-mist flex shrink-0 items-center gap-1 text-[11px]">
      <kbd className="border-line bg-fog rounded border px-1 font-sans text-[10px] leading-4">⌘</kbd>
      click to pick several
    </span>
  )
}
