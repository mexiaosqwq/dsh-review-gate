# Batch 2 · 3b-②（push 类命令升级 full）closer 复核报告

- 日期：2026-10-24
- 单号：task-7（Batch 2 · 3b-②，依赖 3b-①）
- 基线：HEAD `3fa3525`（3b-① 已入库）
- 被审对象：工作区未提交改动（`src/state.ts`、`src/index.ts`、`test/gate.test.mjs`、`README.md`、`lib/` 构建产物）+ worker 报告 `docs/handover/2026-10-24-batch2-3b2-worker.md`（149 行）
- 席位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE**

**结论：PASS_WITH_FINDINGS（0 blocking；F1/F2/F3 为 minor，F4 为 info）**

---

## 0. 被审对象与 diff

```text
git diff --stat
 README.md            |  4 +--
 lib/index.js         | 15 +++++++-
 lib/state.js         | 12 +++++++
 lib/types/state.d.ts |  2 ++
 src/index.ts         | 16 +++++++++
 src/state.ts         | 14 ++++++++
 test/gate.test.mjs   | 96 ++++++++++++++++++++++++++++++++++++++++++++++++++++
 7 files changed, 156 insertions(+), 3 deletions(-)
```

- `src/state.ts`：新增模块私有 `PUSH_RE` + `shouldEscalateForPush`（`:249-254`）；3b-① 的 `recordPushHistory` 未改。
- `src/index.ts`：assemble 的 pendingReview 分支新增 auto/escalateOnPush/micro/push 四条件升级块（`:335-349`），位于 `shouldWaive` 判定之前；既有 waiver、diff 注入、`reviewInstructionText` 未改。
- `test/gate.test.mjs`：纯函数 1 例 + 行为 4 例（a/b/c/d）+ 共享 `assemblePushTurn` 辅助。
- `README.md`：机制信号链第 2 条加 push 升级说明；配置表 `escalateOnPush` 行补全。
- `lib/` 3 个生成文件与 `src` 同步；`lib/client.js` 未变。
- 未触碰 `src/instruction.ts`、`decideReview`、`shouldWaive`、`recordPushHistory` 的语义；未 commit。

---

## 1. 重点：先 waived 再 push 再 assemble 的时序

我按派令用当前 `lib` 实跑了一个此前测试没覆盖的序列：

1. 同一 agent 写入 `a.txt`（相对 HEAD 恰好 1 行改动）；
2. 第一次 assemble（此时 `pushHistory` 空，应 waived、`pendingReview=null`）；
3. emit `bash` / `git push origin main`（走 tools/result，重新 grade/arm）；
4. 第二次 assemble。

原始输出：

```text
firstSection= undefined
firstReceipt= {"ts":1792818582072,"agentId":"r7-seq","outcome":"waived","files":["/data/data/com.termux/files/home/tmp/r7-seq-aVHGeZ/a.txt"],"changedLines":1}
secondSection= PRESENT
secondIncludesFull= true
secondIncludesL1= false
secondTextHead= [review-gate] 本回合已改动 1 个文件。收尾流程：给出最终总结之前，先执行全面复审，逐项完成：
审查纪律：只报本回合 diff 引入的问题，pre-
```

结论：

- 第一次确实按既有 waiver 落 `outcome:'waived'`、无 review-gate section，`pendingReview` 被清。
- push 事件重新 `gradeAndArm` 时，`state.files` 仍保留那 1 个文件；`pushHistory` 由 3b-① 记录；第二次 assemble 看到 `p.action==='micro'` 且 `shouldEscalateForPush` 为 true，将 `p.action` 改成 full，waiver 因 `action!=='micro'` 不成立，最终注入 **full** section 且**没有** `L1 快扫`。
- 这条时序没有发现 major 缺口。

---

## 2. auto 守卫与固定档

对当前 `lib` 用临时 fakeCtx + 独立 git fixture 跑运行态矩阵（每个 case 独立 agent id / receiptDir）：

```text
auto push                        section= PRESENT full= true micro= false receipt= none
auto push dry-run                section= PRESENT full= true micro= false receipt= none
auto double-space push           section= PRESENT full= true micro= false receipt= none
auto push at prefix 249          section= PRESENT full= true micro= false receipt= none
auto push semicolon              section= none      full= false micro= false receipt= waived
auto push&&                      section= none      full= false micro= false receipt= waived
auto non-push                    section= none      full= false micro= false receipt= waived
auto escalate=false              section= none      full= false micro= false receipt= waived
fixed micro push                 section= PRESENT full= false micro= true receipt= none
fixed full push                  section= PRESENT full= true micro= false receipt= none
off push                         section= none      full= false micro= false receipt= none
```

- 固定 `micro` 也产 `p.action==='micro'`，但升级块第一条件是 `cfg.mode==='auto'`，所以它保持 micro；证明守卫来自 `cfg.mode`，不是 action。
- 固定 `full` 本来 action 就是 full，升级为 no-op；输出 full section，无 waiver。
- `off` 连 pendingReview 都不产生，无 section、无回执；符合既有分档。
- `escalateOnPush:false` / 非 push 命令仍走 waiver；对照组有效。
- `auto push semicolon` 与 `auto push&&` 是下面 F3 的边界缺口（仍被 waived），不是 auto 守卫错误。

---

## 3. `PUSH_RE` 边界与 300/20 复算

### 3.1 独立边界表

```text
"git push" true
"git push origin main" true
"git push --dry-run" true
"git  push origin main" true
"x"*250 + " git push origin main" true          # 前缀 250 字 + 空格，push 起点在 251
"gh pr create --fill" true
"npm publish --access public" true
"cd x && git push origin main" true
"git commit -m wip\ngit push origin main" true
"git push; echo done" false                       ← F3
"git push&& echo done" false                      ← F3
"sh -c 'git push'" false                          # worker §5.4 已声明
"git -C ~/repo push origin main" false            # worker §5.4 已声明
"cd x&&git push" false                            # worker §5.4 已声明
"GIT PUSH" false                                  # worker §5.4 已声明
"cat git push.txt" false
"ls # then git push" true                         # 宁多审，可接受
```

- 派令要求的 `git push` 在第 250 字符处：用 `'x'.repeat(249) + ' git push origin main'` 实跑，assemble 得到 full section；300 截断前仍包含完整 `git push`。
- `git  push` 双空格：`git\s+push` 命中，assemble 得到 full。
- `--dry-run` 命中；与 README 一致。
- **`git push;` / `git push&&`** 因尾部 fence 是 `(\s|$)`，分号/`&&` 不是 `\s`，不命中；见 F3。

### 3.2 300 字符截断复算

```text
prefix 290 -> pushIndex 291 -> storedLen 300, escalates true
prefix 291 -> pushIndex 292 -> storedLen 300, escalates true
prefix 292 -> pushIndex 293 -> storedLen 300, escalates false (tail "git pus")
prefix 293 -> pushIndex 294 -> storedLen 300, escalates false
...
```

与 worker §5.2 的 “pushStart=292 HIT / 293 MISS” 一致（我这里 pushIndex 为 0-based 前缀计数；报告用的是起点索引，边界相同）。

### 3.3 20 条上限复算

```text
total=20（push 为第 1 条） -> len=20, pushKept=true,  escalates=true
total=21（push 为第 1 条） -> len=20, pushKept=false, escalates=false, first=cmd-1
```

与 worker §5.3 一致。push 若是最旧一条会被挤掉；属于已留档的 300/20 上限，不是本单新回归。

---

## 4. 不改既有语义

```text
git diff -- src/instruction.ts        # 空
git diff -U0 -- src/state.ts src/index.ts
# 只出现新增行：PUSH_RE/shouldEscalateForPush + index assemble 新块
```

- `decideReview`：无 hunk；仍按 no write/off/maxChain 早退、固定档、auto 四条件分档。
- `shouldWaive`：无 hunk；仍要求 `mode auto + action micro + 单文件 + 非 bash + changedLines < exemptBelowLines`。
- `reviewInstructionText` / `instruction.ts`：无 hunk；push 只改 `p.action`，不改文案来源。
- 3b-① `recordPushHistory` 及监听器写入分支：无手改；pushHistory 仍不注入、不落盘、不产生回执。
- `p.files` / `p.paths`：升级块只执行 `p.action='full'`；`p.files` 与 `p.paths` 原样保留。第一次序列的 full 文本仍显示“本回合已改动 1 个文件”，可作行为旁证。

---

## 5. README 真话

`README.md:40`（机制信号链第 2 条）新增：

> **push 类升级**（`escalateOnPush` 开启且 `auto` 档）：本回合 bash 命令命中 `git push` / `gh pr create` / `npm publish` → 此刻把 micro 升为 full，这一步排在「微量豁免」判定**之前**——否则「1 行改动 + git push」会被豁免掉，正是该升级要堵的洞；固定 `micro`/`full` 档不参与。

`README.md:173`（配置表 `escalateOnPush`）：

> 开启后把本回合的 bash 命令记入内存史（≤20 条 × 300 字符，结算即清；**不注入复审指令、不落盘、不产生回执**）；本回合命令命中 push 类（`git push` / `gh pr create` / `npm publish`，`--dry-run` 也算）时，**`auto` 档把 micro 升为 full 且不吃「微量豁免」**（升级判定先于豁免）；固定 `micro`/`full` 档不参与。默认关闭时连记录都不发生 = 零行为变化

核对：

| 声明 | 实码/实跑 | 结论 |
|---|---|---|
| 先于 waiver | 升级块位于 `shouldWaive` 前；第一次序列 waived→push→full | 真 |
| auto 才升级 | `cfg.mode==='auto'` 第一条件；固定 micro 保持 micro | 真 |
| 固定 full 不参与 | 已 full，升级 no-op；输出 full | 真 |
| 固定 micro 不参与 | 输出 micro，无 full | 真 |
| `--dry-run` 也算 | `git push --dry-run` 纯函数/运行态均 full | 真 |
| 不吃微量豁免 | 升级后 action full，`shouldWaive` 必 false；a 例 receipt=null | 真 |
| 默认 false 零行为 | `escalateOnPush:false` 仍 waived；记录不调用 | 真 |
| ≤20×300、结算即清、不注入/不落盘/不回执 | 3b-① 未改；本轮复算/隔离复查 | 真（历史通道语义） |
| 固定 micro/full 档不参与 | 运行态矩阵 | 真 |

`README` 计数仍是 `100` / `合计 105`（`README.md:207,219`），实际本单后为 gate **105** / 合计 **110**；见 F1。

---

## 6. 旧 lib 反证

```text
旧 lib = HEAD 3fa3525（无 shouldEscalateForPush / PUSH_RE）
old lib gate: ℹ tests 105 ℹ pass 103 ℹ fail 2

✖ shouldEscalateForPush: git push / gh pr create / npm publish match, noise does not
  TypeError: shouldEscalateForPush is not a function
✖ assemble: push-class command escalates an auto micro review to full (not waived)
  AssertionError: a push turn owes a review even though the diff is one line
✔ assemble: without escalateOnPush the same push turn stays waived (control)
✔ assemble: a non-push command does not escalate
✔ assemble: fixed micro mode is never escalated by a push command
```

- 真正驱动新码的是纯函数例 + 行为 a；行为 b/c/d 在旧 lib 上是**绿色控制/守卫**，不是新码驱动。
- 旧 lib 的 a 失败证明红线：1 行 edit + push 在旧码被 waiver；新码通过 §1/§2 的 full 输出修复了这个洞。
- `100 → 105` gate、`105 → 110` total；README/AGENTS 需要更新，见 F1。

---

## 7. 回归面与计数

```text
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: .../lib/client.js (3 modules, smoke-gated)
# BUILD_EXIT=0

env -u LD_PRELOAD npm test
# ℹ tests 110  ℹ pass 110  ℹ fail 0        [NPM_EXIT=0]

env -u LD_PRELOAD node --test test/gate.test.mjs
# ℹ tests 105  ℹ pass 105  ℹ fail 0        [GATE_EXIT=0]

env -u LD_PRELOAD node --test test/realloop.test.mjs
# ℹ tests 6  ℹ pass 6  ℹ fail 0            [REALLOOP_EXIT=0]

git diff --check                            # exit 0
```

- `npm test` 110 = gate 105 + client-bundle 3 + receipts-stats 2；worker 报告 §2.2/§6 的 110/105 正确。
- `lib/` 3 个文件（index/state/types state）与 src 同步，无 client 变化。
- realloop 6/6 通过；assemble 改动未破真时序装配。
- `git diff --check` 干净；未 commit。
- **README/AGENTS 计数**：实际应改为 **gate 105 / 合计 110**；当前仍是 100/105（F1）。

---

## 8. 规格对照

| 规格 | 证据 | 结论 |
|---|---|---|
| `shouldEscalateForPush(commands)` 纯函数 | `src/state.ts:252-254`；纯函数测试 | 完成 |
| `PUSH_RE` git push / gh pr create / npm publish | `src/state.ts:249`；正/负例 | 完成（尾部 shell 分隔符见 F3） |
| assemble 在 waiver 之前升级 | `src/index.ts:335-349`；先 waived 再 push 序列 | 完成 |
| 条件 auto + escalateOnPush + micro + should | `src/index.ts:339-344`；固定 micro/full/off 矩阵 | 完成 |
| `p.action='full'`；files/paths 不变 | `src/index.ts:347`；第一次序列 full 文本仍 1 文件 | 完成 |
| 测试纯函数 + 四行为 | `test/gate.test.mjs:856,1763,1785,1797,1808,1818` | 完成（覆盖缺口见 F4） |
| README 配置表 + 机制节 | `README.md:40,173` | 完成 |
| build + 全量测试 + lib 同步 | §7 | 完成；计数文档未同步（F1） |
| 不改 instruction/既有判定 | §4 | 完成 |

---

## 9. Findings

### F1 · minor | `README.md:207,219`；`AGENTS.md:20,49`

**事实**：本单新增 5 例后实际 gate 105 / total 110；README 的 Layout（`:207`）和 Commands（`:219`）仍写 `gate 100 ... 合计 105`，AGENTS 的 Layout/Commands（`:20`、`:49`）同样仍是 100/105。worker 报告 §2.2/§6 已写 110/105，但两份项目文档未同步。

**影响**：下一批基线、测试数审计与发布说明会继续读旧值；交付物出现“代码 110、文档 105”的口径漂移。

**最小修法**：lead 提交前把 README 两处 + AGENTS 两处（共四行）改为 **gate 105 / 合计 110**；本 closer 不改文档。

### F2 · minor | `AGENTS.md:68`

**事实**：AGENTS 架构第 2 条仍写“auto 档单文件微量 diff < exemptBelowLines ... 直接免审”，没有 push 升级例外；README 已更新，但 AGENTS 作为长期知识库仍给出会被本单推翻的绝对句。

**影响**：后续 agent 只读 AGENTS 时会以为 auto 小 diff 必然免审，漏掉 `escalateOnPush && auto && push` 的 full 先于 waiver 语义；与 README 冲突。

**最小修法**：在该句后加“（`escalateOnPush` 开启且本回合 push 类命中时先升 full，再判豁免）”；与 F1 的计数一起由 lead 收尾。`decisions.md` 不需要新增条目：本单是 task-7 规格实现，不是新的用户拍板；若项目要求所有机制变更入台账，再加一行指针即可，但不应伪造成用户决定。

### F3 · minor | `src/state.ts:249`

**事实**：`PUSH_RE` 尾 fence 是 `(\s|$)`；以下真实 push 命令**不命中**：

```text
shouldEscalateForPush(['git push; echo done'])       // false
shouldEscalateForPush(['git push&& echo done'])       // false
```

运行态：auto + escalateOnPush + 1 行 edit + `git push; echo done` → `section=none`、`receipt=waived`；`git push&&` 同样。`gh pr create;` / `npm publish;` 共享同一尾 fence，也属于同一类漏判。

**影响**：带 shell 分隔符的常见 push 形态仍会落回原 waiver，正是本单要堵的洞；方向是**漏判→micro/waived**，不会误拦、不会多审；但功能对常见命令形态不完整。

**最小修法**：把三处尾部 `(\s|$)` 改为允许 shell 分隔符的前瞻（例如 `(?=\s|$|[;&|)])`），并补 `git push;`、`git push&&`、`npm publish;` 的纯函数/行为测试；若决定保持保守正则，则至少把这条计入 README 已知边界/worker §5.4，不要宣称“命令命中”覆盖全部形态。

### F4 · info | `test/gate.test.mjs:856,1763-1830`；worker 报告 `:125-135`

**事实**：worker 的五例覆盖了 pure 正/负、a push→full、b 关闭→waived、c 非 push→waived、d 固定 micro；但以下已实测的分支没有回归断言：

- 先 waived 再 push 再 assemble（派令重点；我实跑通过，见 §1）；
- 固定 `full` / `off`（我实跑通过，见 §2）；
- `git  push` 双空格、push 在 250 字符前缀后（我实跑通过，见 §3）；
- `git push;` / `git push&&`（我实跑失败，F3 的核心）。

worker §5.4 的 miss 表也没有列 `git push;` / `git push&&`；§5.5 承认 fixed full/off 未单测。这些不是当前功能错误，但下一轮改 `PUSH_RE` 或 assemble 顺序时没有回归护栏。

**最小修法**：在现有行为 helper 上补 3–4 条（首 waive 再 push、fixed full、off、分号/&&），或至少补一条 `git push;` 红例和首 waive 序列；不要求改产品码。F3 修完后同批补。

---

## 10. 对收尾提交的建议

1. **计数**：README（`:207`、`:219`）和 AGENTS（`:20`、`:49`）改为 **gate 105 / 合计 110**；这是本单唯一必须改的文档计数。
2. **AGENTS**：除计数外，只补 `AGENTS.md:68` 的 push 升级例外；`decisions.md` 不需要新增，除非团队把本单视为新的用户拍板（当前没有这样的记录）。
3. **F3/F4**：若本轮不修 `PUSH_RE` 尾分隔符，至少把 `git push;`/`git push&&` 加入已知边界；若修，按 §9 的最小 lookahead + 三条测试，改后重跑 build、gate 105→108、npm 110→113（若加 3 例）并同步计数。
4. **提交前**：`git diff --check`、`env -u LD_PRELOAD npm test`、realloop 6/6、`lib/` 与 src 同步；不要只 commit `src` 漏 `lib/`。

---

## 11. 摘要（≤10 行）

- **PASS_WITH_FINDINGS，0 blocking**：升级块确实在 waiver 前；auto+escalateOnPush+micro+push→full，固定 micro/full/off 矩阵符合规格；1 行 edit + push 的洞已堵。
- 派令重点时序实跑通过：第一次 waived（`changedLines:1`）→ push 重新 arm → 第二次 **full section** 且无 `L1 快扫`；不是 major。
- `git  push`/prefix 250/--dry-run full；固定 micro 仍 micro、固定 full 仍 full、off 无 review；300/20 复算与 worker 一致。
- 旧 lib：105 tests / 103 pass / 2 fail；纯函数 + 行为 a 红，b/c/d 绿（控制/守卫），与 worker 自报一致。
- 回归：build 0；npm test 110/110（gate 105 + client 3 + stats 2）；realloop 6/6；diff 0；lib 同步。
- F1 minor：README/AGENTS 计数仍 100/105，应改 105/110；F2 minor：AGENTS:68 缺 push 例外；F3 minor：`git push;`/`git push&&` 仍 waived；F4 info：上述边界无回归测试。
- 建议 lead 提交前至少处理 F1，按团队口径决定 F3/F4；未改码、未 commit。
