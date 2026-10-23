import { useEffect, useRef, useState } from 'react'
import { Copy, Sparkles } from 'lucide-react'
import { ActionTile } from '@/components/common/ActionTile'
import { buttonVariants } from '@/components/ui/button'
import { deletionPrompt, type PromptSubject } from '@/lib/prompt'
import type { AssistantTarget } from '@shared/types'

export function AskButton({ subject }: { subject: PromptSubject }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ActionTile
        icon={Sparkles}
        label="Ask AI"
        hint="Ask an assistant whether this is safe to delete"
        iconClassName="text-amber"
        onClick={() => setOpen(true)}
      />
      <AskDialog subject={subject} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function AskDialog({ subject, open, onClose }: { subject: PromptSubject; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const prompt = deletionPrompt(subject)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
  }, [open])

  useEffect(() => {
    if (open) {
      setNotice(null)
      setError(null)
    }
  }, [open, prompt])

  async function send(target: AssistantTarget): Promise<void> {
    const api = window.stow
    if (!api) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const result = await api.ask(target, prompt)
      if (result.ok) setNotice(result.notice ?? 'Opened.')
      else setError(result.error ?? 'Could not open that assistant.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="ask-title"
      onClose={(event) => {
        event.currentTarget.returnValue = ''
        onClose()
      }}
    >
      {open && (
        <form method="dialog" className="p-6">
          <h2 id="ask-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
            Ask whether this is safe
          </h2>
          <p className="text-mist mt-3 text-sm leading-relaxed">
            This prompt includes the name, size, path, and Stow’s label for {subject.title}. Stow does not send it. It opens the desktop app.
          </p>
          <textarea
            readOnly
            value={prompt}
            aria-label="Prompt"
            className="border-line bg-fog/70 mt-4 h-40 w-full resize-none rounded-xl border p-3 font-mono text-[11px] leading-relaxed"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'outline' })} onClick={() => void send('copy')}>
              <Copy aria-hidden />
              Copy prompt
            </button>
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'outline' })} onClick={() => void send('chatgpt')}>
              ChatGPT
            </button>
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'outline' })} onClick={() => void send('claude')}>
              Claude
            </button>
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'outline' })} onClick={() => void send('cursor')}>
              Cursor
            </button>
            <button type="button" disabled={busy} className={buttonVariants({ variant: 'outline' })} onClick={() => void send('codex')}>
              Codex
            </button>
          </div>
          {notice && <p className="mt-3 text-sm leading-relaxed">{notice}</p>}
          {error && <p className="text-coral mt-3 text-sm leading-relaxed">{error}</p>}
          <div className="mt-6 flex justify-end">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              Close
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
