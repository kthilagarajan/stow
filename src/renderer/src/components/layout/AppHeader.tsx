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
  note,
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
  // When the disk was last scanned, or what the scan is doing now.
  note: string
  // Shown only when a newer release is out.
  update: { version: string; downloading: boolean; ready: boolean; onOpen: () => void } | null
}) {
  const { theme, cycle } = useTheme()
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const scanLabel = scanning ? 'Scanning' : scanned ? 'Scan again' : 'Scan'

  return (
    // A title bar the width of the window: the macOS traffic lights sit in its left end (trafficLightPosition in
    // tauri.conf.json centres them on this 52px row), so pl-[84px] starts the logo just after them.
    // Tauri only drags from the element that was pressed, so every non-interactive piece carries the attribute.
    <header
      data-tauri-drag-region
      className="bg-sheet/80 border-line/70 relative flex h-13 shrink-0 items-center justify-between gap-4 border-b pr-3 pl-[84px]"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
        <span data-tauri-drag-region aria-hidden className="bg-line/80 mr-1.5 h-5 w-px" />
        <img data-tauri-drag-region src={mark} alt="" width={28} height={28} draggable={false} className="size-7" />
        <div data-tauri-drag-region className="flex min-w-0 items-baseline gap-2">
          <p data-tauri-drag-region className="font-display text-[17px] leading-none font-semibold tracking-tight">Stow</p>
          <p data-tauri-drag-region className="text-mist truncate text-xs leading-none">What can go, and what stays</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {update && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" className="update-pill text-kelp h-8" onClick={update.onOpen}>
                <ArrowDownToLine aria-hidden />
                {update.downloading ? 'Downloading…' : update.ready ? 'Restart to update' : 'Update'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stow {update.version} is available</TooltipContent>
          </Tooltip>
        )}
        <div className="border-line/70 bg-sheet/70 flex h-8 items-center gap-2 rounded-lg border px-3">
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
        <p role="status" className="text-mist max-w-56 truncate pl-2 text-xs" title={note}>
          {note}
        </p>
        <Button className="ml-1 h-8" onClick={onScan} disabled={scanning} aria-label={scanLabel}>
          <RefreshCw className={scanning ? 'motion-safe:animate-spin' : undefined} aria-hidden />
          {scanLabel}
        </Button>
      </div>
      {scanning && <Progress value={progress} aria-label="Scan progress" className="absolute inset-x-0 -bottom-px h-0.5 rounded-none" />}
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
        <Button variant="ghost" size="icon" className="text-mist hover:text-ink size-8" aria-label={label} aria-pressed={pressed} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
