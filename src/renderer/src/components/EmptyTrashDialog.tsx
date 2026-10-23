import { useEffect, useRef } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'

export function EmptyTrashDialog({
  open,
  bytes,
  onCancel,
  onConfirm
}: {
  open: boolean
  bytes: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[value="cancel"]')?.focus()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="empty-trash-title"
      onClose={(event) => {
        const value = event.currentTarget.returnValue
        event.currentTarget.returnValue = ''
        if (value === 'confirm') onConfirm()
        else onCancel()
      }}
    >
      {open && (
        <form method="dialog" className="p-6">
          <h2 id="empty-trash-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            Empty the Trash?
          </h2>
          <p className="text-mist mt-3 text-sm leading-relaxed">
            This permanently deletes {formatBytes(bytes)} in the Trash. There is no way back. Finder may ask once more before it finishes.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              Cancel
            </button>
            <button value="confirm" className={buttonVariants({ variant: 'destructive' })}>
              Empty Trash
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
