# Batch 1 · Task 3（`receipts-stats.mjs` 审计统计）closer 复核报告

- 日期：2026-10-24
- 单号：R3（Batch1-T3，Batch 1 收尾单）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §4 + §11.5 + 交接书
- 被审对象：工作树未提交改动（`scripts/receipts-stats.mjs`、`test/receipts-stats.test.mjs`、`package.json`、`README.md` + 新 worker 报告）；HEAD = `a85ec7d`（T2 已提交）
- 岗位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE**

**结论：PASS**（0 blocking；F1 为 minor 级测试覆盖缺口，F2–F4 为 info；功能与真实数据口径均正确，可提交）。

---

## 0. 结论摘要

- §4 Step 1–6 逐条对上：计划用例逐字落地；脚本 = 计划代码 + §11.5 的 `BUCKETS/other` 分支 + 两处说明注释；`package.json` test 串三文件；README 用法行落在「开发」节（`README.md:210`）。
- 亲跑：`node --test test/receipts-stats.test.mjs` **2/2**；`npm test` **99/99**（gate 94 + client 3 + stats 2）；`npm run build` exit 0；真实 CLI exit 0（`total 1063`，`today.reviews 1`）。
- 真驱动：HEAD 树内无该模块 + 新测试 → **ERR_MODULE_NOT_FOUND / exit 1**；当前工作树同一测试 → **2/2 exit 0**。
- 独立复算：当前生产文件 **1063** 行；排除复核期间新增的最后一行（`2026-10-23T21:30:31.792Z`，ack/full/findings=0）后，**1062 / 629 / 375 / 4 / 54 / 40** 与 worker 报告逐项一致；当前 `other=40` 是「有 action 的 review 行」口径，全文件 `other=46`（多出 6 条缺失 severity 落在无 outcome 行）——§11.5 的 46 与 worker 的 40 都可解释，不是代码缺陷。
- 边界探针：`todayStart-1` 排除、`todayStart`/`+1` 计入、非数字 `ts` 排除；空文件/缺文件/坏 JSON 行 CLI 均 exit 0；非数组 findings 按 0；非四值/缺失 severity 进 `other`；费率/均值与计划公式一致。测试未把这些边界全部固化（F1），但手工探针全过。
- 行数/越界：script 98、test 69、package 98、README 229、worker 报告 174；tracked diff 仅 README 1/0 + package 1/1；`src/`、`lib/`、既有测试零改动。

---

## 1. diff 全读与 §4/§11.5 对拍

diff 全读：`scripts/receipts-stats.mjs`（98 行）、`test/receipts-stats.test.mjs`（69 行）、`package.json`、`README.md`；`git diff` tracked 部分 = 2 文件 2 增 1 删；两个新文件为 untracked。

| Step | 计划要求 | 实测 | 结论 |
|---|---|---|---|
| 1 | 写失败测试（计划用例） | `test/receipts-stats.test.mjs:1-36` 与 §4 Step 1 的 36 行代码**逐字相等**（Python compare = True） | 对上 |
| 2 | 跑测试确认 FAIL | HEAD 树 + 新测试 → `ERR_MODULE_NOT_FOUND` / exit 1（§4 预期形态） | 对上 |
| 3 | 写脚本（计划内嵌代码） | `scripts/receipts-stats.mjs` 98 行；与计划代码 diff 仅：BUCKETS/other、findings 分支、2 处注释（见 §2） | 对上 |
| 4 | 跑测试确认 PASS | stats 2/2；全量 99/99 | 对上 |
| 5 | `package.json` test 接入 | `package.json:39` 三文件：gate + client-bundle + receipts-stats | 对上 |
| 6 | README 加用法 | `README.md:210`，位于 `## 开发`（188 行）代码块；行文本与 §4 一致，§11.5 的「开发节」口径已落实 | 对上 |
| 7 | 全量测试 + 提交 | 全量 99/99、build 0；commit 未执行（岗位边界，正确移交 lead） | 按边界移交 |

接口核对：`summarize(rows, now = Date.now())` 返回 `{ total, today: { reviews, full, micro, zeroFinding, findings, bySeverity{critical,major,minor,info,other}, stopLoss, waived, fullRatio, zeroFindingRate, waiverRate, stopLossRate, avgDiffLines, avgChain } }`；CLI `node scripts/receipts-stats.mjs [receipts.jsonl]`，缺省 `~/.dsh/storages/review-gate/receipts.jsonl`。

---

## 2. 实现语义逐项核对（§4 代码 + §11.5）

- **today 窗口**：`midnight = new Date(now); midnight.setHours(0,0,0,0)`；`row.ts < todayStart` 跳过。`todayStart-1` 排除、`todayStart`/`+1` 计入（探针见 §5）。**没有上界**：`row.ts` 在 `now` 之后（甚至次日）仍会进入 today；详见 F2。
- **outcome 分桶**：`stop_loss`、`waived` 先于 `action` 判定，各自 `continue`；`action === undefined` 的行不进 `reviews`；其余有 action 的行计 review。`total` 另行统计所有 `typeof ts === 'number'` 行（含 waived/stop_loss/无 outcome），与计划一致。
- **findings**：`Array.isArray(row.findings) ? row.findings : []`；非数组按 0 条，不崩；`findings.length` 计总数，空数组计 `zeroFinding`。
- **severity**：四值 `critical/major/minor/info` 各入桶；其余（非对象 finding、缺失 severity、high/medium/low）全部入 `other`；`Σbuckets == findings`（review 行内）成立。
- **费率**：`fullRatio=full/reviews`、`zeroFindingRate=zeroFinding/reviews`、`waiverRate=waived/(reviews+waived)`、`stopLossRate=stopLoss/(reviews+stopLoss)`；分母 0 → `null`；`Math.round(x*1000)/1000`。
- **均值**：`avgDiffLines` 只收集 review 行的数字 `cost.diffLines`；`avgChain` 只收集数字 `cost.intercepts`；空样本 → `null`；1 位小数。
- **CLI**：`isMain` 用 `process.argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href`；真实 `node scripts/...` 命中；缺省路径 `homedir()/.dsh/storages/review-gate/receipts.jsonl`；`readFile(...).catch(() => '')` 缺文件降级空数组；按行 `JSON.parse` 失败静默丢弃；输出 `JSON.stringify(..., null, 2)`（§4 设计，无加料）。
- **与计划代码的唯一行为差异**：§11.5 要求 `other` 桶，故 `bySeverity` 的键集从 `SEVERITIES` 改为 `BUCKETS = [...SEVERITIES, 'other']`；findings 循环增加 `f && typeof f === 'object'` 守卫并落 `other`。其余保持计划原文。

---

## 3. 独立复算真实 receipts（不修改仓库）

一次性脚本：`~/tmp/r3-crosscheck.mjs` / `r3-refine.mjs`（只读 `receipts.jsonl`）。

当前文件（2026-10-24 05:30 左右）：

```text
lines 1063   badJson 0   noTs 0
acknowledged 630 · waived 375 · stop_loss 4 · no outcome key 54
actions(ack): micro 430 · full 200
findings(ack) 1039 · severity { critical 13, major 118, minor 323, info 545, other 40 }
other detail: high 6 · medium 16 · low 15 · missing 3
```

排除复核期间新增的最后一行（`ts 2026-10-23T21:30:31.792Z`；outcome acknowledged，action full，findings `[]`）：

```text
lines 1062   ack 629   waived 375   stop_loss 4   no outcome 54
actions(ack): micro 430 · full 199
findings 1039 · severity { critical 13, major 118, minor 323, info 545, other 40 }
other detail: high 6 · medium 16 · low 15 · missing 3
```

**与 worker 报的 1062 / 629 / 375 / 4 / 54 / 40 逐项一致**。当前 1063/630/full200 的差异 = 那一行新增 full ack（0 findings），不是统计漂移；§11.2 基线 1053/620/375/4 的 +9 ack 来自 T1–T3 期间，另 +1 来自复核期间，waived/stop_loss 逐字不变。

**`other` 的 46 vs 40 解释（纠正 worker 的「行数口径」猜测）**：

```text
全文件 findings（含无 outcome 行） 1058；other 46 = high 6 + medium 16 + low 15 + missing 9
有 action 的 review 行 findings      1039；other 40 = high 6 + medium 16 + low 15 + missing 3
```

9 条缺失 severity 中，**6 条在无 outcome 行、3 条在 acknowledged 行**；`summarize` 只统计有 action 的 review 行，故 6 条不进入今日 `bySeverity`。§11.5 的 46 是「全文件/全 finding」口径，worker 的 40 是「review 行」口径，二者不是行数与 finding 数的差别。另：37 条 high/medium/low 实际是 **14 行中的 37 条 finding**（不是 37 行）。

**非数组 findings**：全文件有 4 行，值分别为 `5/0/0/3`，全部无 outcome key（action 为 full/micro/micro/full）；`summarize` 按 0 条处理、不崩；它们不在 ack findings 统计内。

---

## 4. 亲跑与真驱动

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
# ✔ 2 tests  ℹ pass 2  ℹ fail 0                    [exit 0]

env -u LD_PRELOAD npm test
# ℹ tests 99  ℹ pass 99  ℹ fail 0                  [exit 0]
# gate 94 + client-bundle 3 + stats 2

env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)   [exit 0]
# build 后 git status 不变：无 lib/ 改动
```

**HEAD 无模块的红证据**（独立复现）：

```sh
git archive HEAD | tar -x -C ~/tmp/r3-head
cp test/receipts-stats.test.mjs ~/tmp/r3-head/test/
git ls-tree -r --name-only HEAD | grep receipts-stats   # 无输出
env -u LD_PRELOAD node --test ~/tmp/r3-head/test/receipts-stats.test.mjs
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/r3-head/scripts/receipts-stats.mjs'
# ℹ tests 1  ℹ pass 0  ℹ fail 1                    [exit 1]
```

当前工作树同一测试 2/2 / exit 0。红是计划 Step 2 预期的「模块尚未创建」形态，不是断言失败；测试本身确实随实现出现而由红转绿。

**真实 CLI**：

```sh
env -u LD_PRELOAD node scripts/receipts-stats.mjs
# total 1063
# today: reviews 1 / full 1 / micro 0 / zeroFinding 1 / findings 0
#        fullRatio 1 / zeroFindingRate 1 / waiverRate 0 / stopLossRate 0
#        avgDiffLines 301 / avgChain 0                    [exit 0]
```

worker 在 05:25 实跑时 today 全零（当时最后一行尚未出现）；05:30 新增一行 full ack 后，当前 CLI 的 today=1，与新增行时间一致，不是口径变化。

---

## 5. 边界探针与测试覆盖矩阵

一次性探针 `~/tmp/r3-probe.mjs`（`summarize` 直接调用）结果：

| 边界 | 实测 | 是否被仓库测试覆盖 |
|---|---|---|
| 空文件 / 缺文件 | CLI 均 exit 0；total 0，rates/avg 全 null | **否**（手工验证） |
| 坏 JSON 行 | 与一条合法行混排：bad 被丢弃，total 1，exit 0 | **否**（手工验证） |
| 非数组 findings | `findings: 3` 的 review 行 → findings 0 / zeroFinding 1 | **是**（`receipts-stats.test.mjs:59`） |
| `ts` 非数字 | 行被排除出 total 与 today；不崩 | **否**（手工验证） |
| 跨午夜精确边界 | `todayStart-1` 排除；`todayStart`、`todayStart+1` 计入 | **否**（测试只有 yesterday 08:00 / today 08:00 的粗粒度前后行，未测 00:00:00 与 -1ms） |
| 非对象 finding | `[null, 'x', {severity:'major'}]` → major 1 / other 2 / findings 3 | **否**（手工验证） |
| rates | 计划样例：fullRatio .5 / zeroFindingRate .5 / waiverRate .333 / stopLossRate .333 | **否**（测试只断言 avg，未断言四个 rate） |
| avg 空样本 | 空/缺文件 → avgDiffLines/avgChain null | **否**（手工验证） |
| today 未来行 | `summarize(rows, 2026-10-23 23:59)` 会算入 2026-10-24 05:30 的行（见 F2） | **否** |

**F1 的直接证据**：worker 报告 `:140` 写「`now` 边界（跨午夜的 `todayStart`）……均有断言」，但测试第一例的 `today` 是 08:00、`yesterday` 是 08:00，没有精确 `todayStart` 边界行；CLI 的 empty/missing/bad-line 未进 `node --test`（本报告 §5 手工探针验证）。这是覆盖/自述问题，不是当前功能错误——上述手工探针全部通过。

---

## 6. 集成交付、行数账与越界

- `package.json:39`：`node --test test/gate.test.mjs test/client-bundle.test.mjs test/receipts-stats.test.mjs`；三文件齐全；`npm test` 99/99。
- `README.md:210`（`## 开发` 节代码块内）：`node scripts/receipts-stats.mjs [receipts.jsonl]   # 今日 full/micro、零发现率、severity、均值`；与计划文本一致。
- 输出为 §4 规定的 pretty JSON，字段有 `total`/`today` 结构，未加 `--date`/CSV/额外说明参数（无加料）。
- 行数：`scripts/receipts-stats.mjs 98`、`test/receipts-stats.test.mjs 69`、`package.json 98`、`README.md 229`、worker 报告 174；与 worker 报告一致。
- `git diff --numstat`：`README.md 1/0`、`package.json 1/1`；两个新文件 untracked；`src/`、`lib/`、`test/gate.test.mjs`、`test/client-bundle.test.mjs` 零改动；`git diff --check` clean。
- README 存量数字漂移：`:198` 树状注释与 `:208` 命令块仍写 gate **92 例**，当前 gate 94（T2 后）；worker 报告 §7 已披露，属既有文档，不影响 T3 用法行（F3）。

---

## 7. Findings

**F1 · minor | `test/receipts-stats.test.mjs:5-69`；worker 报告 `:140`**
事实：两例测试覆盖了主路径、`other` 桶、非数组 findings，但未覆盖精确跨午夜 `todayStart` 边界、`ts` 非数字、空文件/缺文件/坏 JSON CLI；worker 报告却称「`now` 边界……均有断言」。
影响：若未来有人改坏 `typeof row.ts` 守卫或 `< todayStart` 边界，现有测试不会红；CLI 的读取/解析降级也无回归护栏。当前实现经手工探针全部正确。
最小修法（可选，不阻断）：扩展现有两例（不新增测试数）——加一行 `ts: todayStart-1` 与一行 `ts: todayStart`（以及一行 `ts:'bad'`），断言 total/reviews；CLI 部分用 `spawnSync` 跑空文件/坏 JSON/缺文件各一次。若坚持计划的最小测试范围，则至少把 worker 报告 `:140` 的覆盖声明改为「手工验证，非测试覆盖」。

**F2 · info | `scripts/receipts-stats.mjs:37`（today 窗口）**
事实：`if (row.ts < todayStart) continue` 只有下界，没有上界；当前生产数据新增的 `2026-10-24 05:30` 行会被 `summarize(rows, 2026-10-23 23:59)` 计入，输出 reviews 15/full 5，而不是 worker 快照的 14/full 4。计划代码本身即如此，worker 未偏离。
影响：把 `now` 钉到历史时刻做「当日」统计、或回执时间戳因时钟偏移落在未来时，today 会被高估；CLI 使用当前 `now` 时只在未来时间戳场景有影响。
最小修法（规格层选择，需 lead 决定）：在窗口加 `const tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate()+1); if (row.ts >= tomorrow.getTime()) continue`（按自然日），或按 `row.ts > now` 截断（按 now 时刻）；本单按 §4 原文不擅自改。

**F3 · info | `README.md:198,208`**
事实：README 仍写「gate 单元 92 例」，实际 gate 94（`npm test` 99 = 94+3+2）；T3 新增用法行位于同一代码块。
影响：用户会读到过时的测试计数；新用法行本身正确，不涉及 T3 代码。
最小修法：Batch 1 收尾时把两处 92 改为 94（命令块可写「99 例（gate 94 + client 3 + stats 2）」）；属既有 T2 文档漂移，不是 T3 回归。

**F4 · info | worker 报告 `:103,171` + `scripts/receipts-stats.mjs:8`**
事实：worker 把 §11.5 的「9 vs 3」解释为「按行/按 finding 口径差」；实际是 **9 条缺失 severity finding：6 条在无 outcome 行、3 条在 acknowledged 行**，`summarize` 只统计 review 行，故全文件 other 46 / review 行 other 40。脚本注释把「37 findings」写成「37 rows」（实际 14 行、37 findings）。
影响：审计报告的口径说明会误导后续维护者；代码行为正确。
最小修法：更正报告说明与脚本注释（`37 rows` → `37 findings`；注明 46=全文件、40=review 行），无需改行为。

---

## 8. 转述要点（≤3 句）

1. T3 达标：脚本/测试/package/README 四处集成完整，stats 2/2、全量 99/99、build 0、真实 CLI exit 0；HEAD 无模块时测试确证 exit 1，当前绿；真实回执 1062/629/375/4/54/40 与 worker 报告逐项对上（当前 1063 只因复核期间新增一行 full ack）。
2. 唯一 minor 是测试覆盖/自述：精确 `todayStart` 边界、`ts` 非数字、空/缺/坏行 CLI 未进测试（手工探针均过）；另三条 info：today 无上界会算入未来行，README 仍写 gate 92 例（实际 94），worker 的 `other` 46/40 口径说明应更正。
3. 语义与 §4/§11.5 一致，可提交；`other` 40 是 review 行口径、46 是全文件口径（6 条缺失 severity 在无 outcome 行），worker 报告里的「行数口径」猜测应更正。

---

## 9. 残留风险

- 测试未固化精确午夜边界与 CLI 读取降级（F1）；当前手工证据充分，但未来回归防护弱。
- `today` 无上界（F2）：历史 `now`/未来时钟偏移会高估；计划未定义上界，需 lead 决定是否补。
- README 存量 92 例（F3）与 worker 报告口径说明（F4）是文档问题，不影响运行。
- 真实数据在复核期间仍在增长；本报告以「当前 1063 行 + 排除新增行 = worker 快照 1062」双口径对拍，后续数字会继续漂移。

---

## 10. 复核者改动与临时物

- 仓库内唯一新增：本报告（`docs/handover/2026-10-23-batch1-t3-closer.md`）。
- 未修改任何 `src/`、`lib/`、`scripts/`、`test/`、`README.md`、`package.json`；未 commit。
- `~/tmp/` 一次性物（可删）：`r3-crosscheck.mjs`、`r3-refine.mjs`、`r3-probe.mjs`、`r3-head/`、`r3-cli-*.out`、`r3-empty.jsonl`、`r3-badline.jsonl`、`r3-head-red.out`、`r3-current-green.out`。
