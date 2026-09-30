// Shared client-bundle smoke: executes the shipped bytes under a host-faithful
// loader facade. Used BOTH by the build (pre-publish gate — staging that fails
// here never replaces lib/client.js) and by the published-artifact test.
// Born from the 2026-09-30 boot-kill: a hand-written bootstrap line passed
// build and type-check but missed the host module table, and because lib/ IS
// the live install (symlink), the broken state went live on the next restart.
import assert from 'node:assert/strict'
import vm from 'node:vm'

/**
 * Execute one client bundle the way dsh-client-modules would.
 * @param {string} code - full bundle text (window.__ModuleLoader__.load closure).
 * @param {Record<string, unknown>} [extraSeeds] - additional platform seeds.
 * @returns {{ id: string, face: {inject: string[], apply: Function}, slots: {seat: string, def: object, component: Function}[] }}
 */
export function smokeClient(code, { extraSeeds = {}, expectedId = 'dsh-review-gate' } = {}) {
  const registrations = []
  const sandboxWindow = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  }
  // Mirror the host's makeRequire: unknown spec throws loudly. Only react and
  // its JSX runtime are legitimate externals for this bundle.
  const seeds = {
    react: { useState: () => [null, () => {}], useEffect: () => {} },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
    ...extraSeeds,
  }
  vm.runInNewContext(code, { window: sandboxWindow }, { filename: 'client-bundle' })

  assert.equal(registrations.length, 1, 'exactly one __ModuleLoader__.load registration')
  const { id, factory } = registrations[0]
  assert.equal(typeof factory, 'function', 'factory is a function')
  assert.equal(id, expectedId, `bundle id ${id} != ${expectedId}`)

  const pluginFace = factory((spec) => {
    if (spec in seeds) return seeds[spec]
    throw new Error(`smoke: external "${spec}" missed the module table (externals drift)`)
  })
  assert.ok(Array.isArray(pluginFace.inject) && pluginFace.inject.length > 0, 'inject array present')
  assert.equal(typeof pluginFace.apply, 'function', 'apply function present')

  const slotInjects = []
  const slotRegistrations = []
  pluginFace.apply({
    slots: {
      inject: (seat, mount) => slotInjects.push({ seat, mount }),
      register: (def, component) => slotRegistrations.push({ def, component }),
    },
  })
  for (const { mount } of slotInjects) mount() // seat mounts are lazy

  assert.equal(slotRegistrations.length, 1, 'one slot registration after mount')
  return {
    id,
    face: pluginFace,
    slots: slotRegistrations.map((r) => ({ seat: slotInjects[0]?.seat, def: r.def, component: r.component })),
  }
}
