# dsh-review-gate

## Project

- DSH 宿主插件：回合级代码复审闸门。回合内发生文件写入（write/edit 工具，或 bash 命令命中写模式）→ 回合收尾前把 agent steer 回来执行分档自复审（micro 快扫 / full 全面），`review_acknowledge` 结构化回执是唯一完成信号；回执落 `~/.dsh/storages/review-gate/receipts.jsonl` 审计日志。
- 单包 TypeScript 插件，无子包。宿主经 `dsh plugin --profile web add ~/dsh-review-gate` 安装，`cordis.patch.yml` 往 profile 插一层 `id: review-gate`。
- 入口 = `src/index.ts` 的 `apply()`（package.json main 指向构建产物 `lib/index.js`）。公开面靠 index.ts 顶部 `export *` 重导出 state/instruction——拆分文件后外部导入不变，改文件名/导出名前先确认这层。

## Layout

```
├─ src/
│  ├─ index.ts        接线层：apply() + Config schema + review_acknowledge/review_gate_config 工具注册 + 全部事件监听（副作用都在这）
│  ├─ state.ts        状态机核心：decideReview 分档 / handleTurnStopping 拦截止损 / trackWrite / collectDiff / BASH_WRITE_RE / globToRegExp
│  ├─ instruction.ts  复审指令文案：MICRO_TEXT/FULL_TEXT（两档五分区）、reviewInstructionText、buildDriverMessage/buildReviewMessage
│  ├─ config-live.ts  活配置覆盖层：OVERLAY_KEYS / readOverlay / applyOverlay（原位合并）/ pickOverlay / saveOverlay（tmp+rename 原子写）
│  └─ client/         网页面板 client 半区：composer chip + 力度弹窗（React；构建 = tsc -p tsconfig.client.json + scripts/build-client.mjs 包 __ModuleLoader__ 闭包；接缝 = conversation.input.left list slot，session-scoped）
├─ test/
│  ├─ gate.test.mjs      80 例单元（import ../lib/index.js —— 不 build 就测旧码）
│  └─ realloop.test.mjs  6 例真时序（dsh-agent-loop-testkit 驱动真实 AgentLoop；npm test 不含它）
├─ lib/               tsc 产物，已入库（package main 指向 lib/，fresh clone 即可用；改 src 后重新 build 并一并提交）
├─ docs/
│  ├─ superpowers/plans/  4 份计划：v2 回执化设计 · v4 realloop 测试配方 · overnight-v5 批次剧本 · ui-panel 调参面板
│  └─ handover/           ~19 份一次性 worker/closer 报告（历史存档，不进路由）+ decisions.md 决定台账
├─ cordis.patch.yml   bundle patch：- insert 一层 id: review-gate
├─ README.md          机制/配置/部署约定的权威现状描述（改机制必同步）
└─ package.json / tsconfig.json   strict · NodeNext · ES2022；peerDeps = dsh-agent/fs/llm/system-prompt/tools + cordis + schemastery
```

## Docs

- 改任何机制/语义前 → `README.md`（信号链、已知边界 ceiling、slot 部署约定——最权威现状）
- 写/改真时序测试前 → `docs/superpowers/plans/2026-09-28-review-gate-v4-realloop-tests.md`（testkit 驱动配方、mount 顺序、诊断监听器 veto 陷阱）
- 追溯某决定为何拍板/缓办、用户授权记录 → `docs/handover/decisions.md`（决定台账：日期/动作/可逆性/依据）
- 改复审指令文案 → `src/instruction.ts`（改后必须同步 gate.test.mjs 的形态断言）
- 实现/审查「UI 调参面板」时 → `docs/superpowers/plans/2026-09-29-review-gate-ui-panel.md`（已定设计、webServer 契约取证、M0/M1 边界与禁区）
- v2 设计背景（回执化 + diff 证据注入 + 多 session 隔离）→ `docs/superpowers/plans/2026-09-27-review-gate-v2.md`
- handover/ 下其余报告是一次性历史，不路由；新报告只追加，不进本表。

## Commands

```sh
npm install                              # 装依赖（package-lock.json 权威）
npm run build                            # tsc → lib/；改 src 后必跑
npm test                                 # gate 单元 80 例；import lib/ —— 先 build 再 test，否则测旧码
node --test test/realloop.test.mjs       # 真时序 6 例（较慢，单独跑）
node --test --test-name-pattern '<子串>' test/gate.test.mjs   # 单测过滤
dsh plugin --profile web add ~/dsh-review-gate               # 安装/更新到 profile
dsh --profile web --dump-config          # 验证挂载：应出现 id: review-gate 层
```

验证顺序：改 src → build → gate + realloop 全绿 → 提交（**含 lib/**）→ 重启目标 profile → 真机验收（receipts.jsonl 留痕）。提交信息用 conventional commits（feat/fix/test/docs/refactor，git log 实况）。

## Architecture

事件流（监听器全部在 index.ts 的 `ctx.effect` 内 `yield ctx.on(...)` 注册）：

1. `tools/result` → trackWrite（按 writeTools 清单识别，读 `args.file_path`）+ bash 写模式启发式（BASH_WRITE_RE，宁多触发不漏触发）→ gradeAndArm：decideReview 即时分档置 pendingReview，每次新写使旧回执失效（新改动欠新复审）
2. `system-prompt/assemble` → pendingReview 期间向 runtime-context 注入 `review-gate` 命名段：指令文本 + 懒取证 git diff（arm 后首次 collectDiff，300 行截断，非 git 降级提示）+ bash 命令清单；micro 档 diff 行数 ≥ fullAtLines 现场升格 full。**不进对话流**——自定义 MessageSourceMap kind `'review-gate'`，client 按 source.kind !== 'user' 折叠渲染
3. `agent/turn-stopping` → handleTurnStopping：已 ack → 结算放行（full 结算 sessionFiles 漂移）；未 ack 且 chain < maxChain → steer 驱动消息（source.kind='review-gate'），chain+1，pendingReview 保留；chain 到顶 → 止损放行 + stop_loss 审计行
4. `review_acknowledge` 工具（apply 顶层注册）→ 唯一结算点：acknowledged=true、审计行、pendingReview=null、clearTurnWrites、chain=0；ack 后收到客户端重放 → 走残渣清理分支提示直接结案，不重记
5. `agent/inbox/claimed` → chain 衰减 1（止损后每个用户回合保底恢复 1 轮复审）；**source-gate**：kind==='review-gate' 的自产 driver 消息跳过衰减
6. `agent/disposed` → states 删除

- 多 session 隔离 = `Map<agent.id, GateState>`；事件载荷缺 agent.id 直接跳过跟踪。
- 活配置（UI 面板地基）：启动序 = schema 默认 → bundle patch → 存储覆盖层（receiptDir 下 config.json，原位合并即时生效）；HTTP 面 = `ctx.inject(['webServer'], …)` 惰性挂载两条 exact 路由（headless 下子 fiber pending 即无 HTTP，不破装）；`review_gate_config` 工具与 HTTP 共用同一条校验+持久化链；`pitfallsFile`/`receiptDir` 是启动级键，运行时面刻意不收。
- 分档（decideReview，纯函数）：无写且无 bash 命中 → skip；mode off / chain 到顶 → skip；固定 mode 直用；auto 下 full = 文件数 ≥ fullAtFiles ‖ session 漂移 ≥ milestoneAtFiles（受 noNewReviewsBeforeDemotion 疲劳守卫钳制）‖ 命中 alwaysFullGlobs，否则 micro。
- IO 边界：decideReview/handleTurnStopping/trackWrite 是纯函数（测试直调）；state.ts 里唯一 IO 是 collectDiff（child_process，2s 超时）；steer 与审计落盘副作用全留 index.ts。

## Conventions

- `export const inject = ['tools']` 不可删：injectable 属性只有声明了依赖才可读，漏了报 `cannot get property "tools" without inject` 整插件激活失败（真实宿主故障 2026-09-27）。
- 工具注册必须在 apply() 顶层，不能放进 ctx.effect generator——同样报 without inject（官方工具插件均此形态）。
- 头部 `import type {} from '@deepseek-ai/dsh-agent'` 等 type-only 导入不可删：它们把宿主事件名与 `context.agent` 扩展注入 cordis 类型，删了门静默失活（assemble_degraded 回执使降级可观测）。
- 复审指令只走 runtime-context 注入，不出现在对话流；steer 消息必须带 `source.kind: 'review-gate'`（既是 client 折叠渲染开关，也是 claimed 衰减的 source 门）。
- Config 键改动 → 同步 src/index.ts 的 Config schema + README 配置表。schema 是权威。
- 用户拍板的决定记入 `docs/handover/decisions.md`（决定台账），不散落在会话/报告正文里。

## Pitfalls

- **宿主不重读磁盘**：插件 bundle 加载后改 lib/ 不生效，必须重启目标 profile；`npm run build` 不触碰运行中宿主（曾因 16 小时旧 bundle 引发拦截-重发循环，误导排查）。
- **测试测的是 lib/ 不是 src/**：改 src 后忘 build → 旧码全绿假象。green ≠ 测过新码。
- **真时序测试配方**（test/realloop.test.mjs 注释即文档）：驱动真回合 = `agent.inbox.append` + `agent.wakeDriver()`，**不调 harness.claim**（claim 把回合抢给调用者 → 空步零模型调用）；`harness.create` 第二参 `{provider, model}` 必给；gate 插件必须先于 `mountAgentLoopTestHarness` 挂载（load-order-sensitive）；teardown 走 `ctx.fiber.dispose()`（cordis Context 无 dispose 方法）。
- **waterfall 事件上挂诊断监听器必须 `return next()` 透明**（跨上下文再加 `{global: true}`）——不透明监听器 = veto 整链，会砍死同链其他插件（veto 语义 realloop 双向实证）。
- **不要再接 fs/write-intent 车道**：dsh-fs-observation-policy 在 base 层先注册且终裁，review-gate 的 fs-intent 监听器从未被调用过（死车道，v5-T3 已整体清除）——写跟踪只走 tools/result + bash 启发式。
- **globToRegExp 不支持 `?` 通配**（与 globstar 量词冲突，曾有真 bug）——需要时写显式模式。
- **`node --test test/`（目录参数）在本机 node 24 报 MODULE_NOT_FOUND**——目录被当 CJS 模块加载；必须传文件路径。
- bash 直写不进 FileSystem service，事件层不可见，只有命令模式启发式部分覆盖（有误报/漏报，只武装不阻断）——补覆盖改 BASH_WRITE_RE，别幻想事件能兜住它。

## Maintenance

- 改机制必同步三处：README.md（机制/配置/边界）、本文件、decisions.md（若涉及用户拍板）。
- 计划完成后，其「已验证配方/教训」上收进本文件或 README；handover 报告只追加不路由。
- 新增长期文档：计划放 `docs/superpowers/plans/`，交接/审计报告放 `docs/handover/`，开写时在本文件 Docs 表加触发行。
- 各节条目按使用频率排序；过期条目直接删，本文件不许只增不减。
