# dsh-review-gate 夜间批次计划（2026-09-28 晚，用户授权「自主推进」，晨间验收）

> 读法：这是今晚的执行剧本 + 明早的验收报告载体。每完成一项，在对应节追加【结果】行；晨间 digest 在文末。
> 授权边界：用户原话「晚上就麻烦你了，你写一个文档，好好规划一下，建立好 todo，明天早上看看结果」= skill 语境下的「自主推进」——按保守默认走（最小改动、最易回退），立项类新功能仍不擅自开工。

## 已在飞（接管点）
- **F1（worker 执行中）**：A noNewReviews + B receipts outcome + FULL_TEXT 边界枚举条（用户逐字批准的成稿）。令内含完整合同与验证链（build + 73 测试预期）。

## 今晚任务清单（按序执行；每项独立 commit，closer 把关）

### T1. F1 收口【结果】
- worker 交付 → lead 亲验（diff + 亲跑 73）→ closer 统审（覆盖 R1+F1，铁律 6）→ lead commit。
- 预期工件：A/B 功能 + 边界枚举条 + 测试 63+3+5+2=73 + README 配置行。

### T2. 测试脆弱性修复：ack receipt 测试固定路径残留【结果】
- 病理：gate.test.mjs 某 ack 测试用 `os.tmpdir()/review-gate-test` 固定路径，失败轮崩在清理前 → 残留行污染下轮（今晚 R1 调试实锤）。
- 修法：改 mkdtemp 随机目录（与 realloop 车道同款模式），测试内自清理。
- 验收：连续跑两遍全绿；`ls $(node -e 'console.log(require("os").tmpdir())')` 无 review-gate-test 残留。

### T3. fs-intent 死车道代码清除（deletion over addition）【结果】
- 依据：v4-T4 双闭合定论——fs/write-intent、fs/edit-intent 监听器在宿主永不被调用；v3.3 的 lastIntentPath 去重属守死车道的 no-op。
- 动作：移除两个 fs-intent 监听器 + GateState.lastIntentPath 字段 + 相关双计去重逻辑；**保留** realloop veto 语义测试（那是语义基座不是死代码）；gate.test.mjs 相关 fakeCtx 测试对齐（fs-intent 路径的测试改走 tools/result 或删除，逐条注明）。
- 风险：若未来 policy 注册顺序变化，车道会复活——用 realloop veto 测试 + README 已知边界行守住记忆。
- 验收：全链绿；`grep -c "fs/write-intent" src/` 仅剩注释引用或为零。

### T4. README 部署约定细则（v4 Deferred 项）【结果】
- 补全：slot 所有权（与 dsh-fs-observation-policy 的依赖链路语义）、tools/result 兜底为何足够、T3 死车道清除后的边界表更新。
- 纯文档，closer 顺带审。

### T5. scout 起草两份 spec 修订草案（只读，晨间用户裁决，不落码）【结果】
- ①「五分区评审输入对齐」：auto-review 的五分区（固定策略/仅 cwd 环境/带来源项目约束/过滤带来源历史/待审动作）映射到 full 指令组装的草案。
- ②「防锚定二审」终稿：基于 DSH 工具面事实（插件无强制 fork 能力，subagent 是模型工具面）的可行形态 + 成本模型 + 数据门槛。
- 落 docs/handover/2026-09-28-v5-spec-drafts-scout.md。

### T6. scout：插件 × 平台契约全面对齐审计（用户晚间追加方向）【结果】
- 方法：取证权威顺序顶层——`cordis_inspect_query` 实查 live 契约（Event.listEvents / Config.listConfigs / Tool.listTools）+ 本地 node_modules types 交叉。
- 对拍面：review-gate 全部平台接触点逐条（事件监听签名、tools/result 载荷形状、Config schema 暴露、ack 工具注册、steer/assemble 用法、自定义 source kind 机制、声明式 source folding）。
- 产出：分级优化清单（现状 / 平台现行契约 / 优化方向 / 行数账 / 风险），按【已验证/观察/待研究】分级；**只出清单不落码**——晨间用户挑选后才立项施工。
- 落 docs/handover/2026-09-28-v5-T6-contract-audit-scout.md。

## 禁区（今晚不做）
- reviewerSubagent 落码（等 receipts 数据 ≥2 周）；client Review 面板（需 UI 设计输入）；任何 config 默认值变更；git push；删除/改写既有 commit。

## 执行协议
- 每任务：worker 令（完备性：背景/任务/输出/回执/验证链）→ lead 亲验 → closer 复核 → lead 逐文件点名 commit → 更新本文件【结果】。
- 每个非用户拍板不可逆决定 → docs/handover/decisions.md 台账挂起，不落码。
- 失败 ≤3 轮修复台账，超限挂起该任务不硬闯。
- STOP 纪律不变：lib 行为与断言不符 → 取证报告，不硬修。

## 晨间 Digest（2026-09-29 早）

### 今晚完成（6/6 任务，9 commits，测试 72：gate 66 + realloop 6，全程绿）

| 任务 | 结果 | commit |
|---|---|---|
| T1 | F1 三件（noNewReviews 疲劳防护 / receipts outcome 终态语义 / 边界枚举条）+ closer 统审 PASS | `961b2e7` |
| T2 | ack receipt 测试 mkdtemp 化（残留污染源消除）+ Config K 双源交叉断言 | `140861d` |
| T3 | fs-intent 死车道全清（净删 60 行，写跟踪单信号化 + Set 幂等） | `c92be42` |
| T4 | README 部署约定节（slot 所有权 / 兜底充分性 / 重启契约） | `7f79278` |
| T5 | 两份 spec 草案（五分区对齐=建议只搬 2 个文本微调；防锚定二审=形态+成本+数据门槛齐备） | `776d1ee` |
| T6 | 契约对齐审计：10 接触点对拍，三处真偏差全经 lead 抽验实证（报告 `docs/handover/2026-09-28-v5-T6-contract-audit-scout.md`，与本 digest 同 commit 入库） | 见本 commit |

### 待你拍板（晨间决定队列，全部有草案在手）
1. **T6 Top3 小件**（共 ~5-9 行，全部 lead 抽验过）：README steer ceiling 过时更正（steer 已契约化 runtime-types.d.ts:194）/ assemble 依赖扩展字段 JSDoc+诊断收据 / Config schema pitfallsFile+receiptDir optional 化（现 schema 必填 vs 代码按可选）
2. **T5① 五分区**：scout 建议只搬 2 个文本微调，不立专项 spec（架构前提不成立）
3. **T5② reviewerSubagent**：形态/成本（full ×2-3）/数据门槛齐备，建议维持缓办等 receipts 数据
4. **stop_loss 行密度**：closer 实证两条生产触发路径（行量有界略高于预估），建议等实数据
5. **上游报障**：inspect 带输入查询被拒（"input" must be an object，桥接 bug，今日两度复现）——要不要报 DSH 上游你定

### 台账提醒
`docs/handover/decisions.md` 七项待追认已全部落位；夜间新增拍板（T2-T6 授权）源自你的「晚上就麻烦你了」授权，本 digest 即追认请求。
