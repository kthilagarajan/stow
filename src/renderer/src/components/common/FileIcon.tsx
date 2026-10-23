import { useEffect, useState } from 'react'
import type { EntryKind } from '@shared/types'
import { AppWindow, File, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FileIcon({ src, kind, className }: { src?: string; kind?: EntryKind; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [src])
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className={cn('size-8 shrink-0 rounded-md object-contain', className)}
      />
    )
  }
  const Icon = kind === 'file' ? File : kind === 'app' ? AppWindow : Folder
  return (
    <span className={cn('bg-fog text-harbor grid size-8 shrink-0 place-items-center rounded-md', className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  )
}
