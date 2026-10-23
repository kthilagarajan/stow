import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { addToTrash, applyTrash, clearTrash, freedBytes } from '../shared/items'
import type { TrashedPath } from './scanner'
import type { SavedScan, StorageChild, StorageItem, Verdict } from '../shared/types'

const VERDICTS = new Set<Verdict>(['mandatory', 'keep', 'optional', 'clear'])

let db: DatabaseSync | null = null

export function openStore(): void {
  if (db) return
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  const database = new DatabaseSync(path.join(dir, 'stow.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scan (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      scanned_at INTEGER NOT NULL,
      limited INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS item (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      grp TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      trashable INTEGER NOT NULL,
      lift_from_parent INTEGER NOT NULL,
      shadow INTEGER NOT NULL,
      complete INTEGER NOT NULL,
      limited INTEGER NOT NULL,
      children TEXT NOT NULL
    );
  `)
  db = database
}

export function closeStore(): void {
  db?.close()
  db = null
}

export function readScan(): SavedScan | null {
  const database = db
  if (!database) return null
  const scan = database.prepare('SELECT scanned_at, limited FROM scan WHERE id = 1').get() as
    | { scanned_at: number; limited: number }
    | undefined
  if (!scan) return null
  const rows = database.prepare('SELECT * FROM item').all() as unknown as ItemRow[]
  return {
    scannedAt: scan.scanned_at,
    limited: scan.limited,
    items: rows.map(rowToItem).filter((item): item is StorageItem => item !== null)
  }
}

export function writeScan(scan: SavedScan): void {
  const database = db
  if (!database) return
  const insert = database.prepare(`
    INSERT INTO item (
      id, title, path, bytes, verdict, grp, summary, detail,
      trashable, lift_from_parent, shadow, complete, limited, children
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  database.exec('BEGIN')
  try {
    database.exec('DELETE FROM item')
    for (const item of scan.items) {
      insert.run(
        item.id,
        item.title,
        item.path,
        item.bytes,
        item.verdict,
        item.group,
        item.summary,
        item.detail,
        item.trashable ? 1 : 0,
        item.liftFromParent ? 1 : 0,
        item.shadow ? 1 : 0,
        item.complete ? 1 : 0,
        item.limited ? 1 : 0,
        JSON.stringify(item.children)
      )
    }
    database.prepare('INSERT OR REPLACE INTO scan (id, scanned_at, limited) VALUES (1, ?, ?)').run(scan.scannedAt, scan.limited)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function clearMeasuredTrash(): void {
  const current = readScan()
  if (!current) return
  writeScan({ ...current, items: clearTrash(current.items) })
}

export function persistTrash(moved: TrashedPath[]): void {
  const current = readScan()
  if (!current || moved.length === 0) return
  let items = current.items
  for (const entry of moved) {
    const bytes = freedBytes(items, entry.path) || entry.bytes
    items = addToTrash(applyTrash(items, entry.path, entry.bytes), bytes)
  }
  writeScan({ ...current, items })
}

interface ItemRow {
  id: string
  title: string
  path: string
  bytes: number
  verdict: string
  grp: string
  summary: string
  detail: string
  trashable: number
  lift_from_parent: number
  shadow: number
  complete: number
  limited: number
  children: string
}

function rowToItem(row: ItemRow): StorageItem | null {
  if (!VERDICTS.has(row.verdict as Verdict)) return null
  return {
    id: row.id,
    title: row.title,
    path: row.path,
    bytes: Number(row.bytes) || 0,
    verdict: row.verdict as Verdict,
    group: row.grp,
    summary: row.summary,
    detail: row.detail,
    trashable: row.trashable === 1,
    liftFromParent: row.lift_from_parent === 1,
    shadow: row.shadow === 1,
    complete: row.complete === 1,
    limited: row.limited === 1,
    children: parseChildren(row.children)
  }
}

function parseChildren(raw: string): StorageChild[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const child = entry as Partial<StorageChild>
      if (typeof child.name !== 'string' || typeof child.path !== 'string') return []
      if (typeof child.verdict !== 'string' || !VERDICTS.has(child.verdict)) return []
      return [
        {
          name: child.name,
          path: child.path,
          bytes: Number(child.bytes) || 0,
          verdict: child.verdict,
          summary: typeof child.summary === 'string' ? child.summary : '',
          trashable: child.trashable === true,
          kind: child.kind === 'file' || child.kind === 'folder' || child.kind === 'app' ? child.kind : undefined
        }
      ]
    })
  } catch {
    return []
  }
}
