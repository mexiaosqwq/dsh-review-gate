// Wrap the tsc-compiled CommonJS client program into the DSH browser loader
// shape: window.__ModuleLoader__.load({ id, factory: (require) => ... }).
// Relative modules are inlined with a tiny local require; platform modules
// (react, the slots service, ...) stay as require() calls and are resolved by
// the host's browser module table.
// (Recipe adopted from dsh-web-mobile's out-of-tree client build; id adapted.)
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const buildDir = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')
const PLUGIN_ID = 'dsh-review-gate'

// Walk the emit dir recursively and key each module by its forward-slash
// relative path (e.g. "index.js", "review-gate-chip.js").
async function collectSources(dir, { rel = '' } = {}) {
  const sources = new Map()
  for (const entry of (await readdir(dir, { withFileTypes: true }))) {
    const abs = join(dir, entry.name)
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      for (const [k, v] of await collectSources(abs, { rel: relPath })) {
        sources.set(k, v)
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      sources.set(
        relPath,
        (await readFile(abs, 'utf8')).replace(/\n?\/\/# sourceMappingURL=.*$/u, ''),
      )
    }
  }
  return sources
}

const sources = await collectSources(buildDir)

const REQUIRE_RE = /require\("(\.[^"]+\.js)"\)/g
// Resolve a `./x.js` child relative to its parent module to the canonical
// forward-slash key used in __modules.
const resolveChild = (parent, rel) => {
  const joined = posix.join(posix.dirname(parent), rel)
  const normalized = posix.normalize(joined)
  return normalized === '.' ? '' : normalized
}

// Dependency-first topological order from the entry.
const visited = new Set()
const order = []
const visit = (file) => {
  if (visited.has(file)) return
  visited.add(file)
  const src = sources.get(file)
  if (!src) throw new Error(`client module not found for require: ${file}`)
  for (const match of src.matchAll(REQUIRE_RE)) {
    visit(resolveChild(file, match[1]))
  }
  order.push(file)
}
visit('index.js')

const modules = order
  .map((file) => {
    // Rewrite each relative require to its canonical path so the runtime
    // __localRequire (id.slice(2), entry-relative) resolves nested modules.
    const src = sources.get(file).replace(REQUIRE_RE, (m, rel) => `require("./${resolveChild(file, rel)}")`)
    return `__modules[${JSON.stringify(file)}] = function (require, module, exports) {\n${src}\n};`
  })
  .join('\n')

const wrapped = [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
  'var __modules = {};',
  modules,
  'var __cache = {};',
  'function __localRequire(id) {',
  '  if (id.charCodeAt(0) !== 46) return require(id);',
  '  id = id.slice(2);',
  '  var cached = __cache[id];',
  '  if (cached !== undefined) return cached.exports;',
  '  var module = { exports: {} };',
  '  __cache[id] = module;',
  '  __modules[id](__localRequire, module, module.exports);',
  '  return module.exports;',
  '}',
  'var module = { exports: {} };',
  '__modules["index.js"](__localRequire, module, module.exports);',
  'return module.exports;',
  '} });',
].join('\n')

// Publish behind the smoke gate: write to staging, execute the bytes under a
// host-faithful loader facade, and only swap into lib/ on green. lib/ IS the
// live install (symlink), so an unverified intermediate build must never land
// there — the 2026-09-30 boot-kill shipped exactly that way.
await rm(buildDir, { recursive: true, force: true })
await mkdir(dirname(outputPath), { recursive: true })
const stagingPath = `${outputPath}.staging`
try {
  await writeFile(stagingPath, wrapped)
  const { smokeClient } = await import('./client-smoke.mjs')
  smokeClient(wrapped)
  // POSIX rename atomically replaces the target — no rm first (a gap between
  // rm and rename would briefly leave lib/client.js missing to a restart).
  await rename(stagingPath, outputPath)
  console.log(`client bundle: ${outputPath} (${order.length} module${order.length === 1 ? '' : 's'}, smoke-gated)`)
} catch (error) {
  await rm(stagingPath, { force: true })
  console.error(`client bundle REJECTED at the smoke gate — lib/client.js kept at the last good build: ${error.message}`)
  process.exit(1)
}
