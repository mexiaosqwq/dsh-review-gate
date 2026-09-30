// Host-lib sanity: the publish gate for the server half. tsc's noEmitOnError
// already blocks emit on type errors, but a module that type-checks can still
// fail at import time (top-level await misuse, missing runtime export) — and
// lib/ IS the live install (symlink), so it must load before anything that
// restarts the host can pick it up.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(pathToFileURL(join(root, 'lib', 'index.js')))
assert.equal(typeof mod.apply, 'function', 'lib/index.js exports apply()')
console.log('host lib sanity: apply() export OK')
