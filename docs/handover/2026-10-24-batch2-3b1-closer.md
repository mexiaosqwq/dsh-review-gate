# Batch 2 · 3b-①（pushHistory 记录通道 + `escalateOnPush` 配置键）closer 复核报告

- 日期：2026-10-24
- 单号：task-6（Batch 2 · 3b-①，纯管道、零行为变更）
- 基线：HEAD `aa4272c`（3a 已收口）
- 被审对象：工作区未提交改动（`src/index.ts`、`src/state.ts`、`src/config-live.ts`、`test/gate.test.mjs`、`README.md`、`lib/` 构建产物）+ worker 报告 `docs/handover/2026-10-24-batch2-3b1-worker.md`（实际 122 行；派令写 140 行，见 F4）
- 席位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE**

**结论：PASS_WITH_FINDINGS（0 blocking；F1/F2 为 minor，F3/F4 为 info）**

---

## 0. 被审对象与 diff

```text
git diff --stat
 README.md                  |  3 +-
 lib/config-live.js         |  1 +
 lib/index.js               | 16 ++++++++-
 lib/state.js               | 15 +++++++++
 lib/types/config-live.d.ts |  2 +-
 lib/types/index.d.ts       |  2 ++
 lib/types/state.d.ts       | 19 +++++++++++
 src/config-live.ts         |  1 +
 src/index.ts               | 17 ++++++++++
 src/state.ts               | 26 +++++++++++++++
 test/gate.test.mjs         | 83 ++++++++++++++++++++++++++++++++++++++++++++++
 11 files changed, 182 insertions(+), 3 deletions(-)
```

- `src/` 改动均为新增：`Config` 键、`ReviewGateConfig` 可选字段、`GateState.pushHistory`、`createState` 初始化、`clearTurnWrites` 清空、`recordPushHistory`、bash 监听器独立分支、工具 set 参数/类型、`OVERLAY_KEYS` 追加。
- `src/instruction.ts` 零 diff；`BASH_WRITE_RE`、`decideReview`、`handleTurnStopping` 既有逻辑零 diff（见 §1）。
- `lib/` 7 个生成文件与 `src` 同步；没有 `lib/client.js` 或 client 相关改动。
- 未触碰 `package.json`、`scripts/`、`cordis.patch.yml`；未 commit。

> 计数口径注意：HEAD 基线 gate 96 / 合计 101；本单新增 4 例 → 实际 gate 100 / 合计 105（client 3 + stats 2）。派令写的 “gate 105 + 3 + 2 = 110” 与基线不符；worker 报告写的 105 才是实际值（见 F1/F4）。

---

## 1. 零行为变更

### 1.1 source diff 只读

`src/index.ts` 新增 hunk：

- `:39` import `recordPushHistory`
- `:73-76` `escalateOnPush: z.boolean().default(false)`
- `:214-219` bash 监听器独立记录分支
- `:790-794` 工具 set 参数 schema
- `:813` `a` 类型字段

`src/state.ts` 新增 hunk：

- `:43-47` `ReviewGateConfig.escalateOnPush?`
- `:184-190` `GateState.pushHistory`
- `:213` `createState` 初始化
- `:227` `clearTurnWrites` 清空
- `:230-240` `recordPushHistory`

`src/config-live.ts` 仅 `:29` 追加 `'escalateOnPush'`。`git diff -- src/instruction.ts` 为空；`BASH_WRITE_RE`、`decideReview`、`handleTurnStopping` 的分支文本没有出现在 diff 的增删行中。结论：**无既有语义改动**。

### 1.2 默认关闭时行为

- `Config({}).escalateOnPush === false`（实跑；见 §4）。
- bash 监听器记录分支有 `cfg.escalateOnPush` 单点守卫；默认 false 时不调用 `recordPushHistory`。
- `pushHistory` 虽为 `GateState` 的必填字段，但只在 `createState()` 初始化，`clearTurnWrites` 清空；不参与 `decideReview`、`handleTurnStopping` 的既有判定。
- `recordPushHistory` 不写 `bashCommands`、不设置 `bashWrites`、不设置 `pendingReview`；`gradeAndArm` 仅在原信号（`state.files` / `state.bashWrites`）上运行。
- 结论：**默认 false 零行为变化**；与 README 和 worker 报告一致。

---

## 2. 通道隔离

### 2.1 `pushHistory` 出现点

```text
grep -Rni 'pushHistory|recordPushHistory' src
src/state.ts:190  pushHistory: string[]
src/state.ts:213  pushHistory: [],
src/state.ts:227  state.pushHistory = []
src/state.ts:236  export function recordPushHistory(...)
src/index.ts:39  recordPushHistory,
src/index.ts:218 recordPushHistory(state.pushHistory, command)
```

只有状态定义/清空/纯函数和监听器调用；没有 `instruction.ts`、`reviewInstructionText`、`bashSection`、`appendReceipt`、`saveOverlay`、`stateSummary` 的出现。

### 2.2 注入面

`src/index.ts:370-377` 的注入文本只拼：

- `state.bashCommands.map(...)` 的 `bashSection`
- `reviewInstructionText(...)`
- diff section

`pushHistory` **不在**这三个来源里。新测试 `test/gate.test.mjs:867-888` 在 `escalateOnPush:true` 下先发 `git push origin main` 再发 `edit`，取 `review-gate` section 并断言 `section.text.includes('git push origin main') === false`；实跑通过。

### 2.3 落盘/回执面

- `appendReceipt` 调用点（`src/index.ts:243,303,351,689,724`）的 payload 均不含 `pushHistory`。
- `stateSummary`（`src/index.ts:471-481`）只暴露 `chain/sessionFiles/noNewReviews/openWrites/bashWrites/pending`，不含 `pushHistory`。
- `saveOverlay` 只写 `overlay`，`pushHistory` 不在 `OVERLAY_KEYS`，也不在 `ReviewGateConfig`。
- `recordPushHistory` 只 `push/shift` 内存数组；无 `writeFile`/`appendReceipt`/日志调用。

结论：**不注入、不落盘、不产生回执**与 README 声明一致。

---

## 3. 上限、截断与边界

直接 `node --input-type=module` 调 `lib/index.js`（只读探针，不改仓库）：

```text
21-> 20 cmd-1 cmd-20
301-> 1 300 true
whitespace/nonstring-> ["   ","\t\n"] count 2
middle-> 300 aaaaaMIDDLEbbbb tail true
```

逐项：

- **21 → 20 保留最新**：0-based `cmd-0..cmd-20` 共 21 条，结果 `cmd-1..cmd-20`，长度 20；最旧 `cmd-0` 被 shift。与规格和 `recordPushHistory` 的 `if (history.length > 20) history.shift()` 一致。
- **301 → 300**：`'x'.repeat(301)` 入参，结果为 `'x'.repeat(300)`；截断保留头部（`slice(0,300)`），不保留尾部。
- **非字符串/空串**：`undefined/null/42/object/array/''` 均不改变数组；实测 `untouched` 保持 `['keep']`。
- **纯空白串 `'   '`**：**会被记录**（与 `'\t\n'` 一起进入结果）。裁定：**按规格字面不是缺陷**——规格写的是“非字符串/空串忽略”，`'   '` 是非空字符串；注释也写 “empty input”，没有写 trim。若 3b-② 不希望空白项参与 push 判定，应在消费侧 `trim()` 后过滤，或另行修订规格；本单不应为了空白串擅自改 `recordPushHistory` 的契约。
- **超长命令中段无关**：300 char 截断只取头部；`'a'*150 + 'MIDDLE' + 'b'*145` 截断后中段仍在，尾部被截；3b-② 不能假设命令完整（见 §10）。

结论：上限/截断/非法输入符合规格；空白串记录是规格字面行为（info，见 F3）。

---

## 4. 配置面三入口一致

### 4.1 schema / OVERLAY_KEYS / 工具 set

- `src/index.ts:76`：`escalateOnPush: z.boolean().default(false)`。
- `src/config-live.ts:29`：`OVERLAY_KEYS` 末尾追加 `'escalateOnPush'`。
- `src/index.ts:790-794`：工具 set 参数 `{ type: 'boolean', description: ... }`。
- `src/index.ts:813`：`a` 类型 `escalateOnPush?: boolean`。
- `src/index.ts:855-861` 的既有 `for (const key of OVERLAY_KEYS)` 循环自动覆盖新键；HTTP `pickOverlay` 同源。

### 4.2 实调 set true → false

用临时 `fakeCtx`（与测试同形，不触碰仓库）实跑：

```text
default: false
set true: 审查闸门全局默认已生效（即时）：escalateOnPush=true
overlay true: {"escalateOnPush":true}
set false: 审查闸门全局默认已生效（即时）：escalateOnPush=false
overlay false: {"escalateOnPush":false}
http-like pick/apply: {"mode":"full","escalateOnPush":true} true full
```

- set true 后 `readOverlay` 真落 `{"escalateOnPush":true}`；set false 后真变 false；不是只回显。
- 直接 `pickOverlay` + `applyOverlay` 也把 true 合入配置，证明 HTTP 透传路径同源。

### 4.3 漏登 OVERLAY_KEYS 真会被抓

把当前 `lib/` 复制到 `~/tmp` 副本，删掉 `lib/config-live.js` 中的 `'escalateOnPush'`，只跑该测试：

```text
✖ escalateOnPush: schema default is false and the config tool exposes the key
  AssertionError [ERR_ASSERTION]: the config tool applies the key
  actual: false / expected: true                         [exit 1]
```

`test/gate.test.mjs:1606-1608` 的 `set escalateOnPush=true` + `readOverlay` 断言确实能抓住漏登记；worker 报告 §2.3 的说法成立。

---

## 5. 旧 lib 反证

从 `git archive HEAD` 取旧 `lib/`，复制当前新测试，symlink `node_modules`，跑完整 gate：

```text
旧 lib exports: NO recordPushHistory/escalateOnPush
old lib gate: ℹ tests 100 ℹ pass 97 ℹ fail 3

✖ recordPushHistory: records, truncates at 300 chars, keeps the newest 20
  TypeError: recordPushHistory is not a function
✖ clearTurnWrites: settles pushHistory together with the turn writes
  AssertionError: fresh state starts empty — undefined !== []
✖ escalateOnPush: schema default is false and the config tool exposes the key
  AssertionError: recording is opt-in (default false) — undefined !== false
✔ escalateOnPush: push commands are recorded but never arm or leak into the instruction
```

裁定：

- 前三条是**真实红驱动**：新 API/字段/默认值在旧 lib 上确实不存在。
- 第四条在旧 lib 上**绿**，worker 报告 §2.1 的自报准确。它不是恒真断言：若实现把命令塞进 `bashCommands`（会出现在 section）、把 `bashWrites` 置真（会 steer）或把记录并入既有 arm 路径，它会红；因此它是**零行为变更的回归守卫**，而不是新码驱动。
- 但它的标题 “push commands are recorded” 超过了实际断言范围：它没有直接断言 `state.pushHistory` 被写入；如果监听器分支整体删掉，它仍会绿，纯函数测试也不覆盖 `index.ts` 的调用。建议保留为回归守卫，但把标题/注释限定为 “push alone does not arm and never leaks into instruction”；若 3b-② 需要，另加可观测/测试 seam。详见 F2。

---

## 6. README 真话检验

`README.md:173`：

> `escalateOnPush` | `false` | 开启后把本回合的 bash 命令记入内存史（≤20 条 × 300 字符，结算即清），供 push 类升级判定使用；**不注入复审指令、不落盘、不产生回执**。默认关闭时零行为变化（升级判定本身尚未接入）

逐项核对：

| 声明 | 实码 | 结论 |
|---|---|---|
| 默认 false | `Config` default false；实跑 `Config({})` | 真 |
| 记本回合 bash 命令 | `tools/result` 的 bash 分支，`cfg.escalateOnPush` 为真时调用 | 真 |
| ≤20 条 × 300 字符 | `recordPushHistory` 的 `>300 slice`、`>20 shift`；实测 21→20、301→300 | 真（UTF-16 code unit 口径见 §8 残留） |
| 结算即清 | `clearTurnWrites` 清空；测试与实跑 | 真 |
| 不注入 | `bashSection` 只取 `bashCommands`；新测试断言 section 不含 push | 真 |
| 不落盘 | `pushHistory` 无 `appendReceipt`/`saveOverlay`/`writeFile` 通路 | 真 |
| 不产生回执 | 无 ack/receipt 调用；`stateSummary` 不含 | 真 |
| 升级判定尚未接入 | `escalateOnPush` 无消费方；无 `shouldEscalateForPush`/`p.action` push 分支 | 真 |

`README.md:105` 也已把 `escalateOnPush` 列入运行时可调键；`README.md:173` 是唯一新增配置表行，符合“只描述记录行为”。`README.md:207/219` 的测试计数仍是 96/101，见 F1。

`README` 的 `alwaysFullGlobs` 行还保留了 `chain` 已到 `maxChain` 的止损例外，和 3a 的边界一致（本单未改）。

---

## 7. 回归面

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: .../lib/client.js (3 modules, smoke-gated)
# BUILD_EXIT=0

env -u LD_PRELOAD npm test
# ℹ tests 105  ℹ pass 105  ℹ fail 0        [NPM_EXIT=0]

env -u LD_PRELOAD node --test test/gate.test.mjs
# ℹ tests 100  ℹ pass 100  ℹ fail 0        [GATE_EXIT=0]

env -u LD_PRELOAD node --test test/realloop.test.mjs
# ℹ tests 6  ℹ pass 6  ℹ fail 0            [REALLOOP_EXIT=0]

git diff --check                            # exit 0
git status --porcelain
# M README.md / lib/... / src/... / test/gate.test.mjs
# ?? docs/handover/2026-10-24-batch2-3b1-worker.md
```

- `npm test` 105 = gate 100 + client-bundle 3 + receipts-stats 2；**不是派令写的 110**。HEAD 基线 96/101，新增 4 例后是 100/105；worker 报告的 105 正确。
- `build` 后 `lib/` 7 个文件与 `src` 同步；无 `lib/client.js` 变化。
- realloop 6/6 通过，`GateState` 新必填字段没有破坏测试装配；仅有测试/纯函数改动，未运行额外真机（默认 false，无行为变化）。
- `git diff --check` 0；当前 status 无意外文件；本报告是唯一新增的 untracked closer 文件。

---

## 8. 规格对照

| 规格 | 证据 | 结论 |
|---|---|---|
| Config `escalateOnPush` 默认 false | `src/index.ts:76`；`Config({})` 实跑 | 完成 |
| `OVERLAY_KEYS` 追加 | `src/config-live.ts:29`；漏登记变异红 | 完成 |
| 工具 set 参数/类型 + HTTP 透传 | `src/index.ts:790-794,813`；实调 true→false；`pickOverlay` | 完成 |
| `GateState.pushHistory` 初始化 | `src/state.ts:190,213` | 完成 |
| `clearTurnWrites` 清空 | `src/state.ts:227`；测试 + 实跑 | 完成 |
| 纯函数 `recordPushHistory` | `src/state.ts:236-240`；21/301/非法输入探针 | 完成 |
| bash 监听器独立分支 | `src/index.ts:214-219`；不写 `bashCommands`、不 arm、不落盘、不回执 | 完成 |
| 测试四条 | `test/gate.test.mjs:834,856,867,1590`；101→105 | 完成（F2 有覆盖缺口） |
| README 配置表一行 | `README.md:173`；事实核对全真 | 完成 |
| 禁区：不改 instruction/规则 | `git diff -- src/instruction.ts` 为空；无新注入段 | 完成 |

---

## 9. Findings

### F1 · minor | `README.md:207,219`；`AGENTS.md:20,49`

**事实**：本单新增 4 例后实际 gate 100 / total 105；README 的 Layout（`:207`）和 Commands（`:219`）仍写 “gate 96 ... 合计 101”，AGENTS 的 Layout/Commands（`:20`、`:49`）同样仍是 96/101。worker 报告 §2.2 已写 105，但文档没有同步。

**影响**：下一批基线与“全量测试”读数为 96/101，实际 100/105；提交后文档继续漂移，审计容易误判为少跑了测试。不影响运行时。

**最小修法**：lead 提交前把 README 两处 + AGENTS 两处（共四行）改为 gate 100 / 合计 105；worker 报告 §0 的 `test +75` 也改为实际 `+83`（见 F4）。

### F2 · minor | `test/gate.test.mjs:867-888`

**事实**：测试标题是 “push commands are recorded but never arm or leak into the instruction”，但断言只覆盖两件负向事实：

1. 单独 push 不 steer；
2. 有 edit 后 `review-gate` section 不含 push 文本。

它**没有**断言 `state.pushHistory` 含该命令；旧 lib（无新分支）上该测试为绿（实测）。若删除 `index.ts:217-219` 的 `recordPushHistory` 调用，纯函数测试仍绿、该测试也仍绿——`index.ts` 的监听器接线没有直接回归断言。

**影响**：这是**回归守卫**（能拦住把 push 塞进 `bashCommands` 或借 push arm 的错误实现），但不是新分支记录行为的正证；标题容易被误读为已覆盖“recorded”。不影响当前实现正确性（纯函数与静态路径均通过），属测试质量缺口。

**最小修法**：保留该例，标题/注释改为 “push alone does not arm and never leaks into instruction”；若需要正证，给测试加一个不落盘/不回执的内存观测 seam，或至少用 `recordPushHistory` + `createState` 的纯函数组合覆盖状态字段（当前已有）。不要删除这个负向守卫。

### F3 · info | `src/state.ts:236-240`

**事实**：`recordPushHistory` 只拒绝 `command === ''`；`'   '`、`'\t\n'` 会被记录（实测 count 2）。规格写的是“非字符串/空串忽略”，注释写 “empty input”，因此**不是规格违背**；worker 报告 §5.3 也没有把空白串列为缺陷。

**影响**：3b-② 如果直接对 `pushHistory` 做 push 匹配，空白项不会命中；如果未来把 `pushHistory` 用于计数/展示，空白项会占一条（最多 20 条内）。当前无消费方，无实际后果。

**最小修法**：本单不改（保持规格字面）；3b-② 在消费侧 `if (!command.trim()) continue` 或把空白串显式纳入规格。若产品定义“空串”包含纯空白，再改 `recordPushHistory` 并补测试。

### F4 · info | `docs/handover/2026-10-24-batch2-3b1-worker.md:28`；派令回归口径

**事实**：

- worker 报告 §0 的 `git diff --numstat` 写 `test/gate.test.mjs 75 0`；实际为 **83 0**（`git diff --numstat` 与 `--stat` 一致）。报告实际 122 行，派令写 140 行；这是报告/派令口径的陈旧，不是代码差异。
- 派令写 “应 gate 105 + client 3 + stats 2 = 110”；实际 HEAD 基线 gate 96，新增 4 例 = **gate 100 / total 105**。worker 报告 §2.2 写 105 是正确的。
- 本轮 `npm test` 实测 105/105；`node --test test/gate.test.mjs` 100/100；不存在未跑的第 5 个测试文件。

**影响**：若按 110 验，会把正确的 105 误判为少跑；若按 75 行核对 diff，会误以为测试少了 8 行（实际是报告未更新）。不改变代码正确性。

**最小修法**：lead 在收口时以 **gate 100 / total 105** 为准；修正派令/报告中的 110、75、140。代码不需要改动。

---

## 10. 对 3b-② 的三个具体提醒

1. **消费必须发生在 `clearTurnWrites` 之前。** `pushHistory` 在 `handleTurnStopping` 的 ack、止损、steer 和 no-pending 四个路径都会被清空（`src/state.ts:349,358,365,371`）；同时 `src/index.ts:748` 的 ack 也会清。若在 `handleTurnStopping` 返回后、或 ack 后再读，看到的永远是 `[]`。建议在 `system-prompt/assemble` 的 pendingReview 分支读取，或在调用 `handleTurnStopping` 前先取出快照；不要改 `clearTurnWrites` 的既有语义来“留历史”。
2. **`pushHistory` 是“本回合全部 bash 命令”，不是 push 白名单。** 监听器对每个 bash 命令都调用 `recordPushHistory`（只要 `escalateOnPush` 真）；没有去重、没有 push 过滤，最多保留最新 20 条，单条截到 300 个 UTF-16 code unit；空白串也会入列。3b-② 必须自己用 push 正则筛选，并接受“老命令可能已被截断/挤掉”。
3. **没有观测面，别假设能从 HTTP/回执看到它。** `stateSummary` 不含 `pushHistory`，receipts 不含，`config.json` 也不含；`escalateOnPush` 只是配置键。3b-② 若要真机/测试验证记录，需另加**不落盘、不回执**的测试 seam 或日志，不要把 `pushHistory` 塞进 `bashCommands`/instruction；另外用 `cfgOf(agentId)` 读生效配置（全局+会话 overlay），不要只读 boot `config`。

---

## 11. 复核者改动与临时物

- 仓库内唯一新增：本报告。
- 未修改 `README.md`、`src/`、`test/`、`lib/`、`package.json`、`AGENTS.md`；未 commit。
- 临时探针/变异均在 `~/tmp/r6-*`，已清理；未污染仓库。`npm run build` 按复核要求重放，`git status` 与 worker 交付清单一致。
- 复核覆盖范围：`git diff HEAD` 的 11 个文件、`src/instruction.ts` 零 diff 证据、`git grep pushHistory/escalateOnPush` 全部出现点、`README.md` 配置表/计数行、worker 报告、HEAD+新测试的旧 lib 回归、当前 build/test/realloop/diff-check。

---

## 12. 摘要（≤10 行）

- **PASS_WITH_FINDINGS，0 blocking**：纯管道实现与规格逐项一致；默认 false 零行为变化，通道隔离、上限/截断、三入口、README 真话、旧 lib 反证均通过。
- `recordPushHistory` 21→20、301→300、非字符串/空串忽略实测通过；纯空白串按规格字面会被记录（F3 info，不是缺陷）。
- `set escalateOnPush` true→false 实调 round-trip 通过；漏登 `OVERLAY_KEYS` 的变异测试会红，断言有效。
- 旧 lib 上 4 条新测试 3 红 1 绿；绿的监听器例是回归守卫而非恒真，但标题“recorded”超过实际断言范围（F2 minor，保留并改名/补 seam）。
- 实际回归：build 0；npm test **105/105**（gate **100** + client 3 + stats 2）；realloop 6/6；diff --check 0。
- README/AGENTS 仍写 gate 96/合计 101（F1 minor，提交前改 100/105）；worker 报告 test diff 写 75、派令写 110，实际 83/105（F4 info）。
- 3b-② 先读后清、自行过滤 push、别指望观测面（§10）。
