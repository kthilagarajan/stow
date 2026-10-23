import assert from 'node:assert/strict'
import { addToTrash, applyTrash, clearTrash } from './items'
import type { StorageItem } from './types'

function item(partial: Pick<StorageItem, 'id' | 'path' | 'bytes'> & Partial<StorageItem>): StorageItem {
  return {
    title: partial.id,
    verdict: 'clear',
    group: 'Test',
    summary: '',
    detail: '',
    children: [],
    trashable: true,
    liftFromParent: false,
    shadow: false,
    complete: true,
    limited: false,
    ...partial
  }
}

const bytesOf = (items: StorageItem[], id: string) => items.find((entry) => entry.id === id)?.bytes

const start = [
  item({ id: 'trash', path: '/u/.Trash', bytes: 0, trashable: false }),
  item({
    id: 'caches',
    path: '/u/Library/Caches',
    bytes: 300,
    children: [{ name: 'Google', path: '/u/Library/Caches/Google', bytes: 200, verdict: 'clear', summary: '', trashable: true }]
  })
]

// A path below the listed children: only the caller knows its size.
const deep = applyTrash(start, '/u/Library/Caches/Google/Chrome', 50)
assert.equal(bytesOf(deep, 'caches'), 250)
assert.equal(deep[1]?.children[0]?.bytes, 150)

// A listed child: its size comes from the scan.
const child = applyTrash(deep, '/u/Library/Caches/Google')
assert.equal(bytesOf(child, 'caches'), 100)
assert.equal(child[1]?.children.length, 0)

// Moving to the bin moves bytes into it; emptying clears it.
const binned = addToTrash(addToTrash(start, 50), 150)
assert.equal(bytesOf(binned, 'trash'), 200)
assert.equal(bytesOf(clearTrash(binned), 'trash'), 0)
assert.equal(addToTrash(start, 0), start)

console.log('trash bookkeeping ok')
