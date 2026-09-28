# Review-Gate v4 真时序测试基建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用第一方 `@deepseek-ai/dsh-agent-loop-testkit` 建立真实 AgentLoop 时序测试车道，实证裁决三个 fakeCtx 无法覆盖的行为：真回合 steer、ack 自清后重放零拦截、waterfall 单槽 veto 语义（fs-intent 车道死活的最终证据）。

**Architecture:** 新增独立测试文件 `test/realloop.test.mjs`（单文件自足，fixtures 内联）。用 testkit 的 `mountAgentLoopTestDependencies`（挂 LLM/session/projection/system-prompt/tools/agent 六服务，停在 AgentLoop 前）→ 注册 review-gate（load-order-sensitive 消费者）→ `mountAgentLoopTestHarness` → `harness.create` 产真 Agent。脚本化 `LlmAdapter`（预设 StreamChunk 响应队列）+ 桩 write 工具驱动真回合；`agent.steer` 打间谍记录拦截。

**Tech Stack:** node:test + node:assert/strict；`@deepseek-ai/dsh-agent-loop-testkit@0.1.7-rc.2`（**唯一新增，dev-only**）；既有 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`（build 已在用，可解析）。

## Global Constraints

- 新增依赖仅限 devDependencies 一条：`"@deepseek-ai/dsh-agent-loop-testkit": "0.1.7-rc.2"`；**peerDependencies 不动**。批准本计划 = 拍板此 dev 依赖。
- 测试一律不写 live receipts：`config.receiptDir` 必须指向 `fs.mkdtemp` 临时目录（`appendReceipt` 走 node:fs/promises appendFile，src/index.ts L161-164，无需 fs 后端）。
- **本计划零 src 改动**：被测对象 = 已构建的 lib/index.js（v3.3，b919a28）。任何测试暴露 lib 行为与断言不符 → **STOP，取证并报告**，不修 lib（硬规则：真实数据前不动状态机；若属测试自身假设错误，报告中说明并修测试）。
- 每任务收口：`npm run build && node --test test/gate.test.mjs && node --test test/realloop.test.mjs` 全绿。
- 不 push 远程；每任务一个本地 commit。

## File Structure

- Create: `test/realloop.test.mjs` — 全部真时序测试 + 内联 fixtures（mountGateHarness / ScriptedAdapter / chunk 构造器 / 桩工具 / waitIdle）
- Modify: `package.json` — devDependencies 增加一条

---

### Task 1: testkit 依赖 + 挂载冒烟

**Files:**
- Modify: `package.json`（devDependencies）
- Create: `test/realloop.test.mjs`

**Interfaces:**
- Consumes: `lib/index.js` 默认导出对象（name/inject/Config/apply）与命名导出 `Config`（schemastery schema，可调用求值）
- Produces: `mountGateHarness(t, gateConfig?)` → `{ ctx, harness, agent, steered, tmpDir }`（Task 2/3 复用；`ctx.dispose` 由 `t.after` 托管）

- [ ] **Step 1: 加 devDependency**

`package.json` devDependencies 块加：

```json
"@deepseek-ai/dsh-agent-loop-testkit": "0.1.7-rc.2"
```

- [ ] **Step 2: 安装并验证可解析**

```bash
cd ~/dsh-review-gate && npm install
node -e "import('@deepseek-ai/dsh-agent-loop-testkit').then(m => console.log(Object.keys(m)))"
```

Expected: 打印含 `mountAgentLoopTestDependencies`、`mountAgentLoopTestHarness`、`createInboxStub`、`unsupportedInbox`。若 npm 无法解析（registry 不供该包）→ **STOP 报告**，勿绕路。

- [ ] **Step 3: 写挂载骨架 + 冒烟测试**

创建 `test/realloop.test.mjs`：

```js
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
    await ctx.dispose()
    await rm(tmpDir, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx)
  // load-order-sensitive 消费者：必须在 harness 之前挂（testkit README §Drive a production Agent）
  // await 确认 gate 激活完成（监听器已注册）后才继续——若此 cordis 版本 plugin fork 不可 await，
  // 会立刻 TypeError：STOP 报告，改用可用的就绪信号，勿用 sleep 糊
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
```

- [ ] **Step 4: 跑冒烟**

```bash
cd ~/dsh-review-gate && node --test test/realloop.test.mjs
```

Expected: 2 个测试 PASS。若 `ctx.plugin(gate)` 激活失败（inject=['tools'] 未满足等）→ 测试挂起/超时 → STOP 报告 fiber 诊断。若 SessionId 或 UserMessage 校验拒绝裸字符串 id → 在 `userMessage` helper 里改用 session 提供的消息工厂（取证 dsh-session 后调整，报告中记录）。

- [ ] **Step 5: 全量回归 + 提交**

```bash
cd ~/dsh-review-gate && npm run build && node --test test/gate.test.mjs
git add package.json package-lock.json test/realloop.test.mjs
git commit -m "test: realloop lane bootstrap via dsh-agent-loop-testkit"
```

Expected: build 绿 + 63/63 旧测试绿。

---

### Task 2: 真回合写文件 → turn-stopping 恰好 steer（fakeCtx 首个不可测行为）

**Files:**
- Modify: `test/realloop.test.mjs`（追加 fixtures 与测试）

**Interfaces:**
- Consumes: Task 1 的 `mountGateHarness`
- Produces: `ScriptedAdapter`（构造参数 = StreamChunk 数组的队列）、`textChunks(text)`、`toolCallChunks(callId, name, argsJson)`、`stubWriteTool`、`userMessage(text)`、`waitIdle(ctx, agent)`（Task 3 复用）

- [ ] **Step 1: 追加 fixtures**

在 `test/realloop.test.mjs` 追加：

```js
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

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
```

- [ ] **Step 2: 追加 steer 裁决测试**

```js
test('realloop: write turn intercepts at turn-stopping and steers with the file list', async (t) => {
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
  harness.claim(agent, 'next-turn', 1)
  await idle
  assert.ok(steered.length >= 1, 'no-ack write turn must steer at least once')
  assert.ok(steered.length <= 2, `maxChain=2 stop-loss must cap steering, got ${steered.length}`)
  assert.ok(JSON.stringify(steered[0]).includes('probe-a.ts'), 'driver message must name the written file')
  console.log(`[verdict] steer count on unacked write turn: ${steered.length}`)
})
```

- [ ] **Step 3: 跑测试**

```bash
cd ~/dsh-review-gate && node --test test/realloop.test.mjs
```

Expected: PASS，且 `[verdict]` 行打印实测拦截次数（1 或 2 都合法——计数本身就是裁决数据，写进任务报告）。若 `steered.length === 0`：先查间谍是否被绕过（loop 可能在构造时捕获 steer 引用）——诊断步骤：在 `mountGateHarness` 里补挂 `ctx.on('agent/inbox/inserted', (a, m) => steered.push(m))` 作为备用记录源，重跑；仍为 0 → lib 真回合行为与设计不符 → STOP 报告。若 adapter 脚本耗尽（>4 次请求）→ 拦截循环失控 → STOP 报告（maxChain 失效，属 lib bug 判定）。

- [ ] **Step 4: 全量回归 + 提交**

```bash
cd ~/dsh-review-gate && npm run build && node --test test/gate.test.mjs && node --test test/realloop.test.mjs
git add test/realloop.test.mjs
git commit -m "test: real-turn steer verdict through production AgentLoop"
```

---

### Task 3: ack 即结算 → 重放回合零拦截（v3.3 核心断言的真时序版）

**Files:**
- Modify: `test/realloop.test.mjs`（追加一个测试）

**Interfaces:**
- Consumes: Task 1 `mountGateHarness`、Task 2 全部 fixtures；`lib/index.js` 命名导出 `DRIVER_HINT`（重放文本用真值）

- [ ] **Step 1: 追加 ack 结算测试**

```js
import { DRIVER_HINT } from '../lib/index.js'

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
  const idle1 = waitIdle(ctx, agent)
  agent.inbox.append('next-turn', userMessage('write a file'))
  harness.claim(agent, 'next-turn', 1)
  await idle1
  assert.equal(steered.length, 0, 'ack consumed in-turn must settle the gate before turn-stopping')

  // 模拟 client continuation：重放 DRIVER_HINT 作为新用户消息（真值文本）
  const idle2 = waitIdle(ctx, agent)
  agent.inbox.append('next-turn', userMessage(DRIVER_HINT))
  harness.claim(agent, 'next-turn', 2)
  await idle2
  assert.equal(steered.length, 0, 'replay turn after settled ack must not re-steer')

  // receipts 落在临时目录而非 live 路径
  const receipts = await readFile(join(tmpDir, 'receipts.jsonl'), 'utf8')
  assert.ok(receipts.includes('"action":"micro"'), 'ack receipt must land in the redirected receiptDir')
})
```

（文件顶部补 `import { readFile } from 'node:fs/promises'`——并入既有 fs/promises import 行。）

- [ ] **Step 2: 跑测试**

```bash
cd ~/dsh-review-gate && node --test test/realloop.test.mjs
```

Expected: PASS。若 `steered.length > 0`：说明 ack 未在 turn-stopping 前结算（或 v3.3 自清未生效）→ **这是 lib bug 判定，STOP 报告**（附 receipts 时间线）。若 receipts 断言失败：查 `appendReceipt` 失败是否被吞（src L620 try/catch）——tmp 目录应可写，失败即异常路径，STOP 报告。

- [ ] **Step 3: 全量回归 + 提交**

```bash
cd ~/dsh-review-gate && npm run build && node --test test/gate.test.mjs && node --test test/realloop.test.mjs
git add test/realloop.test.mjs
git commit -m "test: ack self-settle and replay silence verdict (v3.3 core)"
```

---

### Task 4: waterfall 单槽 veto 语义实证（fs-intent 车道死活的最终证据）

**Files:**
- Modify: `test/realloop.test.mjs`（追加一个测试）

**Interfaces:**
- Consumes: `@deepseek-ai/cordis` 的 `ctx.on` / `ctx.waterfall`（共享 hooks 数组、first-registered 先跑）
- Produces: 纯断言证据，无下游接口。**裸挂载**（不挂 gate）以隔离语义演示。

- [ ] **Step 1: 追加 veto 语义测试**

```js
test('realloop: waterfall single-slot semantics — first-registrant veto truncates later observers', async (t) => {
  // 纯 cordis 语义演示：无需 testkit——隔离变量，不混入生产拓扑
  const ctx = new Context()
  t.after(() => ctx.dispose())
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
})
```

- [ ] **Step 2: 跑测试**

```bash
cd ~/dsh-review-gate && node --test test/realloop.test.mjs
```

Expected: PASS。结论写入任务报告：真机上 policy（base 层先激活、apply 内同步注册、lib L90-91 不调 next）→ review-gate 的 fs-intent 监听器**永不被调用**（结合 dump-config 行序 L239 < L1628）；v3.3 的 lastIntentPath 去重属死车道守卫（无害 no-op），sessionFiles 历史虚增的真实根因另行归因（嫌疑：bashWrites / receipts 自写信号），等重启后 receipts 数据定论。

- [ ] **Step 3: 全量回归 + 提交**

```bash
cd ~/dsh-review-gate && npm run build && node --test test/gate.test.mjs && node --test test/realloop.test.mjs
git add test/realloop.test.mjs
git commit -m "test: waterfall single-slot veto semantics verdict"
```

---

## Deferred（本计划不做，等实证数据）

- README 部署约定（slot 所有权 + tools/result 兜底降级说明）——措辞依赖 Task 4 结论落档后一并写。
- 五分区评审输入对齐、review_acknowledge 合法性矩阵——等真时序车道绿了再立独立计划。
- actor 键控（agent.id → agent.session WeakMap 键）——纯研究项，数据前不动。
- `createInboxStub`/`unsupportedInbox` ——harness 真 Agent 已覆盖需求，YAGNI 不引入。
