# Batch 1 · Task 2（micro/full 提示词加「审查纪律」）closer 复核报告

- 日期：2026-10-23
- 单号：R2（Batch1-T2；task-2）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §3 + §11.5 + 交接书
- 被审对象：工作树未提交改动（4 modified + 1 worker 报告），HEAD = `5a1a7a6`（T1 已提交）
- 岗位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE**

**结论：PASS**（0 blocking findings；下列 F1/F2 为 info 级可选加固，不阻断提交。）

---

## 0. 结论摘要

- §3 Step 1-6 逐条对上：micro 在「边界漏判；」与「汇报时」之间纯插入一段；full 在首行与「0.」之间只加一行；两档 5 个关键词各 5/5；`reviewInstructionText` 签名/函数体/既有调用方零变更；step 5「证据不足降 confidence 不否决」字节不变；README 句尾补句与计划原文逐字一致。
- 亲跑：`npm run build` exit 0；`npm test` **97/97**（gate 94 + client 3）；新用例单跑 1/1；`realloop` 6/6。
- 真驱动反证：HEAD 旧 `lib/instruction.js` 的 5 个关键词命中数**全为 0**；用 HEAD lib 跑新测试 = **1 fail / exit 1**（`micro: scope limited to this diff`）；同一测试体对 worktree lib = 1 pass / exit 0。
- 反向 diff 已证明「只插不改」：删除新增测试块后测试文件与 HEAD 逐字节相等；逆转两处指令编辑后 `src/instruction.ts` 与 HEAD 逐字节相等；去掉 README 追加句后与 HEAD 逐字节相等。
- braceGuard：新增文本 `{{` / `}}` 均为 0；assemble 注入路径仍为 `braceGuard(reviewInstructionText(...) + diffSection + bashSection)`（`src/index.ts:366`）。
- 行数账：worker 报告 152 行与实测一致；`git diff --numstat` = README 1/1、lib/instruction.js 2/1、src/instruction.ts 2/1、test 14/0，测试文件 0 删除。

---

## 1. diff 全读与 §3 逐条对拍

diff 全读覆盖：`README.md`、`src/instruction.ts`、`test/gate.test.mjs`、`lib/instruction.js`（`git diff` 全文，4 文件 19 增 3 删；`lib/index.js`、`lib/client.js`、`src/index.ts` 无变更）。

| Step | 计划要求 | 实测落点 | 结论 |
|---|---|---|---|
| 1 | 加 `instruction: precision discipline present in both tiers` | `test/gate.test.mjs:547-559`（分节注释 547，用例 549-559，代码逐字取自 §3） | 对上 |
| 2 | build 后过滤测试确认 FAIL | 见 §3：HEAD-lib 反证 exit 1，断言落 `micro: scope limited to this diff` | 对上 |
| 3 | `MICRO_TEXT` 在「……边界漏判；」后、「汇报时」前插单段，保持单行模板 | `src/instruction.ts:27`；纯插入（见 §4），无整段重排 | 对上 |
| 4 | `FULL_TEXT` 在开头与「0.」之间插一行 | `src/instruction.ts:31`；只在首行后加 1 行，`0.`-`5.` 全部保留原序 | 对上 |
| 5 | README「带证据的事中引导」第 2 条补一句 | `README.md:40` 句尾追加，计划原文逐字命中（见 §4） | 对上 |
| 6 | build + 过滤测试 + 全量测试 | build 0；过滤 1/1；全量 97/97 | 对上 |
| 7 | `git add` + `git commit` | 未执行 | 岗位边界内，正确移交 lead |

合同层核对：
- `MICRO_TEXT` / `FULL_TEXT` 均含同一组 5 个关键词，各 5/5（§2/§3）。
- 两档均保持「单行 / 单行模板」形态；full 仅新增 1 个模板行，未重排步骤。
- `reviewInstructionText` 函数体与 HEAD 逐字节相同（签名不变）；`buildReviewMessage` / `buildDriverMessage` 未改；生产调用方 `src/index.ts:366` 参数未变。
- step 5「severity 取值唯一…证据不足降 confidence 不否决」与 HEAD 逐字节相同（`diff` 无输出）。
- README 只改第 2 条句尾；配置表、其他段未动。

---

## 2. 亲跑验证（全部卸垫片）

```sh
cd ~/dsh-review-gate
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)   [exit 0]

env -u LD_PRELOAD npm test
# ℹ tests 97  ℹ pass 97  ℹ fail 0  ℹ cancelled 0

env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' test/gate.test.mjs
# ✔ instruction: precision discipline present in both tiers
# ℹ tests 1  ℹ pass 1  ℹ fail 0

env -u LD_PRELOAD node --test test/gate.test.mjs          # 94/94
env -u LD_PRELOAD node --test test/client-bundle.test.mjs # 3/3
env -u LD_PRELOAD node --test test/realloop.test.mjs      # 6/6（补跑）
git diff --check                                          # clean
```

计数核对：HEAD 基线 gate 93（用 HEAD 测试文件 + HEAD lib 在 `~/tmp/r2-headcheck` 实测 93 pass），T2 +1 = 94；加 client 3 = 97，与派令预期一致。worker 报告「基线 96 → 97」成立。

---

## 3. 真驱动反证（HEAD 旧 lib）

方法：`git ls-tree HEAD lib` 全量导出到 `~/tmp/r2-headcheck/lib`（HEAD 版，不含 T2 文本），把**工作树的新测试文件**拷到同目录 `test/`，`node_modules` symlink 回仓库；另用 worktree lib 做同构对照。

```sh
env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' \
  ~/tmp/r2-headcheck/test/gate.test.mjs
# ✖ instruction: precision discipline present in both tiers
# AssertionError: micro: scope limited to this diff
# ℹ tests 1  ℹ pass 0  ℹ fail 1        [exit 1]

env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' \
  ~/tmp/r2-newcheck/test/gate.test.mjs
# ✔ …  ℹ tests 1  ℹ pass 1  ℹ fail 0   [exit 0]
```

HEAD `lib/instruction.js` 的 5 词命中数：`只报本次 diff 引入的问题 0 / pre-existing 0 / 周边代码 0 / No actionable findings found 0 / 严重度 0`；worktree `lib/instruction.js` 均为 **2**（micro/full 各一）。故红是旧文本的真实状态，不是测试语法/环境问题；测试是驱动型，不是恒真。

---

## 4. 位置、纯插入与文本一致性（逐字节证据）

- micro 纯插入：`HEAD line 27` 仅把 `；汇报时` 替换为 `；<审查纪律>汇报时` 后与 worktree line 27 **完全相等**（`micro pure insert: true`）。
- full 纯插入：worktree FULL_TEXT 去掉含「审查纪律」的那 1 行后，与 HEAD 的 10 行模板 **完全相等**（`remaining identical: true`）；「审查纪律」在两档各出现 1 次。
- 顺序断言：micro `条件写反、边界漏判；` < `审查纪律` < `汇报时` = true；full `逐项完成：\n` < `审查纪律` < `0. 先列出` = true。
- 计划原文逐字核对：micro/full 的「审查纪律」文本与 README 补句在 `roadmap` 与 `src/instruction.ts`/`README.md` 中均 `True`（三处全命中）。
- step 5：`证据不足降 confidence 不否决` 行 `diff` 无输出（字节相同）。
- `reviewInstructionText` 函数块：HEAD 与 worktree 提取后逐字节相等（17 行）；`git diff -U0` 仅出现 `@@ -27 +27 @@` 与 `@@ -30,0 +31 @@` 两个 hunk，无签名/函数体改动。
- README：去掉追加句后与 HEAD 逐字节相等；追加句在 `README.md:40` 句尾。
- 既有断言只增不改：反向移除新增测试块后，`test/gate.test.mjs` 与 HEAD 逐字节相等；`git diff -- test/gate.test.mjs` 实际删除行数 = 0。

---

## 5. braceGuard 与注入路径

- 新增的两段文本（micro/full）`{{` 计数 0、`}}` 计数 0；`git diff -U0 -- src/instruction.ts | grep '^+' | grep -c '{{\|}}'` = 0。
- 活路径 `src/index.ts:366` 仍为：
  `text: braceGuard(reviewInstructionText(p.action, p.files, pitfallsText, config.pitfallsFile) + diffSection + bashSection)`
  即新增文本仍在 `braceGuard` 内，宿主插值不会被裸 `{{` 杀死。
- 常驻 `review-gate-usage` 段（`src/index.ts:310`）也仍过 `braceGuard`，本次未改。
- `buildReviewMessage`（legacy 导出）仍直接调用 `reviewInstructionText`，未过 `braceGuard`；但它是旧兼容路径、生产注入不走它，且新文本本身无花括号，不构成本单风险（既有状态，未改动）。

---

## 6. 语义一致性（独立推演）

- **step 5「severity 校准」**：`severity 取值唯一——info|minor|major|critical…证据不足降 confidence 不否决` 原样保留；新纪律只要求「按严重度排序」，二者是「定义/校准」与「排序」的互补关系，无冲突。full 文本要求先读纪律再看 step 5，顺序合理；micro 没有 step 5 的矩阵，但 T1 已把 schema 的「仅此四值」恢复（`src/index.ts:631`），micro 的 severity 词表有工具 schema 兜底。
- **FULL_TEXT 既有范围纪律（line 33 的「本回合 diff 为准锚定 / 不可信分析数据」与 line 35 的「无真实跨越不报，禁止发明边界凑数」）**：新纪律「只报本次 diff 引入的问题」「每条 finding 必须离散可行动、指出具体受影响代码、不依赖未声明假设」与这两条同向，属于更严格的报告门槛，不是重复到需要删除的程度；无矛盾。
- **潜在边界（非缺陷）**：step 2（line 34）的「sibling routes / alternate guards / parser variants」横向检查仍要求检查同类点；新纪律说 pre-existing 不报。正确的合读是「检查 sibling 以保证本次改动覆盖一致，但只报本次 diff 引入的实例」，与 line 33 的 diff 锚定一致；建议未来若出现歧义再加一句限定（本单无需改）。
- **micro 单行模板**：`……边界漏判；审查纪律：……按严重度排序。汇报时……` 读得通，单行未破坏；长度 326 字符（full 1436），新增约 110 字符，可接受。
- **范围外注记**：新纪律「pre-existing…不报」与项目 `AGENTS.md` §10.3「发现无关的 dead code 报告但不主动删除」是不同层面的口径（复审报告范围 vs 开发行为）；若用户要求统一，另立文档任务，不影响本单。

---

## 7. Findings

**blocking findings：无（0 条）。**

**F1 · info | `test/gate.test.mjs:549-559`**
事实：新测试只断言 5 个关键词的包含性，不锁定插入位置；位置契约（micro 在「汇报时」前、full 在「0.」前）只有本次 diff 反证，未进入常跑护栏。worker 已在残余风险中主动披露（报告 §7）。
影响：未来若有人把关键词挪到不合适的位置（如塞进不可信数据免责段），测试仍绿；当前实现位置经反向 diff 证明正确。
最小修法（可选，1–2 行断言，测试数仍 97）：在同一用例循环内加
`assert.ok(text.indexOf('审查纪律') < text.indexOf(action === 'micro' ? '汇报时' : '0. '), action + ': discipline precedes the checklist')`
非 §3 合同要求，不阻断。

**F2 · info | `src/instruction.ts:27` / `:31`**
事实：两档文案均为「按严重度排序」，未写排序方向；Qoder 原始证据是「从高到低」。micro 无 step 5 的 severity 校准矩阵，但 schema（T1 已恢复四值 guard）提供词表。
影响：排序方向靠模型推断；当前不构成错误（计划原文如此，worker 无过错）。
最小修法（可选，后续文案 1 词）：改为「按严重度从高到低排序」；本单按合同保持原文。

---

## 8. 行数账

`wc -l` 实测：`src/instruction.ts 92`、`test/gate.test.mjs 1666`、`README.md 228`、`lib/instruction.js 74`、worker 报告 152，与 worker 报告逐项一致。

`git diff --numstat`（增/删）：`README.md 1/1`、`lib/instruction.js 2/1`、`src/instruction.ts 2/1`、`test/gate.test.mjs 14/0`；与报告 §3 一致，测试文件无删除（新增测试块 14 行全增）。

---

## 9. 转述要点（≤3 句）

1. T2 达标：micro/full 各插入同一组「审查纪律」，位置精确、step 5 与函数签名零变更，build 0、`npm test` 97/97、realloop 6/6；HEAD 旧 lib 的 5 词全 0 命中，新测试在旧 lib 上确证会红（exit 1）。
2. 无 blocking findings；两条 info 可选加固：给新用例加 1–2 行位置断言（现在只测包含性），以及未来把「按严重度排序」写清方向为「从高到低」。
3. 语义上新增纪律与 step 5 severity、FULL_TEXT 的 diff 锚定/禁止发明边界同向，无冲突；可提交（含 `lib/instruction.js`），真机生效需用户重启 profile。

---

## 10. 残留风险

- **真机未验**：提示词对真实模型行为的影响需用户重启 profile 后用 receipts 观察；本单只做构建 + 单测。
- **位置契约未入常跑测试**（F1）：当前由 diff 反证，未来回归只能靠人工复核。
- **排序方向未写死**（F2）：模型可能按升序/降序自行理解；不影响测试，但影响报告观感。
- 生产 receipts 为活跃会话审计流；本复核除运行时闸门自身回执外未直接写入/修改，测试均使用隔离 `receiptDir`。

---

## 11. 复核者改动与临时物

- 仓库内唯一新增：本报告（`docs/handover/2026-10-23-batch1-t2-closer.md`）。
- 未修改任何 `src/`、`lib/`、`test/`、`README`；未 commit。
- `~/tmp/` 一次性物（可删）：`r2-headcheck/`（HEAD lib + 新测试/基线）、`r2-newcheck/`（worktree lib 对照）、`r2-red.out`、`r2-green.out`、`r2-head-gate.out`。
