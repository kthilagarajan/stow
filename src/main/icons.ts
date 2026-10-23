import { app } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const icons = new Map<string, string>()
const apps = new Map<string, string>()
let indexing: Promise<void> | null = null

const ALIASES: Record<string, string> = {
  code: 'visual studio code',
  'code - insiders': 'visual studio code - insiders',
  'visual studio code': 'visual studio code'
}

export async function fileIcons(paths: string[]): Promise<Record<string, string>> {
  await indexApps()
  const unique = [...new Set(paths.filter((entry) => typeof entry === 'string' && entry.length > 0))].slice(0, 80)
  const result: Record<string, string> = {}
  await Promise.all(
    unique.map(async (filePath) => {
      const icon = await iconFor(filePath)
      if (icon) result[filePath] = icon
    })
  )
  return result
}

function indexApps(): Promise<void> {
  if (!indexing) {
    const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]
    indexing = Promise.all(roots.map((root) => walkApps(root, 0))).then(() => undefined)
  }
  return indexing
}

async function walkApps(dir: string, depth: number): Promise<void> {
  if (depth > 2) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return
      const full = path.join(dir, entry.name)
      if (entry.name.endsWith('.app')) {
        apps.set(entry.name.slice(0, -4).toLowerCase(), full)
        return
      }
      if (depth < 2) await walkApps(full, depth + 1)
    })
  )
}

function appForName(name: string): string | undefined {
  const key = name.toLowerCase().replace(/\.app$/, '')
  const alias = ALIASES[key]
  if (alias && apps.has(alias)) return apps.get(alias)
  if (apps.has(key)) return apps.get(key)
  const tail = key.split('.').at(-1)
  if (tail && tail.length > 2 && apps.has(tail)) return apps.get(tail)
  return undefined
}

async function iconFor(filePath: string): Promise<string | undefined> {
  const cached = icons.get(filePath)
  if (cached) return cached
  const target = appForName(path.basename(filePath)) ?? filePath
  try {
    const image = await app.getFileIcon(target, { size: 'normal' })
    if (image.isEmpty()) return undefined
    const url = image.toDataURL()
    icons.set(filePath, url)
    return url
  } catch {
    return undefined
  }
}
