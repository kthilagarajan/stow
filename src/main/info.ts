import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ItemInfo } from '../shared/types'

// Spotlight records when Finder or an app last opened something. It is often missing for caches.
function lastOpened(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('mdls', ['-raw', '-name', 'kMDItemLastUsedDate', filePath], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(null)
      const value = Date.parse(stdout.trim())
      resolve(Number.isFinite(value) ? value : null)
    })
  })
}

export async function itemInfo(filePath: string): Promise<ItemInfo | null> {
  if (!filePath || !path.isAbsolute(filePath) || filePath.includes('\0')) return null
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(filePath)
  } catch {
    return null
  }
  const [opened, items] = await Promise.all([
    lastOpened(filePath),
    stat.isDirectory()
      ? fs.readdir(filePath).then((names) => names.length, () => null)
      : Promise.resolve(null)
  ])
  return {
    modified: stat.mtimeMs,
    created: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
    opened,
    items,
    hidden: path.basename(filePath).startsWith('.'),
    link: stat.isSymbolicLink()
  }
}
