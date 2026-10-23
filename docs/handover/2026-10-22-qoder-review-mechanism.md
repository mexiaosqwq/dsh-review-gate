# Qoder 审查机制逆向报告

> 2026-10-22 · 目标：把 Qoder 的"审查"完整拆开，弄清楚它到底在哪一层做了什么，哪些能搬到 dsh-review-gate，哪些搬不了。
>
> 取证对象：`@qoder-ai/qodercli@1.1.76`（npm 包，纯 JS bundle）+ `qodersec 0.9.5`（Qoder Security 引擎，linux-arm64 静态 Go 二进制）+ Qoder 官方文档（IDE Ultra Review / Code Security）。本机 Termux（android arm64）。

---

## 0. 结论摘要

Qoder 的"审查"不是一套机制，而是四条互相独立的路径：

| 路径 | 载体 | 审查者 | 输出 | 定位 |
|---|---|---|---|---|
| CLI `/review` | qodercli | **同会话主 agent** | 散文 findings | 快速、便宜、贴着当前任务上下文 |
| CLI `/simplify` | qodercli bundled skill | 同会话 + **4 个并行子 agent**（Agent 工具可用时） | 结构化 file/line/summary/cost | 只做质量清理，不找 bug |
| IDE `/ultra-review` | Qoder IDE | **3 个并行维度（独立执行）** | 结构化报告 | 高信噪比、精确到行 |
| Qoder Security | qodersec 二进制 + 云端 | **独立扫描引擎 + LLM + 云** | findings / SARIF / 修复建议（经用户确认） | 安全专用、分层、按量计费 |

一句话原理：

- **CLI `/review` 走"同会话提示词"路线**——不新起 reviewer，把审查指令作为隐藏 meta 消息注入当前会话，复用主 agent 已经掌握的上下文；靠提示词纪律（只报本次引入、禁 cosmetic、报前读周边、无发现明说）压噪音。
- **`/simplify` 与 `/ultra-review` 走"维度并行"路线**——把审查拆成互不干扰的独立视角，各自跑完再合并去重；区别是 `/simplify` 拆的是质量维度（Reuse/Simplification/Efficiency/Altitude），Ultra Review 拆的是评审维度（Completeness/Correctness/Impact）。
- **Qoder Security 走"独立引擎 + 分层时机"路线**——模式匹配放在本地 L1（每次写）、语义审查放在 L2（任务收尾）、跨文件数据流放在 L3（push 前）、全仓分析放在 L4（云端）；引擎负责确定性检测，LLM 负责语义，云端负责重活。
- 这四条路径共同的设计原则：**审查范围必须由 diff 界定；发现必须可定位、可行动；噪音靠"本次引入 + 确定 + 有证据"三道门过滤；重活按时机分层；修复必须经过人类决策门。**

---

## 1. 取证方法与产物

### 1.1 Qoder CLI（可运行动态取证）

```sh
npm pack @qoder-ai/qodercli@1.1.76
tar xzf qoder-ai-qodercli-1.1.76.tgz
node package/bundle/qodercli.js --version   # 1.1.76（Termux 可直接跑，仅 OpenSSL 证书目录警告）
node package/bundle/qodercli.js --help      # 完整命令面
```

包结构：

```
package/
├─ bundle/
│  ├─ qodercli.js               33MB  主 CLI bundle
│  ├─ qoder-worker-runtime.mjs  34MB  agent runtime / prompts / tools
│  ├─ builtin/                        bundled skills 与 hook 配置
│  └─ vendor/qoder-security/          Qoder Security 插件（skill + 二进制启动器）
└─ package.json
```

### 1.2 Qoder Security 引擎（静态 + 部分动态）

启动器 `vendor/qoder-security/bin/bootstrap.sh` 的下载规则：

```
BASE=https://qoder-ide.oss-accelerate.aliyuncs.com/security/qodersec
URL=${BASE}/0.9.5/codesec-cli-linux-arm64.tar.gz
```

实测下载 3.0MB，解包得到 7.2MB 的 `codesec-cli`：

```sh
file codesec-cli
# ELF 64-bit LSB executable, ARM aarch64, statically linked, stripped
```

在 Termux 上：

- `./codesec-cli --help` ✅ 正常；
- `./codesec-cli review --help` ✅ 正常（`review` 是隐藏命令，顶层 help 不列出）；
- `./codesec-cli scan --help` ✅ 正常；
- `./codesec-cli version` ❌ `SIGSYS: bad system call`（Go traceback，pc=0x13180，syscall 0x1b7；0x1b7=439，arm64 上是 `faccessat2`，Android seccomp 拦截——推断，未逐项验证）。

结论：**能静态分析、能看 help；`scan` 未实测，但 `version` 已因 SIGSYS 崩溃，且实际扫描还依赖 Qoder 登录态/云端，按此推断本机不可用**（不是"确定不能用"，是"没有继续验证的价值"）。

### 1.3 证据索引

| 证据 | 位置 | 证明什么 |
|---|---|---|
| `/review` 提示词构造函数 | `qoder-worker-runtime.mjs` 函数 `$9o`（byte 26186114） | 同会话审查的确切文案 |
| `/review` 目标指令 | 同文件函数 `uvu`（26185177） | 四种范围各自让模型跑什么 git 命令 |
| `/review` 提交动作 | 同文件函数 `PAr`（26187702） | `submit_prompt { isMeta: true }`，不新起 agent |
| `/review` 命令对象 | 同文件 `Uks` | 四范围 picker + custom 直通 |
| `/simplify` 提示词 | 同文件函数 `Zyu` / `nLo` | 四角度并行 + 单遍 fallback |
| Security 路由/门禁 | `vendor/qoder-security/skills/security-scan/SKILL.md` | L1–L4 的触发、命令、remediation gate |
| Security hooks | `vendor/qoder-security/.qoder-plugin/qoder-hooks.json` | 实际挂载点：PostToolUse L1、git push L3；Stop 为空 |
| Security 插件自述 | `vendor/qoder-security/.qoder-plugin/plugin.json` | "Pattern-based warnings on edits, cloud-backed diff review on Stop, agentic commit/push review with SHA tracking" |
| qodersec 命令面 | `codesec-cli review --help` / `scan --help` | layer/mode/platform 语义、SARIF/SCA/fail-on |
| qodersec findings schema | `codesec-cli` 字符串表 | severity/cwe_id/taint_flow_summary/confidence/fingerprint 等字段 |
| IDE Ultra Review | https://docs.qoder.com/zh/user-guide/chat/ultra-review | 三维度、严格门槛、严重度、单维容错 |
| Code Security 产品页 | https://docs.qoder.com/zh/qoder-security-guide | L1–L4、credits、全仓扫描 |

---

## 2. CLI `/review`：同会话提示词审查

### 2.1 完整链路

```
用户输入 /review [指令]
  ├─ 无参数 → Review picker（VBd）
  │    ├─ Current changes
  │    ├─ Base branch  → git branch --format=%(refname:short)，main/master 置顶，弹分支选择
  │    ├─ Commit       → git log --no-decorate --pretty=format:%H%x00%s -n 100，弹提交选择
  │    └─ Custom instructions → 输入框
  ├─ 有参数 → 直接把参数当 custom instructions
  └─ zBd() 解析为 ReviewTarget
       └─ PAr() → submit_prompt { content: $9o(target), isMeta: true }
            └─ 当前会话收到隐藏 meta 用户消息 → 主 agent 按提示词执行审查
```

关键点：

- **不新起 reviewer agent、不切换模型**。`PAr` 返回的是 `submit_prompt`，`isMeta:true` 让这条消息作为系统内部提示存在，不显示成普通用户输入。
- 审查者就是当前主 agent，因此它天然知道本次任务做过什么、为什么这么改——这是它相对 Codex 独立 child session 的优势，也是它的自审偏差来源。
- 输出默认是**普通 assistant 散文 findings**（未见结构化 schema）；没有 `review_acknowledge`、没有强制回执、没有循环止损。

### 2.2 四种范围的提示词

`uvu(target)` 会拼出不同的"先跑什么"指令：

| 范围 | 给模型的指令（原文摘要） |
|---|---|
| current_changes | 审查 working tree 的 staged + unstaged + untracked；先 `git status --short`，再用 `git diff --staged` / `git diff` 看 tracked，untracked 直接读文件 |
| base_branch | 审查当前分支相对 base 的改动；先自己找 merge-base，再 `git diff <merge-base-sha>` |
| commit | 审查指定 commit；用 `git show --stat --oneline <sha>` + `git show --format=fuller --find-renames <sha>` |
| custom | 用户指令原样作为审查要求（空则报错） |

注意 current_changes 特意点名 **untracked 文件要直接读内容**——因为 `git diff` 结构性不显示未跟踪文件。这与 dsh-review-gate 曾踩过的"新文件空 diff"是同一个坑。

### 2.3 审查提示词全文（`$9o`）

原文（英文，节选完整结构）：

```text
You are a senior engineer reviewing a colleague's code change. Your goal is to be a
helpful, thorough reviewer — the kind who catches real problems early and makes the
codebase better, without nitpicking or being unnecessarily harsh.

## What to review

${uvu(A.target)}

## What to look for

Focus on things the author would genuinely want to know before merging: correctness
issues, subtle bugs, regressions, unhandled edge cases, performance footguns,
confusing logic that will trip up the next reader, and gaps in test coverage that
leave real risk uncovered.

Stay focused on what the change itself introduces. Don't flag pre-existing issues
unrelated to this diff, cosmetic style preferences, or sweeping refactors unless the
change actively makes them necessary.

Before raising an issue, check the surrounding code to make sure you're not misreading
intent or missing context.

## How to present findings

Organize findings from most to least severe. For each one, mention the file and line,
explain why it matters, and suggest a concrete direction for the fix. Keep each finding
focused on a single issue.

If nothing actionable stands out, simply say: No actionable findings found.

Skip the preamble — lead directly with findings. Only add context where it genuinely
helps the author understand why something matters.

## Language

Respond in the same language the user is using in this conversation. If the
conversation so far is in Chinese, write your review in Chinese. If in English, write
in English. Match the user's language naturally.
```

### 2.4 设计原理拆解

这版提示词只有约 30 行，但把"审查质量"最关键的几件事都写死了：

1. **角色**：senior engineer 审同事的改动——不是"找茬机器"，也不是"舔狗"。
2. **范围**：只报本次改动引入的问题；明确禁 pre-existing、禁纯风格、禁顺手大重构。
3. **取证义务**：报之前先读周边代码，防止误读意图/漏上下文。
4. **输出纪律**：按严重度排序；每条 file+line、为什么、修复方向；一条只讲一个问题。
5. **空结果语义**：没有可行动问题就明说 `No actionable findings found`，不硬凑。
6. **语言跟随**：用户中文就中文，避免翻译腔。

它没有做：结构化字段、置信度、整体正确性判决、强制回执、成本计量、循环收敛。这些是 Ultra Review / Security 或 Codex 才有的。

---

## 3. CLI `/simplify`：四角度并行质量审查

### 3.1 定位

`simplify` 是 qodercli 的 bundled skill，描述是：

> Review the changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes. Quality only — it does not hunt for bugs.

即：**只管质量，不管正确性 bug**。这与 `/review` 形成互补：一个找 bug，一个做清理。

### 3.2 完整流程

```
Phase 0 — Gather the diff
  git diff @{upstream}...HEAD
  无 upstream → git diff main...HEAD 或 git diff HEAD~1
  有未提交改动 / range 为空 → 再 git diff HEAD，把 working tree 纳入
  如果传了 PR/branch/file → 审查该目标
        ↓
Phase 1 — Review
  Agent 工具可用：
    同一条消息起 4 个独立 review agent，各拿 diff + 一个角度：
      Reuse          — 新代码是否重复实现了已有功能？指出应复用的 helper
      Simplification — 冗余/可推导状态、复制粘贴微变、深嵌套、死代码
      Efficiency     — 重复计算、重复 IO、本可并行的串行、启动/热路径阻塞
      Altitude       — 是否只打补丁没治根因；共享基础设施上叠特例
  Agent 不可用：
    同上下文单遍跑完四个角度，并明确声明"不是完整四 agent 审查"
        ↓
  For each finding: file, line, one-line summary, concrete cost
        ↓
Phase 2 — Apply the fixes
  按同 line / 同 mechanism 去重
  直接修
  跳过：会改变预期行为的、修复范围远超 diff 的、误报的
  最后总结：修了什么、跳过什么、或确认已经干净
```

### 3.3 设计原理拆解

- **按"关注点"fan-out，而不是按文件 fan-out**。四个角度互相独立，避免一个 agent 在"复用"和"性能"之间来回切换导致深度被稀释。
- **有明确 fallback**：Agent 工具不可用时退回单遍，并在总结里诚实说明，不假装做了四 agent 审查。
- **去重键是 line/mechanism**，不是文本相似度——同一处代码被两个角度同时命中时只留一条。
- **"cost"字段**是它的特色：每条 finding 必须说清"重复了什么、浪费了什么、更难维护在哪"，而不是泛泛说"可以简化"。
- **只做质量**：不找 bug，避免与 `/review` 的职责重叠。

---

## 4. IDE `/ultra-review`：三维度并行评审

### 4.1 三个维度

| 维度 | 只盯一件事 |
|---|---|
| Completeness（需求完整度） | 变更是否真正落地需求意图；验收点、API 契约、状态分支是否覆盖；有没有只实现一半 |
| Correctness（编码正确性） | 逻辑漏洞、空指针/越界、错误处理/边界、并发/资源泄漏、明显安全/性能风险 |
| Impact（变更影响面） | 本次改动引入的副作用（全局状态、IO、并发、生命周期 hooks）；对既有契约的破坏（API、默认值、schema、配置向后兼容） |

### 4.2 合并与门槛

- 三个维度**并行执行**，各自只盯自己的事，避免维度间互相干扰、深度稀释。
- 合并阶段按**同一处代码**归并，保留证据最充分的一份。
- 每条 finding 必须同时满足：**问题确定（非推测）+ 由本次变更引入 + 有可引用的证据**。
- 严重度三档：Critical（必须修）/ Warning（建议修）/ Suggestion（可考虑）。
- 单维容错：某个维度因目标范围特殊无产出时，其他维度照常返回，报告标注缺失项。
- 范围：未提交变更（staged+unstaged）优先；没有则回退最近一次 commit；也支持指定 commit / 文件 / PR / 代码片段。

### 4.3 设计原理拆解

- **维度隔离**换深度：一个 agent 同时考虑"需求是否完整 + 代码是否正确 + 影响面是否可控"，容易每项都浅尝辄止；拆成三个独立维度后，每个都能往深里走。
- **合并去重**换信噪比：并行会带来重复，合并阶段按位置归并，避免同一问题报三遍。
- **严格门槛**换精度：`确定 + 本次引入 + 有证据` 三道门，直接砍掉推测性、历史遗留、无证据的噪音。
- **单维容错**换可用性：不因为某一个维度跑空/失败就让整次评审失败。

---

## 5. Qoder Security：独立引擎 + 分层时机

### 5.1 它不是提示词，是引擎

`plugin.json` 自述：

> Automated security review for Qoder. Pattern-based warnings on edits, cloud-backed diff review on Stop, and agentic commit/push review with SHA tracking. **All logic runs in the cross-platform qodersec binary.**

`SKILL.md` 只是**路由 + 门禁层**：它决定该跑哪一层、该不该问用户、结果怎么呈现；真正的扫描/审查在 `qodersec` 和云端。

### 5.2 四层

| 层 | 面向 | 强度 | 触发 | 命令 | 成本 |
|---|---|---|---|---|---|
| L1 | 本轮任务生成的代码 | 本地模式匹配 | 每次 Edit/Write/MultiEdit/NotebookEdit 后自动 | `review --platform=qoder --mode=hook --layer=l1` | 免费 |
| L2 | 增量代码 | 语义理解，单遍 | 任务收尾，用户主动 `/security-scan` 或推荐卡片 | `review --layer=l2`（manual） | ~5 credits/500 行 |
| L3 | 增量代码 | 跨文件、跨函数数据流 | push 前（Bash `git push *` hook 或显式请求） | `review --layer=l3` | ~20 credits/500 行 |
| L4 | 整仓 | 云端全量 + SCA | 手动 `/security-scan` 全仓 | `scan` / `scan --sca=false` | 按量 credits |

### 5.3 实际 hooks（0.9.5）

`qoder-hooks.json`：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "qodersec-launch.cmd ensure-deps --hook-event SessionStart",
        "timeout": 15, "async": true } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command",
          "command": "qodersec-launch.cmd review --platform=qoder --mode=hook --layer=l1" } ] },
      { "matcher": "Bash",
        "if": "Bash(git push *)",
        "hooks": [ { "type": "command",
          "command": "qodersec-launch.cmd review --platform=qoder --mode=hook --layer=l3" } ] }
    ],
    "Stop": []
  }
}
```

值得注意的**版本差异**：`plugin.json` 描述说 "cloud-backed diff review on Stop"，但 0.9.5 实际 `Stop` 是空数组；L2 在 skill 里是 manual 触发。这说明 Stop 自动审查可能是旧版/新版行为，或由其他注册路径动态挂载——不要按自述文案想当然。

### 5.4 L1：本地模式匹配

- 内置规则（二进制内嵌）+ 自定义规则（`security-patterns.yaml`）。
- 自定义规则位置：项目级 `<git-root>/.codesec/security-patterns.yaml`（高优先级）与用户级 `~/.qodersec/security-patterns.yaml`（合并）。
- 规则字段：`ruleName` / `substrings` / `regex`（RE2）/ `path_glob` / `paths` / `exclude_paths` / `severity`（HIGH|MEDIUM|LOW）/ `reminder`。
- 护栏：合并去重后最多 50 条；每条 reminder ≤1KB；regex ≤1000 字符；拒绝嵌套量词等 ReDoS 风险；编译失败/无匹配器的规则丢弃并记日志。
- 二进制字符串里能确认的规则类别标签至少包括 SQL / XSS / XXE / RCE / API / JWT / SSL / TLS / CWE；每条命中带 "Security note" / "Vulnerable" / "Fix example" 文案。具体内置规则集未逐条枚举——字符串表不等于完整规则目录。
- L1 的输出直接回流到会话上下文，由模型在下一轮处理（不是最终报告）。

### 5.5 L2 / L3：模型语义 + 数据流

- L2：单遍语义审查，适合任务收尾；识别 SQLi、RCE、敏感信息泄露等。
- L3：跨文件、跨函数追踪完整数据流；能看懂团队自研净化函数只过滤了单引号、但参数拼进 `order by` 所以仍然注入这类"单文件看安全、连起来有问题"的链路。
- 口径注：SKILL.md 的 manual 命令写作 `review --layer=l2`，省略了 `--mode`；而 `review --help` 显示 `--mode` 默认 `hook`，且 hook 模式只接受 l1/l3。manual 模式可能由 launcher/内部按 layer 推断，未实测——这里只把它当作"产品文档口径"，不当成二进制行为的铁证。
- L3 manual 的增量语义：**从上次手动审查基线开始，只审未审过的 commit**；跳过已审 commit（SHA 追踪），只有 working-tree 变更时回退到 L2；找不到 diff 则跳过。
- 二进制里有 `review.state.baseline`、`review.selection ... skipped_reviewed_commits`、`review.fallback layer=l3 mode=manual target=l2` 等日志字符串，印证上述行为。
- 结果经过 `returned_to_customer` / `suppressed_dedup` 计数，说明引擎侧还有一层去重。

### 5.6 L4：云端全仓扫描

- `scan --platform qoder --all`：上传代码包到云端，异步创建任务，立刻返回 `report_url / project_id / scan_id / task_name`；之后用 `scan poll --project <name> --task-id <id>` 查询。
- 上传门禁：必须弹确认（中文原文："L4 全量仓库扫描代码将会上传云端进行安全扫描……扫描完成后我们将立即永久删除您的代码"）。
- SCA 门禁：全仓扫描前单独问是否包含 SCA（软件成分分析）。
- 文件过滤：`.qodersecignore`（gitignore 语法）；默认排除 `.env*`、私钥、证书、二进制、`node_modules/`、`dist/` 等；单文件 >10MiB 不打包；上传包 >500MB 拒绝。
- 报告格式：table / json / SARIF / GitLab SAST / detailed；`--fail-on critical|high|medium|low|none` 控制 CI 退出码。
- 平台矩阵：`qoder`（qodercli relay，无需 AK/SK）、`gitlab`、`jenkins`、`hand`、`yunxiao`；不同平台的上下文来源、MR 评论回写、auto-fix 支持不同。

### 5.7 findings schema（从二进制字符串还原）

引擎侧的 finding 结构字段（JSON tag）：

```
severity, title, message, description, explanation, category, cwe_id,
file_path, file, filePath, start_line, line, lineNumber, end_line,
code_snippet, vulnerableCode, remediation_suggestion, fix,
remediation_code_example, taint_flow_summary, confidence, fingerprint
```

这比 Qoder CLI `/review` 的散文 findings 强得多：有 CWE、有行号、有污点流摘要、有置信度、有指纹（用于去重/状态跟踪）。

### 5.8 结果处理与人类决策门

这是 Qoder Security 最值得借鉴的部分：

1. **findings-first**：必须先展示全部发现（severity、category、CWE、file/line、描述、漏洞代码片段、修复建议、数据流摘要），再问用户。
2. **remediation gate**：`AskUserQuestion` 固定问句："Security issues were found. Do you want me to fix them before I continue?"，两个选项：Fix now / Continue without fixing。
3. **POST_FIX_HALT**：修完后只报告改了哪些文件、修了哪些问题、验证结果；然后停下等新消息。**不得**自动 `git add` / `commit` / `push` / PR / merge / release / deploy。
4. **不把"跳过扫描"写成持久状态**：一次 handoff 内的 skip 只在内存里，新 commit 清除。
5. **不谎报干净**：云端扫描提交后没有 inline findings，绝不能声称"没发现问题"；只有 `terminal=true` 且 counts 为 0 才能说干净。

### 5.9 设计原理拆解

- **确定性 vs 概率性分工**：模式匹配、数据流、SARIF 输出交给引擎；语义理解交给模型。LLM 不擅长稳定复现 taint 分析，引擎不擅长理解业务意图——各干各的。
- **按信任边界分层**：写代码时（L1）便宜快，任务收尾（L2）做语义，push 前（L3）做跨文件数据流，整仓（L4）上云。越接近"代码离开本机"，检查越深。
- **增量状态**：SHA baseline + skipped reviewed commits + fingerprint，避免每次重复审同一批 commit。
- **人类决策门**：扫描是自动的，修复不是；findings 必须先可见，修复后必须停，防止 agent 把"修安全问题"顺手变成"自动 push"。

---

## 6. 完整原理：四条路径的统一框架

### 6.1 三个设计轴

把 Qoder 的四条路径放到三个轴上，就能看清它为什么这么设计：

| 轴 | 取值 | Qoder 的选择 |
|---|---|---|
| 审查者独立性 | 同会话主 agent / 独立 child agent / 并行维度 / 外部引擎 | `/review` 同会话；`/simplify` 并行 4 agent；`/ultra-review` 并行 3 维；Security 外部引擎 |
| 审查时机 | 按需 / 每次写 / 任务收尾 / push 前 / 全仓 | `/review` 按需；Security L1 每次写、L2 收尾、L3 push 前、L4 全仓 |
| 输出契约 | 散文 / 结构化 findings / SARIF 报告 | `/review` 散文；`/simplify` 结构化 file/line/cost；Ultra 结构化报告；Security 完整 schema/SARIF |

### 6.2 噪音控制的五道门

Qoder 的四条路径反复出现同一组过滤条件：

1. **本次引入**：pre-existing 不报（`/review` 明确写；Ultra 的 strict gate 也写）。
2. **确定非推测**：Ultra 要求"问题确定，非推测"；`/review` 要求"报前先读周边代码"。
3. **有证据**：Ultra 要求可引用证据；`/review` 要求 file+line+why；Security 要求 code_snippet + taint flow。
4. **作者会修**：Codex rubric 里的 "author would likely fix" 同源；Qoder 用"senior engineer 审同事"的口吻表达。
5. **去重**：`/simplify` 按 line/mechanism；Ultra 按同一处代码；Security 有 `suppressed_dedup` 计数与 fingerprint。

### 6.3 成本控制的三种手段

- **分层**：L1 免费本地，L2/L3 按 credits，L4 云端按量。
- **增量**：L3 只审未审过的 commit；`/simplify` 只审 diff。
- **并行/串行选择**：`/simplify` 有 Agent 就并行四路，没有就单遍——不为了并行而并行。

### 6.4 人类控制的三个门

- **上传门禁**：L4 上传代码前必须确认。
- **SCA 门禁**：全仓扫描前单独问是否包含依赖分析。
- **修复门禁**：findings 必须先展示，修复后必须停，不许自动 push。

### 6.5 失败处理

- Ultra：单维容错，一个维度跑空不影响其他维度。
- Security：L3 manual 可回退 L2；后端不可用有 circuit breaker；不能把中断/失败说成"无发现"。
- `/simplify`：Agent 不可用回退单遍，并明确声明降级。

---

## 7. 对照：Codex / Qoder / dsh-review-gate

| 维度 | Codex `review` | Qoder CLI `/review` | Qoder `/simplify` | Qoder Ultra Review | Qoder Security | dsh-review-gate |
|---|---|---|---|---|---|---|
| 审查者 | 独立 child session | 同会话主 agent | 同会话 + 4 子 agent | 3 并行维度 | 独立引擎 + LLM + 云 | 同会话主 agent |
| 触发 | 用户 `codex review` | 用户 `/review` | 用户 `/simplify` | 用户 `/ultra-review` | 写/收尾/push/全仓 | 自动 turn-stopping |
| 范围 | uncommitted / base / commit / custom | 同左 | upstream diff | uncommitted→commit→PR/文件 | 增量/全仓 | 本回合写入 |
| 输出 | 严格 JSON findings | 散文 | file/line/summary/cost | 结构化报告 | schema/SARIF | ack 回执 |
| 优先级 | P0–P3 + confidence | 严重度排序 | 无 | Critical/Warning/Suggestion | critical/high/medium/low | info/minor/major/critical |
| 上下文 | rubric-only system prompt | 主 agent 全上下文 | 主 agent + diff | 维度隔离 | 引擎上下文 | 主 agent + 注入 diff |
| 成本 | 额外一次模型运行 | 同会话一轮 | 4 次子 agent（可选） | 3 维并行（成本未公开） | credits | 同会话额外一轮（steer） |
| 强项 | 独立性、结构化 | 贴上下文、轻 | 质量维度覆盖 | 信噪比、深度 | 安全深度、分层 | 强制触发、回执、审计 |
| 弱项 | 贵、JSON 脆 | 自审偏差 | 只做质量 | IDE-only | 闭源、计费、云 | 维度单一、无成本计量 |

**关键判断**：dsh-review-gate 与 Qoder CLI `/review` 同型（同会话、上下文注入）。这不是落后，而是不同取舍——我们换来的是自动触发、回执、审计和止损；Qoder 换来的是更轻的提示词和更贴上下文的审查。真正值得补的是 **Qoder 的精度纪律** 与 **`/simplify` 的维度拆分**，不是它的引擎。

---

## 8. Termux 可行性（实测）

### 8.1 能跑

- **Qoder CLI**：纯 JS bundle，`node bundle/qodercli.js --version` → 1.1.76；`--help` 正常。Termux 上可直接做静态/动态逆向。
- **dsh-review-gate**：Node/TS，无原生依赖；提示词级改动零风险。
- **DSH subagents**：进程内服务（`dsh-subagent`，`dsh-acp` 已在用 `ctx.get("subagents")`），做 4 角度并行 review 可行；代价是额外模型调用与延迟。

### 8.2 不能跑 / 不建议跑

- **qodersec 引擎**：静态 aarch64 Go 二进制，`--help` 可看，`version` 触发 `SIGSYS`（Android seccomp 拦截 `faccessat2`，推断）；实际扫描还需要 Qoder 登录态/云端。Termux 不可用。
- **IDE `/ultra-review`**：桌面 IDE 专属，Termux 无 IDE。
- **Qoder L4 全仓云扫**：需要上传代码、Qoder 账号、credits；与本机无关。

### 8.3 结论

> **抄提示词与流程设计：可行且零依赖；抄引擎：不可行；抄并行架构：可行但费模型调用。**

---

## 9. 对 dsh-review-gate 的可落地清单

### A. 提示词级（低成本，建议先做）

把 Qoder `/review` 的纪律并入 `FULL_TEXT` / `MICRO_TEXT`：

- 只报**本回合 diff 引入**的问题；pre-existing、纯风格、顺手大重构不报。
- 报之前先读周边代码，确认不是误读意图/漏上下文。
- 按严重度从高到低排序；每条给 file+line、为什么、修复方向。
- **没有可行动问题就明说**，不硬凑。
- 跳过前言，直接给结论。
- 用用户当前语言。

同时可把 `/simplify` 的四角度（Reuse / Simplification / Efficiency / Altitude）作为 full 档的补充检查清单，但不要与"找 bug"混在一起。

### B. 输出契约级（中成本）

- `review_acknowledge` 的 findings 增加可选 `confidence`（0–1）与 `priority`（或把 severity 映射到 P0–P3）。
- 增加 `overall_correctness`（patch is correct / incorrect）与 `overall_explanation`。
- receipts 向后兼容：新字段 optional，旧回执照常读。
- 可选：`taint_flow_summary`（安全类 finding 的数据流摘要）。

### C. 架构级（高成本，收益最大）

- **四角度并行 review**：用 DSH subagents 起 4 个独立 reviewer（Reuse/Simplification/Efficiency/Altitude 或 Completeness/Correctness/Impact），合并去重；Agent 不可用时回退单遍并声明。
- **pre-push 升级**：Qoder 的 L3 在 `git push` 前触发；我们目前只有写时 micro/任务收尾 full。可增加"检测到 push 意图 → 强制 full + 数据流"的路径。
- **去重键**：按 file+line+mechanism 合并 findings，避免同一处报多条。

### D. 不适用

- qodersec 引擎、云端 L4、IDE Ultra Review——不是 Termux/DSH 能复用的东西。

---

## 10. 附录

### 10.1 关键命令

```sh
# Qoder CLI 逆向
npm pack @qoder-ai/qodercli@1.1.76
node bundle/qodercli.js --version
node bundle/qodercli.js --help

# Qoder Security 引擎
curl -fsSL -o qodersec.tar.gz \
  https://qoder-ide.oss-accelerate.aliyuncs.com/security/qodersec/0.9.5/codesec-cli-linux-arm64.tar.gz
tar xzf qodersec.tar.gz
./codesec-cli --help
./codesec-cli review --help
./codesec-cli scan --help
./codesec-cli version   # Termux: SIGSYS
```

### 10.2 关键源码位置

| 内容 | 位置 |
|---|---|
| `/review` 提示词 | `qoder-worker-runtime.mjs` `$9o` |
| `/review` 目标指令 | 同文件 `uvu` |
| `/review` 提交动作 | 同文件 `PAr` |
| `/review` 命令对象/picker | 同文件 `Uks` / `VBd` / `zBd` |
| `/simplify` 提示词 | 同文件 `Zyu` / `nLo` |
| Security skill | `vendor/qoder-security/skills/security-scan/SKILL.md` |
| Security hooks | `vendor/qoder-security/.qoder-plugin/qoder-hooks.json` |
| Security 插件自述 | `vendor/qoder-security/.qoder-plugin/plugin.json` |
| qodersec 启动/更新 | `vendor/qoder-security/bin/{bootstrap.sh,qodersec-launch.sh}` |

### 10.3 官方文档

- Ultra Review：https://docs.qoder.com/zh/user-guide/chat/ultra-review
- Code Security：https://docs.qoder.com/zh/qoder-security-guide
- CLI Review：https://docs.qoder.com/zh/cli/review-changes
- Review & Commit：https://docs.qoder.com/zh/qoder/review-and-commit

---

## 11. 一句话总纲

> Qoder 的审查机制不是"一个更强的提示词"，而是**按审查者独立性、审查时机、输出契约三个轴分工**：同会话提示词负责贴上下文，维度并行负责覆盖与深度，独立引擎负责确定性与安全，人类决策门负责修复边界。dsh-review-gate 的骨架（自动触发/回执/审计/止损）已经比 Qoder CLI 更强，下一步应该补的是**精度纪律**与**维度拆分**，而不是换引擎。
