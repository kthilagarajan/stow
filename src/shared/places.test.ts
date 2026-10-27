import assert from 'node:assert/strict'
import { addPlace, readPlaces, removePlace } from './places'

const projects = { path: '/Users/alex/Projects', name: 'Projects' }
const downloads = { path: '/Users/alex/Downloads', name: 'Downloads' }

assert.deepEqual(addPlace([], projects), [projects])
assert.deepEqual(addPlace([projects], downloads), [downloads, projects])
assert.deepEqual(addPlace([downloads, projects], projects), [projects, downloads])
assert.deepEqual(addPlace([downloads, projects], { path: '/Users/alex/Music', name: 'Music' }, 2).length, 2)
assert.deepEqual(removePlace([downloads, projects], projects.path), [downloads])

assert.deepEqual(readPlaces(JSON.stringify([projects])), [projects])
assert.deepEqual(readPlaces(JSON.stringify([{ path: 'relative', name: 'x' }, { path: 3 }, projects])), [projects])
assert.deepEqual(readPlaces('not json'), [])
assert.deepEqual(readPlaces(null), [])
assert.deepEqual(readPlaces('{"path":"/x"}'), [])

console.log('places ok')
