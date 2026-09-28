import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import * as gate from '../lib/index.js'

const baseConfig = {
  mode: 'auto',
  fullAtFiles: 3,
  fullAtLines: 150,
  milestoneAtFiles: 10,
  maxChain: 2,
  writeTools: ['write', 'edit'],
  ignoreGlobs: [],
  alwaysFullGlobs: [],
}

async function mountGateHarness(t, gateConfig = {}) {
  const ctx = new Context()
  const tmpDir = await mkdtemp(join(tmpdir(), 'gate-e2e-'))
  t.after(async () => {
    // cordis Context has no dispose method; teardown goes through the root
    // fiber (ctx.fiber.dispose, verified against cordis lib/types/fiber.d.ts
    // L111-112 and the testkit README "Dispose the owning context" rule).
    await ctx.fiber.dispose()
    await rm(tmpDir, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  // load-order-sensitive consumer: must mount before the harness
  // (testkit README "Drive a production Agent" section).
  // Awaiting the plugin call confirms gate activation (listeners registered)
  // before we proceed. If this cordis version makes plugin fork non-awaitable
  // it throws TypeError immediately: STOP and report, never paper over with sleep.
  await ctx.plugin(gate, { ...baseConfig, receiptDir: tmpDir, ...gateConfig })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('gate-e2e'))
  const steered = []
  const originalSteer = agent.steer.bind(agent)
  agent.steer = (msg) => {
    steered.push(msg)
    return originalSteer(msg)
  }
  return { ctx, harness, agent, steered, tmpDir }
}

test('smoke: production topology mounts, gate activates, agent exposes steer', async (t) => {
  const { agent } = await mountGateHarness(t)
  assert.equal(typeof agent.steer, 'function')
})

test('smoke: gate Config schema resolves defaults standalone', () => {
  const resolved = gate.Config({ receiptDir: '/tmp/whatever' })
  assert.equal(resolved.fullAtFiles, 3)
  assert.equal(resolved.mode, 'auto')
})
