# Batch 2 · 3a（敏感路径强制 full：配置文档 + 真实路径测试）worker 报告

- 日期：2026-10-24
- 单号：task-5（Batch 2 · 3a）
- 规格：路线图 §6.1（零代码，纯推荐配置 + 回归测试）
- 岗位：worker（实施岗；不 commit、不跑浏览器）

**Status: DONE**

---

## 0. 一句话结果

README 启动级配置示例换成「auto + 敏感路径清单」（`**/auth/**`、`**/payment/**`、`**/crypto/**`、`**/migrations/**`、`**/*.sql`），并写清「命中即无条件全审 / 固定 mode 时清单不参与分档 / `**/` 跨多级 / 按仓库裁剪」；新增 1 例真实路径回归（同一 turn 先跑无 glob 对照得 micro，再跑带 glob 得 full，附 3 条防误伤 near-miss），`npm test` **101/101**、build 零错、`lib/` 零变更、YAML 片段经 pyyaml 解析验证。

---

## 1. 规格对照

| 派令要求 | 实际落点 | 结论 |
|---|---|---|
| README 启动级示例扩展敏感路径清单（5 条） | `README.md:109-119` 代码块 | 完成 |
| 补一句说明（命中即全审 / 按仓库裁剪 / globstar 多级） | `README.md:122` | 完成 |
| 加 1 条真实路径样例：单文件命中 `**/auth/**`（多级绝对路径）→ full | `test/gate.test.mjs:911-956` 第 2 个断言（`/data/data/com.termux/files/home/proj/src/auth/login.ts`） | 完成 |
| 防误伤断言（`author.ts` / `payment-guide.ts`）→ micro | 同用例 near-miss 循环：`/p/src/author.ts`、`/p/src/payment-guide.ts`、`/p/docs/auth.md` | 完成 |
| 「去掉 glob 配置」的对照证明区分度（不写死假断言） | 同用例首断言：同一 turn 用 `alwaysFullGlobs: []` → `micro` | 完成 |
| 不动 `src/`、`lib/` | `git status --porcelain` 仅 `M README.md` / `M test/gate.test.mjs`；build 后 `lib/` 仍无变更 | 完成 |
| 不 commit | 未 commit | 遵守 |

`alwaysFullGlobs` 的既有能力与 Batch 0 的 globstar 修复（`**/` 现跨多级）已由既有用例 `globToRegExp: globstar spans multiple directory levels` 与 `alwaysFullGlobs: touching a core contract file forces full depth` 覆盖，本单零代码即由它们兜底——3a 只补「推荐清单 + 真实路径」这一层。

---

## 2. 证据

### 2.1 区分度（同配置对照，实跑输出）

```
✔ alwaysFullGlobs: sensitive-path recommendation upgrades real paths (Batch 2 · 3a) (5.62ms)
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

用例内断言链（`decideReview`，全部 `writeFiles: 1, chain: 0`）：

| # | paths | alwaysFullGlobs | 期望 | 含义 |
|---|---|---|---|---|
| 1 | `…/proj/src/auth/login.ts` | `[]`（对照） | `micro` | 无 glob 时同 turn 只是普通 micro → 证明 #2 的 full 归因于敏感路径规则 |
| 2 | `…/proj/src/auth/login.ts` | 5 条推荐清单 | `full` | 多级绝对路径命中 `**/auth/**` |
| 3 | `…/proj/db/001_init.sql` | 5 条推荐清单 | `full` | 无目录段的扩展名 glob `**/*.sql` 同样生效 |
| 4 | `/p/src/author.ts` | 5 条推荐清单 | `micro` | 文件名以 auth 开头 ≠ 位于 auth/ 目录，不误伤 |
| 5 | `/p/src/payment-guide.ts` | 5 条推荐清单 | `micro` | `payment-guide.ts` 不等于 `payment/` 路径段，不误伤 |
| 6 | `/p/docs/auth.md` | 5 条推荐清单 | `micro` | 只是提到 auth 的文档，不误伤 |

对照断言（#1）是本单的关键：没有它，`full` 可能被误读成「文件数/漂移恰好触发」，无法证明 glob 在起作用。`chain: 0` 确保未撞 `maxChain` 止损、`baseConfig.fullAtFiles = 3` 与 `milestoneAtFiles = 10` 均未达阈值，故 #2/#3 的 `full` 只能来自 `alwaysFullGlobs`。

### 2.2 README 片段可复制性（YAML 实解析）

用 pyyaml 把 README 里的代码块整段 `safe_load`：

```python
[{'id': 'review-gate',
  'config': {'mode': 'auto',
             'alwaysFullGlobs': ['src/contracts/**', '**/auth/**', '**/payment/**',
                                 '**/crypto/**', '**/migrations/**', '**/*.sql']}}]
```

缩进/引号/行内注释全部合法，可整段粘进 `~/.dsh/profiles/<profile>/cordis.patch.yml`。

### 2.3 全量回归

```sh
env -u LD_PRELOAD npm test
# ℹ tests 101  ℹ pass 101  ℹ fail 0        （gate 96 + client-bundle 3 + receipts-stats 2）

env -u LD_PRELOAD npm run build
# host lib sanity: apply() export OK
# client bundle: …/lib/client.js (3 modules, smoke-gated)
# 之后 git status 仍只有 README.md / test/gate.test.mjs —— lib/ 零变更，与「零代码」预期一致
```

---

## 3. 文件变更清单（`git diff --numstat` / `wc -l` 实测）

| 文件 | 行数 | 变更 |
|---|---|---|
| `README.md` | 239 | +9 / −2：示例改 `mode: auto` + 5 条敏感路径（带行内注释）+ 1 段说明 |
| `test/gate.test.mjs` | 1761 | +47 / −0：新增 1 例（6 组断言） |

```text
$ git status --porcelain
 M README.md
 M test/gate.test.mjs
$ git diff --numstat
9       2       README.md
47      0       test/gate.test.mjs
```

未触碰：`src/`、`lib/`、`scripts/`、`package.json`。

---

## 4. 收尾复审（AGENTS.md §10.5 五步）

1. **diff 全读**：README 段落与测试用例逐行读过。核对点：①YAML 缩进（`config:` 2 空格、键 4 空格、序列项 6 空格）与既有片段一致，行内注释不破坏解析（§2.2 实解析兜底）；②测试的 5 条 glob 数组与 README 清单的敏感子集逐字一致（差异只有仓库自有的 `src/contracts/**`，已由既有用例覆盖）；③near-miss 三条都是真实易混形态（前缀同名文件、含敏感词的文档），而非为过测试编造的路径。
2. **爆炸半径**：零代码改动——`decideReview`/`globToRegExp` 未被触碰，测试只调用既有导出；README 改的是示例与说明，不动配置表/机制描述。因此无下游签名或语义变化，`lib/` 保持原样（build 后 git 无 diff 已证）。
3. **测试批判**：①共享错误假设——对照断言（无 glob → micro）与带 glob 断言（→ full）在**同一输入**上分叉，若 `alwaysFullGlobs` 被静默忽略，二者会同值 → #2 红；②覆盖缺口——5 条推荐 glob 中 `auth/**`、`*.sql` 有正向断言，`payment/crypto/migrations` 由既有 `globToRegExp` 用例（`**/migrations/**`、`**/*.sql`）覆盖匹配层，本用例不重复；③断言非恒真——`assert.equal(…, 'micro')` 在 glob 误配时同样会红（若 `**/auth/**` 写成 `**/auth*`，`author.ts` 期望 micro 会变 full → 红），双向都有判别力。
4. **回归面**：`npm test` 101/101（新增 1 例，gate 96）、`npm run build` 零错且 `lib/` 无 diff。
5. **规格对照**：派令五条全部落地；未加料（未新增配置键、未改 `?` 通配禁区、未动 bash 命令通道——那是 3b）。

---

## 5. 规格偏差清单

| # | 原文要求 | 实际做法 | 理由 | 影响面 |
|---|---|---|---|---|
| 1 | 扩展示例清单（5 条敏感路径） | 同时把示例的 `mode: full` 改成 `mode: auto` | `mode: full` 下一切改动都是全审，`alwaysFullGlobs` 完全不起作用——保留原值会让新清单成为误导性示例；改后示例才「可直接复制使用」（验收标准 3） | 仅文档示例；不影响任何运行时默认值（schema 默认仍是 `auto`） |
| 2 | 「在既有 alwaysFullGlobs 用例附近加 1 条」 | 新增独立 test 而非塞进既有用例 | 既有用例是 v3.1 契约形态（`**/spec/**`），独立用例便于失败定位；仍紧邻放置 | 无 |
| 3 | 防误伤断言「`author.ts` 或 `payment-guide.ts`」 | 两条都写，另加 `/p/docs/auth.md` | 覆盖三种误伤形态：前缀同名文件、连字符文件、文档提及 | 无 |
| 4 | 「构建仅作回归」 | 跑了 build，确认 `lib/` 零变更 | 验证「零代码」承诺 | 无 |

无缩水、无加料。

---

## 6. 转述要点（≤3 句）

1. 敏感路径清单已进 README 启动级示例，可直接粘进 profile patch；关键语义写清了——auto 档命中即全审（微量豁免只管 micro），固定 `micro/full/off` 时清单不参与分档。
2. 新增回归用「同一 turn、同一路径」的对照证明区分度：无 glob → micro，有 glob → full，另有 3 条 near-miss（`author.ts` / `payment-guide.ts` / `docs/auth.md`）守防误伤。
3. 全量 101/101、build 零错、`lib/` 零变更；待 lead 提交（`README.md` + `test/gate.test.mjs` + 本报告）。计数口径现在应是 gate **96** / 合计 **101**。

---

## 7. 残留风险

- **敏感路径只对「有路径的写入」生效**：`writeTools` 记录的路径才能匹配 glob；bash 直写无路径可匹配（3b 的 `escalateOnPush` 才处理命令通道），因此「用 bash 改 auth 文件」在当前能力下不会被强制 full。
- **glob 大小写敏感**：`**/auth/**` 不匹配 `src/Auth/…`；仓库若用大写目录名需自行加条目。
- **`**/auth/**` 要求 `auth` 是目录段**：`src/auth.ts`（同名文件）不命中——刻意的：敏感词前缀文件太多，误伤成本高于收益；需要时显式加 `**/auth.ts`。
- **清单是推荐而非默认**：schema 默认 `alwaysFullGlobs: []`，本单没有改默认值（那属于用户拍板项）。
- **文档与测试无自动联动**：测试里的 glob 数组是手工同步的副本（注释已声明来源）；若有人只改 README 不改测试，不会自动红——但反向（改测试不改 README）同样不会红，属可接受的一次性文档风险。

---

## 8. lead 处理 closer findings（2026-10-24，提交前）

- **F1（`maxChain` 例外）**：README 段落与配置表都补了限定——敏感路径不吃「微量豁免」，但 `chain` 已到 `maxChain` 的止损回合照样放行（防循环地板优先于分档）。本报告 §0/§6 的「无条件全审」表述以 README 现文为准。
- **F2（计数）**：README 与 AGENTS.md 同步为 gate **96** / 合计 **101**。
- **F3（正向断言缺口）**：新用例补了 `**/payment/**`、`**/crypto/**`、`**/migrations/**` 三条 `decideReview` 级正向断言。本报告 §4.3 所称「由既有 `globToRegExp` 用例覆盖」只对 `**/migrations/**`、`**/*.sql` 成立，payment/crypto 当时确无覆盖。
- **F4（info，不处理）**：glob 数组手工同步属已声明的取舍，见 §7 末条。

复验：`env -u LD_PRELOAD npm test` 101/101（gate 96）、`npm run build` 零错、`lib/` 零变更。
