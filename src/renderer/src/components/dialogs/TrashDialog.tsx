import { useEffect, useRef } from 'react'
import type { TrashTarget } from '@shared/types'
import { buttonVariants } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'
import { BIN } from '@/lib/bin'

export function TrashDialog({
  targets,
  onCancel,
  onConfirm
}: {
  targets: TrashTarget[] | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const open = Boolean(targets && targets.length > 0)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[value="cancel"]')?.focus()
  }, [open, targets])

  const many = (targets?.length ?? 0) > 1
  const cautious = targets?.some((target) => target.verdict !== 'clear') ?? false
  const shown = targets?.slice(0, 8) ?? []
  const extra = (targets?.length ?? 0) - shown.length
  const bytes = targets?.reduce((sum, target) => sum + (target.bytes ?? 0), 0) ?? 0

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="trash-title"
      onClose={(event) => {
        const value = event.currentTarget.returnValue
        event.currentTarget.returnValue = ''
        if (value === 'confirm') onConfirm()
        else onCancel()
      }}
    >
      {targets && targets.length > 0 && (
        <form method="dialog" className="p-6">
          <h2 id="trash-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            {many ? `Move ${targets.length} items to the ${BIN}?` : `Move “${targets[0]?.title}” to the ${BIN}?`}
          </h2>
          {many ? (
            <p className="text-mist mt-3 text-sm leading-relaxed">
              {cautious
                ? `Some of these are not caches. If one of them is the only copy, the ${BIN} is the way back.`
                : `They stay in the ${BIN} until you empty it or put them back. Apps rebuild caches.`}
            </p>
          ) : null}
          {many ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {shown.map((target) => (
                <li key={target.path} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-semibold">{target.title}</span>
                  {target.bytes !== undefined && <span className="shrink-0 font-mono text-xs">{formatBytes(target.bytes)}</span>}
                </li>
              ))}
              {extra > 0 && <li className="text-mist text-sm">and {extra} more</li>}
              {bytes > 0 && <li className="text-mist pt-1 font-mono text-xs">{formatBytes(bytes)} together</li>}
            </ul>
          ) : (
            <>
              <p className="text-mist mt-3 text-sm leading-relaxed">
                {targets[0]?.verdict === 'clear'
                  ? `${targets[0].summary} It stays in the ${BIN} until you empty it or put it back.`
                  : `${targets[0]?.summary} This is not a cache. If this is the only copy, the ${BIN} is the way back.`}
              </p>
              <p className="mt-3 font-mono text-[11px] leading-relaxed break-all">{targets[0]?.path}</p>
            </>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              Cancel
            </button>
            <button value="confirm" className={buttonVariants({ variant: 'destructive' })}>
              Move to {BIN}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
