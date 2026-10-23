# Batch 1 · Task 2（micro/full 提示词加「审查纪律」）worker 报告

- 日期：2026-10-23
- 单号：task-2（Batch1-T2）
- 规格：`docs/superpowers/plans/2026-10-22-review-gate-enhancement-roadmap.md` §3 Task 2 + §11.5 执行口径 + 交接书
- 岗位：worker（实施岗，唯一写码；不 commit、不跑浏览器）

**Status: DONE**

---

## 0. 一句话结果

`MICRO_TEXT` / `FULL_TEXT` 双档各插入一段「审查纪律」（同组 5 个关键词全覆盖）；新增 1 例形态断言，先红后绿；README「带证据的事中引导」第 2 条补一句；`reviewInstructionText` 签名未动、`{{` 零引入。`npm test` **97/97**，`npm run build` 零错。

---

## 1. 实现与规格对照（§3 Step 1-7）

| Step | 计划要求 | 实际落点 | 结论 |
|---|---|---|---|
| 1 | 加 `instruction: precision discipline present in both tiers` | `test/gate.test.mjs:547-559`（分节注释 547，用例 549-559；代码逐字取自计划） | 完成 |
| 2 | build 后跑过滤测试，确认 FAIL | 见 §2「红」——`micro: scope limited to this diff` 断言失败 | 完成（红） |
| 3 | `MICRO_TEXT` 在「条件写反、边界漏判；」后、「汇报时」前插单句 | `src/instruction.ts:27`：保持单行模板，仅插入一段 | 完成 |
| 4 | `FULL_TEXT` 在「…逐项完成：\n」后、「0.」前插一行 | `src/instruction.ts:31`：新行置于首行与 `0.` 之间，步骤 0-5 未重排 | 完成 |
| 5 | README「带证据的事中引导」第 2 条补一句 | `README.md:40` 句尾追加（原文照录） | 完成 |
| 6 | build + 过滤测试 + 全量测试 | 过滤 1/1 PASS；`npm test` 97/97 | 完成 |
| 7 | `git add … && git commit` | **未执行**——岗位边界：成员不 commit，提交由 lead 统一做 | 按边界移交 |

**硬约束逐条核对**

| 约束 | 结果 |
|---|---|
| 两档都含 5 关键词 | ✅ 实测两档各命中 5/5（§2 输出），构建产物 `lib/instruction.js` 每个关键词 2 处（两档各一） |
| 保持单行模板、最小 diff | ✅ micro 只改 1 行（插入 1 段）；full 只加 1 行；无重排 |
| 不重排既有步骤 | ✅ full 输出顺序 = 首行 / 审查纪律 / 0 / 1 / 2 / 边界枚举 / 3 / 4 / 5 / Codex 收口 / 结尾（§2 打印） |
| 保留 step 5「证据不足降 confidence 不否决」 | ✅ full 文本仍含该句（实测 `true`） |
| 不改 `reviewInstructionText` 签名 | ✅ `git diff src/instruction.ts` 未触及函数签名（仅两处模板字符串） |
| 新增文本无裸 `{{ }}` | ✅ 两档 `text.match(/\{\{/g)` 计数均为 0（不依赖 braceGuard 兜底） |

---

## 2. 真实验证命令与输出要点（全部卸垫片）

**红（只加测试、未改 src）**

```sh
env -u LD_PRELOAD npm run build        # 零错
env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' test/gate.test.mjs
# ℹ tests 1  ℹ pass 0  ℹ fail 1
# ✖ instruction: precision discipline present in both tiers (12.48ms)
#   AssertionError [ERR_ASSERTION]: micro: scope limited to this diff
#     at TestContext.<anonymous> (…/test/gate.test.mjs:553:12)
```

补充反证：`git show HEAD:lib/instruction.js` 对 5 个关键词逐个 `grep -c` 全为 **0**——即在改动前，micro 与 full **两档都不含**任何关键词，红是老代码的真实状态，不是测试自身问题。

**绿（实现后）**

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)
env -u LD_PRELOAD node --test --test-name-pattern 'precision discipline' test/gate.test.mjs
# ℹ tests 1  ℹ pass 1  ℹ fail 0
env -u LD_PRELOAD npm test
# ℹ tests 97  ℹ pass 97  ℹ fail 0  ℹ duration_ms ~3.2s
```

**双档词表旁证（`~/tmp/rg-t2-keywords.mjs`，不进仓）**

```text
micro 只报本次 diff 引入的问题=true | pre-existing=true | 周边代码=true | No actionable findings found=true | 严重度=true | len= 326
micro bare-braces= 0 | has step5 guard= true
full  只报本次 diff 引入的问题=true | pre-existing=true | 周边代码=true | No actionable findings found=true | 严重度=true | len= 1436
full  bare-braces= 0 | has step5 guard= true
```

（micro 无 step 5，该行脚本对 micro 恒 true 属占位；full 的 `证据不足降 confidence 不否决` 为实命中。）

**full 文本行序（构建产物实测，前 12 字符）**

```text
[review-gate | 审查纪律：只报本次 di | 0. 先列出本次改动文件 | 1. diff 全读：逐 | 2. 爆炸半径：对改动的 | 边界枚举（Codex 边 | 3. 测试批判：①测试和 | 4. 回归面：跑全量相关 | 5. 规格对照：改动是否 | （借鉴 Codex Se | 发现问题→立即修复并复验
```

**计数**：基线 96 → 本单后 **97**（gate 94 + client-bundle 3），与派令预期一致。

---

## 3. 文件变更清单（`wc -l` 实测）

| 文件 | 行数（wc -l） | 变更（`git diff --numstat`） |
|---|---|---|
| `src/instruction.ts` | 92 | +2 / −1：micro 模板行 1 行改写、full 模板新增 1 行 |
| `test/gate.test.mjs` | 1666 | +14 / −0：分节注释 + 新用例 |
| `README.md` | 228 | +1 / −1：第 2 条句尾补句 |
| `lib/instruction.js` | 74 | build 产物 +2 / −1（与 src 一一对应；`lib/index.js`、`lib/client.js` 无变更） |

```text
$ git status --porcelain
 M README.md
 M lib/instruction.js
 M src/instruction.ts
 M test/gate.test.mjs
$ git diff --numstat
1       1       README.md
2       1       lib/instruction.js
2       1       src/instruction.ts
14      0       test/gate.test.mjs
```

未触碰：`src/index.ts`、`scripts/`、`lib/client.js`、`src/state.ts`、`src/client/`。

---

## 4. 收尾复审（AGENTS.md §10.5 五步）

1. **diff 全读**：3 个源文件 + 产物 diff 逐行读过。micro 插入点在「边界漏判；」与「汇报时」之间、句子完整（`…；审查纪律：…按严重度排序。汇报时…`）；full 新行位于首行与 `0.` 之间，`\n` 结尾，未破坏后续 6 行拼接；README 仅句末追加，未改前文。
2. **爆炸半径**：`MICRO_TEXT`/`FULL_TEXT` 的消费点 = `reviewInstructionText`（同文件）→ `buildReviewMessage`（旧兼容形）+ `src/index.ts` 的 assemble 注入。本次只改字符串内容，签名/导出/调用点零变化；`git diff src/instruction.ts` 未触及 `reviewInstructionText` / `buildReviewMessage` / `buildDriverMessage` 行。既有依赖这些文本的断言（`逐行读`/`最终总结`/`review_acknowledge`/`数据流`/`三连接`/`critical`/`不可信分析数据`/`逐行读过`）全部仍在——97/97 绿即证。
3. **测试批判**：①共享错误假设检查——新断言只检查「文本包含关键词」，与实现同源于同一常量，但**红证据来自 HEAD 产物（关键词 0 命中）**，说明断言能独立区分改前/改后；②路径覆盖——循环遍历 micro/full 两档，两档都断言 5 词；未覆盖的只有「关键词是否位于期望位置」（本单不以位置为契约，计划也只要求包含性）；③断言非恒真：删掉任一档的插入段，对应用例即红（micro/full 各自独立断言）。
4. **回归面**：`npm run build` 零错（含 host lib 导入自检 + client bundle smoke 闸门）；`npm test` 97/97（不只跑新用例）。
5. **规格对照**：Step 1-6 全覆盖；未改签名、未新增导出、未加 `{{`、未触碰禁区文件；「保留 step 5」已核。

---

## 5. 规格偏差清单

| # | 原文要求 | 实际做法 | 理由 | 影响面 |
|---|---|---|---|---|
| 1 | Step 1 给的是测试代码块 | 代码块逐字落地，另在其上补 1 行分节注释（`// ---- Batch 1 Task 2: … ----`） | 与文件既有分节惯例一致，便于定位 | 无功能影响，+1 行注释 |
| 2 | Step 7 要求 `git add` + `git commit` | 未执行 | 岗位边界：成员不 commit，提交由 lead 统一做 | 变更仍在工作区（4 文件 modified），待 lead 提交 |
| 3 | §3 Files 标注 `src/instruction.ts:26-39` | 实际涉及 27 / 31 两行（T1 后行号未变，仍在该区间） | 与计划行号区间一致 | 无 |

无其他偏差；无缩水、无加料。

---

## 6. 转述要点（≤3 句）

1. micro 快扫与 full 全面复审的提示词现在都带同一套「审查纪律」：只报本回合 diff 引入的问题（pre-existing / 纯风格 / 顺手大重构不报）、报前先读周边代码、无 actionable findings 就明说（No actionable findings found）不硬凑、按严重度排序。
2. full 档额外要求「每条 finding 离散可行动、指出具体受影响代码、不依赖未声明假设」；两档都保持单行/单行模板，无 `{{` 注入风险，函数签名与既有步骤全未动。
3. 默认动作建议：lead 复核后按 Step 7 提交（含 `lib/`）；真机生效需重启 profile（host 半区改动），团队内测试跑 `lib/` 本体不受影响。

---

## 7. 残留风险

- **真机未验**：提示词文本对真实模型行为的影响（是否真的减少 pre-existing 报告）只能在用户重启 profile 后由 receipts 数据观察；本单只做构建 + 单测（岗位边界不跑浏览器）。
- **文本长度**：full 模板 1436 字符（+~110），micro 326 字符（+~110）——每次注入多约 100 字符，可忽略但记录在案。
- **断言只覆盖包含性**：若未来有人把关键词挪到不合适的位置（如塞进“不可信数据”免责段），测试仍绿；位置契约未纳入（计划未要求）。
- **计数口径**：本单后 gate 94 + client 3 = 97；后续任务请以实测为准，勿沿用旧数字。
