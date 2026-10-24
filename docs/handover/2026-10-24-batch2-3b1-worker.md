# Batch 2 · 3b-① worker 报告：bash 命令记录通道 + `escalateOnPush` 配置键

- 任务：task-6（Batch 2 · 3b-①，纯管道、零行为变更）
- 基线：HEAD `aa4272c`（3a 已收口）
- 日期：2026-10-24
- 席位：worker（实现席，不 commit）

**Status: DONE**

## 0. 文件清单（本单改动）

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/state.ts` | 手改 | `ReviewGateConfig.escalateOnPush?` + `GateState.pushHistory` + `createState` 初始化 + `clearTurnWrites` 清空 + 新增导出纯函数 `recordPushHistory` |
| `src/index.ts` | 手改 | Config schema 键 + import + bash 监听器记录分支 + `review_gate_config` 工具 set 参数 schema / args 类型 |
| `src/config-live.ts` | 手改 | `OVERLAY_KEYS` 追加 `'escalateOnPush'` |
| `test/gate.test.mjs` | 手改 | 新增 4 例：`recordPushHistory` 纯函数 / `clearTurnWrites` 结算 / 监听器零行为变更回归 / schema+set round-trip |
| `README.md` | 手改 | 配置表新增一行；L105 运行时键清单同步 |
| `lib/**`（7 个产物文件） | build 生成 | `npm run build` 产物，随单提交（未手改） |

`git diff --numstat`（不含 lib/）：

```
2	1	README.md
1	0	src/config-live.ts
17	0	src/index.ts
26	0	src/state.ts
83	0	test/gate.test.mjs
```

lib 产物：`lib/config-live.js` +1、`lib/index.js` +15/-1、`lib/state.js` +15、`lib/types/{config-live,index,state}.d.ts` 各 +1/+2/+19。

## 1. 规格对照（逐条）

| # | 派令要求 | 落地 | 位置 |
|---|---|---|---|
| 1 | Config schema 加 `escalateOnPush: z.boolean().default(false)`，注释说明默认 false 不改现有行为 | ✅ 等价英文注释：opt-in 记录，3b-② 消费，默认 false 行为不变 | `src/index.ts:73-76` |
| 2 | `OVERLAY_KEYS` 追加 `'escalateOnPush'` | ✅ 追加在 `noNewReviewsBeforeDemotion` 之后 | `src/config-live.ts:29` |
| 3 | 工具 set 参数 schema + 参数类型 + 应用分支；描述写清默认 false 与作用；HTTP 面沿用透传 | ✅ schema `{type:'boolean'}` + 描述（含「默认 false / 记录 bash 命令 / push 类升级判定 / 内存态 ≤20 条×300 字符 / 结算即清 / 不注入指令」）；`a` 类型加 `escalateOnPush?: boolean`；应用分支由既有 `for (const key of OVERLAY_KEYS)` 循环自动覆盖（未新造通道，HTTP `pickOverlay` 同源） | `src/index.ts:790-794`、`:813`、应用分支由 `:855-861` 的既有循环覆盖 |
| 4 | `GateState.pushHistory` + 注释四要素；`createState` 初始化；`clearTurnWrites` 清空；纯函数 `recordPushHistory`（非字符串/空串 return、>300 截断、>20 shift） | ✅ 注释含「仅 escalateOnPush 开启时 / 内存态 / 不持久化 / 不注入指令 / 结算即清」；`recordPushHistory` 导出，签名 `(history: string[], command: unknown): void` | `src/state.ts:184-190`、`:213`、`:227`、`:236-240` |
| 5 | bash 监听器保留 `BASH_WRITE_RE` 分支不动，新增独立分支；绝不写 `state.bashCommands`、不 appendReceipt、不落盘 | ✅ 原分支逐字未动；新增分支在 `if (exec.name === 'bash')` 内、原分支之后，条件与派令逐字一致；只调 `recordPushHistory(state.pushHistory, …)` | `src/index.ts:213-219` |
| 6 | 测试：`recordPushHistory` 四类断言 / `clearTurnWrites` 清空 / 默认 false / 工具 schema 描述含该键；不动既有断言 | ✅ 4 例，既有断言零改动（`git diff test/` 只有新增块） | `test/gate.test.mjs:834`、`:856`、`:867`、`:1590` |
| 7 | README 配置表加一行，只描述本单记录行为 | ✅ 一行，含 ≤20 条×300 字符 / 结算即清 / 不注入 / 不落盘 / 不产生回执；并明说「升级判定本身尚未接入」 | `README.md:173` |
| 8 | build + 全量测试 + `git diff --check` | ✅ 见 §2 | — |

禁区自查：`decideReview` 任何分支未动；`src/instruction.ts` 未动（零注入文案变更）；无新增注入段；`lib/` 无手改（仅构建产物）；未 commit。

## 2. 证据

### 2.1 红阶段（新测试打在旧 lib 上）

顺序 = 先写测试、不 build、直接跑（旧 `lib/` 即 HEAD 产物）：

```
✖ recordPushHistory: records, truncates at 300 chars, keeps the newest 20
  TypeError: recordPushHistory is not a function
✖ clearTurnWrites: settles pushHistory together with the turn writes
  AssertionError [ERR_ASSERTION]: fresh state starts empty
✖ escalateOnPush: schema default is false and the config tool exposes the key
  AssertionError [ERR_ASSERTION]: recording is opt-in (default false)
ℹ tests 4  ℹ pass 1  ℹ fail 3
```

诚实标注：第 4 例（`escalateOnPush: push commands are recorded but never arm or leak into the instruction`）在旧 lib 上是**绿**的——它断言的是「零行为变更」（push 单独不武装、记录不泄漏进指令），旧码天然满足；它的价值是拦住错误实现（把命令塞进 `bashCommands` 或借 push 武装复审），不是驱动新码。真正驱动新码的是上面 3 条红。

### 2.2 绿阶段

```
env -u LD_PRELOAD npm run build
  host lib sanity: apply() export OK
  client bundle: …/lib/client.js (3 modules, smoke-gated)

env -u LD_PRELOAD npm test
  ℹ tests 105  ℹ pass 105  ℹ fail 0        （基线 101 + 本单 4）

env -u LD_PRELOAD node --test test/realloop.test.mjs
  ℹ tests 6  ℹ pass 6  ℹ fail 0            （真时序回归：GateState 形状变更未破装配）

git diff --check → 干净（无空白/冲突标记）
```

### 2.3 运行时面（HTTP 透传）人工核对

```
node -e 'pickOverlay({escalateOnPush:true, mode:"full"}) → {"mode":"full","escalateOnPush":true}
         applyOverlay → cfg.escalateOnPush === true
         Config(...) → true'
```

即 HTTP `POST /plugin/review-gate/config` 的 `pickOverlay`+`validatePatch` 路径对该键已生效，无需新代码。工具 set 面的同一路径由 `test/gate.test.mjs:1606-1608` 的 round-trip 断言覆盖（`set escalateOnPush=true` → 返回含 `escalateOnPush=true` → overlay 落盘 `{escalateOnPush:true}`）；若 `OVERLAY_KEYS` 漏登记，该断言必红（set 会返回「未提供任何可设键」）——这是本单唯一能抓住派令第 2 条的断言。

## 3. 偏差清单

**做了但没被要求（4 项，均为必要的接线/一致性）：**

1. `src/state.ts` 的 `ReviewGateConfig` 接口加 `readonly escalateOnPush?: boolean`——派令只写「Config schema」，但 `apply(ctx, config)` 形参类型是 `ReviewGateConfig`，不补则该行 TS 报属性不存在（编译不过）。
2. README L105「运行时可调键 = …」清单同步追加 `escalateOnPush`：该键确实进了 `OVERLAY_KEYS`，不改这句即为文档自相矛盾（配置表与清单必须同源）。
3. 测试多 1 例（监听器回归，见 §2.1 说明）：派令第 5 条的硬约束（绝不写 `bashCommands`、不变化武装行为）若无断言等于裸奔。
4. schema/set 测试里加了 round-trip 断言（`tool.execute({action:'set'})` + `readOverlay` + try/finally 清理临时 `receiptDir`）：否则第 2、3 条只有声明级覆盖、无生效级覆盖。

**被要求但没做：** 无。

## 4. 迁移给 3b-② 的说明（3 句）

1. 记录通道已就绪但**没有任何消费方**：`state.pushHistory` 只在 `escalateOnPush` 开启时由 bash 监听器追加，`clearTurnWrites`（ack/结算路径）即清，因此 3b-② 的 push 判定必须在**消费点**读它，且读的时机只能落在结算清空之前。
2. 历史里存的是**本回合全部 bash 命令**（不筛选 push；筛选留给升级判定），单条 ≤300 字符、最多 20 条、最旧先丢——判定器不要假设它能覆盖整回合的长命令。
3. 有意不暴露观测面：HTTP `states` 摘要与回执都不含该字段，若 3b-② 要真机验证「是否记录到」，需另开一条观测通道（本单按派令「不落盘、不产生回执」刻意不做）。

## 5. 残留风险

1. **300 字符截断按 UTF-16 code unit 切**：若截断点落在代理对中间，会留下孤立代理项（当前仅内存态，无渲染/序列化通路，故无实际后果；一旦 3b-② 把该历史写进回执或指令文本，需改用 `Array.from(cmd).slice(0,300).join('')` 之类的码点切法）。派令字面要求 `slice(0,300)`，本单按字面实现，未擅自偏离。
2. **`recordPushHistory` 无「去重/仅 push」语义**：同一回合重复的 bash 命令会各占一条（挤掉历史），这是派令定义的通道行为，非缺陷；若 3b-② 需要「本回合最近一次 push」，自行取 `history` 尾部即可，不必回头改本函数。
3. **零行为变更的置信边界**：只证明了「push 单独不武装」「记录不进注入文本」「默认 false 时 `Config` 解析为 false」；`escalateOnPush` 关闭时 `pushHistory` 恒为 `[]` 这一点无法从外部观测（无观测面），靠代码路径（`if (cfg.escalateOnPush && …)` 单点守卫）保证。
4. **真机未验证**：本单是纯管道，宿主 boot 时载入新 lib 才有实际效果；`escalateOnPush` 默认 false，即使重启也无行为变化，无需真机验收，真机面等 3b-② 接线后再做。

## 6. 自检（提交前）

- 逐行读全 diff：无复制粘贴改漏（三个文件的新键命名统一 `escalateOnPush` / `pushHistory` / `recordPushHistory`）。
- 爆炸半径：`recordPushHistory` 新增导出，唯二调用方 = index.ts 监听器 + 测试；`clearTurnWrites` 新增一行语义（清 `pushHistory`），调用方（ack 工具、handleTurnStopping 结算）无需改动；`GateState` 加必填字段 → 全部构造点只有 `createState()`（已 grep 确认无字面量构造）。
- 测试批判：三处断言均为真断言（`history[0] === '#5'` 的算术可从 2+25-20 推出；overlay deepEqual 校验落盘实值；`Config({})` 校验默认值来源为 schema 而非测试假设）；未测路径 = §5.3 的关闭态恒空。
- 全量回归：105/105 + realloop 6/6 + build 绿 + diff-check 干净。
- 规格对照：8 条全落地，无缩水；加料 4 项见 §3。
