import { useEffect, useState } from 'react'
import type { ItemInfo } from '@shared/types'
import { Skeleton } from '@/components/common/Skeletons'
import { formatDate } from '@/lib/format'

export function Metadata({ path }: { path: string }) {
  const [info, setInfo] = useState<ItemInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setInfo(null)
    setLoading(Boolean(path && window.stow))
    if (path && window.stow) {
      void window.stow.info(path).then((result) => {
        if (!live) return
        setInfo(result)
        setLoading(false)
      })
    }
    return () => {
      live = false
    }
  }, [path])

  if (loading) {
    return (
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 py-0.5" role="status" aria-label="Reading details">
        {[16, 14, 20, 12].map((width, index) => (
          <div key={index} className="contents">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="ml-auto h-3" style={{ width: `${width * 4}px` }} />
          </div>
        ))}
      </div>
    )
  }
  if (!info) return null
  const rows: [string, string][] = [['Modified', formatDate(info.modified)]]
  if (info.created) rows.push(['Created', formatDate(info.created)])
  if (info.opened) rows.push(['Last opened', formatDate(info.opened)])
  if (info.items !== null) rows.push(['Contains', info.items === 1 ? '1 item' : `${info.items.toLocaleString()} items`])

  return (
    <div className="fade-in flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-mist">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {(info.hidden || info.link) && (
        <div className="flex gap-1.5">
          {info.hidden && <span className="bg-fog text-mist rounded-md px-1.5 py-0.5 text-[11px] font-semibold">Hidden</span>}
          {info.link && <span className="bg-fog text-mist rounded-md px-1.5 py-0.5 text-[11px] font-semibold">Symbolic link</span>}
        </div>
      )}
    </div>
  )
}
