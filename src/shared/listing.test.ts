import assert from 'node:assert/strict'
import { applyFolderProgress, mergeListing, noteFolderUpdate, type FolderProgress } from './listing'
import type { FolderEntry, FolderListing, FolderUpdate } from './types'

function entry(name: string, bytes = 0, measured = false): FolderEntry {
  return {
    name,
    path: `/Users/alex/ag/${name}`,
    bytes,
    kind: name.includes('.') ? 'file' : 'folder',
    verdict: 'keep',
    summary: 'Stow will not move this.',
    trashable: false,
    measured
  }
}

function listing(entries: FolderEntry[]): FolderListing {
  return {
    path: '/Users/alex/ag',
    name: 'ag',
    bytes: 0,
    verdict: 'keep',
    summary: 'Files and folders inside this one, largest first.',
    trashable: false,
    entries,
    smallerCount: 2,
    smallerBytes: 0,
    limited: false,
    measuring: true,
    token: 4
  }
}

function update(partial: Partial<FolderUpdate> = {}): FolderUpdate {
  return {
    path: '/Users/alex/ag',
    token: 4,
    bytes: 0,
    sizes: [],
    entries: null,
    smallerCount: 0,
    smallerBytes: 0,
    measuring: true,
    limited: false,
    ...partial
  }
}

const start = listing([entry('src'), entry('readme.md')])

const noted = noteFolderUpdate(undefined, update({ sizes: [{ path: '/Users/alex/ag/readme.md', bytes: 1200 }] }))
const patched = applyFolderProgress(start, noted)
assert.equal(patched.entries[1]?.bytes, 1200)
assert.equal(patched.entries[1]?.measured, true)
assert.equal(patched.entries[0]?.measured, false)
assert.equal(patched.smallerCount, 2)
assert.equal(patched.measuring, true)

const again = noteFolderUpdate(noted, update({ sizes: [{ path: '/Users/alex/ag/src', bytes: 8000 }], bytes: 9200 }))
const both = applyFolderProgress(start, again)
assert.equal(both.entries[0]?.bytes, 8000)
assert.equal(both.bytes, 9200)

const finishedEntries = [entry('src', 8000, true), entry('readme.md', 1200, true)]
const done = noteFolderUpdate(
  again,
  update({ measuring: false, bytes: 9200, entries: finishedEntries, smallerCount: 0, smallerBytes: 0 })
)
const complete = applyFolderProgress(start, done)
assert.equal(complete.measuring, false)
assert.deepEqual(complete.entries.map((item) => item.name), ['src', 'readme.md'])
assert.equal(complete.smallerCount, 0)

// A late patch from the same visit cannot reopen a finished folder or replace a size it already has.
const late = noteFolderUpdate(done, update({ measuring: true, sizes: [{ path: '/Users/alex/ag/src', bytes: 1 }] }))
assert.equal(applyFolderProgress(complete, late).entries[0]?.bytes, 8000)
assert.equal(applyFolderProgress(complete, late).measuring, false)

// A row that was still waiting can take a size found by opening that folder.
const waiting = noteFolderUpdate(
  again,
  update({ measuring: false, bytes: 9200, entries: [entry('src', 8000, true), entry('readme.md')], smallerCount: 0 })
)
const filled = noteFolderUpdate(waiting, update({ measuring: false, sizes: [{ path: '/Users/alex/ag/readme.md', bytes: 1200 }] }))
const shown = applyFolderProgress(start, filled)
assert.equal(shown.measuring, false)
assert.equal(shown.entries[1]?.bytes, 1200)
assert.equal(shown.entries[1]?.measured, true)
assert.equal(shown.entries[0]?.bytes, 8000)

// An older visit cannot overwrite the one on screen.
const stale: FolderProgress = { ...done, token: 3, bytes: 1, measuring: true, entries: null }
assert.equal(applyFolderProgress(complete, stale).bytes, 9200)

const limited = noteFolderUpdate(undefined, update({ limited: true }))
assert.equal(applyFolderProgress(start, noteFolderUpdate(limited, update())).limited, true)

// A known folder total stays put while the first patches still report 0.
assert.equal(applyFolderProgress({ ...start, bytes: 5000 }, noted).bytes, 5000)

const measured = listing([entry('src', 8000, true), entry('readme.md', 1200, true)])
const blank = listing([entry('src'), entry('readme.md')])
const kept = mergeListing({ ...measured, measuring: false, bytes: 9200 }, blank)
assert.equal(kept.bytes, 9200)
assert.equal(kept.entries[0]?.bytes, 8000)
assert.equal(kept.entries[0]?.measured, true)
assert.equal(kept.entries[1]?.measured, true)

const newer = mergeListing(measured, listing([entry('src', 9000, true), entry('readme.md')]))
assert.equal(newer.entries[0]?.bytes, 9000)
assert.equal(newer.entries[1]?.bytes, 1200)

console.log('folder updates ok')
