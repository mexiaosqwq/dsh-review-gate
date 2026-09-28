import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
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
  // AgentOptions.provider/model 是必需路由（裁定补记 #2：缺省报 no provider/model error）
  const agent = await harness.create(SessionId('gate-e2e'), { provider: 'scripted', model: 'm1' })
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

// ponytail: 不观察 options.signal——测试脚本毫秒级跑完且不用 abort；
// 升级路径 = 在 yield 循环里检查 options.signal.aborted
class ScriptedAdapter extends LlmAdapter {
  constructor(responses) {
    super()
    this.responses = responses
  }
  providerInfo(provider) {
    return { id: provider, name: 'scripted' }
  }
  // 最小路由方法（裁定补记 #3：LlmModelInfo 三字段即可，余可选）
  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }
  async prepareCall(provider, model) {
    return { model: { provider, id: model, name: model }, stream: (o) => this.stream(o) }
  }
  async *stream(options) {
    const chunks = this.responses.shift()
    if (!chunks) throw new Error('script exhausted: unexpected model request')
    for (const chunk of chunks) yield chunk
  }
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallChunks(callId, name, argsJson) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argsJson },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name, arguments: argsJson },
    },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const stubWriteTool = defineTool({
  name: 'write',
  description: 'stub write: records nothing, touches no disk; the gate tracks by tool name only',
  parameters: {
    file_path: { type: 'string', required: true, description: 'target path' },
    content: { type: 'string', description: 'file body' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  },
  async execute() {
    return 'ok'
  },
})

let msgSeq = 0
function userMessage(text) {
  msgSeq += 1
  return { id: `u${msgSeq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function waitIdle(ctx, agent, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const disposer = ctx.on('agent/status', (payload) => {
      if (payload.agent === agent && payload.status === 'idle') {
        clearTimeout(timer)
        disposer()
        resolve()
      }
    })
    const timer = setTimeout(() => {
      disposer()
      reject(new Error('agent did not reach idle in time'))
    }, timeoutMs)
  })
}

test('realloop: write turn intercepts at turn-stopping and replays the driver message with the review file count', async (t) => {
  const { ctx, harness, agent, steered } = await mountGateHarness(t)
  // 队列按「最多 maxChain=2 次拦截 + 1 次跳过」预算：write 后最多再要 3 个文本响应
  ctx.llm.registerAdapter(
    ['scripted'],
    new ScriptedAdapter([
      toolCallChunks('call_1', 'write', JSON.stringify({ file_path: '/tmp/gate-e2e/probe-a.ts', content: 'x' })),
      textChunks('reviewed'),
      textChunks('ok'),
      textChunks('ok2'),
    ]),
  )
  ctx.tools.register(stubWriteTool)
  const idle = waitIdle(ctx, agent)
  agent.inbox.append('next-turn', userMessage('write a file'))
  // 裁定补记 #1：不调 harness.claim（会把消息从 driver 手里抢走，preStep 得 0 空步）；
  // loop-driven 配方 = inbox.append + agent.wakeDriver()
  agent.wakeDriver()
  await idle
  assert.ok(steered.length >= 1, 'no-ack write turn must steer at least once')
  assert.ok(steered.length <= 2, `maxChain=2 stop-loss must cap steering, got ${steered.length}`)
  // buildDriverMessage carries the changed-file COUNT ("N 个文件"), never the
  // paths — the plan's "must name the written file" was a wrong assumption
  // about lib behavior (lib buildDriverMessage L305-312; probe evidence).
  assert.ok(JSON.stringify(steered[0]).includes('1 个文件'), 'driver message must report the changed-file count')
  console.log(`[verdict] steer count on unacked write turn: ${steered.length}`)
})

test('realloop: in-turn review_acknowledge settles the gate; replay turn does not re-steer', async (t) => {
  const { ctx, harness, agent, steered, tmpDir } = await mountGateHarness(t)
  const ackArgs = JSON.stringify({
    action: 'micro',
    files: ['/tmp/gate-e2e/probe-a.ts'],
    findings: [],
    fixes_made: false,
    summary: 'e2e ack',
  })
  ctx.llm.registerAdapter(
    ['scripted'],
    new ScriptedAdapter([
      toolCallChunks('call_1', 'write', JSON.stringify({ file_path: '/tmp/gate-e2e/probe-a.ts', content: 'x' })),
      toolCallChunks('call_2', 'review_acknowledge', ackArgs),
      textChunks('done'),
      textChunks('acknowledged, closing'),
    ]),
  )
  ctx.tools.register(stubWriteTool)
  // Turn 1: write -> ack in the same turn (ack settles before turn-stopping).
  const idle1 = waitIdle(ctx, agent)
  agent.inbox.append('next-turn', userMessage('write a file'))
  agent.wakeDriver()
  await idle1
  assert.equal(steered.length, 0, 'ack consumed in-turn must settle the gate before turn-stopping')

  // Turn 2: client continuation replays the DRIVER_HINT verbatim as a new user
  // message; the settled gate must not re-steer.
  const idle2 = waitIdle(ctx, agent)
  agent.inbox.append('next-turn', userMessage(gate.DRIVER_HINT))
  agent.wakeDriver()
  await idle2
  assert.equal(steered.length, 0, 'replay turn after settled ack must not re-steer')

  // Receipts land in the redirected tmpDir, not the live storages path.
  const receipts = await readFile(join(tmpDir, 'receipts.jsonl'), 'utf8')
  assert.ok(receipts.includes('"action":"micro"'), 'ack receipt must land in the redirected receiptDir')
  console.log('[verdict] ack settled in-turn; replay turn steered 0 times; receipt written')
})

test('realloop: waterfall single-slot semantics — first-registrant veto truncates later observers', async (t) => {
  // 纯 cordis 语义演示：无需 testkit——隔离变量，不混入生产拓扑。
  // 用途锚点：本测试是 fs-intent 车道死活判定的语义基座（静态五源论证
  // 63db8eca0be3e4b1 的实证补全）——真机上 fs-observation-policy 在 base 层
  // 先激活且其监听器不调 next()，本测试实证该形态下后注册的透明观察者
  // （review-gate 的 fs-intent 监听器）永不被调用、veto 裁决直接返回。
  // teardown 走 root fiber（cordis Context 无 dispose 方法，T1 实证）。
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
  })
  const probeSeen = []

  // 场景 A = 真机拓扑（policy 先注册，review-gate 观察者后注册）
  const disposeVetoA = ctx.on('fs/write-intent', () => Promise.resolve({ kind: 'createIfAbsent' }))
  const disposeProbeA = ctx.on('fs/write-intent', (target, actor, next) => {
    probeSeen.push(target.displayPath)
    return next()
  })
  const outA = await ctx.waterfall(
    'fs/write-intent',
    { displayPath: '/p.ts', targetKey: 'p' },
    { agent: { id: 'a1' } },
    () => undefined,
  )
  assert.equal(probeSeen.length, 0, 'later transparent observer must NEVER run when an earlier listener decides')
  assert.deepEqual(outA, { kind: 'createIfAbsent' })
  disposeVetoA()
  disposeProbeA()

  // 场景 B = 反序（透明观察者先注册）：观察者被调用，veto 裁决穿透返回
  const disposeProbeB = ctx.on('fs/write-intent', (target, actor, next) => {
    probeSeen.push(target.displayPath)
    return next()
  })
  const disposeVetoB = ctx.on('fs/write-intent', () => Promise.resolve({ kind: 'replaceIfVersion', version: 1 }))
  const outB = await ctx.waterfall(
    'fs/write-intent',
    { displayPath: '/q.ts', targetKey: 'q' },
    { agent: { id: 'a1' } },
    () => undefined,
  )
  assert.deepEqual(probeSeen, ['/q.ts'], 'transparent observer registered first does run')
  assert.deepEqual(outB, { kind: 'replaceIfVersion', version: 1 })
  disposeProbeB()
  disposeVetoB()
  console.log('[verdict] single-slot veto: A(later observer never ran) + B(observer ran, veto value passthrough) both hold')
})
