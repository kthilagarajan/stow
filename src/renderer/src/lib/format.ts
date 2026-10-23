const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 KB'
  if (bytes < 1000) return `${Math.round(bytes)} bytes`
  const exp = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)))
  const value = bytes / 1000 ** exp
  const digits = exp >= 3 ? 1 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  const text = value
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1')
  return `${text} ${UNITS[exp]}`
}

export function formatScannedAt(ms: number): string {
  const date = new Date(ms)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date >= today) return `Last scan today at ${time}`
  if (date >= yesterday) return `Last scan yesterday at ${time}`
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  return `Last scan ${day} at ${time}`
}
