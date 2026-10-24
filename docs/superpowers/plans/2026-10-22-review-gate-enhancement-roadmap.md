# dsh-review-gate 增强路线图与 Batch 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status: Batch 1 已于 2026-10-23 实施完成（662d786 ack v2 / 1a634e0 提示词纪律 / 17987f0 receipts-stats）；Batch 0.5（collectDiff `~` 路径）、Batch 2 · 3a（敏感路径推荐 + 回归测试）、Batch 2 · 3b（`escalateOnPush` push 升级，2026-10-24）均已实施；仅剩 Batch 3（独立 reviewer）为 proposal — 待用户批准，批准前不执行。**
>
> 何时读：讨论/实施 review-gate 的提示词精度、回执 v2、审计统计、风险分层或独立 reviewer 时。Batch 1 已实施完成（记录与收尾口径见 §11）；Batch 2/3 只是方向与决策门，不是已批准任务。

**Goal:** 在不改变闸门触发/结算语义的前提下，把复审提示词的精度提到 Qoder `/review` + Codex rubric 同级，并把回执升级为可度量的 v2 契约；同时提供一个零依赖的 receipts 统计脚本，为后续风险分层与独立 reviewer 提供数据。

**Architecture:** Batch 1 只动两个源码文件加一个脚本（外加 README 与测试）：`src/instruction.ts` 加“审查纪律”段；`src/index.ts` 的 `review_acknowledge` schema/receipt 加 optional 字段；`scripts/receipts-stats.mjs` 聚合 `receipts.jsonl`。不新增事件、不新增运行时依赖、不新增配置键。Batch 2/3 另起计划。

**Tech Stack:** TypeScript（NodeNext / ES2022）、Node 内置 `node:test`、无第三方依赖。

## Global Constraints

- `review_acknowledge` 的既有必填字段（`action/files/fixes_made/summary`）与结算语义不变；新字段一律 optional。
- 不改 `decideReview` / `handleTurnStopping` / steer / `maxChain` / waiver 的任何行为。
- 不改 `review_gate_config` 的配置键；Batch 1 不新增配置。
- 新增注入文本只能走现有 `reviewInstructionText` 路径（调用点已有 `braceGuard`）；不新增 runtime-context。
- 构建后再跑测试：测试 import 的是 `lib/`，不是 `src/`。本机命令统一 `env -u LD_PRELOAD npm test`。
- 不新增运行时依赖；统计脚本只用 `node:fs/promises` / `node:os` / `node:path` / `node:url`。
- README 必须同步；`AGENTS.md` 的 Docs 路由行在创建本文件时加。

---

## 0. 背景：为什么是这四个方向

### 0.1 当前实现的三处缺口

1. **提示词只有“怎么审”，缺少“什么不该报”**。`FULL_TEXT` 的五步流程很完整，但没有 Qoder `/review` 那三条精度纪律：只报本次 diff 引入、禁 pre-existing/cosmetic/大重构、报前先读周边代码。结果是复审容易把历史问题、风格偏好、顺手重构混进 findings。
2. **指令说“降 confidence”，回执却没有 confidence 字段**。`src/instruction.ts:37` 的 severity 校准写着“证据不足降 confidence 不否决”，但 `review_acknowledge` 的 findings 只有 `{file,line?,severity,note}`（`src/index.ts:628-632`）。模型被要求写一个不存在的字段，回执无法承载置信度。
3. **回执已有全量 findings，但没有聚合视图**。`readReceiptStats`（`src/index.ts:388-425`）只统计今日 `reviews/stopLoss/waived` 和最后一条；没有 full/micro 比例、零发现率、findings/severity 分布、平均 diff 行数/拦截轮次。没有这些数据，就无法判断“独立 reviewer 是否值得做”。

### 0.2 外部证据（详见 `docs/handover/2026-10-22-qoder-review-mechanism.md`）

- Qoder CLI `/review`：同会话 hidden meta prompt；只报本次改动引入的问题，明禁 pre-existing/cosmetic/大重构；报前先读周边代码；无发现明说 `No actionable findings found`；按严重度排序；用用户语言。
- Codex review rubric：每条必须 impact、discrete/actionable、由本次改动引入、作者会修、不依赖未声明假设、能指出受影响代码；P0–P3 + confidence。
- Qoder Security：按信任边界分层（写时 L1 / 收尾 L2 / push 前 L3 / 全仓 L4），并有人类修复门。对应我们的 Batch 2 方向。
- Qoder Ultra Review / `/simplify`：按维度并行、合并去重、严格门槛。对应 Batch 3 方向。

### 0.3 四个方向与批次

| 方向 | 内容 | 批次 | 决策门 |
|---|---|---|---|
| 1 | 提示词精度（审查纪律） | Batch 1 | 无，直接做 |
| 2 | 回执 v2（confidence + overall verdict）+ receipts 统计脚本 | Batch 1 | 无，直接做 |
| 3 | 风险分层 + push 前升级 | Batch 2 | 用户批准默认行为 |
| 4 | 独立 reviewer / 维度并行 | Batch 3 | Batch 1 数据 + subagents spike |

**明确不做**：qodersec 类引擎（Termux 跑不了、闭源）、默认 4 并行 agent（成本未知）、review scope（base/commit/PR，属于另一产品形态）、继续加配置键。

---

## 1. Batch 1 总览

三个任务，按顺序执行；每个任务独立可测、独立提交。

| Task | 交付 | 文件 | 验证 |
|---|---|---|---|
| 1 | `review_acknowledge` v2：`confidence` + `overall_correctness` / `overall_explanation` | `src/index.ts`、`README.md`、`test/gate.test.mjs` | 新测试 + 既有全量（Batch 1 起点 95） |
| 2 | micro/full 提示词加“审查纪律” | `src/instruction.ts`、`test/gate.test.mjs` | 新形态断言 + 既有全量（逐任务递增） |
| 3 | `receipts-stats.mjs`：full/micro、零发现率、severity、均值 | `scripts/receipts-stats.mjs`、`test/receipts-stats.test.mjs`、`package.json`、`README.md` | 新测试 + `npm test` |

---

## 2. Task 1：`review_acknowledge` v2

**Files:**
- Modify: `src/index.ts:613-700`（工具 schema + execute 类型 + 两处 receipt）
- Modify: `README.md` 的「唯一完成信号」段与「结构化回执」表
- Test: `test/gate.test.mjs`，加在 `test('ack: receipt lands in the audit log', ...)` 之后（该处已 `import fs from 'node:fs/promises'`，见 `test/gate.test.mjs:653`）

**Interfaces:**
- Consumes: 现有 `appendReceipt`、`fakeCtx()`、`getAck()`、`baseConfig`。
- Produces:
  - `review_acknowledge` 新增 optional 参数：
    - `overall_correctness?: 'correct' | 'incorrect'`
    - `overall_explanation?: string`
  - findings 每项可带 `confidence?: number`（0–1），只写进描述、不做嵌套 schema 校验（当前 `findings` 是 `unknown[]`，保持最小改动）。
  - receipt 顶层新增 `overall_correctness` / `overall_explanation`（`undefined` 时 `JSON.stringify` 自动省略）。
- 不新增 `priority`：`severity` 已是唯一严重度轴，避免双轴漂移。

- [ ] **Step 1: 写失败测试**

```js
test('ack v2: overall verdict and per-finding confidence persist', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await fs.mkdtemp(join(_tmpdir(), 'rg-ack-v2-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'ack-v2', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  const finding = {
    file: '/a.ts',
    line: 7,
    severity: 'major',
    confidence: 0.62,
    note: 'stale closure',
  }
  await ack.execute(
    {
      action: 'full',
      files: ['/a.ts'],
      findings: [finding],
      overall_correctness: 'incorrect',
      overall_explanation: 'one real bug, fixed',
      fixes_made: true,
      summary: 'fixed stale closure',
    },
    { agent },
  )
  const rec = JSON.parse((await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim())
  assert.equal(rec.overall_correctness, 'incorrect')
  assert.equal(rec.overall_explanation, 'one real bug, fixed')
  assert.deepEqual(rec.findings, [finding])
  await fs.rm(receiptDir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 构建并跑测试，确认失败**

```sh
cd ~/dsh-review-gate
npm run build
env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
```

Expected: FAIL，`rec.overall_correctness` 为 `undefined`。

- [ ] **Step 3: 最小实现——schema 加两个 optional 参数**

在 `findings` 参数之后、`fixes_made` 之前加：

```ts
        overall_correctness: {
          type: 'string',
          enum: ['correct', 'incorrect'],
          description: '可选：整体结论——patch 是否正确（correct/incorrect）',
        },
        overall_explanation: {
          type: 'string',
          description: '可选：整体结论的一句话解释',
        },
```

同时把 `findings` 的 description 改成：

```ts
          description:
            '发现的问题列表，每项 {file, line?, severity(info|minor|major|critical), confidence?(0-1), note}',
```

- [ ] **Step 4: 最小实现——execute 类型与两处 receipt**

`const a = args as { ... }` 增加：

```ts
          overall_correctness?: 'correct' | 'incorrect'
          overall_explanation?: string
```

`settleOnRequest()` 的 `appendReceipt` 与正常结算的 `appendReceipt` 都加：

```ts
            overall_correctness: a.overall_correctness,
            overall_explanation: a.overall_explanation,
```

不要改 `state.noNewReviews` 的计算——零发现计数仍只看 `findings.length`。

- [ ] **Step 5: 构建并跑测试，确认通过**

```sh
npm run build
env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
env -u LD_PRELOAD npm test
```

Expected: 新测试 PASS；既有全量绿（Batch 1 起点 95，逐任务递增）。

- [ ] **Step 6: 更新 README**

`README.md`「唯一完成信号」段的回执字段列表改成：

```text
action / files / findings（file / line? / severity / confidence? / note）/ fixes_made / summary / overall_correctness? / overall_explanation?
```

`README.md`「结构化回执」表补一句：

```text
confidence 与 overall_correctness/overall_explanation 均为 optional；旧回执不受影响。
```

- [ ] **Step 7: 提交**

```sh
git add src/index.ts test/gate.test.mjs README.md lib/
git commit -m "feat(ack): optional confidence and overall verdict in review receipts"
```

---

## 3. Task 2：提示词加“审查纪律”

**Files:**
- Modify: `src/instruction.ts:26-39`
- Test: `test/gate.test.mjs`，加在 `test('ack: instruction text demands the receipt call', ...)` 之后
- Modify: `README.md` 的「带证据的事中引导」段（第 2 条，加一句精度纪律）；不改配置表

**Interfaces:**
- Consumes: 现有 `reviewInstructionText(action, files, pitfallsText?, pitfallsSource?)`，签名不变。
- Produces: `MICRO_TEXT` 与 `FULL_TEXT` 都包含同一组精度关键词；不新增导出。

- [ ] **Step 1: 写失败测试**

```js
test('instruction: precision discipline present in both tiers', async () => {
  const { reviewInstructionText } = await import('../lib/index.js')
  for (const action of ['micro', 'full']) {
    const text = reviewInstructionText(action, 1)
    assert.ok(text.includes('只报本次 diff 引入的问题'), `${action}: scope limited to this diff`)
    assert.ok(text.includes('pre-existing'), `${action}: pre-existing excluded`)
    assert.ok(text.includes('周边代码'), `${action}: surrounding-code check`)
    assert.ok(text.includes('No actionable findings found'), `${action}: empty result is valid`)
    assert.ok(text.includes('严重度'), `${action}: severity ordering`)
  }
})
```

- [ ] **Step 2: 构建并跑测试，确认失败**

```sh
npm run build
env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' test/gate.test.mjs
```

Expected: FAIL，micro/full 至少一个关键词不存在。

- [ ] **Step 3: 改 `MICRO_TEXT`**

在 `……条件写反、边界漏判；` 之后、`汇报时` 之前插入：

```text
审查纪律：只报本次 diff 引入的问题（pre-existing、纯风格、顺手大重构不报）；报前先读周边代码；无 actionable findings 就明说（No actionable findings found），不硬凑；按严重度排序。
```

**不要**把整段改成多行模板；保持现有单行模板，最小 diff。

- [ ] **Step 4: 改 `FULL_TEXT`**

在开头“本回合已改动 N 个文件。收尾流程：给出最终总结之前，先执行全面复审，逐项完成：\n”之后、`0.` 之前插一行：

```text
审查纪律：只报本次 diff 引入的问题；pre-existing、纯风格、顺手大重构不报；报前先读周边代码；没有可行动问题就明说（No actionable findings found），不硬凑；每条 finding 必须离散可行动、指出具体受影响代码、不依赖未声明假设；按严重度排序。
```

保留 step 5 的“证据不足降 confidence 不否决”——Task 1 已让 `confidence` 有处可落。

- [ ] **Step 5: 更新 README**

在 README 的「带证据的事中引导」段（第 2 条）补一句：

```text
micro/full 两档都包含审查纪律：只报本回合 diff 引入的问题，pre-existing/纯风格/顺手大重构不报；无 actionable findings 明说，不硬凑。
```

- [ ] **Step 6: 构建并跑测试，确认通过**

```sh
npm run build
env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' test/gate.test.mjs
env -u LD_PRELOAD npm test
```

Expected: 新测试 PASS；既有全量绿（Batch 1 起点 95，逐任务递增）。

- [ ] **Step 7: 提交**

```sh
git add src/instruction.ts test/gate.test.mjs README.md lib/
git commit -m "feat(prompt): add Qoder-style review precision discipline to both tiers"
```

---

## 4. Task 3：`receipts-stats.mjs` 审计统计

**Files:**
- Create: `scripts/receipts-stats.mjs`
- Create: `test/receipts-stats.test.mjs`
- Modify: `package.json` 的 `test` script
- Modify: `README.md` 的 Commands 节（加一行用法）

**Interfaces:**
- `summarize(rows: unknown[], now = Date.now())` → `{ total, today: { reviews, full, micro, zeroFinding, findings, bySeverity, stopLoss, waived, fullRatio, zeroFindingRate, waiverRate, stopLossRate, avgDiffLines, avgChain } }`
- CLI：`node scripts/receipts-stats.mjs [receipts.jsonl]`；缺省读 `~/.dsh/storages/review-gate/receipts.jsonl`。

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from '../scripts/receipts-stats.mjs'

test('receipts stats: today counts reviews, findings, severity, zero-finding', () => {
  const now = new Date(2026, 9, 22, 12, 0, 0).getTime()
  const today = new Date(2026, 9, 22, 8, 0, 0).getTime()
  const yesterday = new Date(2026, 9, 21, 8, 0, 0).getTime()
  const rows = [
    {
      ts: today,
      outcome: 'acknowledged',
      action: 'full',
      findings: [{ severity: 'major' }, { severity: 'minor' }],
      cost: { diffLines: 40, intercepts: 1 },
    },
    { ts: today, outcome: 'acknowledged', action: 'micro', findings: [], cost: { diffLines: 8, intercepts: 1 } },
    { ts: today, outcome: 'waived' },
    { ts: today, outcome: 'stop_loss' },
    { ts: yesterday, outcome: 'acknowledged', action: 'full', findings: [{ severity: 'critical' }] },
  ]
  const s = summarize(rows, now)
  assert.equal(s.total, 5)
  assert.equal(s.today.reviews, 2)
  assert.equal(s.today.full, 1)
  assert.equal(s.today.micro, 1)
  assert.equal(s.today.zeroFinding, 1)
  assert.equal(s.today.findings, 2)
  assert.equal(s.today.bySeverity.major, 1)
  assert.equal(s.today.bySeverity.minor, 1)
  assert.equal(s.today.bySeverity.critical, 0)
  assert.equal(s.today.waived, 1)
  assert.equal(s.today.stopLoss, 1)
  assert.equal(s.today.avgDiffLines, 24)
  assert.equal(s.today.avgChain, 1)
})
```

- [ ] **Step 2: 跑测试，确认失败**

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
```

Expected: FAIL，`Cannot find module '../scripts/receipts-stats.mjs'`。

- [ ] **Step 3: 写脚本**

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['critical', 'major', 'minor', 'info']

const avg = (xs) =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
const rate = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000)

export function summarize(rows, now = Date.now()) {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const todayStart = midnight.getTime()
  const today = {
    reviews: 0,
    full: 0,
    micro: 0,
    zeroFinding: 0,
    findings: 0,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])),
    stopLoss: 0,
    waived: 0,
  }
  const diffLines = []
  const chains = []

  for (const row of rows) {
    if (!row || typeof row.ts !== 'number') continue
    if (row.ts < todayStart) continue
    if (row.outcome === 'stop_loss') {
      today.stopLoss += 1
      continue
    }
    if (row.outcome === 'waived') {
      today.waived += 1
      continue
    }
    if (row.action === undefined) continue

    today.reviews += 1
    if (row.action === 'full') today.full += 1
    if (row.action === 'micro') today.micro += 1
    const findings = Array.isArray(row.findings) ? row.findings : []
    today.findings += findings.length
    if (findings.length === 0) today.zeroFinding += 1
    for (const f of findings) {
      if (f && SEVERITIES.includes(f.severity)) today.bySeverity[f.severity] += 1
    }
    if (typeof row.cost?.diffLines === 'number') diffLines.push(row.cost.diffLines)
    if (typeof row.cost?.intercepts === 'number') chains.push(row.cost.intercepts)
  }

  return {
    total: rows.filter((r) => r && typeof r.ts === 'number').length,
    today: {
      ...today,
      fullRatio: rate(today.full, today.reviews),
      zeroFindingRate: rate(today.zeroFinding, today.reviews),
      waiverRate: rate(today.waived, today.reviews + today.waived),
      stopLossRate: rate(today.stopLoss, today.reviews + today.stopLoss),
      avgDiffLines: avg(diffLines),
      avgChain: avg(chains),
    },
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const file =
    process.argv[2] ?? join(homedir(), '.dsh', 'storages', 'review-gate', 'receipts.jsonl')
  const raw = await readFile(file, 'utf8').catch(() => '')
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
  console.log(JSON.stringify(summarize(rows), null, 2))
}
```

- [ ] **Step 4: 跑测试，确认通过**

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 接入 `npm test`**

`package.json`：

```json
"test": "node --test test/gate.test.mjs test/client-bundle.test.mjs test/receipts-stats.test.mjs"
```

- [ ] **Step 6: README 加用法**

在 Commands 代码块后加：

```text
node scripts/receipts-stats.mjs [receipts.jsonl]   # 今日 full/micro、零发现率、severity、均值
```

- [ ] **Step 7: 全量测试并提交**

```sh
env -u LD_PRELOAD npm test
git add scripts/receipts-stats.mjs test/receipts-stats.test.mjs package.json README.md
git commit -m "feat(stats): add receipts audit summary script"
```

---

## 5. 自检（写完计划后执行）

**Spec coverage:** 方向 1 → Task 2；方向 2 → Task 1 + Task 3；方向 3/4 → 第 6/7 节路线图。无遗漏。

**Placeholder scan:** 无 TBD/TODO/“类似 Task N”；每个代码步骤都有实际代码。

**Type consistency:**
- `overall_correctness` / `overall_explanation` 在 schema、execute 类型、receipt、测试、README 中拼写一致。
- `confidence` 只出现在 findings 描述与测试对象，不在 receipt 顶层。
- `summarize(rows, now)` 的返回字段与测试断言一致。

**已知边界:** `findings` 的 `confidence` 不做嵌套 schema 校验——当前工具 DSL 的 `findings` 是 `unknown[]`，加 `items` 会扩大改动面；本批只做“有处可写 + 原样落盘”，校验留到有真实误用时再说。

---

## 6. Batch 2（方向 3）：风险分层 + push 前升级（3a / 3b 均已实施）

### 6.1 3a：敏感路径强制 full（零代码，2026-10-24 已实施）

`alwaysFullGlobs` 已经是现成能力。给用户的推荐配置（写进 README 配置示例，不新增键）：

```yaml
alwaysFullGlobs:
  - "**/auth/**"
  - "**/payment/**"
  - "**/crypto/**"
  - "**/migrations/**"
  - "**/*.sql"
```

验收：命中这些路径的单文件改动 → `decideReview` 返回 `full`（现有测试已覆盖 `alwaysFullGlobs`，加一条真实路径样例即可）。

**已实施（2026-10-24，`2611e44`）**：清单进 README 启动级示例（示例的 `mode` 同时由 `full` 改为 `auto`——固定 full 会让清单失去意义）；新增回归 1 例覆盖对照 + 五条 glob 正向 + 三条 near-miss；README 同时写明「命中不吃微量豁免，但 `chain` 到 `maxChain` 的止损回合仍会放行」。

### 6.2 3b：`escalateOnPush`（2026-10-24 已实施：默认 false）

**动机**：Qoder Security 把跨文件数据流放在 `git push` 前（L3）；我们目前只看文件数/行数，小改动 + push 可能只触发 micro。

**设计（最小版）：**
- `Config` 新增 `escalateOnPush: z.boolean().default(false)`（默认 false，避免行为突变）。
- `state.ts` 新增纯函数：

```ts
const PUSH_RE = /(^|\s)git\s+push(\s|$)|(^|\s)gh\s+pr\s+create(\s|$)|(^|\s)npm\s+publish(\s|$)/

export function shouldEscalateForPush(commands: readonly string[]): boolean {
  return commands.some((c) => PUSH_RE.test(c))
}
```

- `index.ts` 的 assemble 分支：`if (cfg.escalateOnPush && p.action === 'micro' && shouldEscalateForPush(state.bashCommands)) p.action = 'full'`。
- 不硬拦 push；只升级复审档位。已 full / 已 ack 不重复。
- 测试：`git push` + 1 文件 → full；`git status` → micro；`git push --dry-run` 是否算由用户拍板（建议算，宁多审）。
- 成本：`src/state.ts` + `src/index.ts`（Config、`review_gate_config` 工具、HTTP overlay 三处同键）+ `test/gate.test.mjs` + README/Config 文档。

**决策门：** 用户确认默认值（false/true）与命令白名单；上线后看 `receipts-stats` 的 fullRatio 与误报反馈。

**已实施（2026-10-24，`3fa3525` + 3b-②）**：用户拍板四默认值——`false` / 仅开启时记录（内存态 ≤20×300、结算即清、不注入不落盘）/ `--dry-run` 算 push / 仅 auto 档。落地两件：①记录通道 + `escalateOnPush` 键（schema/OVERLAY_KEYS/工具/HTTP 四入口）；②`shouldEscalateForPush` + assemble 在**微量豁免之前**把 micro 升 full（守卫 `cfg.mode==='auto'`——固定 micro 也产出 `micro`）。`PUSH_RE` 尾 fence 用 lookahead `(?=\s|$|[;&|)])`，`git push;` / `git push&&` 也命中。测试：纯函数正负例 + 五组行为（push→full / 关闭对照 / 非 push / 固定 micro / 先 waive 后 push 再武装）。

---

## 7. Batch 3（方向 4）：独立 reviewer / 维度并行（未批准，不执行）

### 7.1 先做 spike，不写产品代码

目标：验证 DSH `subagents` 服务能否从 host 插件里安全地起一个 one-shot reviewer。

检查项：
1. `@deepseek-ai/dsh-subagent` 的公开类型与 `ctx.get('subagents')` 的调用方式（`dsh-acp` 已在用）。
2. review-gate 是否需要新增 `inject: ['subagents']`；headless/web 两种 profile 是否都能挂。
3. spawn → 等待 → 超时/取消 → 取最终文本的完整生命周期。
4. 是否能指定更便宜的 provider/model；成本上限。
5. 失败/超时能否回退 inline，不破坏当前 ack 结算。

**Spike 通过标准：** 一个独立脚本/临时插件能起一个 reviewer，返回一段 JSON，主插件能解析并在 30s 内超时回退；不污染现有测试。

### 7.2 产品化形态（spike 通过后另写计划）

- `Config` 新增 `reviewer: 'inline' | 'subagent'`，默认 `inline`。
- 第一版只起**一个**独立 reviewer（不是 4 个），拿 diff + rubric，返回 `{findings, overall_correctness, overall_explanation}`；主插件合并、去重、落 receipt。
- 第二版再考虑 Qoder 式维度并行（Completeness/Correctness/Impact 或 Reuse/Simplification/Efficiency/Altitude），且只在 full 档启用。
- 去重键：`file + line + mechanism`；合并时保留 confidence 最高的一条。
- 失败策略：超时/解析失败 → 回退 inline，并在 receipt 里标 `reviewer: 'inline-fallback'`。

**决策门：** Batch 1 的 `receipts-stats` 跑两周，满足任一条件才启动：
- `zeroFindingRate` 很高（复审经常空手）且用户报告过漏审；或
- 有具体自审偏差案例（同一 bug 复审没发现、用户/CI 发现）；或
- 用户明确要“更强的审查”并接受额外模型成本。

---

## 8. 非目标（本路线图明确不做）

- **不移植 qodersec 引擎**：Termux 上 `version` 已 SIGSYS，且是闭源云客户端；与我们的同会话闸门不是同一问题域。
- **不默认开 4 并行 agent**：成本/延迟未知；先一个独立 reviewer，再谈维度。
- **不做 review scope（base/commit/PR）**：当前产品是 turn gate，不是 PR review；有真实需求另立计划。
- **不继续堆 config 键**：Batch 2 只加一个 `escalateOnPush`；敏感路径复用 `alwaysFullGlobs`。
- **不改 ack 的必填字段/结算语义**：v2 只加 optional。

---

## 9. 度量与决策门

`scripts/receipts-stats.mjs` 输出：

| 指标 | 用途 | 读数 |
|---|---|---|
| `fullRatio` | full 档占比 | 太高 = 阈值过严/成本高；太低 = 风险覆盖不足 |
| `zeroFindingRate` | 零发现复审占比 | 持续很高 = 复审可能空转，或提示词太松 |
| `findings` / `bySeverity` | 发现密度与严重度分布 | 判断“复审是否真的在找 bug” |
| `waiverRate` | 免审率 | 太高 = exemptBelowLines 过宽 |
| `stopLossRate` | 止损率 | 太高 = 模型不配合/指令太长 |
| `avgDiffLines` / `avgChain` | 复审成本代理 | 判断 subagent 的额外成本是否值得 |

**Batch 3 启动门（建议）：** 连续两周 `zeroFindingRate > 0.7` 且至少 2 起用户报告的漏审，或用户明确要求更强审查。否则不启动。

---

## 10. 开放问题（需用户拍板）

1. **Task 1 字段名**：`overall_correctness: 'correct' | 'incorrect'` 是否接受？还是用 `verdict: 'pass' | 'fail'`？
2. **Task 3 脚本位置/命令**：`node scripts/receipts-stats.mjs` 是否合适？还是做成 `npm run stats`？
3. **Batch 2 默认值**：`escalateOnPush` 默认 false（保守）还是 true（更安全）？
4. **Batch 3 成本**：独立 reviewer 是否允许用更便宜的模型？单次复审的 token/费用上限是多少？
5. **执行方式**：Batch 1 采用 subagent-driven（每个 Task 一个 fresh worker + 两阶段审查）还是 inline（本会话按 executing-plans 批量执行）？

> 2026-10-23 用户批准 Batch 1 开工并选用 team 流水线（worker + closer）：第 1/2/5 项按计划默认执行（`overall_correctness` 命名、`scripts/receipts-stats.mjs`、worker+closer）；第 3/4 项随 Batch 2/3 继续待定。

---

## 11. 事实核对与数据基线（2026-10-23，本机实测）

> 本节是开工前的取证记录，不是新任务。核对对象：第 0 节的三处缺口、三个 Task 的代码/测试锚点、Batch 2 的两个「最小版」设计、Batch 3 的 subagents 前提；并用真实 `receipts.jsonl` 建基线。
>
> **结论先行：Batch 1 三个 Task 的前提与锚点全部成立，可照做；Batch 2 的 3a/3b 各有一个结构性阻塞，不能按「零代码 / 最小版」直接实施。**

### 11.1 计划断言逐条核对

| 计划断言 | 实测 | 结论 |
|---|---|---|
| 既有 94 例测试 | 2026-10-23 实测 tests 95 / pass 95 / fail 0（Batch 0 已加 1 例；计划写 94 是 Batch 0 前口径） | 成立，数字需订正 |
| `FULL_TEXT` 缺三条精度纪律 | `src/instruction.ts` 中 `pre-existing` / `周边代码` / `No actionable findings found` / `严重度` 均 0 命中 | 成立，但见下方 nuance |
| 指令要求「降 confidence」而回执无此字段 | `src/instruction.ts:37` 有「证据不足降 confidence 不否决」；`src/index.ts:628-632` 的 findings 描述只有 `{file, line?, severity, note}`；execute 类型 `findings?: unknown[]`（651-657） | 成立 |
| `readReceiptStats` 只统计今日三项 + last | 实际函数体 `src/index.ts:392-429`（注释从 387 起）：today 仅 reviews / stopLoss / waived，last 仅 ts/outcome/action | 成立（行号较计划 388-425 漂移 3-4 行） |
| Task 1 落点 613-700 | 工具注册块实际 611-727；两处 `appendReceipt` 在 667 / 700；`noNewReviews` 计算在 696-697 | 成立（引用范围略窄，不影响执行） |
| Task 2 落点 26-39 | MICRO_TEXT 26-27、FULL_TEXT 29-39 | 成立 |
| 测试锚点 | `ack: instruction text demands the receipt call` = 535 行；`ack: receipt lands in the audit log` = 667 行；`import fs` = 653 行 | 成立 |
| README 锚点 | 「带证据的事中引导」= 工作原理第 2 条（40 行）；「唯一完成信号」= 第 3 条（41 行）；「结构化回执」= 核心特性表行（51 行） | 成立，但都是条目/表行，不是独立小节 |
| Task 3 的 README「Commands 节」 | README 无 Commands 节；命令代码块在「开发」节（188 行起） | **需改文案** |
| Qoder 文档依据 | `docs/handover/2026-10-22-qoder-review-mechanism.md` 存在；152/165/182-185/390-393 行支持 §0.2 的三条纪律与 Codex rubric 描述 | 成立 |
| Batch 3 的 subagents 前提 | DSH 0.2.1-rc.2：`ctx.subagents: SubagentRuntime`（`dsh-subagent/lib/types/index.d.ts:62`）；`startActivation({provider,label,request:{prompt,parent,signal,...},signal,delivery})` → `{childId,result,dispose}`；`dsh-base` 注册 `spawn`/`fork` provider；`dsh-acp` 用 `ctx.get("subagents")` | 成立（详见 11.6） |

**Nuance（第 0.1 节第 1 条）**：`FULL_TEXT` 并非完全没有范围纪律——32 行已有「复审结论一律以本回合 diff 为准锚定，不得以对话记忆替代」，34 行已有「无真实跨越不报，禁止发明边界凑数」。真正缺的是四条具体纪律：只报本次引入、禁 pre-existing/纯风格/顺手大重构、报前读周边代码、空结果明说。计划的目标表述可以更准确，避免把「缺四条」说成「缺全部」。

### 11.2 回执数据基线（`~/.dsh/storages/review-gate/receipts.jsonl`，1053 行，2026-09-27 → 2026-10-23）

**总量分布**：acknowledged 620 / waived 375 / stop_loss 4 / 早期无 outcome 54；action = full 213 / micro 461 / 无 379。

**近两周（2026-10-11 起）**：136 条回执，full 50 / micro 86，零发现 41（**30.1%**），findings 295（minor 92 / info 166 / major 32 / critical 5），waived 110（**waiverRate 44.7%**），stop_loss 1。

**对决策门的直接读数**：Batch 3 的启动门是「连续两周 zeroFindingRate > 0.7」——当前 **0.30**，远未达到；waiverRate ~45% 值得关注（对应 `exemptBelowLines` 的宽度）。也就是说，即便 Batch 1 上线，Batch 3 在现有数据下也不该启动。

**Schema 漂移（Task 3 必须处理）**：

- 4 行 `findings` 不是数组（早期写成数字）；
- 37 条 finding 的 severity 用了 `high/medium/low`（2026-10-05 → 10-10），另有 9 条无 severity。计划里的 `bySeverity` 只认四值，会把这 46 条静默丢掉——需加 `other` 桶（或显式计数）。
- 47 条 `source: on_request` 回执没有 `cost`；375 条 `waived` 只有 `changedLines`，没有 `cost.diffLines`。
- 375 条 waived 中 303 条 `changedLines = 0`——这是 2026-10-10 空 diff bug 的历史残留。任何 waiver 率统计应取 10-11 之后窗口（110 条），否则历史噪声会把基线拉偏。

**两个度量口径的实测语义**：

- `cost.diffLines` = arm 时刻 `git diff HEAD` 的截断行数。**commit 之后为 0**（改动已进 HEAD），非 git 也为 0；626 条有 cost 的回执中 562 条为 0，10-11 后仍有 109/136 为 0。它测的是「未提交证据体积」，**不是改动大小，也不是复审成本**。计划 §9 的「复审成本代理」需降级表述。
- `cost.intercepts` 596/626 为 0 = 模型在 turn-stopping 前主动回执（健康路径），不是数据缺失；只有 29 条为 1、1 条为 2。`avgChain` 实际测的是「拦截率」，不是成本。

### 11.3 阻塞事实 A：`globToRegExp` 的 globstar 编译错误（影响 Batch 2 3a，且是现存缺陷）

实测（`lib/state.js`）：

```text
globToRegExp('**/auth/**')  → /^(?:.[^/]*\/)?auth\/.[^/]*$/
globToRegExp('**/*.ts')     → /^(?:.[^/]*\/)?[^/]*\.ts$/
globToRegExp('src/**')      → /^src\/.[^/]*$/
```

`**/` 先被替换成 `(?:.*/)?`，随后 `**` → `.*`、`*` → `[^/]*` 的两次 replace 又把刚插入的 `.*` 改写成 `.[^/]*`——globstar 退化成「单层 `*`」。结果：

- `**/auth/**` 只匹配 `src/auth/login.ts` 这类**单段前缀**；真实绝对路径 `/data/data/com.termux/files/home/proj/src/auth/login.ts` → `micro`（`decideReview` 实测）。
- `**/*.ts` 不匹配 `a/b/c/x.ts`；`**/node_modules/**` 不匹配 `/a/node_modules/pkg/i.js` 这类多级路径。
- 现有测试 `alwaysFullGlobs: touching a core contract file forces full depth`（780 行）用 `/p/spec/总纲.md`——恰好是单段前缀，所以绿灯；它掩盖了多级路径失败。
- README 示例 `src/contracts/**` 同样只匹配 `src/contracts/a.ts`，不匹配 `src/contracts/ui/a.ts`。

**影响**：Batch 2 的 3a「敏感路径强制 full（零代码）」**不成立**——`**/auth/**`、`**/migrations/**`、`**/*.sql` 在真实项目路径上静默不生效；`ignoreGlobs` 用户配置同样受影响。必须先修 globstar 编译（+ 多级绝对路径回归测试），3a 才谈得上「复用现成能力」。这是一条独立于路线图的现存缺陷，建议作为 Batch 0 先修。

**2026-10-23 已作为 Batch 0 修复**：`src/state.ts` 的 `globToRegExp` 改为先给两种 globstar 形式打占位符、跑完单星替换后再还原（避免插入的 `.*` 被 `*` 遍改写）；新增 `globToRegExp: globstar spans multiple directory levels`，并给 `alwaysFullGlobs` 测试补多级绝对路径断言。验证：`npm test` 95/95、realloop 6/6；真实路径 `/data/.../proj/src/auth/login.ts`、`.../spec/a.md`、`.../db/schema.sql` → `full`，`src/author.ts` / `src/plain.ts` → `micro`。3a 现在可按「复用现成能力」执行。

### 11.4 阻塞事实 B：bash 命令只保留写模式命中项（影响 Batch 2 3b）

`state.bashCommands` 只在 `BASH_WRITE_RE` 命中时 push（`src/index.ts:205-208`），且 `clearTurnWrites` 在 turn-stopping 时清空。`BASH_WRITE_RE` 覆盖重定向 / tee / sed -i / mv / cp / rm / mkdir / touch / chmod / chown / ln / npm install / git checkout -- / git reset / git clean，**不覆盖 `git push`、`gh pr create`、`npm publish`**。

因此 3b 设计的 `shouldEscalateForPush(state.bashCommands)` **永远看不到这三类命令**（除非同一条命令还带重定向等写模式）。3b 不是「加一个纯函数 + Config 键」，需要先有「记录全部 bash 命令」的独立通道（或在 tools/result 里对 push 类命令单独记账），再谈升级判定。

### 11.5 对 Batch 1 的执行结论

三个 Task 的代码落点、类型、测试锚点全部存在，可按计划执行；**Batch 0（globstar 修复）已完成**，Batch 2 3a 解除阻塞，3b 仍受 11.4 阻塞。开工时改四处文案/口径即可：

1. Task 3 Step 6：README「Commands 节」→「开发」节；
2. Task 3 的 `bySeverity`：加 `other` 桶（否则 46 条历史 finding 静默丢失）；
3. §9 的 `avgDiffLines` / `avgChain`：注明「0 值成因」与「不是成本代理」。
4. Step 3 的 findings 描述**保留「，仅此四值」**（`severity(info|minor|major|critical，仅此四值)`）：`decisions.md` 2026-10-10 的 severity 词表防漂移决定要求保留；计划文本漏写，实施已按 closer F1 恢复。

**新增待拍板项（并入第 10 节）**：

6. Qoder 文档（471 行）建议 findings 同时加 `confidence` 与 `priority`（或 severity→P0-P3 映射）；本计划明确不加 `priority`——是否确认放弃？
7. `receipts-stats` 的默认统计窗口是否排除 2026-10-10 之前的 waived 数据（历史空 diff bug 污染）？

### 11.6 现存缺陷 C：`collectDiff` 不展开 `~`、相对路径按进程 cwd 解析（2026-10-23 实测）

实测（`lib/state.js` 的 `collectDiff`，进程 cwd = `~/dsh-review-gate`）：

- 绝对路径 → 正常返回 diff；
- `~/dsh-review-gate/README.md` → 返回 `''`（向上找 `.git` 时把 `.` 当仓库根，git 把 `~/…` 当字面相对路径，无匹配 → 空 diff）；宿主进程 cwd = home 时 → 返回 `null`（找不到 `.git`，降级文案「非 git 环境」——2026-10-23 会话实测到该降级）；
- 相对路径 `README.md` → 仅当进程 cwd 恰好是仓库时正常；宿主 cwd = home 时同样 `null`。

根因：`dirname(first)` 直接用于向上找 `.git`，既不展开 `~`，也不以会话 workspace 为基准（宿主进程 cwd ≠ 会话 workspace）。AGENTS.md 要求路径用 `~/` 或相对路径，因此这是高频路径上的静默降级：证据注入与 auto 档基于 diff 行数的升格判定都拿不到数据。

最小修法（候选）：入口先归一化路径——`~/` / `~` 前缀替换为 `join(homedir(), rest)`；相对路径需要会话 workspace（宿主若无此 API，先只修 `~`，相对路径记为已知缺口并写进 README 边界）。+1 条测试（同文件 tilde 与绝对路径产出同 diff）。

**2026-10-24 已修复（Batch 0.5）**：`collectDiff` 入口 `expandTilde()` 归一化 `~` / `~/…`，root 探测、`git diff HEAD --`、`untrackedAmong` 三处都走归一化结果；`~/tmp` 真 git 仓库集成测试（`~/` 与绝对路径 diff 逐字节等价 + 裸 `~` 等价断言）入 npm test（合计 100）。相对路径仍按宿主进程 cwd 解析，已在 README 已知边界写明。

---

### 11.7 Batch 3 spike 的接口事实（供 7.1 检查项直接使用）

- 服务：`ctx.subagents: SubagentRuntime`（cordis Context 模块增强），`dsh-acp` 的用法是 `this.ctx.get("subagents")`（惰性取，apply 期可能未就绪）。
- 起一个 one-shot：`startActivation({ provider: 'spawn', label, request: { prompt, parent, signal, agentOptions? }, signal, delivery: 'caller' })` → `{ childId, messageId?, result: Promise<SubagentResult>, dispose() }`；`delivery: 'caller'` 表示结果只回调用方（父会话不收到通知消息；本地子仍进父 catalog）。
- 结果：`{ output: ContentBlock[], structured?, diagnostic?, stopReason }`；可传 `outputSchema` 拿结构化 JSON（provider 需 `capabilities.outputSchema`）。
- 模型降本：`request.agentOptions` 可覆盖 provider/model/reasoningEffort（provider 需 `agentOptions` 能力）。
- provider 注册：`dsh-base` 已装 `spawn`（默认名 spawn）与 `fork`（默认名 fork）；standard preset 的 `tool-subagent` 就是 `provider: spawn`。
- 超时/取消：`request.signal` 是规范取消通道；`dispose()` 释放 activation。spike 的 30s 回退可用 `AbortController` + `Promise.race` 实现，不需要新依赖。
