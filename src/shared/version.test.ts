import assert from 'node:assert/strict'
import { isNewer } from './version'

assert.equal(isNewer('v0.2.0', '0.1.0'), true)
assert.equal(isNewer('0.1.1', '0.1.0'), true)
assert.equal(isNewer('v1.0.0', '0.9.9'), true)
assert.equal(isNewer('v0.10.0', '0.9.0'), true)
assert.equal(isNewer('v0.1.0', '0.1.0'), false)
assert.equal(isNewer('v0.0.9', '0.1.0'), false)
assert.equal(isNewer('v0.2.0-beta.1', '0.2.0'), false)

console.log('version compare ok')
