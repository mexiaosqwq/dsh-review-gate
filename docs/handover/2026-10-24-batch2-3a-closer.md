# Batch 2 · 3a（敏感路径强制 full：配置文档 + 真实路径测试）closer 复核报告

- 日期：2026-10-24
- 单号：task-5（Batch 2 · 3a）
- 规格：路线图 §6.1（零代码：README 推荐配置 + 真实路径测试）
- 被审对象：`README.md`、`test/gate.test.mjs` + worker 报告（`docs/handover/2026-10-24-batch2-3a-worker.md`，140 行）；HEAD = `1f41fb9`
- 岗位：closer（独立复核；不改码、不 commit；唯一仓库写入 = 本报告）

**Status: DONE**

**结论：PASS（0 blocking；F1/F2/F3 为 minor，F4 为 info；文档/测试主体正确，建议 lead 提交前处理 F1/F2/F3。）**

---

## 0. 结论摘要

- README 启动级 YAML 独立用 PyYAML `safe_load` 解析通过：`mode: auto` + 6 项 `alwaysFullGlobs`（现有 `src/contracts/**` + §6.1 的 5 条敏感路径，逐字一致）；缩进、键名、引号、行内注释均合法，可整段粘进 profile patch。
- `mode: auto` 是必要的：`decideReview`（src/state.ts:65-80）在 auto 之前对 `mode off/micro/full` 早退，只有 auto 分支读取 `alwaysFullGlobs`；固定 full 虽然结果 full 但清单不参与，固定 micro 会忽略敏感路径，固定 off 直接 skip。
- `shouldWaive`（src/state.ts:101-118）只对 `mode auto` + `action micro` + 单文件 + 非 bash + 有 diff 测量生效；敏感路径被 `decideReview` 判 full 后不会走微量豁免，README 这句与实码一致。
- 新测试 6 个断言全部直接调用 `decideReview`：无 glob 对照 → micro；多级绝对 auth 路径 → full；`**/*.sql` → full；`author.ts` / `payment-guide.ts` / `docs/auth.md` → micro。控制组与实验组同路径、同 `writeFiles:1`、同 `chain:0`，不是恒真。
- 反证（`~/tmp` 副本，不改仓库）：`recommended=[]` → #2 断言 `'micro' !== 'full'` 红；`**/auth/**` 改成宽匹配 `**/auth**` → `author.ts` near-miss 断言 `'full' !== 'micro'` 红。当前测试 96/96 绿、全量 101/101。
- `npm run build` exit 0，`git status --porcelain` 仅 README/test + worker 报告，`lib/` 零变更；`git diff --check` 0。
- 发现的实质问题不是运行时：README 的“无条件全审”在 `chain >= maxChain` 时实际 skip（F1）；README/AGENTS 计数仍 95/100，实际 96/101（F2）；新测试正向只覆盖 auth 与 sql，payment/crypto 无正向断言，worker 报告称既有 globToRegExp 覆盖 payment/crypto 不实（F3）；测试数组手抄 README，README-only drift 不会红（F4）。

---

## 1. README 示例逐行核对

### 1.1 YAML 可粘性

README.md:109-120 的代码块：

```yaml
- id: review-gate
  config:
    mode: auto                 # 固定 micro/full 会让下面的清单失效
    alwaysFullGlobs:
      - "src/contracts/**"     # 本仓库的契约/规格文件
      - "**/auth/**"           # 认证与授权
      - "**/payment/**"        # 支付与计费
      - "**/crypto/**"         # 密钥、签名、加密原语
      - "**/migrations/**"     # 数据库迁移
      - "**/*.sql"             # 任何 SQL 都按敏感处理
```

独立 `python3` + `yaml.safe_load` 结果：

```text
[{'id': 'review-gate',
  'config': {'mode': 'auto',
             'alwaysFullGlobs': ['src/contracts/**', '**/auth/**', '**/payment/**',
                                 '**/crypto/**', '**/migrations/**', '**/*.sql']}}]
```

- 缩进：`config:` 2 空格、键 4 空格、序列项 6 空格；与既有片段一致。
- 键名：`mode`、`alwaysFullGlobs` 均为 Config schema 键；`alwaysFullGlobs` 默认 `[]`（src/index.ts:71），本单不改默认值。
- 引号：所有 glob 双引号包裹，`**` 与 `?` 无冲突（`?` 不支持，本清单未使用）；行内注释不破坏 YAML。
- 5 条敏感 glob 与 §6.1 逐字一致；额外的 `src/contracts/**` 是本仓库既有的契约/规格条目，README 明确说“按仓库裁剪”，不算加料。
- `config` 整段替换、bundle 层 config 为空 `{}` 的语法说明仍在（README.md:124-127），示例可粘贴；Cordis patch 方言未改。

### 1.2 `mode: auto` 的必要性

`src/state.ts:64-80` 的实际顺序：

```ts
if (writeFiles === 0 && !bashWrites) return 'skip'
if (config.mode === 'off') return 'skip'
if (chain >= config.maxChain) return 'skip'
if (config.mode === 'micro') return 'micro'
if (config.mode === 'full') return 'full'
const core = (paths ?? []).some((p) =>
  config.alwaysFullGlobs.some((g) => globToRegExp(g).test(p)),
)
return writeFiles >= config.fullAtFiles || drifted || core ? 'full' : 'micro'
```

直接探针（当前 `lib`）：

```text
auto chain 0 => full
auto chain 2 => skip
micro chain 0 => micro
full chain 0 => full
off chain 0 => skip
auto no writes => skip
```

结论：`mode: auto` 是让清单参与分档的必要条件；README 的“固定 micro/full/off 时清单不参与分档”与实码一致。`mode: full` 本身仍返回 full，但清单确实不参与；`mode: micro` 直接返回 micro、敏感路径不参与；`off` skip。

### 1.3 说明段是否误导

README.md:122：

> 敏感路径**命中即无条件全审**：不看改动文件数与 session 漂移；auto 档的「微量豁免」只作用于 micro，所以这些路径不会被判成「改动太小」而跳过。`mode` 固定成 `micro` / `full` / `off` 时清单不参与分档（示例因此写 `auto`）；`**/` 前缀跨多级目录，清单按仓库实际情况增删，别照抄。

- “不看改动文件数与 session 漂移”正确：`core` 与 `fullAtFiles`/`drifted` 是 OR，敏感路径独立贡献 full；`shouldWaive` 只对 micro 生效。
- “固定 micro/full/off 时清单不参与分档”正确：`decideReview` 在到达 `core` 前已早退。
- **“无条件全审”不准确**：`decideReview` 在 `chain >= config.maxChain` 时先返回 skip（src/state.ts:67），`mode off`/无写也早退；direct probe 的 `auto chain 2 => skip` 是反证。README 下一句只列了固定 mode，没提 maxChain/止损。→ F1。
- “`**/` 前缀跨多级目录”正确（Batch 0 globstar 修复；既有 `globToRegExp` 测试覆盖 `**/auth/**`、`**/migrations/**`、`**/*.sql`）。
- “按仓库裁剪，别照抄”正确；`src/contracts/**` 就是本仓库特有条目。

---

## 2. 六组断言逐条核对

新测试 `test/gate.test.mjs:911-956`，全部经 `const { decideReview } = await import('../lib/index.js')` 调用真实导出，没有复制分档逻辑。

| # | 输入 | 配置 | 期望 | 实跑 | 判别力 |
|---|---|---|---|---|---|
| 1 | `/data/.../proj/src/auth/login.ts`，`writeFiles:1`，`chain:0` | `alwaysFullGlobs: []` | micro | micro | 同路径无 glob 对照；若 `full` 不是 glob 造成，此断言会红 |
| 2 | 同上 | 5 条推荐清单 | full | full | 多级绝对路径命中 `**/auth/**` |
| 3 | `/data/.../proj/db/001_init.sql`，同上 | 5 条推荐清单 | full | full | 无目录段的 `**/*.sql` 生效 |
| 4 | `/p/src/author.ts` | 5 条推荐清单 | micro | micro | `auth` 前缀文件不误命中目录 glob；宽匹配 `**/auth**` 会红 |
| 5 | `/p/src/payment-guide.ts` | 5 条推荐清单 | micro | micro | `payment-guide` 不等于 `payment/` 目录 |
| 6 | `/p/docs/auth.md` | 5 条推荐清单 | micro | micro | 提到 auth 的文档不误命中 |

直接矩阵补充（当前 `lib`）：

```text
control-auth micro
auth full
sql full
author micro
payment-guide micro
docs-auth micro
payment-dir full
crypto-dir full
migrations-dir full
auth-dot-ts micro
auto-maxchain skip
```

- `baseConfig` 的 `fullAtFiles=3`、`milestoneAtFiles=10`、`x` 未给 `sessionFiles`，`writeFiles:1`/`chain:0` 排除了文件数与漂移触发；#2/#3 的 full 只能来自 glob。
- 测试中的 `recommended` 数组是 §6.1 五条的逐字副本；`src/contracts/**` 不在数组里（现有 `globToRegExp` 用例已覆盖该 glob）。
- 6 个断言全部有实际期望与消息，没有 `assert.ok(true)` 之类的恒真形态。

### 2.1 反证（临时副本，不改仓库）

将 `test/gate.test.mjs` 复制到 `~/tmp/r5-mutant*`，以 symlink 挂当前 `lib/` 和 `node_modules`，只改副本：

```text
变异 A：recommended = []
→ ✖ sensitive-path recommendation ...
  AssertionError: **/auth/** forces full on the real multi-level absolute path
  'micro' !== 'full'                                      [exit 1]

变异 B：'**/auth/**' -> '**/auth**'
→ ✖ sensitive-path recommendation ...
  AssertionError: /p/src/author.ts must keep auto grading (no false full)
  'full' !== 'micro'                                      [exit 1]
```

- A 证明正向 full 断言确实依赖 glob；B 证明 near-miss 防误伤断言有判别力（宽匹配会让 `author.ts` 变 full）。
- 两处只在 `~/tmp` 副本执行；仓库 `git status` 仍是 README/test + worker 报告，未污染。
- 当前工作树原始测试 96/96 绿：`env -u LD_PRELOAD node --test test/gate.test.mjs`。

---

## 3. 亲跑与回归

```sh
env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: .../lib/client.js (3 modules, smoke-gated)
# BUILD_EXIT=0

env -u LD_PRELOAD npm test
# ℹ tests 101  ℹ pass 101  ℹ fail 0        [NPM_EXIT=0]

env -u LD_PRELOAD node --test test/gate.test.mjs
# ℹ tests 96  ℹ pass 96  ℹ fail 0          [GATE_EXIT=0]

git status --porcelain
#  M README.md
#  M test/gate.test.mjs
# ?? docs/handover/2026-10-24-batch2-3a-worker.md

git diff --check                           # exit 0
```

- `lib/` 零变更：build 后 status 无 `lib/`，`git diff -- lib` 为空；`src/`、`scripts/`、`package.json` 也零改动。符合“零代码”承诺。
- `npm test` 的 101 = gate 96 + client-bundle 3 + receipts-stats 2；worker 报告 §2.3/§3 的 101、96 与本机一致。
- 未运行 `realloop`：本单无源码/事件改动，`npm test` 已覆盖常跑回归；`git diff -- lib` 为空，故真时序代码未受影响。

---

## 4. 规格对照与残留风险核对

| 规格点 | 实际 | 结论 |
|---|---|---|
| README 启动级示例加 5 条敏感路径 | README.md:109-119，5 条与 §6.1 逐字一致，另保留 `src/contracts/**` | 完成 |
| 说明命中即全审 / 按仓库裁剪 / `**/` 多级 | README.md:122；后两项正确，**“无条件”需限定 maxChain**（F1） | 部分完成 |
| 单文件真实路径命中 `**/auth/**` → full | 新测试 #2；多级绝对路径 | 完成 |
| 防误伤 near-miss | 新测试 #4/#5/#6；宽匹配反证 B 红 | 完成 |
| 不加配置键、不改 src/lib | status/diff 确认 | 完成 |
| 测试 101/101、build、lib 零变更 | 实测 | 完成 |

残留风险逐条核对：

- **bash 直写路径不可匹配（属 3b）**：准确。`trackWrite` 只记录 `writeTools` 的 `file_path`；`BASH_WRITE_RE` 只武装、没有路径，`decideReview` 的 `core` 只看 `paths`，所以用 bash 改 `auth/` 文件不会触发敏感 glob。3b 的 `escalateOnPush` 尚未实现，报告措辞正确。
- **glob 大小写敏感**：准确。`globToRegExp` 用 `new RegExp(...)` 无 `i` 标志（src/state.ts:126-138），`**/Auth/**` 不匹配 `auth`。
- **`**/auth/**` 要求 `auth` 是目录段**：准确。直接矩阵 `auth-dot-ts` → micro；`/p/src/auth.ts` 不命中；需要文件时显式加 `**/auth.ts`（README 未写这条，但报告 §7 已声明，属已知边界）。
- **清单是推荐而非默认**：准确。`src/index.ts:71` `alwaysFullGlobs` 默认 `[]`，本单未改。
- **文档与测试无自动联动**：准确（见 F4）；测试数组是手工同步副本，README-only 修改不会红。

---

## 5. 文件变更与计数

```text
git diff --stat
 README.md          | 11 +++++++++--
 test/gate.test.mjs | 47 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 56 insertions(+), 2 deletions(-)
```

- README.md 239 行；test/gate.test.mjs 1761 行；worker 报告 140 行。
- 未触碰 `src/`、`lib/`、`scripts/`、`package.json`、`AGENTS.md`；未 commit。

**计数漂移（F2）**：

- `README.md:206` 仍写 `gate.test.mjs 95 例单元`；`README.md:218` 仍写 `gate 95 ... 合计 100`。
- `AGENTS.md:49` 仍写 `gate 95 例 ... 合计 100`。
- 本单新增 1 例后实际为 **gate 96 / 合计 101**；worker 报告 §3/§6 也写 96/101，但上述文档未同步。
- 这属于新增文档漂移，不是运行时回归；建议 lead 提交前改为 `gate 96`、`合计 101`。

---

## 6. Findings

### F1 · minor | `README.md:122`；`docs/handover/2026-10-24-batch2-3a-worker.md:14,128`

**事实**：README 与 worker 转述都写“敏感路径命中即**无条件**全审”；但 `decideReview` 在 `chain >= config.maxChain` 时先返回 `skip`（src/state.ts:67），`mode off`/无写也早退。direct probe：`auto chain 2 => skip`；当前测试只测 `chain:0`。README 只解释了固定 mode，没有解释 maxChain 止损。

**影响**：读者会以为敏感路径在任何情况下都强制 full；实际在链顶止损时敏感改动可能被 skip（现有全局安全设计），文档承诺与行为不一致。若产品语义确实要求“敏感路径覆盖 maxChain”，那是需要改代码/单独决策的行为变更，不属于 3a 零代码范围。

**最小修法**：把文案限定为“`mode: auto` 且未触发 `maxChain` 止损（有写入）时，命中即 full；不参与文件数/漂移判断”，或在 README 明确 maxChain 优先是既有边界；worker 报告同步修正“无条件”措辞。若决定要覆盖 maxChain，另开单评估，不在本单悄悄改。

### F2 · minor | `README.md:206,218`；`AGENTS.md:49`

**事实**：新增测试后实际 `gate 96 / client 3 / stats 2 = 101`；README 树（:206）、Commands（:218）与 AGENTS Commands（:49）仍写 gate 95 / 合计 100。worker 报告 §3/§6 已写 96/101，但文档没有同步。

**影响**：后续 agent/用户读到错误基线，测试数审计与批次收尾口径漂移；不影响运行。

**最小修法**：把三处 95→96、100→101；本 closer 不改文档，交 lead 收尾。

### F3 · minor | `test/gate.test.mjs:914-920, 925-950`；worker 报告 `:107`

**事实**：`recommended` 数组含 5 条，但新测试的正向断言只有 `**/auth/**` 与 `**/*.sql` 两组；`payment`/`crypto` 在任何一层都没有正向断言。现有 `globToRegExp` 用例（test/gate.test.mjs:958-973）覆盖 `**/auth/**`、`**/migrations/**`、`**/*.sql`、`src/contracts/**`，**不覆盖 payment/crypto**；`payment-guide.ts` 只是 near-miss 负例。`migrations` 有 matcher 层正向用例，但没有 `decideReview` 层的集成断言。worker 报告 §4 的“payment/crypto/migrations 由既有 globToRegExp 覆盖”对 payment/crypto 不成立，对 migrations 只在 matcher 层成立。直接矩阵虽证明当前 `payment-dir`/`crypto-dir`/`migrations-dir` → full，但没有回归断言。

**影响**：`**/payment/**` 或 `**/crypto/**` 在 README/测试副本中的拼写漂移不会被测试发现；推荐清单中这两条的实际正向保护没有基线；migrations 只有 matcher 级保护。属于测试质量缺口，不是当前功能错误。

**最小修法**：在同一用例追加：

```js
for (const sensitive of ['/p/src/payment/charge.ts', '/p/src/crypto/key.ts', '/p/db/migrations/001.sql']) {
  assert.equal(decideReview({ writeFiles: 1, paths: [sensitive], chain: 0, config: guarded }), 'full')
}
```

不新增测试数；同时修正 worker 报告 §4 的覆盖声明。

### F4 · info | `test/gate.test.mjs:914-916`

**事实**：注释写“if the recommendation drifts, this test is the thing that notices”，但 `recommended` 是手工复制的数组，测试不读取 README；只改 README 的 glob 或只改测试数组，测试不会自动红。worker 报告 §7 已正确写明“文档与测试无自动联动”，但测试注释的措辞容易被误读为自动同步。

**影响**：维护者可能高估该测试对 README 漂移的守护能力；实际仍需人工比对。

**最小修法**：把注释改成“与 README 手工同步；README 变更需同步本数组”，或让测试从 README 的 YAML 解析/共享常量取清单；后者属增强，不阻断 3a。

---

## 7. 转述要点（≤3 句）

1. README 示例的 YAML 独立解析通过，5 条敏感 glob 与 §6.1 逐字一致，`mode: auto` 是必要的（`decideReview` 固定 micro/full/off 早退，只有 auto 读 alwaysFullGlobs）；新测试六组断言直接调 `decideReview`，无 glob 对照 micro、auth/sql full、三条 near-miss micro 全绿。
2. 临时副本反证成立：清空 glob 让 auth full 断言红，改宽 `**/auth**` 让 `author.ts` near-miss 红；亲跑 build 0、npm 101/101（gate 96）、lib 零变更、diff --check 0。
3. 建议 lead 提交前处理三条 minor：README/报告“无条件全审”加 maxChain 限定（F1）；README/AGENTS 计数更新到 96/101（F2）；补 payment/crypto 正向断言并修正 worker 报告覆盖声明（F3）。F4 是测试/文档手工同步的 info，可后续处理。

---

## 8. 残留风险

- 敏感路径只对 `writeTools` 记录的路径生效；bash 直写没有路径（3b）——与 worker 报告一致。
- glob 大小写敏感；`**/auth/**` 要求 `auth` 为目录段，`src/auth.ts` 不命中——与报告一致。
- 测试数组与 README 手工同步，无自动联动（F4）；README-only 漂移不会红。
- `maxChain` 止损优先于敏感 glob（F1）；若产品要求敏感路径覆盖止损，需要单独改代码并重新定义安全边界，不属本次零代码 3a。
- `AGENTS.md`/README 计数未同步（F2）；提交前应修，否则下一批基线继续旧值。

---

## 9. 复核者改动与临时物

- 仓库内唯一新增：本报告（`docs/handover/2026-10-24-batch2-3a-closer.md`）。
- 未修改 `README.md`、`test/gate.test.mjs`、`src/`、`lib/`、`scripts/`、`package.json`、`AGENTS.md`；未 commit。
- `~/tmp` 一次性物：`r5-npmtest.out`、`r5-gate.out`、`r5-mutant*`、`r5-mutant-*.out`（可删）。
