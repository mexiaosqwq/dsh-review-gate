# v5-T6 插件 × 平台契约全面对齐审计（scout，2026-09-28）

岗位：scout（只读，不落码，不拍板）。取证路径：`cordis_inspect_query` live 实查（Host Event 目录全量 + Config 目录首页成功；**带输入查询两度被拒**，见 2.1 待研究）→ 降级本地 node_modules types/实码交叉（`@deepseek-ai/dsh-tools` / `dsh-system-prompt` / `dsh-llm` / `dsh-agent-loop` / `dsh-agent` / `dsh-fs`）。review-gate 行号 = src/index.ts v3.3（660 行版）。

## 0. 结论速览

| # | 接触点 | 匹配状态 |
|---|---|---|
| 1 | tools/result 监听 | 运行时吻合；类型面单参窄化（契约双参）——偏差·无害 |
| 2 | agent/turn-stopping + steer | 吻合；**README ceiling 已过时**（steer 已升格类型契约）——文档偏差 |
| 3 | agent/inbox/claimed | 吻合 |
| 4 | agent/disposed | 吻合 |
| 5 | system-prompt/assemble | 运行时吻合；**依赖未文档化扩展字段 context.agent**——偏差·有静默失效面 |
| 6 | review_acknowledge 工具注册 | 吻合（output mandatory 满足） |
| 7 | Config schema | **声明/用法语义矛盾**（裸 string vs 代码按 optional 用）——观察级偏差 |
| 8 | MessageSourceMap 自定义 kind | 吻合（官方扩展模式本尊） |
| 9 | createUserMessage 构造 | 吻合（summary 未走 bound 工具，现值均 <120 无实害） |
| 10 | fs/write-intent / fs/edit-intent | 语义吻合；车道死活已定性（保留或删除待裁决） |

---

## 1. 逐条对拍

### 1.1 tools/result（src/index.ts:412-449）【已验证】

- **现状**：handler 单参 `(exec: { name: string; arguments: unknown; agent?: { id: string } })`，手写窄化；用 `exec.name/arguments/agent?.id`。
- **平台契约**（live 目录 + dsh-tools/lib/types/index.d.ts:92,209-245,282-291）：mode=emit，`'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined`。ToolExecution = ToolExecutionInput（callId/rootCallId?/name/schema?/arguments/agent?/parent?/signal）+ { rootCallId, token }，registry 在观察者运行前深冻结。
- **匹配状态**：运行时吻合（JS 忽略多余实参；所用三字段全在契约内）。两个顺带确认：①PTC 子派发（`parent` 存在）同样 emit tools/result 且 `exec.agent`=父 agent——run_code 内的 write/edit 子派发会被 trackWrite 正确捕获、外层 run_code 不在 writeTools 名单不重复计数，现状恰好正确；②emit mode=fire-and-forget，监听器无返回值契约，review-gate 无返回 ✓。
- **优化方向**：类型换 import——`import type { ToolExecution } from '@deepseek-ai/dsh-tools'`，签名改 `(exec: ToolExecution)` 并补第二参 `result`（可 `_result` 占位或省略）。**行数账：~3 行**（import 1 + 签名 1 + tools/result/claimed 两处内联类型清理）。**风险：低**——review-gate 已从 dsh-tools import defineTool（L15），无新增依赖面。收益：字段漂移（如 agent 改名）从静默降级变编译期报错。

### 1.2 agent/turn-stopping + agent.steer（src/index.ts:452-458,339-344）【已验证】

- **现状**：handler 收 `{ agent: { id; steer? } }`，`typeof payload.agent.steer === 'function'` 守卫；README.md:47 已知边界称「`agent.steer()` 是 agent-loop 的运行时能力而非 `Agent` 接口的类型契约」。
- **平台契约**（live 目录 + dsh-agent-loop/lib/types/agent.d.ts:38-42）：mode=serial，`(payload: { agent: Agent; turn: number; signal: AbortSignal })`；**ReactLoopAgent implements Agent 的接口方法集含 `send/followup/steer/inject` 四个消息注入方法，steer(input: UserMessage): void 是类型契约**。
- **匹配状态**：运行时吻合；**README ceiling 陈述已过时**——steer 改名风险已被接口契约锁死（改名=破坏性 API 变更，不再「静默」）。
- **优化方向**：只改文档——README.md:47 该句改为「steer 已纳入 Agent 接口契约（dsh-agent-loop agent.d.ts），破坏性变更有语义版本闸；typeof 守卫保留为纵深防御」。**行数账：0 行代码，README 1 处**。**风险：无**。守卫本身建议保留（防御无害，删了省 1 行但损失纵深）。

### 1.3 agent/inbox/claimed（src/index.ts:478-485）【已验证】

- **现状**：`{ agent: { id }; message: { source?: { kind?: string } } }`，source 门控 `kind==='review-gate'` 跳过 chain 衰减。
- **平台契约**（live 目录 + dsh-llm/lib/types/message.d.ts:101-122）：mode=emit，`(payload: { agent: Agent; message: UserMessage; turn: number })`；UserMessage.source: MessageSource（merge-extensible，未知 kind 逐级 fall through）。
- **匹配状态**：吻合。门控依赖「steer 消息的 source.kind 在 claimed 载荷上原样保留」——v4-T2 实码+realloop 实证（docs/handover/2026-09-28-v4-T2-lib-worker.md）。
- **优化方向**：类型随 1.1 顺路换 `UserMessage` import。无独立行动。

### 1.4 agent/disposed（src/index.ts:461-463）【已验证】

- **现状/契约**：`{ agent: { id } }` vs emit `(payload: { agent: Agent })`（live）——吻合（状态清理，无返回值需求）。无行动。

### 1.5 system-prompt/assemble（src/index.ts:490-527）【已验证 + 关键偏差】

- **现状**：waterfall 监听器 `async (assembly, context: { agent?: { id: string } }, next)`，`await next()` 后向 `out.contexts.push({ name: 'review-gate', text })` 并返回 out——waterfall「必须返回 next() 结果（可改写）」契约满足 ✓；`context.agent?.id` 查 states 键控。
- **平台契约**：live 目录 mode=waterfall，签名 `(assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>`（dsh-system-prompt/lib/types/index.d.ts:16-21）；**AssembleContext 契约字段只有 `scope?: ScopeKey` 与 `signal?`**（同文件 L37-45）；PromptAssembly.contexts: AssembledContext[]（{name, text}，L107-112）。
- **运行时实况**：调用方 `assembleContextFor(agent, signal)` 返回 `{ agent, scope: agent, ...signal }`（dsh-agent/lib/index.js:291-297）——**context.agent 与 context.scope 是同一 agent 对象引用**；system-prompt 实码注释明示 context 为「the optional scope and **plugin-defined assembly fields**」（dsh-system-prompt/lib/index.js:305 附近 JSDoc）——agent 是调用方扩展字段，非 AssembleContext 契约成员。
- **匹配状态**：运行时吻合（v2-v3.3 真机注入实证）；**类型面=依赖未文档化扩展字段**。静默失效面：harness 侧 assembleContextFor 若改名 agent 字段 → `?.` 链安全降级为「永不注入」，复审闸门无声停摆（与 typeof 守卫同一失效形态，但这里**没有等价守卫可显式告警**）。
- **优化方向**：①JSDoc 注明依赖与降级行为（0 净增行）——最小动作；②可选硬化：注入路径加一次性告警（pendingReview 非空但 context.agent 缺失时 appendReceipt 一条诊断行，~4 行）——把静默失效变成可审计事件；③不建议改用 context.scope——契约字段但运行时=同一引用，换汤不换药且引入 ScopeKey→id 的二次形状依赖。**风险：②的新增 IO 复用 appendReceipt 静默约定，无中断面**。

### 1.6 review_acknowledge 工具注册（src/index.ts:570-659）【已验证】

- **现状**：`defineTool({ name, description, parameters, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }, execute(args, exec) })`。
- **平台契约**（dsh-tools/lib/types/index.d.ts:104-131）：ToolDefinition extends ToolSchema（name/description/parameters）+ **`output: ToolOutputDefinition` 为 mandatory**（`schema: JsonSchemaNode` 对成功值强校验 + `render(args, value): ContentBlock[]` 纯投影）+ `execute(args: unknown, exec: ToolRunContext): Promise<unknown>`。
- **匹配状态**：吻合——output 已声明、render 返回合法 ContentBlock[]（text 块）、execute 双参签名吻合、参数 schema 由 defineTool 内部校验（L608 注释与契约一致）。
- **优化方向**：无必须项。`presentationMeta`（可选投影）不建议加——回执卡片已有 render 文本，YAGNI。

### 1.7 Config schema（src/index.ts:67-78）【观察】

- **现状**：`pitfallsFile: z.string()`、`receiptDir: z.string()` 裸声明（无 `.default()` 无 `.required()`）；apply 代码按 optional 用——L378 `config.pitfallsFile && existsSync(...)` falsy 守卫、L634 `config.receiptDir ?? RECEIPT_DIR` 回退。
- **平台惯例**（dsh-persona/lib/index.js:23-28 实码）：官方插件显式二分——required 用 `.required()`、可选带默认用 `.default(...)`。
- **匹配状态**：**声明/用法语义矛盾（观察级）**——裸 string 在 schemastery 的默认必填语义下，schema 说必填、代码说可缺；投影形态（配置编辑器/dump-config 呈现）未实测（inspect 带输入被拒，见 2.1）。
- **优化方向**：`pitfallsFile: z.string().optional()`、`receiptDir: z.string().default('')`（或保持 required 但删 apply 守卫——不推荐，守卫是有意降级路径）。**行数账：2 行**。**风险：低**——dump-config 契约面微变（必填→可选展示），无运行时行为变化。

### 1.8 MessageSourceMap 自定义 kind（src/index.ts:35-39）【已验证】

- **现状**：`declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'review-gate': { kind: 'review-gate' } & ContextFormed } }`（host-only 声明）。
- **平台契约**（dsh-llm/lib/types/message.d.ts:94-108）：「Merge-extensible sum type — **each producer declares its own `kind` in its own module**; there is no shared catch-all `plugin` kind」——review-gate 的写法就是官方扩展模式本尊。
- **匹配状态**：吻合。**优化方向**：无。附注：source.form 'notice' 的 summary 有 `boundContextSummary`（上限 CONTEXT_SUMMARY_MAX_CHARS=120，message.d.ts:114-120）——现状两处 summary（L234/L310）实测均短于 120 字符无实害，可不改。

### 1.9 createUserMessage 构造（src/index.ts:229-236,302-313）【已验证】

- **现状**：`createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'review-gate', form: 'notice', summary } })`。
- **平台契约**（message.d.ts:213-216）：`createUserMessage<T extends NewUserMessage>(input: T & { id?: never; role?: never }): T & Pick<UserMessage, 'id' | 'role'>`——入参禁止 id/role，返回冻结消息补 id+role。
- **匹配状态**：吻合（未传 id/role ✓，content 为合法 ContentBlock ✓）。无行动。

### 1.10 fs/write-intent / fs/edit-intent（src/index.ts:534-560）【已验证·已有定性】

- **现状**：透明观察者（`return next()`）双监听 + trackFsIntent 键控建档。
- **平台契约**（live 目录）：mode=waterfall，"Single-slot decision for the next FileSystem.writeText/editText"——first-registered wins，不调 next() 即终裁并截断后续。
- **匹配状态**：监听器写法语义正确（透明）；**车道死活已有五源+realloop A/B 双闭合定性**（dsh-fs-observation-policy base 层先注册且恒终裁——README 已知边界 + 知识页）。现状=死代码但无害。
- **优化候选（留裁决）**：删除双监听（**-27 行**，含 trackFsIntent）——前提是接受「observation-policy 未来若改为透传 next()，车道复活时 review-gate 无现有覆盖」；保留现状——零成本持有复活期权。** scout 不拍板**；倾向保留（死代码成本≈0，README 已披露）。另核查过替代通道 `fs/observed`（emit mode，不可被 veto）——**排除**：FsObservation 只有 `present`/`absent` 两种存在性观察（dsh-fs/lib/types/types.d.ts:42-47），是「文件在不在」不是「刚被写过」，read 已存在文件同样发 present，做写信号会大面积误报。

### 1.11 未采用的更优用法候选（排除记录）

- `tools/post-execute`（waterfall，Accept/replace/enrich/block）：可在结果面改写——review-gate 是观察者不需要改写权，emit 的 tools/result 够用。
- `tools/execute`（around-dispatch timeout/retry/metrics）：与写跟踪无关。
- `agent/created`（serial，per-agent 初始化）：可在建档时机上比「首个写信号懒建档」更早——但懒建档已满足需求，加它只增复杂度。

---

## 2. 分级汇总与待研究

【已验证】live Event 目录（10 接触事件的 mode+签名，本审计第一权威源）；ToolExecution/ToolDefinition/ToolOutputDefinition/PromptAssembly/AssembleContext/MessageSourceMap/createUserMessage/Agent 接口七类契约（全部 node_modules types 实码行号见各节）；assembleContextFor 运行时形状（dsh-agent/lib/index.js:291-297）；ReactLoopAgent.steer 类型契约（agent.d.ts:42）；FsObservation 语义（排除 fs/observed 通道）；dsh-persona Config 惯例。

【观察】schemastery 裸 string 的 Config 投影形态（带输入 inspect 被拒无法实测，仅惯例对照）；fs-intent 死监听的「复活期权价值」判断；1.5 优化②诊断行的必要性（取决于失效面是否真实发生）。

【待研究】**inspect 通道带输入调用被拒**：`Event.listEvents` 传 `{}` 与 `{"event":"tools/result"}` 均报 `"input" must be an object`，无输入目录模式正常——疑似 inspect 桥接对 input 的序列化/校验 bug（schema 明明声明 input 为 object 可选）。影响：单事件精确契约与 Config 分页查询两条取证路径不可用，本审计对应节降级为 types 交叉。建议 lead 报上游或换宿主重启后复测。

## 3. 建议立项优先级 Top3（是否够格由 lead/用户裁决）

1. **README ceiling 修正 + 类型顺路对齐**（README 1 处 + src ~3 行：ToolExecution/UserMessage import 换手写窄化）——零行为变化，消除两处「现状描述落后于平台契约」与字段漂移的静默失效面。
2. **Config 两字段 optional 化**（src 2 行）——声明与用法一致化，投影随官方惯例；顺带修复 dump-config 必填误导。
3. **assemble 依赖显式化**（JSDoc 0 净增行；可选 +4 行诊断收据）——未文档化扩展字段依赖是本审计唯一「静默停摆」级风险面，显式化后失效可审计。

（第 4 候选 fs-intent 双监听删除 -27 行——默认建议**不立项**，保守保留复活期权，除非用户明示洁癖优先。）
