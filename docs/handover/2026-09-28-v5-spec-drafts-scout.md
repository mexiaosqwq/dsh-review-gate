# v5-T5 spec 修订草案：五分区评审输入对齐 + 防锚定二审（scout，2026-09-28）

岗位：scout（只读研究，不落码，不拍板）。两份草案供晨间用户裁决。源面：`@deepseek-ai/dsh-experimental-auto-review`（DSH 宿主 node_modules 本地实包）、`dsh-subagent` README、review-gate v3.3（src/index.ts）。行号均实测。

---

## 第一章 五分区评审输入对齐

### 1.1 机制依据【已验证】

auto-review 的评审输入由固定策略段 + 四数据段构成（lib/index.js:321-333 `reviewUserText`）：

1. **REVIEW_POLICY**（固定策略）：确定性文本常量（lib/index.js:19-52），含 risk/decision 协议与 fail-closed 规则；「replaces human approval for exactly one action」（README.md:87）。
2. **ENVIRONMENT**：仅 `{cwd}` 一个字段（lib/index.js:324-325；cwd 缺失直接抛错 L221）。
3. **PROJECT_INSTRUCTIONS**（带来源项目约束）：从会话面过滤 `isProjectInstruction` 的 user-message，**保留 source 归因**（lib/index.js:257-264，role:"constraint"）。
4. **FILTERED_HISTORY**（过滤带来源历史）：历史条目逐类带 source role（"human-instruction"/"direct-parent-instruction"/"constraint"/"checkpoint"/"fact"，REVIEW_POLICY 内文）；**排除** Main-agent system/message 节点、assistant 文本与推理、工具结果（README.md:60）；工具调用保留 name/arguments 原样（lib/index.js:290-306）。
5. **PENDING_ACTION**：从 schema 还原的完整待审动作（nativeAction/ptcAction，lib/index.js:311）。

设计精髓：评审者是**独立 LLM 调用**，无会话记忆 → 输入必须从会话面重建为一份冻结快照（`snapshotAutoReview`，lib/index.js:214-320，deepFreeze）；排除推理文本与工具结果=只给事实不给叙事，防评审者被主 agent 的自我陈述锚定；历史带来源=约束与事实的授权效力可区分（checkpoint 可恢复上下文但不获得指令效力，REVIEW_POLICY 内文）。

### 1.2 现状对照（review-gate full 指令组装，src/index.ts）

full 指令 = FULL_TEXT（L213-221，步骤 0-5）+ pitfallsFile 段（reviewInstructionText L292-295）+ diff 证据段 + bash 命令段（assemble 监听器 L512-523）。

| Codex 分区 | review-gate 现状 | 档位 | 差距说明 |
|---|---|---|---|
| 固定策略 | FULL_TEXT 步骤 0-5（确定性文本，仅 files 数参数化） | **已覆盖** | 复审程序即策略；约定不变 |
| 仅 cwd 环境 | 无显式环境段；非 git 降级提示 L514 | **部分覆盖（有意不覆盖）** | 复审者=同一会话同一 agent，环境天然已知；补环境段纯膨胀 |
| 带来源项目约束 | pitfallsFile 段（L292-295） | **部分覆盖** | a) 陷阱条目**无来源标注**（哪条规则来自哪个决策/事故不可核实）；b) 通道只有一份用户配置文件（AGENTS.md 本体不注入——但同会话 system prompt 已含，天然可见，非缺口） |
| 过滤带来源历史 | diff 证据段（300 行截断）+ bash 命令清单（L515-519） | **部分覆盖** | 客观事实面（diff/命令）已注入且这正是 auto-review 排除推理的镜像；缺「diff 为准、记忆存疑」的显式条款——自审锚定的轻量对冲 |
| 待审动作清单 | 步骤 0「先列出改动文件清单」+ pendingReview.paths 快照（arm 时冻结，L252-259）+ 回执 files 对照 | **已覆盖** | paths 快照即冻结动作面 |

### 1.3 缺失件草案（两个纯文本微调，不立专项 spec 的理由见 1.5）

**草案 a：pitfalls 来源标注约定**（改 pitfallsFile 格式约定 = 文档侧；指令段补一句）

pitfallsFile 条目格式约定追加一列「来源」（一句注明规则出处：决策记录/事故判例/用户拍板）。FULL_TEXT pitfalls 段标题行改为：

> `### 已知项目陷阱（复审时逐条对照，避免重犯已蒸馏过的坑；条目来源仅供核实规则现状——规则是否仍适用以当前代码为准，不因「有出处」而免验）`

- 行数账：src/index.ts L294 字符串 +1 行改写；gate.test.mjs 文本断言 +1 用例。合计 **src 1 行 + 测试 1 例**。
- 风险：低——纯文本，pitfalls 文件由用户维护，旧格式文件缺来源列时段头照常工作（来源是可选信息）。

**草案 b：「diff 为准」条款**（自审锚定的轻量对冲）

FULL_TEXT 步骤 1 追加半句：

> `……边界漏判；diff 是唯一事实基准——你的记忆与 diff 冲突时以 diff 为准，凭记忆「记得改过」不构成已验证`

- 行数账：src/index.ts L215 字符串内追加（同字符串行，**0 净增行**）；测试文本断言同步。
- 风险：低——与步骤 1 既有「逐行读本次全部 diff」同向强化，无新执行面。

### 1.4 行数账合计

src 1 行净增 + 1 处字符串内追加 + 测试 2 例 + pitfalls 文件格式约定（README 或模板侧一段说明）。

### 1.5 不立 spec 的反方理由（建议采纳草案但**不立「五分区对齐」专项 spec**）

- 五分区架构的成立前提是「评审者=无会话记忆的独立 LLM 调用」（README.md:60 的排除设计、快照冻结全为此服务）；review-gate 复审者=同一会话 agent，四数据段里两条（环境、历史可见性）天然满足、一条（动作冻结）已实现，**真正可搬的只有两个文本微调**。立「对齐」专项是把不适配的架构当目标，违反规格是行为约束契约的原则。
- 两个草案都是 FULL_TEXT 内的措辞级修改，随下一次 full 指令迭代顺路落地即可，专项 spec 的评审成本大于收益。

---

## 第二章 防锚定二审（reviewerSubagent）终稿

### 2.1 机制依据【已验证】

- **DSH 工具面事实**：subagent 委托是**模型工具面**——dsh-subagent 通过 delegation tool 把 provider 注册成模型可见的静态工具行（README.md:32-37），one-shot child 返回单结果（README.md:12）；插件**无强制 fork 能力**（review-gate 只能改指令文本与监听事件，工具调用权在模型）。结论：二审只能走「指令驱动」，强制力=指令服从性，非 harness 保证。
- **fresh-context 语义**：one-shot 子代理不继承父对话（dsh-subagent README.md:12「Choose one-shot children for a single result」；本会话工具面 subagent「不继承对话」）——正是 Codex baseline subagent `fork_turns:"none"`（core-scan.md:2）的对应物。
- **权限面**：Auto 模式下 ordinary project-local 只读复审=low+allow 自动放行不打断（dsh-subagent README.md:107）；手动审批模式每次派发弹审批（摩擦点，见风险）。
- **token 隔离**：子代理 token 不进父会话 meter——复审成本挪出主会话，对长会话的压缩压力反而友好（dsh-compaction 按 session 上下文计量）。

### 2.2 草案：配置键 + full 指令条件化追加段

**配置**：`reviewerSubagent: boolean`，默认 `false`（Config schema +1 键；README 配置表 +1 行）。

**指令段**（assemble 注入处按 `config.reviewerSubagent && p.action === 'full'` 条件拼接，常量形式）：

> `### 独立二审（reviewerSubagent 已开启）\n在完成你自己的复审步骤后，用 subagent 工具派一个 fresh-context 二审（不继承本对话）：prompt 必须自足——附上方完整复审指令、本回合 diff 证据、项目陷阱段，并声明「这是独立代码复审，只依据所附 diff 与你自己读到的文件，无其他上下文」。二审只读排查，不改文件。收到二审结果后：其 findings 与你的 findings **取并集**逐条核实（二审发现不自动采信，须对照源码确认），确认后由你调用 review_acknowledge 转写回执——files/findings 原样转写，summary 注明「含 fresh-context 二审」。若 subagent 工具不可用或派发失败，回退为纯自审并在 summary 注明「二审不可用」。`

- 行数账：src/index.ts 常量 ~7 行 + assemble 条件拼接 +1 行 + Config 键 +1 行 = **src ~9 行 + 测试 2-3 例（off 不追加/on 追加/非 full 不追加）+ README 1 行**。
- 与现有机制的交互：二审发现的修复由父 agent 执行 → 写信号重新武装 pendingReview → 下一轮复审——maxChain 止损兜底已有（L339-343），无需新机制；ack 由父 agent 转写——依据是架构推断：review-gate 的回执工具按 agent 工具面注册，one-shot 子代理工具面独立，大概率不挂该工具（未实测，实施前需一次真机验证；若子代理恰好可见回执工具，须在指令段禁止其调用）。

### 2.3 成本模型（token 增量估算）

- 子代理自足输入：指令段+任务说明 ~1.5-2k + diff ≤300 行 ~3-6k + pitfalls ~1-2k ≈ **6-10k tok 输入**。
- 冷读无缓存：子代理重读改动文件，每文件全文 2-5k tok 全价（父 agent 同会话重读走 prompt cache，约 0.1× 计价）——**这是主要增量**，随 full 改动文件数线性放大。
- 父侧：等待+核实+转写，输出 ~0.5-1k。
- 粗估总账：**full 复审单次 token 成本 ×2~3，延迟 +1~2 分钟**（子代理冷启动+独立读文件）。
- 对冲项：token 挪到子会话，父会话 meter 不涨（压缩压力不升）。

### 2.4 数据门槛（配合 CX-SCOUT 改造件 B 的 outcome 字段）

先落 B 件（receipts 补 outcome: 'acknowledged'|'stop_loss'），积累真机数据后按 receipts 统计三指标再定是否默认开：

1. **full 触发率** = receipts 中 action='full' 且 outcome='acknowledged' 占比；
2. **full findings 命中率** = full 回执 findings.length>0 占比；
3. **止损率** = outcome='stop_loss' 占比（full 复审被迫放弃的规模）。

判定矩阵：触发率高+命中率高 → 现 full 有效，二审边际收益存疑；触发率高+命中率低 → 复审税高收益低，**先调分档阈值（fullAtFiles/fullAtLines）而非加二审**；触发率低+命中率高 → full 稀有且关键，二审成本可承受，默认开可议。

### 2.5 风险与反方理由

**风险**：
1. **指令不可强制**：模型可以不调 subagent 直接 ack（指令服从性≈Codex 侧无 validator 的对应弱点）——回退条款让降级显式可见（summary 注明），不静默。
2. **互斥悖论（核心反方）**：二审的成立前提是「现 full 复审无效（锚定漏检）」，而数据门槛的启动条件是「full 命中率高（有效）」——两者互斥，特性可能永远不满足默认开的条件。这不是缺陷而是**观测驱动设计**的本意：配置键+指令段先落地（默认 off，成本为零），启用与否完全交给 receipts 数据。
3. **转写忠实性**：ack 由父 agent 转写，findings 可能被父 agent 篡改/省略——receipts 审计面无法区分「自审发现」与「二审转写」，只能靠 summary 标注。升级路径（不在本草案）：二审结果让 subagent 结构化返回，父 agent 回执贴原文。
4. **手动审批模式摩擦**：非 Auto 权限下每次派发弹审批，复审流程被人工打断——默认 off 的第二理由。

**不立 spec 的反方理由**：本草案本体就是「可选特性 + 观测门槛」，若用户裁定「full 指令迭代先落第一章两件，二审等 B 件数据再说」，则本章整体可挂 Backlog 不立 spec——此时唯一动作是把 2.4 的判定矩阵记入 review-gate README 已知边界或 Backlog 节，防止观测意图丢失。

---

## 结论汇总

【已验证】五分区实码构成与排除语义（auto-review lib/index.js:19-52/214-333 + README.md:60/87）；subagent 工具面契约（模型静态工具行、one-shot 不继承对话、Auto low+allow 自动放行）；review-gate 五分区对照三档表（已覆盖×2 / 部分覆盖×3 / 有意不覆盖×1，见 1.2）。
【观察】五分区可搬残余=两个文本微调（pitfalls 来源标注 + diff 为准条款，合计 src 净增 1 行）；二审成本 ×2~3 的估算基于 prompt cache 计价惯例，未实测。
【待研究】receipts 三指标真机数据（依赖改造件 B outcome 字段落码）；fresh-context 二审的实机 token 增量（估 ×2~3，需一次真实派发验证）。

两章均含不立 spec 反方理由：第一章建议「采纳微调、不立专项」；第二章建议「落地配置键默认 off、启用交给数据，或整体挂 Backlog」。裁决权在用户。
