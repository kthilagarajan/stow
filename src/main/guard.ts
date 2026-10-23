import path from 'node:path'
import type { Verdict } from '../shared/types'

export interface TrashRecord {
  verdict: Verdict
  trashable: boolean
}

const NEVER_PREFIX = [
  '/Library/Keychains',
  '/Library/Preferences',
  '/Library/Mail',
  '/Library/Messages',
  '/Library/Mobile Documents',
  '/Library/Accounts',
  '/Library/HomeKit',
  '/Library/IdentityServices',
  '/Library/Cookies',
  '/Library/Biome',
  '/Library/Photos',
  '/Library/Group Containers',
  '/Library/CloudStorage',
  '/Library/Finance',
  '/Library/com.apple.appleaccountd'
]

const NEVER_EXACT = new Set([
  '/Library',
  '/Library/Application Support',
  '/Library/Developer',
  '/Library/Containers'
])

const VERDICT_RANK: Record<Verdict, number> = {
  mandatory: 0,
  keep: 1,
  optional: 2,
  clear: 3
}

export function stricterVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[a] <= VERDICT_RANK[b] ? a : b
}

export function pathKeys(filePath: string): string[] {
  const normalized = path.normalize(filePath).replace(/\/+$/, '') || '/'
  const keys = new Set<string>([normalized])
  const dataPrefix = '/System/Volumes/Data'
  if (normalized.startsWith('/Users/')) keys.add(dataPrefix + normalized)
  if (normalized.startsWith(`${dataPrefix}/Users/`)) keys.add(normalized.slice(dataPrefix.length))
  return [...keys]
}

export function homeForms(home: string): string[] {
  const normalized = path.normalize(home).replace(/\/+$/, '')
  return [normalized, `/System/Volumes/Data${normalized}`]
}

function relativeToHome(realPath: string, home: string): string | null {
  const normalized = path.normalize(realPath).replace(/\/+$/, '')
  for (const root of homeForms(home)) {
    if (normalized === root) return ''
    if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length)
  }
  return null
}

export function lookupRecord(registry: Map<string, TrashRecord>, filePath: string): TrashRecord | undefined {
  for (const key of pathKeys(filePath)) {
    const record = registry.get(key)
    if (record) return record
  }
  return undefined
}

export function trashDecision(
  realPath: string,
  home: string,
  record: TrashRecord | undefined
): { ok: true } | { ok: false; error: string } {
  if (!record) return { ok: false, error: 'Stow did not measure that path.' }
  if (!record.trashable || record.verdict === 'mandatory' || record.verdict === 'keep') {
    return { ok: false, error: 'Stow will not move this. It is here to keep.' }
  }

  const relative = relativeToHome(realPath, home)
  if (relative === null) return { ok: false, error: 'That folder is outside your home folder.' }
  if (relative === '') return { ok: false, error: 'That is your home folder.' }
  if (NEVER_EXACT.has(relative) || NEVER_PREFIX.some((fragment) => relative === fragment || relative.startsWith(`${fragment}/`))) {
    return { ok: false, error: 'Stow will not move that part of your Library.' }
  }
  if (relative.endsWith('.app') || relative.includes('.app/')) {
    return { ok: false, error: 'Stow will not uninstall an app.' }
  }
  if (relative.includes('.photoslibrary')) {
    return { ok: false, error: 'Stow will not move a photo library.' }
  }

  return { ok: true }
}
