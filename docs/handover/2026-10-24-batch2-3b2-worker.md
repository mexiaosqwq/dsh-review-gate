# Batch 2 · 3b-② worker 报告：push 类命令升级 full 判定（auto 档专享）

- 任务：task-7（Batch 2 · 3b-②，依赖 3b-①）
- 基线：HEAD `3fa3525`（3b-① 已入库）
- 日期：2026-10-24
- 席位：worker（实现席，不 commit）

**Status: DONE**

## 0. 文件清单（本单改动）

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/state.ts` | 手改 | 模块私有 `PUSH_RE`(:249) + 导出纯函数 `shouldEscalateForPush`(:252) |
| `src/index.ts` | 手改 | import(:40) + assemble 分支的升级守卫（:335-349，插在 waiver 之前） |
| `test/gate.test.mjs` | 手改 | 纯函数 1 例(:856) + 行为级 4 例(:1785 / :1797 / :1808 / :1818) + 辅助 `assemblePushTurn`(:1763) |
| `README.md` | 手改 | 配置表 `escalateOnPush` 行补全语义(:173) + 机制信号链第 2 条加升级与 waiver 先后(:40) |
| `lib/**`（3 个产物文件） | build 生成 | `lib/index.js`、`lib/state.js`、`lib/types/state.d.ts`，随单交付（未手改） |

`git diff --numstat`：

```
2	2	README.md
14	1	lib/index.js
12	0	lib/state.js
2	0	lib/types/state.d.ts
16	0	src/index.ts
14	0	src/state.ts
96	0	test/gate.test.mjs
```

## 1. 规格逐条对照

| # | 要求 | 落地 | 位置 |
|---|---|---|---|
| 1 | `PUSH_RE`（模块内私有）+ `shouldEscalateForPush(commands: readonly string[])` 任一命中即 true；dry-run / `cd x && git push` 天然命中、不额外排除 | ✅ 正则与派令逐字一致；`.some(c => PUSH_RE.test(c))`；无 `g` 标志（无 lastIndex 串态风险） | `src/state.ts:249-254` |
| 2 | assemble 分支在 **waiver 判定之前** 插入 `if (cfg.mode === 'auto' && cfg.escalateOnPush && p.action === 'micro' && shouldEscalateForPush(state.pushHistory)) p.action = 'full'` | ✅ 插在 `const changed = …` 之后、`if (changed !== null && shouldWaive({…}))` 之前；四条件与派令同序；`cfg.mode === 'auto'` 守卫保留（固定 micro 也产 `'micro'`，不靠 action 判） | `src/index.ts:335-349` |
| 3 | 硬约束：①顺序先于 waiver ②`cfg.mode === 'auto'` 不可省 ③不改 `decideReview`、不改指令文案、不把 pushHistory 注入任何文本 | ✅ ①由行为例 a 驱动证明（旧 lib 上 a 为 waived）；②由例 d（固定 micro）守卫；③`git diff src/instruction.ts` 为空、assemble 段文本未引用 `pushHistory`（升级只改 `p.action`，注入文本仍由 `reviewInstructionText` 生成） | 同上 |
| 4 | 测试：纯函数 5 hit + 3 miss；行为级 a/b/c/d（独立 agent id） | ✅ 纯函数用例多补了 `--force-with-lease`、多行、`cat git push.txt`、空串、混合历史；行为级 a=`push-a`、b=`push-b`、c=`push-c`、d=`push-d` | `test/gate.test.mjs:856`、`:1763-1830` |
| 5 | README：①配置表补全语义（auto 升 full、不吃豁免、固定档不参与、dry-run 也算；删「尚未接入」）②机制节信号链第 2 条加一句先后 | ✅ 两处都改；「升级判定本身尚未接入」已删 | `README.md:173`、`:40` |
| 6 | build、`env -u LD_PRELOAD npm test` 全绿、`git diff --check`、lib/ 一并交付、不 commit | ✅ 见 §2；未 commit | — |

## 2. 证据

### 2.1 红阶段（新测试打在旧 lib 上；旧 lib = 3b-① 构建产物）

```
✖ shouldEscalateForPush: git push / gh pr create / npm publish match, noise does not
  TypeError: shouldEscalateForPush is not a function
✖ assemble: push-class command escalates an auto micro review to full (not waived)
  AssertionError [ERR_ASSERTION]: a push turn owes a review even though the diff is one line
✔ assemble: without escalateOnPush the same push turn stays waived (control)
✔ assemble: a non-push command does not escalate
✔ assemble: fixed micro mode is never escalated by a push command
ℹ tests 5  ℹ pass 3  ℹ fail 2
```

诚实标注：b/c/d 三例在旧 lib 上是**绿**的——b/c 是对照组（证区分度），d 是 auto 专享守卫（旧码无升级逻辑天然满足）。真正驱动新码的是纯函数例与例 a；例 a 的红正是「1 行改动 + push 被 waived」这个洞的证据。

### 2.2 绿阶段

```
env -u LD_PRELOAD npm run build
  host lib sanity: apply() export OK
  client bundle: …/lib/client.js (3 modules, smoke-gated)

env -u LD_PRELOAD npm test
  ℹ tests 110  ℹ pass 110  ℹ fail 0      （基线 105 + 本单 5：gate 100→105）

env -u LD_PRELOAD node --test test/realloop.test.mjs
  ℹ tests 6  ℹ pass 6  ℹ fail 0          （真时序回归：assemble 分支改动未破装配/拦截）

git diff --check → 干净
```

## 3. 规格偏差清单

**做了但没被要求（3 项，均为测试/文档的必要配套）：**

1. `test/gate.test.mjs` 新增本地辅助 `assemblePushTurn`(:1763)：4 个行为例共用「起 fakeCtx → 建 git fixture → 发命令/写文件 → assemble → 读回执」流程，断言仍逐例独立（各例 agent id 独立、fixture 独立）。不用辅助则 4×25 行重复。
2. 纯函数例多 5 条边界（`--force-with-lease`、`git push --dry-run` 之外的 `cd x\ngit push`、`cat git push.txt`、空串、混合历史）——派令列了最小集，补的是同名函数的语义边界，不改契约。
3. 报告 §5 的边界实测（多行 / 300 截断 / 20 条上限）用 `~/tmp/3b2-probe*.mjs` 探针跑了 20+ 用例并把读数写进报告——派令要求「给实测结论」，探针脚本未进仓库（一次性）。

**被要求但没做：** 无。**没有顺手改** `BASH_WRITE_RE`（push 不是写模式启发式，升级是独立通道；派令未要求）。

## 4. 转述（≤3 句，给 closer / 后续单）

1. 升级点只有一处：`src/index.ts` assemble 分支、waiver 之前，条件 = auto + escalateOnPush + micro + 历史命中 push 类；它把 `p.action` 就地改成 `'full'`，之后所有下游（注入文案、steer、ack 回执的 action）自然按 full 走，无需第二处改动。
2. 判据是**本回合**命令历史（`pushHistory`，结算即清），所以升级只能发生在 assemble 时；跨回合「上一回合 push 过」不会升级下一回合——这是刻意语义，不是漏。
3. 升级后的 full 回合会走 `handleTurnStopping` 的 full 结算分支（`sessionFiles` 归零，src/state.ts:365），即 push 回合会顺带重置会话漂移计数；这是既有 full 语义的一致延伸，无需额外处理。

## 5. 残留风险（含派令点名的两项实测）

### 5.1 多行命令：**能命中**（实测）

| 命令 | 结果 |
|---|---|
| `git commit -m "wip"\ngit push origin main` | HIT |
| `git commit -m wip\r\ngit push origin main` | HIT |
| `gh pr view 1\ngh pr create --fill` | HIT |
| `'x'*350 + "\ngit push origin main"`（push 落在第 350 字符之后） | MISS（原因不是换行，是 300 字符截断，见 5.2） |

结论：`(^|\s)` 里的 `\s` 覆盖 `\n`/`\r`，多行脚本第二行的 push 正常命中。

### 5.2 300 字符截断：**会漏，边界实测在 push 起始索引 292/293 之间**

`recordPushHistory` 只留前 300 字符（head 截断），实测（命令 = N 个 `x` + `" git push origin main"`）：

```
pushStart=292 → HIT      pushStart=293 → MISS
pushStart=291 → HIT      pushStart=294 → MISS …（直到 301 全 MISS）
```

即 **`git push` 必须整体落在前 300 字符内（起始索引 ≤292）**。`push` 恰好跨 300 被切（如 295 个 `x` + push）→ 截断成 `git pus` → MISS。真实会话里 bash 命令极少 >300 字符，且 push 通常在命令尾部（若同时触发截断则整条命令属异常长脚本），故判为**可接受上限**并在此留档；如未来要堵，最小改法是记录时保留尾部片段（head+tail）而非只 head。

### 5.3 20 条上限：push 若是最旧一条会被挤掉（实测）

```
total=20（push 为第 1 条）→ historyLen=20, pushKept=true,  escalates=true
total=21（push 为第 1 条）→ historyLen=20, pushKept=false, escalates=false
```

一回合 21+ 条 bash 且 push 发生在最早一条时漏升级。实际形态通常相反（push 是收尾最后一条 = 最新 = 必留），故只留档不改。

### 5.4 正则已知漏判/误判（形态固定，均「漏 = 降级为 micro/waived」，不会误拦）

| 命令样例 | 结果 | 原因 |
|---|---|---|
| `sh -c 'git push'` / `bash -c "git push"` | MISS | 前后是引号，非 `\s`/`^`/`$` |
| `git -C ~/repo push origin main` | MISS | `git` 与 `push` 之间不是纯 `\s` |
| `cd x&&git push`（`&&` 后无空格） | MISS | `&` 不是 `\s` |
| `GIT PUSH` | MISS | 大小写敏感 |
| `ls # then git push`（注释里提及） | HIT | 宁多审的代价：可能多一次 full 复审 |

对齐用户拍板「宁多审」：漏判方向安全（最差退化为原行为），误判方向只多付一次复审税，不改正则。

### 5.5 未覆盖路径

- 固定 `full` 档 + push：本来就在 full，升级为 no-op（未单测，逻辑上是 `p.action==='micro'` 条件直接短路）。
- `off` 档：assemble 段根本不注入（pendingReview 不产生），升级无意义。
- 真机未验证：本单是纯 host 侧判定，与 3b-① 一致，默认 `escalateOnPush=false` 时零行为变化；真机面（开启后 push 回合是否真吃 full）留给 lead 拍板后重启 profile 验收。

## 6. 自检（提交前）

- 逐行读全 diff：守卫四条件顺序与派令一致；升级块严格位于 waiver `if` 之前（diff 可见其上方是 `changed` 计算、下方是 `shouldWaive`）。
- 爆炸半径：`shouldEscalateForPush` 唯二调用 = index.ts assemble + 测试；`PUSH_RE` 模块私有（未导出，`grep -c` 确认只在 state.ts 内出现）；`p.action` 只此一处被升级写回，waiver 与 `fullAtLines` 升格均读同一字段（顺序：push 升级 → waiver → 行数升格，后者对 full 为 no-op）。
- 测试批判：①实现与测试不共享错误假设（纯函数例独立枚举命中/未命中字符串；行为例从真实事件入口驱动）；②覆盖了 auto/固定 micro/关闭态/无关命令四象限，未覆盖 `full` 档与 `off` 档（见 5.5 说明）；③断言为真断言（例 a 断言 `'全面复审'` 出现且 `'L1 快扫'` 不出现 + 无 waived 回执文件；例 b 断言回执 `outcome==='waived'` 且 `changedLines===1`）。
- 回归面：gate 110/110、realloop 6/6、build 双闸门绿、diff-check 干净。
- 规格对照：5 条全落地，无缩水；加料 3 项见 §3。

---

## 6. lead 处理 closer findings（2026-10-24，提交前）

- **F1（计数）**：README/AGENTS 四处改为 gate **107** / 合计 **112**（本单 +5 例后再加 lead 补的 2 例）。
- **F2（AGENTS 架构句）**：auto 免审那句补了 push 升级例外（先升 full 再判豁免）。
- **F3（尾 fence 漏判）**：`PUSH_RE` 三处尾部 `(\s|$)` 改为 lookahead `(?=\s|$|[;&|)])`——`git push; echo done` / `git push&& …` 现在命中（旧正则实测 false），保留 `cat git push.txt` 不误判；纯函数正例补了这三种形态。
- **F4（覆盖缺口）**：补 2 例——`git push; …` 行为例、以及「先 waive 再 push 再 assemble」时序例（closer §1 手验过的那条，现在有护栏）；helper 顺手补了 git fixture 临时目录清理。
- 复验：`env -u LD_PRELOAD npm test` 112/112（gate 107）、build 零错、realloop 6/6、`git diff --check` 干净。
