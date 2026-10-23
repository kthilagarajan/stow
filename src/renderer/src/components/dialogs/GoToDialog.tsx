import { useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { BIN } from '@/lib/bin'

export function GoToDialog({
  open,
  onClose,
  onGo
}: {
  open: boolean
  onClose: () => void
  // Resolves to an error to show, or null once the folder is open.
  onGo: (filePath: string) => Promise<string | null>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open || dialog.open) return
    setError(null)
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
    dialog.querySelector<HTMLInputElement>('input')?.select()
  }, [open])

  async function go(filePath: string): Promise<void> {
    if (!filePath.trim()) return
    setBusy(true)
    setError(null)
    try {
      const failure = await onGo(filePath.trim())
      if (failure) setError(failure)
      else ref.current?.close()
    } finally {
      setBusy(false)
    }
  }

  async function choose(): Promise<void> {
    const picked = await window.stow?.pickFolder()
    if (!picked) return
    setValue(picked)
    await go(picked)
  }

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="goto-title"
      onClose={(event) => {
        event.currentTarget.returnValue = ''
        onClose()
      }}
    >
      {open && (
        <form
          className="p-6"
          onSubmit={(event) => {
            event.preventDefault()
            void go(value)
          }}
        >
          <h2 id="goto-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            Go to a folder
          </h2>
          <p className="text-mist mt-2 text-sm leading-relaxed">
            Stow measures it and lists what is inside. Outside the usual places, only caches, installers, and dependencies can go to the {BIN}.
          </p>
          <label htmlFor="goto-path" className="sr-only">
            Folder path
          </label>
          <input
            id="goto-path"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="~/Projects"
            spellCheck={false}
            autoComplete="off"
            className="border-line bg-fog/70 focus-visible:outline-harbor mt-4 h-10 w-full rounded-lg border px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          {error && <p className="text-coral mt-2 text-sm leading-relaxed">{error}</p>}
          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'ghost' })} onClick={() => void choose()}>
              <FolderOpen aria-hidden />
              Choose…
            </button>
            <span className="flex gap-2">
              <button type="button" className={buttonVariants({ variant: 'outline' })} onClick={() => ref.current?.close()}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !value.trim()} className={buttonVariants()}>
                {busy ? 'Measuring…' : 'Go'}
              </button>
            </span>
          </div>
        </form>
      )}
    </dialog>
  )
}
