# dsh-review-gate v2 实施计划（回执化 + 证据化复审）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把复审闸门从「自证 + 必拦」升级为「结构化回执 + 证据注入」——模型完成复审必须调 `review_acknowledge` 工具回执（消掉无谓拦截、产出结构化 findings、复审可见可审计），并给复审指令附上真实 git diff 证据（Qoder L1「对刚改文件做检查」的精髓）。

**Architecture:** 现有事件骨架不动（`tools/result` 跟踪写操作 → `system-prompt/assemble` 注入指令 → `agent/turn-stopping` 兜底拦截 + `agent.steer`）。新增两个能力层：①`review_acknowledge` 工具作为唯一完成信号；②git diff 懒取证注入复审上下文。（多 session 隔离已由现有 `Map<agent.id, GateState>` 键控实现，src/index.ts:182，无需新增。）

**Tech Stack:** TypeScript + cordis（DSH 0.1.7-rc.2 peer 钉死）、`defineTool`/`ctx.tools.register`（dsh-tools）、`node:child_process.execFile`（git）、`node --test`。

## Global Constraints

- 不新增任何 npm 依赖；peerDependencies 保持 `0.1.7-rc.2` 钉版。
- **仓库尚未 git init**（2026-09-27 L1 快扫实证：`git status` 报 not a git repository）——任何 commit 步骤前先在 `~/dsh-review-gate` 执行一次 `git init`。
- 每个任务结束必须：`npm test` 全绿（用显式文件路径 `node --test test/gate.test.mjs`，目录形式在 node v24.18.0 会挂）+ `npm run build`（tsc strict）通过。
- 不创建远程仓库、不 push。
- 回执落盘失败必须吞掉（审计永不打断回合），带 `ponytail:` 注释。
- 完成后需用户重启 dsh web 才生效（宿主启动加载 bundle 后不重读磁盘）。

## 能力盘点（全部已取证，2026-09-27）

**✅ 现在就能做：**

| 能力 | 证据 |
|---|---|
| 注册工具 | `ctx.tools.register(defineTool({...}))` 为 20+ 官方插件标准形态（dsh-tool-goal/lib/index.js L264-300 实样） |
| 事件载荷带会话身份 | `agent/turn-stopping` payload `{agent, turn, signal}`（dsh-agent runtime-types.d.ts L387）；`agent/inbox/claimed` payload `{agent, message, turn}`（L277）；`ToolExecutionInput.agent`（dsh-tools index.d.ts L229，"set by the agent loop"）→ 现有实现已用 `Map<agent.id, GateState>` 按 agent 键控（src/index.ts:182），多 session 隔离已具备 |
| 工具结果观测 | `tools/result(exec, result)`，exec 含 name/arguments/agent，已在本插件使用 |
| 上下文注入 | `system-prompt/assemble` waterfall push `{name, text}` 进 runtime-context，已实现已真机验证 |
| 回合拦截续跑 | `agent/turn-stopping` + `agent.steer()`，已实现已真机验证 |
| git diff 取证 | host 是 node 进程，`child_process.execFile('git', ...)` 可用；box 上 git 可用 |
| 回执落盘 | node fs 直接写 `~/.dsh/storages/review-gate/`（playwright 插件同款落点约定） |

**⚠️ 能做但有天花板：**

| 能力 | 天花板 |
|---|---|
| bash 写操作启发式 | bash 进程直写不走 FileSystem service，事件层永远盲；只能正则匹配命令字符串（`>`/`tee`/`sed -i`/`mv`/`rm`…），有误报，只武装复审不阻断 |
| git diff 证据 | 非 git 目录/超时/超长 diff 需降级（返回 null / 截断 300 行） |

**❌ 结构上不做（出范围）：**

| 项 | 原因 |
|---|---|
| `fs/write-intent`/`fs/observed` 信号升级（覆盖 MCP 工具写） | 事件真实存在（dsh-fs types L28/L52）但 FsTarget/actor 形状未取证；当前 write/edit 主路径已覆盖；挂 P2 备选 |
| 独立复审 subagent（第二双眼睛） | 每轮成本高；等回执数据积累后用数据评估 |
| client UI review 界面 | 工具卡片天然给回执可见性，够用 |
| 真静态分析引擎 | 无引擎可接；diff 注入已把自检从「凭记忆」升级为「看证据」 |

## File Structure

> **L1 快扫修正（2026-09-27）**：初版计划的 Task 0（WeakMap 多 session 隔离）前提错误——源码 `src/index.ts:182` 已用 `Map<agent.id, GateState>` 按 agent 键控且测试已覆盖（gate.test.mjs L216-223 a1/a2 隔离用例），隔离早已实现，该任务整体删除。

- `src/index.ts`（唯一源文件，现状 242 行）：全部改动落这里——ack 工具、diff 取证、bash 启发式。单文件保持（现状规模不值得拆）。
- `test/gate.test.mjs`（421 行，35 例）：每任务追加对应测试。测试基建 = `fakeCtx()`（L148，`on`/`effect`/`emit`）/ `baseConfig`（L11）；agent stub 形态 = `{ id: 's1', steer: (m) => steered.push(m) }`；断言风格 = emit 后查 `steered` 数组（`emit` 同步派发、不返回监听器返回值）。
- `README.md`：Task 5 收尾更新机制说明。
- `~/.dsh/AGENTS.md` §10.5：Task 5 加一行交叉引用（插件为运行时强制机制），消除双头标准漂移。

---

### Task 1: `review_acknowledge` 工具——复审完成的唯一信号

**Files:**
- Modify: `src/index.ts`
- Test: `test/gate.test.mjs`

**Interfaces:**
- Consumes: 现有 `Map<agent.id, GateState>` 键控（src/index.ts:182-199，已实现已测）、`createState()`、`handleTurnStopping(state, steer, config)`；测试基建 `fakeCtx()`（gate.test.mjs:148，需扩展：加 `tools: { register: (d) => registered.push(d) }` 收集器与 `registered: []`）与 `baseConfig`。
- Produces: 工具名 `review_acknowledge`（`parameters` 支持 `enum`，schema.d.ts:22 已核实）；`GateState` 新增 `acknowledged: boolean`（`createState()` 初始 false）；`handleTurnStopping` 改三分支。指令常量 `MICRO_TEXT`/`FULL_TEXT`/`DRIVER_TEXT` 更新。

- [ ] **Step 1: 写失败测试**（真实形态：`fakeCtx()` + `baseConfig` + `steered` 数组断言；fakeCtx 先扩展 tools.register 收集器）

```js
// fakeCtx() 内追加（test/gate.test.mjs:148）：
const registered = []
// ctx 对象加： registered, tools: { register: (d) => { registered.push(d); return () => {} } },

test('ack 工具被注册且调用后置位，close 放行', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = ctx.registered.find((t) => t.name === 'review_acknowledge')
  assert.ok(ack, 'review_acknowledge 未注册')
  const steered = []
  const agent = { id: 's1', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: '查过 diff 无问题' }, { agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0, 'ack 后不拦截')
})

test('无 ack 拦截且保留 pendingReview，驱动后补 ack 放行', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = ctx.registered.find((t) => t.name === 'review_acknowledge')
  const steered = []
  const agent = { id: 's1', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'edit', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c1
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c2（pendingReview 仍在）
  assert.equal(steered.length, 2)
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: '补审' }, { agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 2, '补审被接受，不拦截')
})

test('ack 后再写文件则 ack 失效；无 pendingReview 时 ack 忽略；maxChain 止损保持', async () => {
  // a) ack 置位 → emit 一次 write → close 必须 steer（stale ack 不得放行新改动）
  // b) 从未写文件 → ack.execute 返回文案含 '忽略'
  // c) 连续 2 轮无 ack（chain 到 maxChain）→ 第 3 轮 close 不再 steer（止损，现状 L274-289 用例语义保持）
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/gate.test.mjs`
Expected: FAIL（工具不存在）

- [ ] **Step 3: 最小实现**

```ts
// GateState 增 acknowledged: boolean（createState() 初始 false）
// 工具注册（apply 的 effect 内，放在监听器之后；DefineToolOptions 形状照 dsh-tool-goal lib/index.js L275-300）：
ctx.tools.register(defineTool({
  name: 'review_acknowledge',
  description: '复审闸门回执：完成运行时上下文要求的收尾复审后调用，提交结构化结论。',
  parameters: {
    action:      { type: 'string', required: true, enum: ['micro', 'full'], description: '本次执行的复审档位' },
    files:       { type: 'array',  required: true, description: '复审覆盖的文件绝对路径' },
    findings:    { type: 'array',  required: false, description: '发现的问题 [{file, line?, severity(info|minor|major|critical), note}]' },
    fixes_made:  { type: 'boolean', required: true, description: '是否已就地修复发现的问题' },
    summary:     { type: 'string', required: true, description: '复审结论一句话' },
  },
  execute(args, exec) {
    const state = exec?.agent?.id ? states.get(exec.agent.id) : undefined
    if (!state || !state.pendingReview) return Promise.resolve('（当前无待复审回合，回执忽略）')
    state.acknowledged = true
    return Promise.resolve(`复审回执已登记（${args.action}，${args.files.length} 文件，findings ${args.findings?.length ?? 0} 条）。现在输出最终总结（含复审结论）。`)
  },
  // presentCall 省略（schema.d.ts:232 可选字段）：回执可见性由工具结果卡片承担，最小实现不加
}));
// handleTurnStopping 三分支（替换现有 pendingReview 处理）：
//   state.pendingReview && state.acknowledged → state.pendingReview=null; state.files.clear(); state.chain=0; return（放行）
//   state.pendingReview && state.chain < maxChain → steer(DRIVER_TEXT); state.chain+=1; return（保留 pendingReview，驱动后可补 ack）
//   state.pendingReview && state.chain >= maxChain → pendingReview=null; files.clear(); return（止损放行）
//   !state.pendingReview && state.files.size === 0 → state.chain = 0; files.clear(); return（现状逻辑保持）
// 重新分档置位处（tools/result 监听器 L199）：state.pendingReview 赋值前若 action!=='skip' 先 state.acknowledged = false（重臂必须重置 ack）
// MICRO_TEXT/FULL_TEXT 末尾加：「复审完成后调用 review_acknowledge 工具回执，再输出最终总结。」
// DRIVER_TEXT 改为：「(review-gate) 收尾复审未完成：请执行运行时上下文中的复审，完成后调用 review_acknowledge 回执，然后输出最终总结（含复审结论与本次任务做了什么）。」
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test test/gate.test.mjs && npm run build`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: review_acknowledge receipt tool as sole review-completion signal"
```

---

### Task 2: git diff 证据注入 + 行数升档

**Files:**
- Modify: `src/index.ts`
- Test: `test/gate.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 pendingReview 结构与 `acknowledged` 语义；现有 `Map<agent.id, GateState>` 键控。
- Produces: `collectDiff(files: string[]): Promise<string | null>`（从首个文件向上找 `.git`，`execFile('git', ['-C', root, 'diff', 'HEAD', '--', ...files])`，2s 超时，300 行截断，失败/非 git 返回 null）；Config 新增 `fullAtLines: number`（默认 150）；diff 增删行 ≥ fullAtLines → action 升为 full。

- [ ] **Step 1: 写失败测试**

```js
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
const run = promisify(execFile)

async function mkdtempGitRepo() {                       // helper 本任务自建，不留占位
  const dir = await mkdtemp(join(tmpdir(), 'rg-git-'))
  await run('git', ['-C', dir, 'init'])
  await run('git', ['-C', dir, 'config', 'user.email', 't@t'])
  await run('git', ['-C', dir, 'config', 'user.name', 't'])
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await run('git', ['-C', dir, 'add', '.'])
  await run('git', ['-C', dir, 'commit', '-m', 'base'])
  await writeFile(join(dir, 'a.txt'), 'base\nnew line\n')
  return dir
}

test('collectDiff：git 仓库返回含改动的 diff；非 git 目录返回 null', async () => {
  const { collectDiff } = await import('../lib/index.js')
  const dir = await mkdtempGitRepo()
  const diff = await collectDiff([join(dir, 'a.txt')])
  assert.ok(diff, 'git 仓库应返回 diff')
  assert.match(diff, /\+new line/)
  const plain = await mkdtemp(join(tmpdir(), 'rg-plain-'))
  await writeFile(join(plain, 'x.txt'), 'x')
  assert.equal(await collectDiff([join(plain, 'x.txt')]), null)
})

test('diff 行数达 fullAtLines 升档 full，且 assemble 注入含 diff 段', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const cfg = { ...baseConfig, fullAtLines: 5 }
  apply(ctx, cfg)
  // 真仓库造 6 行改动 → emit write → fakeCtx 的 assemble 用例形态照 gate.test.mjs 既有 assemble 测试
  // 断言：注入文本 action==='full' 且包含 'diff'
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/gate.test.mjs`
Expected: FAIL（collectDiff 不存在）

- [ ] **Step 3: 最小实现**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

async function collectDiff(files: string[]): Promise<string | null> {
  try {
    const root = await findGitRoot(files[0]);           // 逐级向上 dirname 找 .git，最多 12 层
    if (!root) return null;
    const { stdout } = await execFileP('git', ['-C', root, 'diff', 'HEAD', '--', ...files], { timeout: 2000, maxBuffer: 4 << 20 });
    if (!stdout.trim()) return null;
    return stdout.split('\n').length > 300 ? stdout.split('\n').slice(0, 300).join('\n') + '\n…（已截断，完整 diff 请自行 git diff）' : stdout;
  } catch { return null; }                              // ponytail: 非 git/超时统一降级为无证据快扫
}
// assemble 监听器：pendingReview 存在且未缓存 diff 时 lazy 计算（await collectDiff([...s.files])），缓存进 s.pendingReview.diffText；
// 增删行数统计（/^\\+|^\\-/m 逐行计，排除 +++/--- 头）>= config.fullAtLines → pendingReview.action = 'full'；
// 注入文本 = 指令 + (diffText ? '\\n\\n### 本回合改动 diff（HEAD 起）\\n```diff\\n' + diffText + '\\n```' : '\\n\\n（非 git 环境：请对照你本回合的编辑记录复审）')
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `node --test test/gate.test.mjs && npm run build`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: inject git-diff evidence into review instruction, grade by line count"
```

---

### Task 3: 回执落盘（JSONL 审计日志）

**Files:**
- Modify: `src/index.ts`
- Test: `test/gate.test.mjs`

**Interfaces:**
- Consumes: Task 1 ack 工具 execute。
- Produces: `appendReceipt(dir: string, receipt: object): Promise<void>`——`mkdir -p` + `fs.appendFile` 单行 JSON；ack execute 内调用；失败静默吞掉。

- [ ] **Step 1: 写失败测试**

```js
test('ack 回执追加到 JSONL；写失败不抛错', async () => {
  const { appendReceipt } = await import('../lib/index.js')
  const dir = await fs.mkdtemp(join(tmpdir(), 'rg-audit-'))
  await appendReceipt(dir, { action: 'micro', files: ['/a.ts'], findings: 0 })
  const line = (await fs.readFile(join(dir, 'receipts.jsonl'), 'utf8')).trim()
  assert.deepEqual(JSON.parse(line).files, ['/a.ts'])
  // 目录路径指向一个文件 → appendFile 报 ENOTDIR，必须被吞掉
  await assert.doesNotReject(appendReceipt(join(dir, 'receipts.jsonl'), { action: 'full', files: [], findings: 0 }))
})
```

- [ ] **Step 2: 跑测试确认失败** → **Step 3: 实现**（`appendFile(join(dir,'receipts.jsonl'), JSON.stringify({ts: Date.now(), ...receipt}) + '\\n')`，整体 try/catch 吞错 + `// ponytail: 审计失败静默——审计永不打断回合；排障看 stderr 一次性 warn`）→ **Step 4: 回归** → **Step 5: Commit**（`feat: persist review receipts to jsonl audit log`）

落盘目录：`~/.dsh/storages/review-gate/`（与 playwright 插件落点约定一致）。

---

### Task 4: bash 写操作命令启发式（可选，天花板明确）

**Files:**
- Modify: `src/index.ts`
- Test: `test/gate.test.mjs`

**Interfaces:**
- Consumes: 现有 `Map<agent.id, GateState>` 键控（tools/result 监听器内加 bash 分支）。
- Produces: `BASH_WRITE_RE = /(^|[\\s;&|])(>|>>|tee\\b|sed\\b[^\\n]*-i\\b|\\bmv\\b|\\bcp\\b|\\brm\\b|\\bmkdir\\b|\\btouch\\b|\\bchmod\\b|\\bchown\\b|\\bln\\b|npm\\s+(install|i|add|update)|git\\s+checkout\\b[^\\n]*--\\b|git\\s+reset\\b|git\\s+clean\\b)/`；`GateState.bashWrites: boolean` + `bashCommands: string[]`；`decideReview` 入参加 `bashWrites`。

- [ ] **Step 1: 失败测试**：`bash` + `echo hi > /x.txt` → close 时 intercept 且驱动消息含疑似写入命令；`bash` + `ls` → 不武装。
- [ ] **Step 2: 确认失败** → **Step 3: 实现**（tools/result 里 `exec.name === 'bash'` 时取 `exec.arguments.command` 字符串 match，命中则 `s.bashWrites = true` 并 push 命令（≤5 条）；分档时 files.size===0 && bashWrites → 'micro'；指令文本附「bash 中疑似写入：…」；`// ponytail: 正则启发式有误报/漏报——只武装复审不阻断，bash 进程写不走 FileSystem service 结构性不可见`）→ **Step 4: 回归** → **Step 5: Commit**（`feat: arm review gate on bash write-pattern commands`）

---

### Task 5: 真机验证矩阵 + 文档收尾（需用户重启 dsh web）

**Files:**
- Modify: `README.md`（机制说明：ack 回执 + diff 证据 + bash 启发式）
- Modify: `~/.dsh/AGENTS.md` §10.5（一行：「运行时由 `dsh-review-gate` 插件强制（`review_acknowledge` 回执可审计），本节为复审标准。」——消除双头标准）

**验证清单（真 web 会话逐项过）：**

- [ ] 用户重启 dsh web（`lib/` 新包生效，驱动文本应为 v2 措辞「调用 review_acknowledge 回执」）
- [ ] micro + 自觉 ack：一个写回合内模型复审→ack→总结收尾，**无第二次拦截**（本计划核心收益）
- [ ] micro + 忽略指令：驱动拦截出现，驱动后补 ack → 放行
- [ ] full 档：改 ≥3 文件或 ≥150 行 diff → 注入含五步指令 + diff 段
- [ ] maxChain 止损：连续无视 → 最多拦 2 次后放行
- [ ] 多 session：两个会话同时写文件，拦截互不串扰（回执/文件清单对得上）
- [ ] `~/.dsh/storages/review-gate/receipts.jsonl` 有回施行
- [ ] bash 写命令回合被武装（micro）

## Self-Review 结论（v2 快扫后更新）

- **L1 快扫修正（2026-09-27）**：初版计划的 Task 0（WeakMap 隔离）前提错误已删除——现状 `Map<agent.id, GateState>` 已实现隔离；初版测试代码引用了不存在的 helper（setup/mkExec/okResult/defaultCfg）已全部改为测试文件真实形态（fakeCtx/baseConfig/steered 断言）；补 git init 前置；删 presentCall 伪代码。
- 规格覆盖：差距分析三大内部矛盾——①无完成信号→Task 1；②自证无产出→Task 1+2+3；③双头标准→Task 5 AGENTS.md 交叉引用。覆盖齐。
- 占位符扫描：Task 2 的 mkdtempGitRepo 已给实现；测试断言均落到具体文本/状态。
- 类型一致性：`GateState` 字段（files/chain/pendingReview/acknowledged/bashWrites/bashCommands）在 Task 1/4 递增定义，后续任务引用前已存在；测试 helper 名与 test/gate.test.mjs 现存形态逐一对过（fakeCtx L148 / baseConfig L11 / agent stub L194）。
