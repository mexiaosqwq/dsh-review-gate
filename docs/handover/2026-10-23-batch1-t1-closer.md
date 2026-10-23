# Batch 1 · Task 1（`review_acknowledge` v2）closer 复核报告

- 日期：2026-10-23
- 单号：R1（Batch1-T1；task-1）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §2 + §11.5 + 交接书
- 被审对象：工作树未提交改动（4 modified + 1 worker 报告），HEAD = `96ffb06`
- 岗位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE_WITH_CONCERNS**

**结论：PASS**（功能与测试达标，可提交。F1/F3 为两个 minor，建议提交前各花 1 行修掉；F1 属计划文本与 2026-10-10 既有决定的冲突，非 worker 实现错误。）

---

## 0. 结论摘要

- §2 Step 1-6 逐条对上；合同层守住：新参数全 optional（`required` 未变）、未加 `priority`、`noNewReviews` 计算零改动、既有 95 例测试零改动（新测试块 36 行全增）。
- 亲跑：`npm run build` exit 0；`npm test` **96/96**（gate 93 + client-bundle 3，不是我派令里预期的 99，见 F4）；新用例单跑 1/1；补跑 `realloop` 6/6。
- 真驱动已独立反证：HEAD 旧 `lib/` + 新测试 = **1 fail / exit 1**（`undefined ≠ 'incorrect'`）；同一份测试体对当前 `lib/` = 1 pass / exit 0。新测试**整体**是驱动的，但其 `confidence` 断言单独在 HEAD 上也绿（F3）。
- `on_request` 分支用独立探针四场景验过（A 无 state 带字段、B 省略键不出现、C armed 结算带字段+cost、D state 存在但无 pendingReview 带字段）。仓内其实已有两处 `on_request` 测试，只是都不断言新字段——worker 报告的「没有仓内测试」表述不准（F2）。
- F1：`findings` 的 schema 描述删掉了 HEAD 原有的「，仅此四值」。这是 2026-10-10 severity 词表分裂修复的显式组成部分（`decisions.md:35`），历史回执共 37 条 high/medium/low（10-10 后仍有 4 条）+ 9 条缺失 severity。建议恢复四字 + 重建（1 行 + build）。

---

## 1. diff 全读与 §2 逐条对拍

diff 全读覆盖：`README.md`、`src/index.ts`、`test/gate.test.mjs`、`lib/index.js`（`git diff` 全文，4 文件 68 增 4 删；`lib/types/*`、`lib/client.js` 无变更）。

| Step | 计划要求 | 实测落点 | 结论 |
|---|---|---|---|
| 1 | 在 `ack: receipt lands in the audit log` 之后加失败测试 | `test/gate.test.mjs:689-723`；用例代码逐字取自 §2，仅多 1 行分节注释 | 对上 |
| 2 | 构建后跑过滤测试，确认 FAIL | 见 §3：我的 HEAD-lib 反证 exit 1，断言落 `gate.test.mjs:719` | 对上 |
| 3 | schema 加两 optional 参数 + `findings` 描述补 `confidence` | `src/index.ts:628-641`；两参数位于 `findings` 后、`fixes_made` 前；`overall_correctness` enum=`['correct','incorrect']`；`findings` 描述含 `confidence?(0-1)` | 对上（四字回归见 F1） |
| 4 | execute 类型 + 两处 `appendReceipt` 都写入；`noNewReviews` 不动 | 类型 `src/index.ts:660-668`；`settleOnRequest` 回执 `:687-688`；正常结算回执 `:721-722`；`git diff -U0 -- src/index.ts \| grep -c noNewReviews` = **0** | 对上 |
| 5 | build + 过滤测试 + 全量测试 | 见 §2；全绿 | 对上 |
| 6 | README 两处文案 | `README.md:41` 字段列表、`:51` 表格补句，与 §2 Step 6 原文逐字一致（含 `overall_correctness?` / `overall_explanation?` 与「旧回执不受影响」） | 对上 |
| 7 | `git add` + `git commit` | 未执行 | 岗位边界内，正确移交 lead |

合同层核对（逐项）：
- 既有参数语义不变：注册工具 `parameters.required = ["action","files","fixes_made","summary"]`（探针实测，见 §4），新键不在 required。
- 新参数全 optional：同上；且省略时回执 JSON 不含键（探针 B）。
- 不加 `priority`：`grep -rn priority src/ test/ README.md` 零命中。
- 不改 `noNewReviews` 计算：diff 零命中；`test/gate.test.mjs:1039-1040` 的既有 `cost.noNewReviews` 断言仍绿。
- 既有断言只增不改：`test/gate.test.mjs` 的 diff 为 36 增 0 删（`git diff --numstat` 实测 `36 0`）。

---

## 2. 亲跑验证（全部卸垫片）

```sh
cd ~/dsh-review-gate
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)   [exit 0]

env -u LD_PRELOAD npm test
# ℹ tests 96  ℹ pass 96  ℹ fail 0  ℹ cancelled 0

env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
# ✔ ack v2: overall verdict and per-finding confidence persist
# ℹ tests 1  ℹ pass 1  ℹ fail 0

env -u LD_PRELOAD node --test test/gate.test.mjs          # 93/93
env -u LD_PRELOAD node --test test/client-bundle.test.mjs # 3/3
env -u LD_PRELOAD node --test test/realloop.test.mjs      # 6/6（补跑，exit 0）
```

计数口径核对（F4）：HEAD 基线实测 gate **92**（用 HEAD 测试文件 + HEAD lib 在 `~/tmp/r1-headcheck` 跑出 92 pass），本单 +1 = 93，加 client-bundle 3 = **96**。派令预期「gate 96 + client 3 = 99」多算了一次：96 已是 npm test 的总数；计划 §1/§2 写的「94 既有」也早了一例（Batch 0 globstar 已使基线为 95，worker 报告已披露）。

---

## 3. 新断言真驱动（HEAD 旧 lib 反证）

方法：把 `git ls-tree HEAD lib` 的全部文件导出到 `~/tmp/r1-headcheck/lib`（HEAD 版，零新字段），把**工作树的新测试文件**拷到 `~/tmp/r1-headcheck/test/`，`node_modules` symlink 回仓库，跑同一测试体；另做当前 lib 的同构对照。

```sh
env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' ~/tmp/r1-headcheck/test/gate.test.mjs
# ✖ ack v2: overall verdict and per-finding confidence persist
# AssertionError: + actual undefined / - expected 'incorrect'   (gate.test.mjs:719)
# ℹ tests 1  ℹ pass 0  ℹ fail 1        [exit 1]

env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' ~/tmp/r1-newcheck/test/gate.test.mjs
# ✔ ack v2 …  ℹ tests 1  ℹ pass 1  ℹ fail 0   [exit 0]
```

结论：`overall_correctness` / `overall_explanation` 两个断言是真驱动——实现缺失时测试必红（不是「现在绿所以真驱动」）。但 `confidence` 那一半不是（F3，见 §7）。

---

## 4. `on_request` 分支独立取证（~/, 不进仓库）

探针：`~/tmp/r1-onrequest-probe.mjs`（复制 test 的 `fakeCtx`/`baseConfig` 形态，import 仓内构建产物），`env -u LD_PRELOAD node …`，**exit 0，ALL PROBE CHECKS PASS**。

| 场景 | 结果 |
|---|---|
| schema | `overall_correctness.enum=["correct","incorrect"]`；`required=["action","files","fixes_made","summary"]`（新键全 optional） |
| A：无 state（写自由会话），带两字段 | `source="on_request"`；`overall_correctness="correct"`、`overall_explanation="no defects found"`；嵌套 `confidence=0.62` 原样回读 |
| B：同分支省略两字段 | 回执中 `overall_correctness` / `overall_explanation` 两键**均不存在**（`JSON.stringify` 省略 undefined） |
| C：armed 正常结算（先 emit write） | 回执含 `cost`（intercepts/sessionFiles/noNewReviews/diffLines）、无 `source`，两字段已写入 |
| D：state 存在但 `pendingReview=null`（mode off 使 decideReview=skip） | `source="on_request"`，两字段已写入（覆盖 `settleOnRequest` 的第二个入口） |

`on_request` 入口条件有两个（`!state` 与 `state && !pendingReview`），A/D 分别覆盖；正常结算 C 覆盖第二处 `appendReceipt`。两处落盘点均实测写入。

---

## 5. 爆炸半径 / 回执消费侧

- `readReceiptStats`（`src/index.ts:392-430`，HTTP GET 面板数据源）只读 `ts` / `outcome` / `action`，新键惰性，不触碰。
- 客户端 `ReceiptStats`（`src/client/review-gate-form.tsx:28-32`，展示 `:70-104`）只用 `today.reviews/stopLoss/waived`，不读 findings/severity/overall_*。
- `scripts/` 只有 build/smoke 三件，无任何 receipts 读者；`receipts-stats.mjs` 尚未存在（Task 3 才建）。
- 仓内所有 `findings[].severity` 的读点只在测试（`test/gate.test.mjs:702/873` 等），生产代码无消费者；新 optional 字段同理无消费者。
- 旧回执兼容：生产 `receipts.jsonl` 1057 行全部 `JSON.parse` 通过（parse_errors=0）；新键 optional，旧行无需迁移；既有 96 例全绿。README「旧回执不受影响」的声明成立。
- 词表现状（F1 证据）：2026-10-10 前 645 条 finding 中 high 6 / medium 15 / low 12（=33 非四值）+ missing 9；10-10 后 404 条中 medium 1 / low 3（=4 非四值）+ missing 0（合计 37 条非四值）。漂移未灭绝，schema 层措辞仍有防漂移价值。

结论：**无隐藏消费方**；新增 optional 字段与 severity 词表不会破坏既有面板/统计/测试。Task 3 的 `bySeverity` 按 §11.5 加 `other` 桶即可。

---

## 6. 行数账与 README 一致性

`wc -l` 实测与 worker 报告逐项一致：`src/index.ts 878`、`test/gate.test.mjs 1631`、`README.md 228`、`lib/index.js 790`、worker 报告 157。

diff 精确账（`git diff --numstat`，增/删）：`src/index.ts 16/1`、`lib/index.js 14/1`、`test/gate.test.mjs 36/0`、`README.md 2/2`。worker 报告写的「+17 / +15」取的是 `git diff --stat` 的「变更行数」列（增+删），不是纯新增行——口径混写，无实质影响（纯注记，不算 finding）。

README：`:41` 与 `:51` 与计划 Step 6 原文逐字一致；「旧回执不受影响」经 §5 消费侧审计成立；README 中 `severity` 相关旧文案未被改动（`:23` 方法论、`:224` 来源说明均原样）。

---

## 7. Findings（签名：severity | 位置 | 事实→影响→最小修法）

**F1 · minor | `src/index.ts:631`（构建产物 `lib/index.js:559`）**
原文要求（§2 Step 3）的 findings 描述**逐字落地**，但它删掉了 HEAD 原有的「，仅此四值」：`Git HEAD` 为 `severity(info|minor|major|critical，仅此四值)`，工作树为 `severity(info|minor|major|critical)`。`decisions.md:35`（2026-10-10 severity 词表分裂修复）明确记「schema 注明『仅此四值』」；历史回执 37 条 high/medium/low + 9 条 missing（§5）说明漂移真实存在，而 `FULL_TEXT` 的 severity 纪律只在 full 复审出现，micro 复审只靠 schema 描述——删掉四字削弱了这条唯一的常驻守卫。
影响：文档/提示层回归，非运行时故障；会让 Task 3 的 severity 统计继续收到非四值数据。
最小修法（1 行 + 构建）：`src/index.ts:631` 改回 `severity(info|minor|major|critical，仅此四值), confidence?(0-1)`，`env -u LD_PRELOAD npm run build` 重建 `lib/index.js`。README 无需改。
契约提示：§2 Step 3 原文本身缺这四字，worker 照合同实现无过错；需 lead 授权偏离并在 §11.5 补一条执行口径（如「4. Step 3 的 findings 描述保留『仅此四值』，与 decisions.md 2026-10-10 对齐」），避免计划与代码再次漂移。

**F2 · info | worker 报告 `2026-10-23-batch1-t1-worker.md:154`**
表述「`on_request` 分支没有仓内测试」不准确：仓内已有两处覆盖——`test/gate.test.mjs:493-520`（stale receipt 用例的 b 段，断言 `source: on_request`）与 `:898-915`（`ack: clean-state call settles as an on-request receipt`，断言 source + agentId）。真实缺口是「这两处都没有断言新字段」，我的探针已闭合。影响：报告表述，不影响代码；建议更正措辞，并在需要时把「新字段在 on_request 落盘」纳入常跑链（见 F3 的合并修法）。

**F3 · minor | `test/gate.test.mjs:721`**
新用例名含「per-finding confidence persist」，但该断言并不驱动实现：`findings` 在 HEAD 就已原样透传，`confidence` 只是透传字段。实证：把新测试里两条 `overall_*` 断言删掉后，用 **HEAD lib** 跑同一测试体得到 **1 pass / exit 0**（`~/tmp/r1-headcheck/test/gate-confidence-isolated.test.mjs`）。同时，全仓没有任何断言检查 `findings` 的 schema 描述包含 `confidence?(0-1)`——若把 Step 3 的描述改动整个回退，测试仍全绿。
影响：`confidence` 这条交付（描述层）无回归护栏；测试名对覆盖范围有轻微夸大。
最小修法（1 行断言，放在新用例的 `const ack = getAck(ctx)` 后）：
`assert.ok(ack.parameters.properties.findings.description.includes('confidence?(0-1)'), 'confidence documented in schema')`
若同时采纳 F1，可合并为一行断言同时检查 `'仅此四值'` 与 `'confidence?(0-1)'`；断言数增加但测试数仍为 96，不违反「既有断言只增不改」。若 lead 更希望独立用例，新增 ~7 行 test 则测试数变 97。

**F4 · info | 计数口径（派令预期 vs 实测）**
派令写「预期 gate 96 + client 3 = 99」；实测 npm test = **96**（gate 93 + client 3）。差额来自把「96 总数」又加了一次 client 3；HEAD 基线实测 gate 92（+1 新例 = 93）。计划 §1/§2 的「94 既有」也比实测 95 早一例（worker 已披露）。影响：仅口径；建议 lead 提交时顺手更新路线图数字（§1 表格 / §2 Step 5 的 94）。

---

## 8. 非阻断观察

- 新用例的 `fs.rm` 未放 `try/finally`（逐字来自计划 Step 1）：失败时会在临时目录留残渣；不影响通过路径，按「合同代码不擅自加料」不修。
- `settleOnRequest` 的 `state && !pendingReview` 入口（D）只在 mode off / skip 等路径出现，属于既有语义，本单未改；探针已覆盖。
- 生产回执统计是观察性数据，37/9 与 4 的对比不能单独证明「四字 guard 的因果效果」，但与 2026-10-10 的决定记录一致，足以支持 F1 的保守修法。

---

## 9. 转述要点（≤3 句）

1. T1 实现与测试经独立复核达标：两个 optional 参数、两处回执、README 都对上；build 零错，`npm test` **96/96**（不是 99），新用例在 HEAD 旧 `lib/` 上确证会红，`on_request` 分支用独立探针四场景验过。
2. 唯一建议提交前修的回归：findings 描述丢了「，仅此四值」（2026-10-10 明确加过的 severity 防漂移措辞；历史回执仍有 37 条非四值 + 9 条缺失）——恢复四字并 `npm run build` 即可，同时在路线图 §11.5 补一条执行口径。
3. worker 报告的「on_request 无仓内测试」应更正为「有分支测试但未断言新字段」；可顺手加 1 行 schema 描述断言（同时守住 `confidence` 与四字），不阻断本单。

---

## 10. 残留风险

- **真机未验**：host 半区改动需用户重启目标 profile 才生效；本报告只覆盖构建 + 单测 + 探针。
- **`on_request` 新字段无常跑护栏**：目前由本报告探针证明；若 lead 不采纳 F3 的断言，未来回归只能靠人工复测。
- **F1 若不在提交前修**：schema 措辞与 2026-10-10 决定不一致，后续 Task 3 统计口径会继续收到漂移词表。
- **生产回执统计**：本次只读分析 1057 行（0 parse errors），未修改用户审计文件。

---

## 11. 复核者改动与临时物

- 仓库内唯一新增：本报告（`docs/handover/2026-10-23-batch1-t1-closer.md`）。
- 未修改任何 `src/`、`lib/`、`test/`、`README`；未 commit。
- `~/tmp/` 一次性物（可删）：`r1-headcheck/`（HEAD lib + 新测试/变体）、`r1-newcheck/`（当前 lib 对照）、`r1-onrequest-probe.mjs`、`r1-red.out`、`r1-green.out`、`r1-head-gate.out`、`r1-realloop.out`、`r1-confidence-head.out`。
