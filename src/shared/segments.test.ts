import assert from 'node:assert/strict'
import { segmentTotals } from './segments'
import type { StorageItem, Verdict } from './types'

function item(partial: Pick<StorageItem, 'id' | 'path' | 'bytes' | 'verdict'> & Partial<StorageItem>): StorageItem {
  return {
    title: partial.id,
    group: 'Test',
    summary: '',
    detail: '',
    children: [],
    trashable: false,
    liftFromParent: false,
    shadow: false,
    complete: true,
    limited: false,
    ...partial
  }
}

const used = 1_000
const free = 200

function totalsOf(items: StorageItem[], diskUsed = used) {
  return segmentTotals(items, diskUsed, free)
}

const documents = item({
  id: 'docs',
  path: '/Users/a/Documents',
  bytes: 100,
  verdict: 'keep'
})

const caches = item({
  id: 'caches',
  path: '/Users/a/Library/Caches',
  bytes: 30,
  verdict: 'clear'
})

const deps = item({
  id: 'deps',
  path: '/Users/a/Documents/app/node_modules',
  bytes: 15,
  verdict: 'optional',
  liftFromParent: true,
  children: [
    {
      name: 'app/node_modules',
      path: '/Users/a/Documents/app/node_modules',
      bytes: 10,
      verdict: 'optional' as Verdict,
      summary: '',
      trashable: true
    },
    {
      name: 'other/node_modules',
      path: '/Users/a/Projects/other/node_modules',
      bytes: 5,
      verdict: 'optional' as Verdict,
      summary: '',
      trashable: true
    }
  ]
})

const totals = totalsOf([documents, caches, deps])
assert.equal(totals.keep, 90, 'documents should lose the nested dependency bytes')
assert.equal(totals.optional, 15, 'dependencies count once, including the folder outside Documents')
assert.equal(totals.clear, 30)
assert.equal(totals.other, used - 90 - 15 - 30)

const photo = item({
  id: 'photo',
  path: '/Users/a/Pictures/vacation.mov',
  bytes: 800,
  verdict: 'keep',
  shadow: true
})
const withShadow = totalsOf([caches, photo], 30)
assert.equal(withShadow.clear, 30)
assert.equal(withShadow.keep, 0)
assert.equal(withShadow.other, 0)

const support = item({
  id: 'support',
  path: '/Users/a/Library/Application Support',
  bytes: 50,
  verdict: 'keep',
  complete: false
})
const codeCache = item({
  id: 'code-cache',
  path: '/Users/a/Library/Application Support/Code/Cache',
  bytes: 8,
  verdict: 'clear',
  liftFromParent: true
})
const partial = totalsOf([support, codeCache], 50)
assert.equal(partial.keep, 50, 'an unfinished parent keeps its partial size')
assert.equal(partial.clear, 0, 'nested bytes stay inside the unfinished parent')

const nested = item({
  id: 'project',
  path: '/Users/a/Documents/client',
  bytes: 40,
  verdict: 'keep'
})
const deep = item({
  id: 'mods',
  path: '/Users/a/Documents/client/app/node_modules',
  bytes: 12,
  verdict: 'optional',
  liftFromParent: true
})
const specific = totalsOf([documents, nested, deep], 100)
assert.equal(specific.keep, 88)
assert.equal(specific.optional, 12)
assert.equal(specific.other, 0)

console.log('segment totals ok')
