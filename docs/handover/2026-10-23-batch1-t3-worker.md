# Batch 1 · Task 3（`receipts-stats.mjs` 审计统计）worker 报告

- 日期：2026-10-23/24（跨午夜实跑，见 §2 说明）
- 单号：task-3（Batch1-T3，Batch 1 收尾单）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §4 Task 3 + §11.5 修订 + 交接书
- 岗位：worker（实施岗；不 commit、不跑浏览器）

**Status: DONE**

---

## 0. 一句话结果

新建 `scripts/receipts-stats.mjs`（`summarize(rows, now)` + CLI 缺省读 `~/.dsh/storages/review-gate/receipts.jsonl`），按 §11.5 加 `other` 桶吸收历史非四值/缺失 severity；新建 2 例测试（计划用例 + other 桶用例），先红（`ERR_MODULE_NOT_FOUND`）后绿；`npm test` **99/99**（gate 94 + client 3 + stats 2），build 零错；真实回执实跑 total = **1062**，与 §11.2 基线（1053 / 620 / 375 / 4）单调性一致。

---

## 1. 实现与规格对照（§4 Step 1-7 + §11.5 修订）

| Step | 计划要求 | 实际落点 | 结论 |
|---|---|---|---|
| 1 | 写失败测试 | `test/receipts-stats.test.mjs:5-34`（计划用例逐字）+ `:36-69`（§11.5 other 桶用例，新增） | 完成 |
| 2 | 跑测试确认 FAIL | 见 §2「红」——`ERR_MODULE_NOT_FOUND`（`scripts/receipts-stats.mjs` 不存在），与计划预期一致 | 完成（红） |
| 3 | 写脚本（计划内嵌代码） | `scripts/receipts-stats.mjs`（98 行）：计划代码逐字落地 + `BUCKETS`/`other` 桶 | 完成 |
| 4 | 跑测试确认 PASS | stats 2/2 PASS | 完成 |
| 5 | `package.json` test script 接入 | `package.json:39`（追加 `test/receipts-stats.test.mjs`） | 完成 |
| 6 | README 加用法 | **按 §11.5 改到「开发」节**（计划写的 Commands 节不存在）：`README.md:210` 命令块末行 | 完成（修订口径） |
| 7 | 全量测试 + 提交 | 全量 99/99；**commit 未执行**（岗位边界，lead 统一提交） | 按边界移交 |

**§11.5 修订落地**

| 修订 | 落地 |
|---|---|
| `other` 桶吸收 high/medium/low 与缺失 severity | `BUCKETS = [...SEVERITIES, 'other']`；findings 循环：四值 → 对应桶，其余（含非对象 finding）→ `other`；测试断言 `other=4`（high/medium/low/缺失）+ 不变量 `Σbuckets == findings` |
| README 改「开发」节 | 已落 `README.md:210`（开发节命令块内） |
| `findings` 非数组按 0 条处理 | 计划原码已含 `Array.isArray(...) ? ... : []`；保持，测试用 `findings: 3` 的脏行断言 findings=0 / zeroFinding=1 |

**Interfaces 核对**：`summarize(rows: unknown[], now = Date.now())` → `{ total, today: { reviews, full, micro, zeroFinding, findings, bySeverity{critical,major,minor,info,other}, stopLoss, waived, fullRatio, zeroFindingRate, waiverRate, stopLossRate, avgDiffLines, avgChain } }`；CLI `node scripts/receipts-stats.mjs [receipts.jsonl]`，缺省路径 = `~/.dsh/storages/review-gate/receipts.jsonl`。

---

## 2. 真实验证命令与输出要点（全部卸垫片）

**红（只落测试，脚本尚不存在）**

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/dsh-review-gate/scripts/receipts-stats.mjs'
#   imported from …/test/receipts-stats.test.mjs
# ✖ test/receipts-stats.test.mjs (404.75ms)
# ℹ tests 1  ℹ pass 0  ℹ fail 1
```

失败形态与计划预期一致（模块不存在，非断言失败）。

**绿**

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
# ✔ receipts stats: today counts reviews, findings, severity, zero-finding (8.2ms)
# ✔ receipts stats: non-four-value and missing severities land in the other bucket (0.87ms)
# ℹ tests 2  ℹ pass 2  ℹ fail 0

env -u LD_PRELOAD npm test
# ℹ tests 99  ℹ pass 99  ℹ fail 0   （gate 94 + client-bundle 3 + stats 2）

env -u LD_PRELOAD npm run build      # 本轮不动 src，仅作回归
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)
```

**真实数据实跑（缺省路径）**

```sh
env -u LD_PRELOAD node scripts/receipts-stats.mjs
# {
#   "total": 1062,
#   "today": { "reviews": 0, ..., "bySeverity": {critical:0,major:0,minor:0,info:0,other:0}, ... }
# }
```

**为什么 `today` 全零**：执行时刻为 2026-10-24 05:25（已过午夜），而最后一批回执集中在 10-23；`summarize` 只统计 `now` 当日，故 1062 条历史行全部落在 `todayStart` 之前。这是预期语义，不是缺陷。

**当日语义旁证（同一模块，`now` 钉到 2026-10-23 23:59，真实数据）**

```text
reviews 14 / full 4 / micro 10 / zeroFinding 8 / findings 17
bySeverity { critical 0, major 0, minor 4, info 13, other 0 }
fullRatio 0.286 / zeroFindingRate 0.571 / avgDiffLines 49.8 / avgChain 0
```

**与 §11.2 基线交叉核对（整文件口径，旁证脚本 `~/tmp/rg-stats-crosscheck.mjs`，不进仓）**

```text
lines 1062   badJson 0   noTs 0
outcome: acknowledged 629 · waived 375 · stop_loss 4 · (无 outcome 键) 54
actions(among acknowledged): micro 430 · full 199
findings 1039 · severity { critical 13, major 118, minor 323, info 545, other 40 }
other 明细: high 6 · medium 16 · low 15 · 缺失 3   （6+16+15+3 = 40）
```

- 与 §11.2（1053 行 / ack 620 / waived 375 / stop_loss 4）对比：**waived 与 stop_loss 逐字相同**，总行数 +9 且 ack +9（620→629），54 条无 outcome 行不变——增长全部来自 T1–T3 期间的新 ack，单调性自洽。1062 = 629 + 375 + 4 + 54 ✓。
- `other` 桶实测 40 条 finding（37 条非四值 high/medium/low + 3 条缺失），§11.5 所说「37 条 + 9 条缺失」的 37 与实测完全一致；「9」与实测 3 的差异疑为行数口径（按行 vs 按 finding），非代码问题，记录在案。
- 脏数据核对：全文件恰有 **4 行** `findings` 为非数组（`5 / 0 / 0 / 3`），均在无 `outcome` 键的行内；`summarize` 对它们按 0 条处理、不崩（旁证脚本确认行数，正因这 4 行没有 outcome，才不在上面的 ack 统计里）。

**缺省文件不存在**

```sh
env -u LD_PRELOAD node scripts/receipts-stats.mjs ~/tmp/nonexistent-receipts.jsonl
# total 0，today 各计数 0、比率与均值 null（readFile catch → '' → 空数组），退出码 0
```

---

## 3. 文件变更清单（`wc -l` 实测）

| 文件 | 行数 | 变更（`git diff --numstat`） |
|---|---|---|
| `scripts/receipts-stats.mjs` | 102 | 新建（untracked；初版 98，返工 §8 加半开窗 +4 行） |
| `test/receipts-stats.test.mjs` | 91 | 新建（untracked；初版 69，返工 §8 加边界断言 +22 行） |
| `package.json` | 98 | +1 / −1（test script 追加文件） |
| `README.md` | 229 | +1 / −0（开发节命令块加一行） |

```text
$ git status --porcelain
 M README.md
 M package.json
?? scripts/receipts-stats.mjs
?? test/receipts-stats.test.mjs
```

**未改 `src/`、未动 `lib/`**（本轮无 TS 改动；`lib/` 保持 T1/T2 构建态）——符合派令硬约束。

---

## 4. 收尾复审（AGENTS.md §10.5 五步）

1. **diff 全读**：两个新文件逐行读过；`package.json` 仅 test script 一行；README 仅命令块 +1 行。重点核对：①`other` 分支——非对象 finding（字符串/数字）也落 `other`（`f && typeof f === 'object'` 守卫），保证 `Σbuckets == findings` 恒成立；②`stop_loss` / `waived` 分支先于 `action` 判定（waived 行不带 action，若顺序反了会被 `continue` 吞掉）；③`total` 只数 `typeof ts === 'number'` 的行，与逐行解析容错一致；④`isMain` 用 `pathToFileURL(process.argv[1]).href` 比对，避免 `file://` 前缀误判。
2. **爆炸半径**：`summarize` 是新导出（仓内消费方仅新测试 + 自身 CLI），无既有调用方；`package.json` test script 变更只影响 `npm test` 的收集集（已实测 99 例全绿，既有 97 例零回归）；README 改动是纯文档。全仓 grep `summarize` 无第三方引用。
3. **测试批判**：①共享错误假设——测试断言的是「统计口径」而非「实现细节」，且红证据来自模块缺失（构造性），另用真实回执旁证（§2 交叉核对）验证口径，不是循环验证；②覆盖缺口——`now` 边界（跨午夜的 `todayStart`）、脏行（非数组 findings）、非四值 severity、缺失 severity、waived/stop_loss 分桶均有断言；未测 `cost.diffLines` 非数字/缺失（计划用例只给数字；`typeof` 守卫是防御性写法，缺测可接受但记录）；③断言非恒真——`other=4`、`findings=5`、`Σ==findings` 都是「实现错误即红」的真断言（初版若漏掉 other 分支，第一条断言直接失败）。
4. **回归面**：`npm test` 99/99（含既有 gate 94 + client 3）；`npm run build` 零错。
5. **规格对照**：§4 Step 1-6 全覆盖；Step 7 的 commit 按岗位边界移交；§11.5 两条修订（other 桶、README 开发节）均落地；未加料（无 `--date` 参数、无 CSV/JSON 输出选项——计划未要求）。

---

## 5. 规格偏差清单

| # | 原文要求 | 实际做法 | 理由 | 影响面 |
|---|---|---|---|---|
| 1 | §4 Step 1 只给 1 个用例 | 计划用例逐字落地 + 新增 1 例 other 桶用例 | §11.5 第 2 条要求 other 桶（lead 明确"§4 Step 1 用例 + other 桶断言"）；独立用例便于定位失败 | 测试数 +2（97 → 99） |
| 2 | §4 Step 6「README 的 Commands 节」 | 改到「开发」节命令块 | README 无 Commands 节（§11.5 已订正） | 无 |
| 3 | §4 Files 未提 `other` | `BUCKETS`/`other` 桶 + 注释 | §11.5 第 2 条 | 输出多一个 `bySeverity.other` 键 |
| 4 | 派令写「gate 95 + client-bundle 3」 | 实测 gate **94** + client 3 = 97 基线，本单后 99 | T2 结束时实际为 94 + 3（T2 报告 §2 亦记 97）；派令数字疑为笔误 | 报告按实测口径；建议 lead 提交时留意 |
| 5 | §4 Step 7 `git commit` | 未执行 | 岗位边界：成员不 commit | 变更留在工作区，待 lead 提交 |

无其他偏差；无缩水。

---

## 6. 转述要点（≤3 句）

1. 新增 `node scripts/receipts-stats.mjs [receipts.jsonl]`：输出当日 full/micro 分布、零发现率、severity 分桶（含 `other`）、止损/豁免计数与 diff 行/链长均值；缺省读生产回执，文件不存在输出全零而不报错。
2. 历史口径漂移不再被静默丢弃——`high/medium/low` 与缺失 severity 统一进 `other`（真实数据实测 40 条：37 条非四值 + 3 条缺失），非数组 `findings` 脏行按 0 条计；测试先红后绿，全量 99/99。
3. 默认动作建议：lead 复核后提交 4 个文件（2 新建 + package.json + README）；`lib/` 本轮无变更不需一并提交；真实回执 total 1062 与 §11.2 基线单调性自洽（waived 375 / stop_loss 4 逐字相同）。

---

## 7. 残留风险

- **CLI 只统计「当日」**：跨午夜运行会得到全零 today（本次实跑即如此）；若需历史区间统计，需另行扩展参数（计划未要求，未擅自加）。
- **`§11.5` 的「9 条缺失」与实测 3 条不符**：疑为按行/按 finding 的口径差；已在 §2 记录实测值，不影响代码。
- **`avgChain` 语义**：只对 `cost.intercepts` 为数字的行取均值；缺失该字段的行被跳过（不是按 0 计），当日样本 14 例时为 0 需结合该字段来源解读。
- **README 存量数字过时**：`README.md:208` 仍写「gate 单元 92 例」、`:197-198` 树状注释同款（T1/T2 后实际 94）。属既有文档漂移，不在本单范围，未擅自修改——建议 lead 在 Batch 1 收尾提交时一并订正。
- **真机未验**：本单是纯脚本 + 测试 + 文档，无宿主行为变化；无需重启 profile。

---

## 8. 返工（closer F1/F2，2026-10-23 lead 裁定）

### 8.1 F2 采纳：`today` 改为半开区间 [todayStart, todayEnd)

`scripts/receipts-stats.mjs:21-25,41`：

```js
const todayStart = midnight.getTime()
// Half-open window: without the upper bound a row stamped in the future
// (clock skew, hand-edited log, a stale now argument) would be counted as
// "today" forever.
const todayEnd = todayStart + 24 * 60 * 60 * 1000
...
if (row.ts < todayStart || row.ts >= todayEnd) continue
```

真实触发条件：日志里出现未来时间戳（时钟漂移/手改/测试传旧 `now`）时，旧实现会把它们永久算进「当日」，`reviews`/`full`/`micro` 等指标只增不减。生效防护 = 循环守卫（上界）而非声明层。

### 8.2 F1 部分采纳：同一用例内补 4 条边界断言（未扩 API、未新增用例）

`test/receipts-stats.test.mjs:37-58`（仍在计划用例 1 的 `test()` 体内，追加第二个 `summarize()` 调用，计划给定断言零改动）：

```js
const todayStart = new Date(2026, 9, 22, 0, 0, 0).getTime()
const todayEnd = todayStart + 24 * 60 * 60 * 1000
const edge = summarize([
  { ts: todayStart, outcome: 'acknowledged', action: 'micro', findings: [] },        // ① 计入
  { ts: todayStart - 1, outcome: 'acknowledged', action: 'full', findings: [{ severity: 'critical' }] }, // ② 不计入
  { ts: todayEnd, outcome: 'acknowledged', action: 'micro', findings: [] },          // ③ 未来，不计入
  { ts: 'nope', outcome: 'acknowledged', action: 'micro', findings: [] },            // ④ 非数字，跳过
], now)
assert.equal(edge.total, 3, 'non-numeric ts is skipped from total')
assert.equal(edge.today.reviews, 1, 'only [todayStart, todayEnd) rows count as reviews')
assert.equal(edge.today.micro, 1, 'the exact-midnight row is inside the window')
assert.equal(edge.today.full, 0, 'yesterday 23:59:59.999 is outside the window')
assert.equal(edge.today.bySeverity.critical, 0, 'outside-window findings never enter bySeverity')
```

**先红（F2 未修时）**：

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
# ✖ receipts stats: today counts reviews, findings, severity, zero-finding (12.69ms)
#   AssertionError [ERR_ASSERTION]: only [todayStart, todayEnd) rows count as reviews
# ℹ tests 2  ℹ pass 1  ℹ fail 1
```

失败点正是 ③（未来行被计入 → reviews 2 ≠ 1），证明断言有区分度；修脚本后全绿。断言 ②（`todayStart - 1`）在旧实现下已为真（下界早有），保留作回归护栏；断言 ④ 用 `total 3` 证明非数字 ts 不进 total。

### 8.3 返工后验证（全部卸垫片）

```sh
env -u LD_PRELOAD node --test test/receipts-stats.test.mjs
# ✔ today counts reviews, findings, severity, zero-finding
# ✔ non-four-value and missing severities land in the other bucket
# ℹ tests 2  ℹ pass 2  ℹ fail 0

env -u LD_PRELOAD npm test
# ℹ tests 99  ℹ pass 99  ℹ fail 0

env -u LD_PRELOAD node scripts/receipts-stats.mjs     # 真实回执
# exit 0 · total 1064 · today 各计数为 0（跨午夜 + 无当日回执，预期）
```

（`total` 由 1062 → 1064 是两次新回执落盘所致，非代码行为变化。）

### 8.4 返工后文件规模

| 文件 | 行数 | 相对初版 |
|---|---|---|
| `scripts/receipts-stats.mjs` | 102 | +4（半开窗 + 注释） |
| `test/receipts-stats.test.mjs` | 91 | +22（边界断言块） |

### 8.5 返工增量复审（五项）

1. **diff 全读**：仅 2 处改动——脚本 +5 行（含 1 行守卫改写）、测试 +22 行；无复制粘贴残留、无未用变量（`todayEnd` 两处都用到）、`todayStart` 在测试内与 `now` 同日（10-22）自洽。
2. **爆炸半径**：`summarize` 签名未变，新增 `todayEnd` 为局部常量；唯一行为变化 = 未来时间戳不再计入当日（CLI 与测试两侧同源）；真实回执上无未来行（`ts` 最大值 < now），故 total/今日语义对生产数据不变。
3. **测试批判**：新断言全部可失败（先红已证 ③）；① 午夜整点计入、② 前一毫秒排除、③ 次日零点排除、④ 非数字跳过——四条边界各有对应断言；未覆盖 DST 时区（本机 Asia/Shanghai 无夏令时；若未来跨时区部署，`todayStart + 24h` 需改日历日计算，记入残留风险）。
4. **回归面**：stats 2/2 + 全量 99/99 + CLI 实跑 exit 0。
5. **规格对照**：F2 逐字按裁定落地；F1 四条边界断言齐全、未扩 API、未新增测试用例、计划给定断言未改；F3（README 92 例）/F4（other 46 vs 40 口径）按裁定不归本岗，未触碰。
