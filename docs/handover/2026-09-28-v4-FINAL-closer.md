# v4-FINAL 收尾统审报告：v4 四任务整体对拍 + T3/T4 车道复核（closer）

**Status: DONE**

**裁定：PASS**（四任务全部按计划+裁定偏差收口，无未披露偏差；全链亲跑绿 build + 63/63 + 5/5；五 commit 内容与报告逐一对上；三项盲区推演均未发现 fake-green 或环境脆性。修法候选 2 项均为可选 nit，不阻塞。）

## 0. 复核方法

独立复核不背书：realloop.test.mjs 全文件 268 行逐行通读 → 计划四任务 Step 逐条对拍 → 亲跑全链 → `git show --stat` 五 commit 逐一核对 → 三项指定盲区独立推演（含额外自查 4 项）。

## 1. 复核面 ①：realloop.test.mjs 五测试断言质量

| 测试 | 断言核查 | 判定 |
|---|---|---|
| smoke: production topology | `typeof agent.steer === 'function'`——弱断言但属冒烟定位（真实覆盖在 3/4/5 号测试） | ✓ 合格 |
| smoke: Config schema | `fullAtFiles===3`、`mode==='auto'`——schema 求值锚点 | ✓ 真断言 |
| write turn 止损裁决 | `1<=steered<=2`（maxChain 契约双边界）+ `'1 个文件'`（buildDriverMessage source.summary 契约）。非恒真：steer 间谍若被绕过则 `>=1` 红；source 若未保留则回到 3+ 红。T2-CL 已核，本维持 | ✓ 真断言 |
| ack 结算/重放 | turn1 `===0`（与 3 号测试构成隐式对照组——同配方无 ack 必 steer≥1，差分隔离 ack 结算效应）+ turn2 `===0` + receipts 含 `"action":"micro"` | ✓ 真断言，实验设计好 |
| waterfall veto | A：观察者零调用 + veto 值穿透；B：观察者被调 + veto 值经 `return next()` 穿透。双向断言（plan 原文） | ✓ 真断言 |

- **fixtures 复用一致性**：`mountGateHarness` 被 1/3/4 号测试复用，契约跨测试稳定（同 baseConfig、每次调用独立 mkdtemp、独立 steer 间谍、独立 Context——零跨测试状态泄漏）。2 号（纯 schema）5 号（裸 cordis，隔离变量）按计划不挂 harness，合理。
- **共享错误假设排查**：steer 间谍依赖「loop 在 turn-stopping payload 里传同一 agent 对象引用」——若未来 loop 克隆 agent 对象，间谍失明 → `>=1` 红（红不假绿，哨兵有效）。`userMessage` 手工构造 `{role:'user', source:{kind:'user'}}` 与真实 client 构造形状一致（api-session-controller L856-860 实证），非共享错误假设。

## 2. 复核面 ②：四任务逐条对拍 + 偏差完备性

| 任务 | Step 完成度 | 偏差披露核对 |
|---|---|---|
| T1（9ccf553） | 5/5 步全落（devDep/安装四导出验证/骨架+2 冒烟/冒烟跑/全量回归）；commit 由 lead 收口 | 两项偏差（commit 移交、ctx.fiber.dispose）均披露且已入基线 ✓ |
| T2（5f4717c） | 2 步 + R1 取证（STOP→方向裁定→source 门控修复→T2-CL PASS） | 三项偏差（turn→source、lastClaimTurn 移除、断言改计数）+ T2-CL 一项事实修正（「唯一注入方」证伪）均披露 ✓ |
| T3（60693ba） | 3/3 步（ack 测试/一次全绿/回归+commit） | rider 改名（closer nit 采纳）+ `gate.DRIVER_HINT` 命名空间引用（计划原文为具名 import，等效改法已披露）✓ |
| T4（9f61462） | 3/3 步（veto 测试/一次全绿/回归+commit） | 两项环境修正（fiber.dispose、事件名沿用确认）披露 ✓ |

- **未披露偏差搜寻**：计划 Task 2/3/4 的测试代码与实际文件逐段对拍——fixtures 逐字吻合（除裁定补记 #3 的两个路由方法）、断言差异全部落在已披露偏差内。**无未披露偏差**。
- **偏差记录分布**（观察，非缺陷）：计划 addendum 只载 T2 配方 5 条；T1/T3/T4 偏差记录在各 worker 报告（已随各自 commit 入库）。记录完整但分散在 4 份文档，检索需跨文件——可接受，不建议为归档而归档。
- **commit message 与计划原文的改写**（T3/T4 措辞调整、T2 从 test: 变 fix:）：均系 lead 收口动作，与战役实际走向（STOP→修单）一致，informational。

## 3. 复核面 ③：亲跑全链 + commit 核对（closer 本机独立执行）

```
npm run build      # tsc 清
gate.test.mjs      # 63/63
realloop.test.mjs  # 5/5；[verdict] ×3：steer=2 / ack 结算+重放 0 拦截+receipt 落盘 / veto A+B 双向成立
```

五 commit 逐一对拍：

| commit | 内容 | 与报告一致性 |
|---|---|---|
| 9ccf553 | package.json +1、lock +77、realloop +62、T1 报告 | ✓ |
| 5f4717c | src 22 行变更（gate handler 单 hunk）、lib +12、realloop +119、计划 addendum +10、4 份 handover 文档 | ✓（T2-lib 报告的 src/lib/测试三面全对上） |
| 60693ba | realloop +44、T3 报告 | ✓ |
| 9f61462 | realloop +49、T4 报告 | ✓ |

工作树 clean，零未提交残留。

## 4. 复核面 ④：三项盲区独立推演

### ① veto 语义测试能否钉住语义（cordis 版本变化会否假绿）——**不能假绿，判定更比测试更稳**

逐语义轴推演（红/绿方向）：

| 假想的 cordis 语义变化 | 测试结果 | 结论 |
|---|---|---|
| 收集器语义（跑全部监听者再合并） | A 场景 probeSeen 非空 → **红** | 钉住「先决者截断后来者」承重属性 |
| 注册顺序反转（LIFO） | A 红（观察者先跑）+ B 红（观察者不被调）→ **红** | 顺序敏感方向正确 |
| 监听者签名变更（单 context 对象） | probe 的 next() 调用异常 → **红** | |
| 事件名 'fs/write-intent' 被改名/移册 | fallback 返回 undefined ≠ createIfAbsent → **红** | |
| 「首注册者返回值恒胜」语义（不截断但首值胜） | A、B **双绿**——测试无法区分此轴 | **但裁决不受影响**：该语义下后注册观察者同样不被调，fs-intent 车道死活判定（gate 的 fs 监听器永不被调）在两种语义下同真——结论比测试的区分度更鲁棒 |

结论：无 fake-green 路径；唯一测不出的语义轴（首值胜 vs 截断）不影响本测试要支撑的裁决。

### ② Task 3 receipts 断言的并行干扰——**零干扰面**

- `node --test` 每文件独立子进程、文件内测试默认串行；`mkdtemp` 每次调用生成唯一随机后缀目录——同文件 5 测试、跨文件（gate/realloop 两个进程）、乃至 `node --test test/` 全目录并发，tmpDir 均不共享，receipts.jsonl 路径互不相交。
- 干扰只剩理论形态：appendReceipt 静默失败 → 断言红（readFile 抛 ENOENT），不假绿。
- 观察项（非缺陷）：receipts 断言是 presence-only（includes），未钉「单条 receipt」契约——该契约由 gate.test.mjs 的 fakeCtx 姊妹测试覆盖（settlement 语义），realloop 测试的职责是车道路由验证，分工合理。

### ③ CI/他机可移植性——**无环境脆性**

- `mkdtemp(join(tmpdir(), 'gate-e2e-'))` + `rm recursive force`：os.tmpdir() 跨平台（Termux/Linux/macOS/Windows 均可），无 `/tmp` 硬编码。
- `waitIdle` 纯事件驱动（无 sleep）：监听器先于 `wakeDriver` 注册；agent-loop 的 status 只在**状态跃迁**时 emit（`if (status !== previousStatus)`），agent 挂载时已是 idle、wake 发生在监听器附接之后——无漏事件竞态。8s 超时对内存环路极宽裕。
- testkit 版本 exact 钉死（0.1.7-rc.2，无 caret）+ lock 入库 → 可复现。
- 环境前提一条：agent-loop 用 `Promise.withResolvers()`（node 22+ 语法）——CI 需 node ≥22，但这是 DSH 运行时自身要求，非本车道新增假设。

### 额外自查（lead 三项之外）

1. **间谍旁路**：gate 经 `payload.agent.steer?.()` 调用——payload 引用同一 agent 实例，包装生效（测试绿即动态证明）；未来若失效走红不假绿。
2. **turn2 重放形状**：`userMessage(gate.DRIVER_HINT)` 为 kind='user'——与真实 client continuation 形状一致，且 source 门控下该 claim 衰减被 chain=0 守卫挡住，断言语义正确。
3. **失败路径的计时器残留**：测试红时 waitIdle 的 8s timer 不提前清除，失败用例会拖慢进程退出至多 8s——纯体验项，不影响正确性。
4. **每测试独立 Context**：SessionId('gate-e2e') 跨测试复用但 Context 各自新建，无跨上下文会话串扰。

## 5. 修法候选（全部可选，不阻塞）

1. （nit，+1 行）T3 receipts 断言可升级为单条钉死：`receipts.trim().split('\n').length === 1`——把「结算后不二次落 receipt」也带到真时序车道。fakeCtx 姊妹已覆盖语义，属 belt-and-suspenders，按 YAGNI 默认不做。
2. （nit，0 行）偏差记录分散在 4 份 handover 文档——若后续立 README 部署约定档（Deferred 项），可顺带一行指针汇总，不必单独动作。

## 6. 转述要点（供 lead 转发用户）

v4 收尾统审 PASS：四任务对拍全绿（Step 完成度 5/5+2+3/3+3/3、偏差全披露、五 commit 与报告逐一对上、工作树 clean），全链亲跑 build + 63/63 + 5/5。三项盲区推演结论：veto 测试无 fake-green 路径（五种假想语义变化全走红，唯一测不出的轴不影响裁决）；receipts 断言零并行干扰（进程隔离 + mkdtemp 唯一目录）；车道可移植（tmpdir 跨平台、事件驱动无 sleep、依赖 exact 钉死，唯一前提 node ≥22 系 DSH 自身要求）。真时序车道 5 测试已可作长期回归哨兵：steer 间谍旁路、source 保留契约、veto 语义三处未来回归都会走红告警。

## 7. 残留风险

1. 车道与 testkit/agent-loop 版本耦合：升级 DSH 运行时后 5 测试需复查（这正是哨兵职责，红=取证入口，非缺陷）。
2. 真机宿主尚未重启加载 v3.3/v4 lib——本战役全部验证基于 lib 本体与测试车道；真机 receipts 数据（sessionFiles 虚增根因定论）仍待重启后采集（T4 报告已记）。
3. Deferred 项（README 部署约定、五分区评审输入、actor 键控）未启动，等 lead 立独立计划。
