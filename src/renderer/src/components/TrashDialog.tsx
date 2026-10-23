import { useEffect, useRef } from 'react'
import type { TrashTarget } from '@shared/types'
import { buttonVariants } from '@/components/ui/button'

export function TrashDialog({
  target,
  onCancel,
  onConfirm
}: {
  target: TrashTarget | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !target || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[value="cancel"]')?.focus()
  }, [target])

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
      {target && (
        <form method="dialog" className="p-6">
          <h2 id="trash-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            Move “{target.title}” to the Trash?
          </h2>
          <p className="text-mist mt-3 text-sm leading-relaxed">
            {target.verdict === 'clear'
              ? `${target.summary} It stays in the Trash until you empty it or put it back.`
              : `${target.summary} This is not a cache. If this is the only copy, the Trash is the way back.`}
          </p>
          <p className="mt-3 font-mono text-[11px] leading-relaxed break-all">{target.path}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              Cancel
            </button>
            <button value="confirm" className={buttonVariants({ variant: 'destructive' })}>
              Move to Trash
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
