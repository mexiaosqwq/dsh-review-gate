# Batch 1 · Task 1（`review_acknowledge` v2）worker 报告

- 日期：2026-10-23
- 单号：task-1（Batch1-T1）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §2 Task 1 + §11.5 执行口径 + 交接书
- 岗位：worker（实施岗，唯一写码；不 commit、不跑浏览器）

**Status: DONE**

---

## 0. 一句话结果

`review_acknowledge` 新增两个 optional 参数（`overall_correctness` / `overall_explanation`），findings 描述补 `confidence?(0-1)`；两处回执落盘点（正常结算 + `source: on_request`）都写入新字段；测试先红后绿，`npm test` 96/96、`npm run build` 零错；README 两处口径更新。未加 `priority`，未改既有参数语义，未动 `noNewReviews` 计算。

---

## 1. 实现与规格对照（§2 Step 1-7）

| Step | 计划要求 | 实际落点 | 结论 |
|---|---|---|---|
| 1 | 在 `ack: receipt lands in the audit log` 之后加失败测试 | `test/gate.test.mjs:689-731`（分节注释 689，用例 691-731：计划代码 + 返工 F3 的 schema 描述断言） | 完成 |
| 2 | build 后跑过滤测试，确认 FAIL | 见 §2「红」——断言落在 `gate.test.mjs:719`，`actual undefined ≠ 'incorrect'` | 完成（红） |
| 3 | schema 加两 optional 参数 + findings 描述补 confidence | `src/index.ts:628-643`（findings 描述 631；`overall_correctness` 633-637；`overall_explanation` 638-641） | 完成 |
| 4 | execute 类型加两字段 + 两处 `appendReceipt` 都写 | 类型 `src/index.ts:661-668`；`settleOnRequest` 回执 684-690；正常结算回执 718-724；`noNewReviews` 计算（714-716）**未动** | 完成 |
| 5 | 实现后 build + 过滤测试 + 全量测试 | 过滤 1/1 PASS；`npm test` 96/96（pass 96 / fail 0） | 完成 |
| 6 | README「唯一完成信号」字段列表 + 「结构化回执」表补句 | `README.md:41`（字段列表）、`README.md:51`（表格补句，文案取计划原文） | 完成 |
| 7 | `git add … && git commit` | **未执行**——岗位边界：成员一律不 commit，提交由 lead 统一做 | 按边界移交 |

计划 §11.5 对本单的修订（README「Commands 节」等三项）均属 Task 3，本单不涉及；本单适用口径 = 「不新增 priority」「不改既有参数语义」。

---

## 2. 真实验证命令与输出要点（全部卸垫片）

**基线（改动前，证明起点干净）**

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)
env -u LD_PRELOAD npm test
# ℹ tests 95  ℹ pass 95  ℹ fail 0
```

**红（只加测试、未改 src）**

```sh
env -u LD_PRELOAD npm run build                    # 零错（src 未动）
env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
# ✖ ack v2: overall verdict and per-finding confidence persist
# ℹ tests 1  ℹ pass 0  ℹ fail 1
# AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
#   + actual - expected
#   + undefined
#   - 'incorrect'
#   at TestContext.<anonymous> (…/test/gate.test.mjs:719:10)
```

失败形态与计划预期一致：字段未落盘（`undefined`），不是语法/环境错。

**绿（实现后）**

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)
env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
# ✔ ack v2: overall verdict and per-finding confidence persist (141ms)
# ℹ tests 1  ℹ pass 1  ℹ fail 0
env -u LD_PRELOAD npm test
# ℹ tests 96  ℹ pass 96  ℹ fail 0  ℹ duration_ms ~2.9s
```

**分支覆盖旁证（不进仓，临时脚本 `~/tmp/rg-ack-v2-onrequest.mjs`）**

计划 Step 1 的用例只能证明「有一处回执写了新字段」，无法区分是正常结算还是 `on_request` 兜底。为把两处都验掉，另跑脚本：

```sh
env -u LD_PRELOAD node ~/tmp/rg-ack-v2-onrequest.mjs
# line1: {"source":"on_request",…,"overall_correctness":"correct","overall_explanation":"no defects found"}
# line2: {"source":"on_request",…}                      ← 省略两字段时两键均不出现
# CHECK source=on_request: on_request on_request
# CHECK fields written: correct | no defects found
# CHECK omitted clean: false false                      ← 'overall_correctness' in rec === false
# CHECK armed has cost: true | source key: false        ← armed 分支（有 cost、无 source）
# CHECK armed fields: correct | clean
```

三点结论：① `on_request` 分支确实写入两字段；② 省略时 `JSON.stringify` 自动省略 undefined 键（optional 语义天然成立，无需判空）；③ 计划用例走的是 **armed（正常结算）分支**（旁证复现同款流程得到 `cost` 键），两处都验到。

**计数漂移（对齐口径用）**：计划 §1 表格与 §1 段写「94 既有测试」，实测基线为 **95**（gate 92 + client-bundle 3；Batch 0 的 globstar 测试已使计数前移一例），本单落地后为 **96**（gate 93 + client-bundle 3）。不影响实现，建议 lead 顺手订正路线图数字。

---

## 3. 文件变更清单（`wc -l` 实测）

| 文件 | 行数（wc -l） | 变更 |
|---|---|---|
| `src/index.ts` | 878 | +16/−1：schema 628-643、execute 类型 664-665、`settleOnRequest` 回执 687-688、正常结算回执 721-722；返工 F1 后 description 行相对 HEAD 只净增 `confidence?(0-1)`（「，仅此四值」保留） |
| `test/gate.test.mjs` | 1652 | +58/−1：分节注释 689 + 新用例 691-731（返工 F3 在其中加 schema 描述断言）；返工 F3b 在 on-request 用例 906-936 内加 2 个 optional 参数 + 2 条断言 |
| `README.md` | 228 | 2 行改写（41、51） |
| `lib/index.js` | 790 | build 产物 +14/−1（与 src 一一对应；`lib/types/*`、`lib/client.js` 内容未变，git 无变更） |

```text
$ git status --porcelain                                     # 返工后（2026-10-23 晚）
 M README.md
 M docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md   ← lead 的 §11.5/计数订正，非本岗改动
 M lib/index.js
 M src/index.ts
 M test/gate.test.mjs
?? docs/handover/2026-10-23-batch1-t1-worker.md              ← 本报告
?? docs/handover/2026-10-23-batch1-t1-closer.md              ← closer 报告
$ git diff --numstat                                         # 本岗四个文件
2       2       README.md
14      1       lib/index.js
16      1       src/index.ts
58      1       test/gate.test.mjs
```

未触碰：`src/instruction.ts`、`scripts/`、`src/state.ts`、`src/client/`、路线图（lead 自行修改）。

---

## 4. 收尾复审（AGENTS.md §10.5 五步，逐条说明查了什么）

1. **diff 全读**：4 个文件 diff 逐行读过。两处 `appendReceipt` 都改到（缩进 12/10 空格不同，锚点唯一，无串行改错）；无改名残留（`grep -n overall_correctness` 命中 8 处 = src 4 / test 2 / README 2，语义全部一致）；条件/边界无改动（本单是纯增量参数）。
2. **爆炸半径**：`appendReceipt(dir, receipt)` 签名未变（仅多 optional 键）→ 其余 3 个调用点（waived / stop_loss / assemble_degraded，`src/index.ts:232/292/340`）不受影响；唯一读回执的代码 `readReceiptStats`（`src/index.ts:392-429`）只取 `ts` / `outcome` / `action`，新键惰性；无导出类型变更（execute 是内联断言类型）→ `lib/types/*` 无变更；`noNewReviews` 计算未动（`git diff` 中该行 0 命中）。
3. **测试批判**：新用例从磁盘回读 JSON 再断言（不是断言内部状态，非恒真）；`confidence` 通过 `deepEqual(rec.findings, [finding])` 全对象对拍；两处回执分支的覆盖缺口用 §2 旁证闭合；armed 分支身份另有既有守卫——`test/gate.test.mjs:1039` 读 `cost.noNewReviews`，若正常结算被误路由到 `on_request`，该用例会 `TypeError` 变红。共享错误假设检查：用例只依赖「写入→武装」这一既有已验证行为，未假设实现细节。
4. **回归面**：`npm run build` 零错（含 host lib 自检 + client smoke 闸门）；`npm test` 96/96 全绿（不只跑新用例）。
5. **规格对照**：Step 1-6 全覆盖，无缩水；未加 `priority`（`grep -rn priority src/ test/gate.test.mjs README.md` 0 命中）；既有参数语义未改（`action`/`files`/`findings`/`fixes_made`/`summary` 原样）。

---

## 5. 规格偏差清单

| # | 原文要求 | 实际做法 | 理由 | 影响面 |
|---|---|---|---|---|
| 1 | Step 1 给的是测试代码块 | 代码块逐字落地，另在其上补 1 行分节注释（`// ---- Batch 1 Task 1: ack v2 … ----`） | 与文件既有分节惯例一致（各板块均有 header 注释），便于定位 | 无功能影响，+1 行注释 |
| 2 | Step 7 要求 `git add` + `git commit` | 未执行 | 岗位边界：成员不 commit，提交由 lead 统一做 | 变更仍在工作区（4 文件 modified），待 lead 提交 |
| 3 | §1/§2 记「新增 1 例 + 既有 94 例」 | 新增 1 例；既有实测 95 | Batch 0（globstar 修复）已使计数前移；本单不改测试数，只订正口径 | 文档数字过时，建议 lead 更新路线图 |
| 4 | （隐含）两处回执都要落新字段 | 两处都改；计划用例本身无法区分分支，未在其内加区分断言（如 `assert.ok(rec.cost)`），改用 `~/tmp` 旁证 | 合同层：§2 的 Step 内容不可改，避免在合同用例里加料 | 无代码影响；分支覆盖靠旁证 + §4 第 3 条的既有守卫，记录在案 |

---

## 6. 转述要点（≤3 句）

1. 复审回执现在可带「整体结论」（`overall_correctness: correct|incorrect` + `overall_explanation`）与每条 finding 的 `confidence`，全部 optional，旧回执与既有调用零影响。
2. 正常结算与用户主动评审（`on_request`）两处落盘点都已接上，工具 schema 描述与 README 同步；测试先红后绿，全量 96/96、构建零错。
3. 默认动作建议：lead 复核后按计划 Step 7 提交（含 `lib/`）；真机生效需重启目标 profile（host 半区改动），团队内部测试跑 `lib/` 本体不受影响。

---

## 7. 残留风险

- **`on_request` 分支没有仓内测试**（措辞有误，见 §8 更正）：新字段在该分支的行为初稿时只有 `~/tmp` 旁证；返工 F3b 已在既有 on_request 用例内补断言，纳入常跑链。
- **新字段是模型自报的不可信文本**：`overall_explanation` 原样入 JSONL；`JSON.stringify` 会转义换行，不会撕裂行结构，但统计侧（Task 3 的 `receipts-stats`）不应赋予语义权重，口径需在那里写明。
- **真机未验**：host 半区改动需用户重启 profile 才在真机生效；本单只做构建 + 单测（岗位边界不跑浏览器）。
- **计划计数口径过时**（94 → 实测 95 → 本单后 96）：不影响代码，属文档维护项。

---

## 8. 复核更正（closer F2）与返工落码（F1 / F3 / F3b）

### 8.1 F2 更正：仓内其实已有两处 on_request 测试

§7 初稿「`on_request` 分支没有仓内测试」不准确，特此更正：

- `test/gate.test.mjs:493-520`：stale receipt 用例的 b 段，断言 `source: on_request`；
- `test/gate.test.mjs:906-936`：`ack: clean-state call settles as an on-request receipt (2026-09-30 contract)`，断言 `source` + `agentId`。

真实缺口只是**这两处都没断言本单新增的两个字段**（新字段在该分支此前仅由 `~/tmp/rg-ack-v2-onrequest.mjs` 旁证）。该缺口现由 F3b 在第二处用例内闭合，已进入 `npm test` 常跑链。

### 8.2 F1（采纳，lead 授权偏离 §2 Step 3 字面）

- 改动：`src/index.ts:631` findings 描述恢复「，仅此四值」——
  `'发现的问题列表，每项 {file, line?, severity(info|minor|major|critical，仅此四值), confidence?(0-1), note}'`
- 理由：`decisions.md` 2026-10-10 的 severity 词表防漂移决定；micro 复审只靠此描述约束（没有 FULL_TEXT 纪律），删四字会削弱唯一常驻守卫。
- 构建产物同步：`lib/index.js:559` 同文案（`npm run build` 重放）。
- 相对 HEAD 净变化：description 行只在原「，仅此四值」后插入 `, confidence?(0-1)`，旧措辞零丢失。

### 8.3 F3（采纳，1 处断言；先验证了 schema 挂载路径）

- 先取证而非照抄：读 `node_modules/@deepseek-ai/dsh-tools` 与 `dsh-llm` 类型（`defineTool → ToolDefinition extends ToolSchema`，`parameters: Record<string, unknown>`），再用 `~/tmp/rg-schema-shape.mjs` 实跑打印注册对象——
  `top keys: ['name','description','parameters','output','execute']`、`parameters keys: ['type','properties','required']`、`properties` 含 7 个参数名。
  确认 `ack.parameters.properties.findings.description` 是真路径（不是猜测）。
- 落码（新用例 `const ack = getAck(ctx)` 之后，`test/gate.test.mjs:697-704`）：

```js
  const findingsDesc = ack.parameters.properties.findings.description
  assert.ok(
    findingsDesc.includes('confidence?(0-1)') && findingsDesc.includes('仅此四值'),
    'findings schema documents confidence?(0-1) and keeps the four-value severity guard',
  )
```

- 断言强度实测（HEAD 旧 lib 对拍，零改动工作区）：

```text
$ git show HEAD:lib/index.js | grep "发现的问题列表"
# description: '…severity(info|minor|major|critical，仅此四值), note}'      ← 两个子串都缺 confidence
```

即 HEAD 上该断言必红 —— 这是真断言，不是恒真；同时它会挡住 F1 被回退（缺「仅此四值」同样变红）。

### 8.4 F3b（采纳，2 处 optional 参数 + 2 条断言）

- 改动：既有用例 `ack: clean-state call settles as an on-request receipt`（`test/gate.test.mjs:906-936`）——
  - execute 参数加 `overall_correctness: 'correct'`、`overall_explanation: 'no defects'`；
  - 回执读回后加两条断言：`row.overall_correctness === 'correct'`、`row.overall_explanation === 'no defects'`。
- 既有断言一条未改（只增），测试数不变（仍 96）。
- 红线核对：`git show HEAD:lib/index.js | grep -c overall_correctness` = **0** → 该用例在 HEAD 上必红，新断言有区分度。

### 8.5 返工后 diff 要点（`git diff --numstat` 实测）

| 文件 | 新增/删除行 | 返工增量说明 |
|---|---|---|
| `src/index.ts` | +16 / −1 | F1：description 行与 HEAD 的差异缩为「插入 `, confidence?(0-1)`」 |
| `test/gate.test.mjs` | +58 / −1 | F3：+8 行（含注释与断言）；F3b：execute 调用由 1 行展开为 10 行（+10/−1）+ 2 条断言 |
| `lib/index.js` | +14 / −1 | build 重放 F1/F3 对应产物 |
| `README.md` | +2 / −2 | 本单初版既有改动，未受返工影响 |

> 注：工作区另有 lead 对路线图的改动（`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md`，+25/−8，§11.5 第 4 条口径 + 计数订正），非本岗改动，未触碰。

### 8.6 返工后验证输出（全部卸垫片）

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)

env -u LD_PRELOAD node --test --test-name-pattern 'ack v2' test/gate.test.mjs
# ℹ tests 1  ℹ pass 1  ℹ fail 0

env -u LD_PRELOAD npm test
# ℹ tests 96  ℹ pass 96  ℹ fail 0  ℹ duration_ms ~3.4s
```

### 8.7 返工后的收尾复审（增量五项）

1. **diff 全读**：F1 只改 1 行文案；F3 断言读的是注册对象上的 schema（非拼接字符串）；F3b 只增参数与断言，未动既有断言。
2. **爆炸半径**：`ack.parameters` 只被新增断言读取，无生产代码消费；F3b 新增参数走同一 execute 路径（optional，undefined 时 JSON 自动省略，不影响其他回调用例）。
3. **测试批判**：F3 断言强度已用 HEAD lib 反证（§8.3）；F3b 强度同样用 HEAD lib 反证（§8.4）；两处都不与实现共享假设——断言的对象是模型可见的 schema 文本与落盘 JSON。
4. **回归面**：build 零错 + 全量 96/96（含 client-bundle smoke）。
5. **规格对照**：F1/F3/F3b 三条均按 lead 裁定落地，无加料；未新增测试用例，未改既有断言，未新增 `priority`。
