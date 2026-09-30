// client-bundle.test.mjs — 执行级 smoke：lib/client.js 的字节必须真的能在
// 浏览器 loader 语义下跑起来。起因判例（2026-09-30 真机 boot 失败）：构建脚本
// 把入口 bootstrap 写成 __localRequire("index.js")（裸名落平台 require 查表），
// build 绿、产物在、没有任何执行级检查——整个 GUI 因这个 bundle 拒载
// （"1 entry did not activate"，用户进不去网页）。
//
// 本测试复刻宿主 loader 的 require 语义（seed 命中 / 未知 spec 直接 throw，
// 与 dsh-client-modules makeRequire 同形态），在 vm 里执行产物工厂，断言：
//   1) 恰好一次 __ModuleLoader__.load 注册，id = 包名
//   2) 工厂返回插件 face：inject 数组 + apply 函数
//   3) apply() 真的把 chip 注册进 conversation.input.left slot
// 任何 require 漏表（现在或将来）都会在这里炸，而不是在用户真机上炸。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('client bundle: factory registers once and exposes the plugin face', async () => {
  const code = await readFile(join(root, 'lib', 'client.js'), 'utf8')

  // Fake browser: capture __ModuleLoader__.load registrations.
  const registrations = []
  const sandboxWindow = {
    __ModuleLoader__: { load: (registration) => registrations.push(registration) },
  }

  // Fake platform require: mirrors the host loader's makeRequire — unknown
  // spec throws loudly (this is the exact trap the bootstrap line fell into).
  // Only react + jsx-runtime are legitimate externals for this bundle.
  const seeds = {
    react: { useState: () => [null, () => {}], useEffect: () => {} },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
  }
  const platformRequire = (spec) => {
    if (spec in seeds) return seeds[spec]
    throw new Error(`smoke: external "${spec}" is not a seeded platform module (externals drift)`)
  }

  vm.runInNewContext(code, { window: sandboxWindow }, { filename: 'lib/client.js' })

  assert.equal(registrations.length, 1, 'exactly one __ModuleLoader__.load registration')
  assert.equal(registrations[0].id, 'dsh-review-gate', 'registration id = package name')
  assert.equal(typeof registrations[0].factory, 'function', 'factory is a function')

  // Run the factory the way the host materialize() does: with the loader require.
  const pluginFace = registrations[0].factory(platformRequire)
  assert.ok(Array.isArray(pluginFace.inject) && pluginFace.inject.length > 0, 'inject array present')
  assert.equal(typeof pluginFace.apply, 'function', 'apply function present')
})

test('client bundle: apply() mounts the chip into conversation.input.left', async () => {
  const code = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  const registrations = []
  const sandboxWindow = { __ModuleLoader__: { load: (r) => registrations.push(r) } }
  const seeds = {
    react: { useState: () => [null, () => {}], useEffect: () => {} },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
  }
  vm.runInNewContext(code, { window: sandboxWindow }, { filename: 'lib/client.js' })
  const { factory } = registrations[0]
  const face = factory((spec) => {
    if (spec in seeds) return seeds[spec]
    throw new Error(`smoke: external "${spec}" missed the module table`)
  })

  // Fake client context: the slot seat the chip must land in.
  const slotInjects = []
  const slotRegistrations = []
  const ctx = {
    slots: {
      inject: (seat, mount) => slotInjects.push({ seat, mount }),
      register: (def, component) => slotRegistrations.push({ def, component }),
    },
  }
  face.apply(ctx)

  // The seat mount is lazy — the host invokes it when the composer renders.
  for (const { mount } of slotInjects) mount()

  assert.deepEqual(slotInjects.map((s) => s.seat), ['conversation.input.left'],
    'chip mounts into the composer left seat and nothing else')
  assert.equal(slotRegistrations.length, 1, 'one slot registration')
  assert.equal(slotRegistrations[0].def.id, 'review-gate-intensity-chip', 'slot id stable')
  assert.equal(slotRegistrations[0].def.name, 'conversation.input.left', 'slot seat name consistent')
  assert.equal(typeof slotRegistrations[0].component, 'function', 'chip component is a function')
})
