// client-bundle.test.mjs — 已发布产物的执行级 smoke：lib/client.js 的字节必须
// 真的能在浏览器 loader 语义下跑起来。起因判例（2026-09-30 真机 boot 失败）：
// 构建脚本把入口 bootstrap 写成 __localRequire("index.js")（裸名落平台 require
// 查表），build 绿、产物在、没有任何执行级检查——整个 GUI 因这个 bundle 拒载
// （"1 entry did not activate"，用户进不去网页）。
//
// 执行器本体在 scripts/client-smoke.mjs（单一事实源）：构建链在发布 lib/ 之前
// 跑同一份 smoke（staging 不过 = lib/client.js 保持上一个好产物），本测试对
// 已发布产物复跑同款断言 + slot 形态细节，防「绕过 build 直接改 lib」。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { smokeClient } from '../scripts/client-smoke.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('client bundle: factory registers once and exposes the plugin face', async () => {
  const code = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  const result = smokeClient(code)
  assert.equal(result.id, 'dsh-review-gate', 'registration id = package name')
  assert.ok(Array.isArray(result.face.inject) && result.face.inject.length > 0, 'inject array present')
  assert.equal(typeof result.face.apply, 'function', 'apply function present')
})

test('client bundle: apply() mounts the chip into conversation.input.left', async () => {
  const code = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  const [slot] = smokeClient(code).slots
  assert.equal(slot.seat, 'conversation.input.left', 'chip mounts into the composer left seat')
  assert.equal(slot.def.id, 'review-gate-intensity-chip', 'slot id stable')
  assert.equal(slot.def.name, 'conversation.input.left', 'slot seat name consistent')
  assert.equal(typeof slot.component, 'function', 'chip component is a function')
})

test('smoke gate: broken bundles are rejected, not published', () => {
  // The three failure shapes the 2026-09-30 boot-kill could take again.
  assert.throws(
    () => smokeClient('window.__ModuleLoader__.load({id:"dsh-review-gate",factory:(require)=>require("index.js")})'),
    /missed the module table/,
    'bare-name entry bootstrap (the actual boot-kill shape) must throw',
  )
  assert.throws(
    () => smokeClient('window.__ModuleLoader__.load({id:"dsh-review-gate",factory:(require)=>require("nope")})'),
    /missed the module table/,
    'unknown external must throw',
  )
  assert.throws(
    () => smokeClient('window.__ModuleLoader__.load({id:"wrong-id",factory:()=>({inject:["tools"],apply(){}})})'),
    /!= dsh-review-gate|id/,
    'wrong plugin id must throw',
  )
  assert.throws(
    () => smokeClient('window.__ModuleLoader__.load({id:"dsh-review-gate",factory:()=>({inject:[],apply(){}})})'),
    /inject array present/,
    'empty inject must throw',
  )
})
