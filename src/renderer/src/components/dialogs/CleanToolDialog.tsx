import { useEffect, useRef } from 'react'
import type { DevTool } from '@shared/types'
import { buttonVariants } from '@/components/ui/button'
import { BIN } from '@/lib/bin'
import { formatBytes } from '@/lib/format'

export function CleanToolDialog({ tool, onCancel, onConfirm }: { tool: DevTool | null; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !tool || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[value="cancel"]')?.focus()
  }, [tool])

  const frees = tool && tool.estimate === 'frees' && tool.bytes ? ` It frees about ${formatBytes(tool.bytes)}.` : ''
  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="clean-tool-title"
      onClose={(event) => {
        const value = event.currentTarget.returnValue
        event.currentTarget.returnValue = ''
        if (value === 'confirm') onConfirm()
        else onCancel()
      }}
    >
      {tool && (
        <form method="dialog" className="p-6">
          <h2 id="clean-tool-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            Clean up {tool.name}?
          </h2>
          <p className="text-mist mt-3 text-sm leading-relaxed">
            Stow runs <code className="font-mono text-xs">{tool.command}</code>. {tool.summary}
            {frees}
          </p>
          <p className="text-mist mt-2 text-sm leading-relaxed">{tool.name} deletes these itself. They do not go to the {BIN}, so there is no way back.</p>
          <div className="mt-6 flex justify-end gap-2">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              Cancel
            </button>
            <button value="confirm" className={buttonVariants({ variant: 'destructive' })}>
              Clean up
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
