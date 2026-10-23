import type { ReactNode } from 'react'
import { ArrowDownToLine, FolderInput, HardDrive, Monitor, Moon, RefreshCw, Rows3, Rows4, Sun } from 'lucide-react'
import type { VolumeInfo } from '@shared/types'
import mark from '@/assets/icon.png'
import { Skeleton } from '@/components/common/Skeletons'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/useTheme'
import { formatBytes } from '@/lib/format'
import { NEXT_THEME, THEME_LABEL } from '@/lib/theme'

export function AppHeader({
  volume,
  scanning,
  scanned,
  progress,
  compact,
  onToggleCompact,
  onGoTo,
  onScan,
  update
}: {
  volume: VolumeInfo | null
  scanning: boolean
  scanned: boolean
  // 0 to 100 while a scan runs.
  progress: number
  compact: boolean
  onToggleCompact: () => void
  onGoTo: () => void
  onScan: () => void
  // Shown only when a newer release is out.
  update: { version: string; downloading: boolean; onOpen: () => void } | null
}) {
  const { theme, cycle } = useTheme()
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const scanLabel = scanning ? 'Scanning' : scanned ? 'Scan again' : 'Scan'

  return (
    // pl-24 leaves room for the macOS traffic lights; the row is 36px tall so it lines up with them.
    <header className="drag relative flex items-center justify-between gap-4 px-5 pt-3 pb-3 pl-24">
      <div className="flex items-center gap-3">
        <img src={mark} alt="" width={36} height={36} draggable={false} className="size-9" />
        <div>
          <p className="font-display text-[22px] leading-none tracking-tight">Stow</p>
          <p className="text-mist mt-1 text-xs leading-none">What can go, and what stays</p>
        </div>
      </div>
      <div className="no-drag flex items-center gap-2">
        {update && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" className="update-pill text-kelp h-9" onClick={update.onOpen}>
                <ArrowDownToLine aria-hidden />
                {update.downloading ? 'Downloading…' : 'Update'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stow {update.version} is available</TooltipContent>
          </Tooltip>
        )}
        <div className="border-line/70 bg-sheet/70 flex h-9 items-center gap-2 rounded-lg border px-3">
          <HardDrive className="text-harbor size-4" aria-hidden />
          <span className="text-sm font-semibold tracking-tight">{volume?.name ?? 'Macintosh HD'}</span>
          {volume ? (
            <span className="fade-in text-mist font-mono text-[11px]">
              {`${formatBytes(volume.freeBytes)} free of ${formatBytes(volume.totalBytes)}`}
            </span>
          ) : (
            <Skeleton className="h-3 w-32" />
          )}
        </div>
        <IconButton label="Go to a folder" hint="Go to a folder (⇧⌘G)" onClick={onGoTo}>
          <FolderInput aria-hidden />
        </IconButton>
        <IconButton
          label={`Theme: ${THEME_LABEL[theme]}`}
          hint={`${THEME_LABEL[theme]} — click for ${THEME_LABEL[NEXT_THEME[theme]].toLowerCase()}`}
          onClick={cycle}
        >
          <ThemeIcon key={theme} className="fade-in" aria-hidden />
        </IconButton>
        <IconButton label="Compact rows" hint={compact ? 'Roomy rows' : 'Compact rows'} pressed={compact} onClick={onToggleCompact}>
          {compact ? <Rows4 aria-hidden /> : <Rows3 aria-hidden />}
        </IconButton>
        <Button onClick={onScan} disabled={scanning} aria-label={scanLabel}>
          <RefreshCw className={scanning ? 'motion-safe:animate-spin' : undefined} aria-hidden />
          {scanLabel}
        </Button>
      </div>
      {scanning && <Progress value={progress} aria-label="Scan progress" className="absolute inset-x-0 bottom-0 h-1 rounded-none" />}
    </header>
  )
}

function IconButton({
  label,
  hint,
  pressed,
  onClick,
  children
}: {
  label: string
  hint: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon" className="size-9" aria-label={label} aria-pressed={pressed} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
