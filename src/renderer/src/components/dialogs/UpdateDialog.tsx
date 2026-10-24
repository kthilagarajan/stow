import { useEffect, useRef } from 'react'
import { ArrowDownToLine, ExternalLink, RefreshCw, RotateCw } from 'lucide-react'
import { Skeleton } from '@/components/common/Skeletons'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { Update } from '@/hooks/useUpdate'
import { formatBytes } from '@/lib/format'

export function UpdateDialog({ update, current }: { update: Update; current: string | null }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { info, phase, progress, error, requested } = update

  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !requested || dialog.open) return
    dialog.setAttribute('closedby', 'any')
    dialog.showModal()
  }, [requested])

  const percent = progress && progress.total > 0 ? Math.min(100, (progress.received / progress.total) * 100) : 0

  return (
    <dialog
      ref={ref}
      className="trash-dialog"
      aria-labelledby="update-title"
      onClose={(event) => {
        event.currentTarget.returnValue = ''
        update.dismiss()
      }}
    >
      {requested && (
        <form method="dialog" className="p-6">
          {!info && phase === 'checking' ? (
            <div role="status" aria-label="Checking for updates">
              <h2 id="update-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
                Checking for updates
              </h2>
              <Skeleton className="mt-4 h-3 w-56" />
            </div>
          ) : !info ? (
            <>
              <h2 id="update-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
                Stow is up to date
              </h2>
              <p className="text-mist mt-2 text-sm leading-relaxed">
                {current ? `Version ${current} is the latest release.` : 'This is the latest release.'}
              </p>
            </>
          ) : (
            <>
              <h2 id="update-title" className="font-display text-[1.35rem] leading-tight tracking-tight">
                Stow {info.version} is available
              </h2>
              <p className="text-mist mt-2 text-sm leading-relaxed">
                {current ? `You have ${current}. ` : ''}It downloads from GitHub, then Stow restarts to finish. Your last scan stays.
              </p>
              {info.notes && (
                <div className="border-line bg-fog/60 mt-4 max-h-44 overflow-auto rounded-xl border p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {info.notes}
                </div>
              )}
              {phase === 'downloading' && (
                <div className="mt-4" role="status" aria-label="Downloading the update">
                  <Progress value={percent} className="h-1.5" />
                  <p className="text-mist mt-1.5 font-mono text-[11px]">
                    {progress ? `${formatBytes(progress.received)} of ${formatBytes(progress.total)}` : 'Starting the download'}
                  </p>
                </div>
              )}
              {phase === 'ready' && !error && (
                <p className="fade-in mt-4 text-sm leading-relaxed">The update is ready. Restart Stow to start using {info.version}.</p>
              )}
              {phase === 'installing' && (
                <p className="fade-in mt-4 text-sm leading-relaxed" role="status">
                  Restarting Stow…
                </p>
              )}
              {error && <p className="text-coral mt-3 text-sm leading-relaxed">{error}</p>}
            </>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button value="cancel" className={buttonVariants({ variant: 'outline' })}>
              {phase === 'downloading' ? 'Hide' : phase === 'ready' ? 'Later' : 'Close'}
            </button>
            {info && !info.asset && (
              <button type="button" className={buttonVariants()} onClick={() => void update.openRelease()}>
                <ExternalLink aria-hidden />
                View release
              </button>
            )}
            {info?.asset && (phase === 'ready' || phase === 'installing') && (
              <button type="button" disabled={phase === 'installing'} className={buttonVariants()} onClick={() => void update.install()}>
                <RefreshCw aria-hidden />
                Restart to update
              </button>
            )}
            {info?.asset && phase !== 'ready' && phase !== 'installing' && (
              <button type="button" disabled={phase === 'downloading'} className={buttonVariants()} onClick={() => void update.download()}>
                {phase === 'error' ? <RotateCw aria-hidden /> : <ArrowDownToLine aria-hidden />}
                {phase === 'error' ? 'Try again' : phase === 'downloading' ? 'Downloading…' : `Download ${formatBytes(info.asset.bytes)}`}
              </button>
            )}
          </div>
        </form>
      )}
    </dialog>
  )
}
