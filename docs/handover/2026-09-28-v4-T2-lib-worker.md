# v4-T2-lib 执行报告：maxChain 止损失效修复（worker）

**Status: DONE_WITH_CONCERNS**（验收全绿；修复方案对合同有一处实质性修正，已用两侧实测数据论证，供 closer/lead 复审裁决）

## 实现与验收对照

| 合同验收 | 结果 |
|---|---|
| ① realloop 裁决转绿 | ✓ **[verdict] steer count = 2**（与 lead 执行模拟预测一致），断言 1<=steered<=2 绿 |
| ② gate.test.mjs claimed 衰减测试审查 | ✓ 实测原样通过（63/63）——**无需修测试数据**：其 message:{} 的 source 为 undefined ≠ 'review-gate'，衰减照发；turn 字段在新方案下不再是判据，原样保留无害 |
| ③ 验证链全绿 | ✓ `npm run build` + gate 63/63 + realloop 3/3 |
| ④ SKIP commit | ✓ 遵守 |

## 修复方案：对合同的一处实质性修正（偏差全量披露）

### 合同原方案（条款 1+2）与实测证伪过程

1. **按合同实现 turn 门控**（lastClaimTurn 字段 + `payload.turn > state.lastClaimTurn` 门控 + 每次更新）→ build 后 realloop **仍 steered=3**。
2. 探针取证（~/tmp/forensics-t2r1.mjs）：claimed 事件 turn 序列 = 全部 1（续步 claim 与初始 claim **同 turn**，假设「续步 turn 递增」证伪——同 turn 门控应生效）→ 但行为未变。
3. **SEQ 铁证**：`claimed#1(用户消息) → tools/result(state 创建) → claimed#2..4(续步)`——**state 诞生于首个 write 信号，晚于用户消息自己的 claim**。claim#1 时 handler `if (!state) return` → **lastClaimTurn 基线永远丢失** → 首个续步 claim（turn=1 > lastClaimTurn=0）被误判为新 turn → 衰减照发。
4. **补基线分支**（lastClaimTurn===0 哨兵）→ 双红：realloop 换断言红 + **fakeCtx claimed 测试红**（2!==3）——**两侧「第一次 claimed」语义相反**（真时序=续步不应衰减；fakeCtx=用户新回合应衰减），哨兵不可区分。turn 门控方案在两侧数据下无解。
5. **方案修正 = source 门控**：claimed 的 message.source.kind === 'review-gate'（buildDriverMessage 自产）→ 跳过衰减；其余（真用户消息）照衰减。**这正是 claimed handler 注释原意（"A newly claimed **user** message starts a fresh user turn"）的字面实现**，且免疫 state 创建时序。

### 两侧实测数据（方案修正的依据）

| 场景 | turn 门控（合同原案） | source 门控（修正案） |
|---|---|---|
| realloop 真时序 | steered=3（无界重放，止损失效） | **steered=2** ✓ |
| gate.test.mjs fakeCtx claimed 衰减 | 基线分支下 2!==3 红 | 原样通过 ✓ |

### 规格偏差清单

1. **条款 1（GateState.lastClaimTurn 字段）→ 移除**：source 门控无状态、无时序依赖，字段无用即死代码（deletion over addition）。原文要求增字段 → 实际未加（试加后随方案修正移除）→ 理由如上 → 影响面：无（createState 回归原形）
2. **条款 2（turn 门控）→ source 门控**：原文「仅当 payload.turn > state.lastClaimTurn 时衰减 + 每次更新」→ 实际「message.source.kind === 'review-gate' 时跳过衰减」→ 理由：turn 门控有 state 创建时序盲区（SEQ 铁证：claimed#1 早于 state 诞生），基线哨兵在两侧场景语义相反、无法区分 → 影响面：衰减判据从 turn 比较变为消息来源判别，语义锚点（注释「user message starts a fresh user turn」）不变且更精确
3. **测试断言修正（计划 Task 2 的 'probe-a.ts' 断言）→ '1 个文件' 计数断言**：buildDriverMessage 只携带文件计数与 DRIVER_HINT，从不携带路径（lib L305-312 源码 + 探针 STEER 内容证据）→ 属「测试自身假设错误」例外条款 → 影响面：断言语义从「点名文件」修正为「报告计数」（lib 真实契约）

### src 变更清单（合同范围核对）

- `src/index.ts`：**仅 claimed handler 一处**（L465-489 区域：source 门控 + 取证注释）。createState/GateState 回归原形（零净变更）。禁止顺手重构条款遵守（无其他改动）。
- `test/realloop.test.mjs`：裁决断言修正一处（'probe-a.ts' → '1 个文件'，带 lib 证据注释）。
- `lib/`：build 产物随 src 更新。

## 转述要点（供 lead 转发用户）

maxChain 止损失效已修复、验证链全绿（realloop [verdict]=2 与执行模拟预测一致）。修复方案对合同有一处实质修正：原定 turn 门控被实测证伪——state 诞生于首个 write 信号、晚于用户消息自己的 claim，turn 基线永远丢失（SEQ 铁证），且基线哨兵在真时序与 fakeCtx 两侧语义相反无解；改为 source 门控（gate 自产 driver 消息 source.kind='review-gate' 跳过衰减），是注释「user message starts a fresh user turn」的字面实现、唯一两侧全对解，附带移除了不再需要的 lastClaimTurn 字段。另：计划 Task 2 的「driver 消息点名文件」断言属测试假设错误（lib 只报文件计数），已按例外条款修正。请 closer 重点复核 source 门控语义边界（gate 自产消息一律不触发衰减是否有漏网场景）。

## 残留风险

- source 门控的边界：若未来出现「非 gate 产但也不该衰减」的 claimed 消息形态（如其他插件的 notice 注入），会误衰减——当前唯一系统注入方就是 gate（grep 实证），风险低但 closer 值得看一眼。
- buildDriverMessage 不携带路径的 lib 行为本身是否要增强（把 paths 列进 driver 消息）属产品决策，未动（合同未要求）。
