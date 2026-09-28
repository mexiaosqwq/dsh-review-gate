# CX-SCOUT 调查报告：Codex Security 未落地功能深度研究（2026-09-28）

岗位：scout（只读调查）。研究源：`~/tmp/codex-security-src` 实码浅克隆（权威）+ review-gate v3.3（src/index.ts，commit b919a28 已构建形态）。全部结论按【已验证】（实码读毕）/【观察】（跨源推断，单点不下定论）/【待研究】分级。

先修一处旧结论：早段研究报告（~/tmp/codex-security-research.md，已沉淀记忆）称 stopAfterNoNew=「4 轮无新发现即停」。实码语义是**按 discovery worker 数累加**（`noNewStreak + accepted.length`，coordinator.ts:1153；workbench 权威侧同式 `run["consecutive_no_new"] + len(inputs)`，deep_scan_workbench.py:1678-1679），不是 reducer 轮数。一个 reducer 消费 N 个 worker 全部零新发现时 streak 一次 +N，可能一轮就到阈值。记忆已按此修正口径，本文以实码为准。

---

## 第一章 deep 扫描引擎多 agent 拓扑

### 1.1 机制还原【已验证】

拓扑分三层，两层在 TS/Python 编排码，一层在 prompt 指引码：

**编排层（coordinator + workbench）**——worker 类型只有三种（types.ts:8 `DeepScanWorkerKind = "setup" | "discovery" | "dedup"`；setup 仅作 phase 名，调度器不派 setup worker）。调度循环 coordinator.ts:652-1074：

- 发现池：`while (!deadline && (无前次reducer || noNewStreak < stopAfterNoNew) && active.size < workers && dispatched < maxDiscoveryRuns)` 派 discovery worker（L866-883），每 worker 渲染独立 prompt（templates.ts:32-53）写自己的 `workers/discovery-000N/prompt.md`。
- reducer 就绪（`reducerReady` L1205-1221）：buffer 非空且（有前次结果 或 buffer≥2 或 无活跃且触顶）——**首个语义合并必须 ≥2 个独立 discovery**（L1212-1215 注释：单 worker 不可成初次收敛）。
- FIFO buffer：完成的 discovery 进稳定缓冲，reducer 认领快照，归并期间新完成的等下一轮（类注释 L646-651）；按 `completionSequence` 保序（L1301-1309）。
- 可替换失败（L1359-1380）：`policy_refusal` / `transient_error` / `invalid_discovery_artifacts` 三类 → 单 worker 记 canceled 计数，连续达 `stopAfterConsecutiveErrors ?? stopAfterNoNew`（L705-706 回退合并）才整体失败；不可替换失败立即终止全扫。
- 收敛与封顶二值终态（types.ts:3 `TerminalReason = "saturated" | "capped"`）：saturated = reducer 完成后 `noNewStreak ≥ stopAfterNoNew && buffer 空`（L1029-1039，abort 活跃 worker）；capped = 无活跃无缓冲且触顶/到期（L909-922）。
- 恢复与幂等：全部 worker 状态持久 SQLite（workbench 是 DeepScanStore 的权威实现），重启重放 recoverAcceptedDiscoveries/recoverCompletedReducers（L1076-1168）；`finishWithReplay` 幂等重放一次防「SQLite 已提交但响应丢失」（L1250-1276）；coordinator 心跳租约 + generation 单调，失联被接替时自杀让位（L549-644）。

**worker 内部层（core-scan.md 指引，即「threat-model worker」的真实位置）**——deep discovery worker 就是跑一遍完整 Standard scan 的 Codex 线程，其内部再 fork subagents（默认 3，executor.ts:292-312 以 Codex `agents.max_threads` 传递；dedup reducer 强制 `subagents: 0`，worker-runner.ts:388）：

- **baseline subagent 防锚定**（core-scan.md:2 + threat-model.md:13-25）：`fork_turns: "none"` 起新线程，**只传**仓库路径/授权 scope/用户上下文/安全指引，明确「不传 caller 生成的威胁假设、不传本指引、不传其他 worker 的 prompt」——baseline 独立建模，主 worker 事后用 returned canonical threatModel 校准自己的模型（threat-model.md:25）。防的是父线程假设锚定子线程审计。
- **focused investigators**（core-scan.md:5）：同样 `fork_turns: "none"`，按 investigation packet（共享攻击者/资产/入口的问题组，core-scan.md:4）分工，数量由 packet 独立性决定。
- **主 worker 聚合**（core-scan.md:6-7）：合并规则=只按「同一被破坏的安全控制 + 同一有效修复」分组，禁止按 CWE/子系统/文件族合并；coverage 收敛=union（baseline ∪ investigators ∪ 主 worker 的 fully_reviewed_files）∩ 授权清单。
- 每 worker 在**隔离 artifact 目录**执行（executor.ts:568-571：discovery 只写自己目录，target 只读；reducer 写共享 artifacts）。

**reducer 层**（dedup.md 模板）：单串行语义归并器，禁看代码禁起子 agent；按 **remediation-subsumption** 合并（修保留项必然修掉被吸收项才许合并，dedup.md:17），必须 account 每个输入 finding 的 provenance（dedup.md:23），分页读取控响应体量（dedup.md:9-15）。

### 1.2 适配性判定：不搬（形态不合）+ 一件待研究

- **review-gate 的复审主体是「同一 agent 自审」**（steer 回本 agent），多 agent 拓扑的前提（N 个独立昂贵 worker 做重扫描）不存在。DSH 的 Agent Teams/subagent 是另一层（用户显式建队），review-gate 作为 harness 插件不该也无法派 subagent——若复审派 subagent 还会破坏责任链（谁为复审结论负责）。
- **可留作观察的件**：①fresh-context 防锚定思想——full 复审由同一 agent 做时天然有「自审自改」锚定；若 DSH 插件工具面未来暴露 fork/subagent 能力，full 档可考虑「无对话上下文 + diff 证据注入」的独立二审。**待研究**：DSH 插件是否有可用的 fork 工具面（本岗未查 cordis 工具清单，留 lead 定夺是否立项）。②reducer 的 provenance/account 规则对 findings 飞轮消费端（receipts→pitfalls 蒸馏）有借鉴价值，属消费端增强非闸门核心。**观察**。

---

## 第二章 sealed checkpoint bundle

### 2.1 机制还原【已验证】

**三段式：checkpoint → unsealed canonical → sealed bundle**。

**checkpoint**（artifact-scan-draft.ts:287-318）：`record_codex_security_scan_draft({complete:false})` 在「每个候选可得后 + 每个验证决策后」调用（discovery.md:9 指令 + core-scan.md:6）。落盘形态：文件名=**输入快照 sha256**（内容寻址，L621-629），写 `checkpoints/<sha256>.json`；已存在则逐字节比对不符即报错（L300-309，内容不可变）；worker layout 维护 `checkpoint-head.json` 指针（L310-317）；重试/归档的旧 checkpoint 也参与语义恢复（readArchivedWorkerCheckpoints L714+）。

**unsealed canonical 三件**（scanDraftInputSchema 驱动，recordCodexSecurityScanDraft L79-173）：findings.json / coverage.json / scan-manifest.json；worker 交 result.json（L270-275），Deep parent 由 coordinator 聚合后经 workbench completion lock 发布（server.ts:1194-1216 onComplete → recordCodexSecurityScanDraftViaWorkbench）。并发保护=`draftDigest` 乐观锁（三件内容 + 文件名的组合 sha256，L939-945）+ workbench 单锁。

**seal**（finalize_scan_contract.py，SDK finalize 唯一入口）：`_prepare_scan_finalization`（L2663-2798）读三件 → 填 envelope（producer/sealedAt）→ JSON Schema 全量校验 → 生成 `scan["artifacts"]` 清单=每件 {path, sha256, mediaType}（`_artifact_record` L2314-2328）+ coverage receipts 必须全在清单内（L2336-2343）→ `sealedAt = completedAt`（L2728）。**写序即密封语义**（`_write_prepared_scan_finalization` L2801-2830）：findings → coverage → report.md（投影）→ **scan-manifest.json 最后写**（L2827）→ `_validate_existing_seal` 逐件复核 sha256（L2346-2382，任何被清单文件事后被改即 ContractError）。sealed 后读路径同样复核（`_read_sealed_scan` L2385-2418）；save 工具拒绝编辑 sealed 文件（references/artifact-storage.md:56）；workflow 状态必须放库外（finding-workflow.ts:57）。

### 2.2 适配性判定：不搬（收益不足），投影原则留观察

- review-gate 的审计产物只有 receipts.jsonl，**appendFile 追加式本身就是不可变形态**（append-only + 每行带 ts），无多写者并发（单 agent 单 state），无事后读取的消费方——密封三件套（sha256 清单/乐观锁/只读闸）解决的是「多写者 + 事后篡改 + 长生命周期结果集」三问题，review-gate 一个都没有。YAGNI。
- **观察**：「canonical 权威 vs 派生投影」的分层（report.md/SARIF 永远从 canonical 派生、不入密封清单、不手写，scan-artifacts.md:114）对未来「复审结果聚合面板/跨会话 pitfalls 蒸馏」适用——届时 receipts.jsonl 是 canonical，任何汇总/报告都是一次性投影。现记录原则备用，不立 spec。

---

## 第三章 SARIF 投影

### 3.1 机制还原【已验证】

实现全在 `finalize_scan_contract.py`（CLI export 与 finalize 共用，cli.ts:1288-1351 `exportFindings` 调 Python）。映射规则（build_sarif L2251-2294 + _sarif_result L2216-2248 + _sarif_rule L1886-1917）：

- findings 按 `occurrenceId` 排序、按 `ruleId` 聚合成 SARIF 2.1.0 rules；rule 名=ruleId 段转可读标签（acronym 白名单大写，L1879-1883）。
- severity→level 映射 + GitHub `security-severity`：取 rule 内最高 score，未评分档 critical/high/medium/low/info = 9.5/8.0/5.0/2.0/0.0（sarif-adapter.md:18，显示值非 CVSS）。
- 每条 result：`partialFingerprints["codexSecurity/v1"]=语义指纹`（跨投影稳定）+ 可选 `primaryLocationLineHash`（GitHub 源行 hash，仅当能安全读有界非 symlink 源文件，L2145-2167）+ primary location（root-control 优先）+ 全部去重 evidence locations（L2100-2142）。
- 语义超集保留在 properties（category/confidence/findingId/occurrenceId/candidateId）；生命周期/攻击路径/coverage **有损省略**，必须回读 canonical（sarif-adapter.md:21-23）。
- 消费面：GitHub code scanning 注解；导出存 `exports/results.sarif` 与 canonical 分离；**finalization 时的自动导出 best-effort**——投影失败不破坏密封只提示重跑（`_write_sarif_projection_if_possible` L2639-2647）。

### 3.2 适配性判定：不搬（形态不合 + 收益不足）

- review_acknowledge 的 findings（{file, line?, severity(info|minor|major|critical), note}）已有 severity 枚举；review-gate 无外部消费面（无 GitHub/GUI 集成），SARIF 无对象可投影。
- **观察**：两条原则在未来做复审可视化/聚合时直接适用——①投影与权威分离 + best-effort 不阻断权威；②语义指纹（partialFingerprints 的 codexSecurity/v1 思想）用于跨会话匹配同类 finding。findings schema 的 taxonomy{category,cwe} 结构对 receipts 不必要（复审 finding 粒度小、note 自由文本足够），不搬。

---

## 第四章 硬上限工程化

### 4.1 机制还原【已验证】

四旋钮（默认值 deep-scan-defaults.ts:2-9：workers=4 / subagents=3 / stopAfterNoNew=4 / stopAfterConsecutiveErrors=3 / maxDiscoveryRuns=40 / maxTimeHours=96，上限 96 硬编码 scan-settings.ts:61-62）：

- **stopAfterNoNew**：收敛止损。streak 按 discovery worker 数累加（`new_findings>0 → 0，否则 +len(inputs)`，workbench L1678-1679 权威；coordinator 恢复逻辑 L1153 一致）；newFindings=聚合结果中前次聚合没有的 finding 身份数（artifact-validation.ts:129-137）。饱和判定还要 buffer 空（coordinator L1029-1039）；finish 时 SQLite fail-fast 校验 saturated 必须 streak≥阈值（workbench L1825-1831）——**终态合法性由持久状态机裁决，客户端不能谎报**。
- **maxDiscoveryRuns**：派发计数上限（`dispatched < max`，coordinator L871），封顶即 capped。
- **maxTimeHours**：从 run createdAt 起算的 deadline timer（L514-547），到点 abort discovery（不再派新 worker，缓冲内照常归并）；「到期且零产出」是唯一允许无 reducer 收尾的豁免（zero_discovery_deadline，workbench L1865-1876）。
- **stopAfterConsecutiveErrors**：连续失败止损，缺省回退 stopAfterNoNew（L705-706）；只对可替换失败计数。
- 交互：四者与（deadline ∧ streak ∧ 池空）共同决定终态二值（saturated=质量收敛 / capped=资源触顶）——**终态自带语义标签**，下游（coverage completeness、report 措辞、failure_capped 特判 workbench L1733-1789）按终态分叉。

review-gate 现状对照：maxChain=stopAfterConsecutiveErrors 的对应物（src/index.ts:339-343 止损 + claimed 衰减 L478-485 恢复）；FULL_TEXT 已有 stop-after-no-new 的**提示词版**（L220「复审-修复循环直到连续一轮零新发现才算收口」——单轮复审内的循环承诺，无状态机支撑）。

### 4.2 适配性判定：改造搬（两个小件），行数账如下

**改造件 A：会话级复审收敛疲劳防护（noNewReviews）**——把 Codex 的 stopAfterNoNew 从「提示词承诺」升级为会话级状态机：连续 K 次 full 复审零新发现 → 降格后续 milestone 升格（drifted 判定不再触发 full）。

- 语义依据：Codex 侧 streak 的可靠性来自完整 Standard scan + validator；review-gate 的 findings=[] 可能是「真没问题」也可能是敷衍——所以只收窄「会话漂移升格」这一档（milestoneAtFiles 触发的 full），不动 micro/full 基本分档、不动 maxChain 止损，K 建议取 3（配置键）。
- 落点与行数账（src/index.ts）：GateState +1 字段（`noNewReviews: number`）+1 行；createState +1；review_acknowledge execute 结算处（L631-655 ack 分支）`state.noNewReviews = (action==='full' && (a.findings??[]).length===0) ? state.noNewReviews+1 : 0` +2；decideReview 加参数 `noNewReviews` 与 config 项，drifted 改 `(sessionFiles>=milestoneAtFiles && noNewReviews<K)` +3；Config schema +1（默认 3）；README 配置表 +1 行。**合计 src ~9 行 + 测试 gate.test.mjs ~3 用例 + README 1 行**。
- 风险：①decideReview 是纯函数，签名变化波及既有测试调用点（机械改，测试文件 ~5 处）；②敷衍复审误触发降格——降格只影响 milestone 漂移升格（本身就是弱信号），K=3 时误伤面小；③新配置键属公开面，README 需同步。
- spec 修订草案（v2 计划附录或独立小节）：

> **复审收敛疲劳防护（Codex stopAfterNoNew 改造版）**：GateState 增加 noNewReviews 计数。review_acknowledge 成功结算且本次 action=full 且 findings 为空数组时 +1，否则清零。decideReview 的 milestone 漂移升格（sessionFiles≥milestoneAtFiles→full）仅在 noNewReviews < noNewReviewsBeforeDemotion（配置，默认 3）时生效。该计数不影响 micro/full 基本分档、maxChain 止损与 claimed 衰减。理由：full 复审连续零产出说明会话改动质量稳定，milestone 升格的复审税无边际收益；判据可靠性低于 Codex（无 validator），故只收窄弱信号档且 K 取大。 receipts 的 cost 对象同步记录 noNewReviews 供审计。

**改造件 B：终态语义观测（receipts 记 outcome）**——Codex 的 saturated/capped 终态标签让「收敛完成」与「止损放弃」可区分。review-gate 的 receipts 目前只在 ack 时写（L634-649），止损放行（maxChain 触发）**不留任何审计行**——capped 率（复审被迫放弃率）不可观测。

- 落点与行数账：turn-stopping 监听器（L453-458）接住 handleTurnStopping 返回值（现在被丢弃，+1 行）；返回 'skip' 且 chain≥maxChain 时 appendReceipt({outcome:'stop_loss', chain, files}) +3 行（handleTurnStopping 保持纯函数，IO 在监听器侧）；ack 分支 receipts 加 `outcome:'acknowledged'` +1 行。**合计 ~5 行 + 测试 2 用例**。
- 风险：止损落盘会新增 receipts 行密度（每止损一行）——可接受，receipts 本就逐 ack 一行。
- spec 修订草案一句版：receipts 行增加 outcome 字段（'acknowledged' | 'stop_loss'），止损放行在监听器侧补写审计行；消费端可统计复审放弃率。

**不搬**：maxTimeHours（复审秒级，无时间上限需求）、maxDiscoveryRuns 的累计上限形态（review-gate 的「写→复审→ack→再写」每轮都有真实写操作，是正常工作流不是 pin 循环，连续计数已由 maxChain 覆盖）。

---

## 结论汇总（按分级）

【已验证】四件机制的源码级还原（行号见各章）；stopAfterNoNew 实码语义=discovery worker 数粒度（修正旧报告「轮」的说法）；sealed bundle 写序=manifest 最后写即密封点，读路径双向复核 sha256；SARIF=canonical 的有损确定性投影，best-effort 不破坏密封。

【观察】投影与权威分离原则、语义指纹、reducer provenance/account 规则——均为未来消费端（复审聚合面板/pitfalls 蒸馏）备用原则，现不立 spec；fresh-context 防锚定二审受 DSH 插件工具面能力约束。

【待研究】①DSH 插件面是否有可用的 fork/subagent 能力（决定防锚定二审是否可立项，本岗只读边界内未查 cordis 工具清单）；②noNewReviews 降格判据在真实会话的误伤率（需真机 receipts 数据，与 v4-T4 的 receipts 归因调查共享数据源）。

改造搬候选仅两件（A noNewReviews ~9 行、B outcome 观测 ~5 行），均为小件且不改契约面（A 新增 1 配置键除外）；四件中无一件值得直接搬。
