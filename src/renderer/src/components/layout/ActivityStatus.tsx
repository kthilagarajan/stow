import type { ActivityTask } from '@shared/types'
import { BIN } from '@/lib/bin'

const SHOWN = 3

function describe(task: ActivityTask): { title: string; detail?: string } {
  const counted = task.total ? `${task.done ?? 0} of ${task.total}` : undefined
  switch (task.kind) {
    case 'scan':
      return { title: 'Scanning this Mac', detail: [task.target, counted].filter(Boolean).join(' · ') || undefined }
    case 'folder':
      return { title: `Measuring ${task.target ?? 'a folder'}`, detail: counted && `${counted} items` }
    case 'trash':
      if (task.target) return { title: `Moving ${task.target} to the ${BIN}` }
      return { title: task.total ? `Moving ${task.total} items to the ${BIN}` : `Moving to the ${BIN}` }
    case 'empty-bin':
      return { title: `Emptying the ${BIN}` }
    case 'volume':
      return { title: 'Reading the disk' }
    case 'saved':
      return { title: 'Opening the last scan' }
    case 'info':
      return { title: 'Reading details', detail: task.target }
    case 'icons':
      return { title: 'Loading Finder icons' }
    case 'update':
      return { title: 'Checking for updates' }
    case 'download':
      return { title: task.target ? `Downloading Stow ${task.target}` : 'Downloading the update' }
    case 'tools':
      return { title: 'Checking developer tools' }
    case 'tool-clean':
      return { title: `Cleaning up ${task.target ?? 'a developer tool'}` }
  }
}

// What is running behind the scenes, so a loader always has a reason beside it. Hidden when idle.
export function ActivityStatus({ tasks }: { tasks: ActivityTask[] }) {
  if (tasks.length === 0) return null
  const shown = tasks.slice(0, SHOWN)
  return (
    <section aria-label="Background activity" aria-live="polite" className="bg-raised/50 ring-line mb-3 rounded-xl px-2.5 py-2 ring-1">
      <p className="text-mist flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase">
        <span className="activity-dot bg-harbor size-1.5 rounded-full" aria-hidden />
        Working
      </p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {shown.map((task) => {
          const { title, detail } = describe(task)
          const share = task.total ? Math.min(100, ((task.done ?? 0) / task.total) * 100) : null
          return (
            <li key={task.id} className="fade-in min-w-0">
              <p className="truncate text-xs font-medium" title={title}>
                {title}
              </p>
              {detail && <p className="text-mist truncate font-mono text-[10px]">{detail}</p>}
              {share !== null && (
                <span className="bg-line mt-1 block h-0.5 overflow-hidden rounded-full" aria-hidden>
                  <span className="activity-bar bg-harbor block h-full rounded-full" style={{ width: `${share}%` }} />
                </span>
              )}
            </li>
          )
        })}
        {tasks.length > SHOWN && <li className="text-mist text-[11px]">{tasks.length - SHOWN} more</li>}
      </ul>
    </section>
  )
}
