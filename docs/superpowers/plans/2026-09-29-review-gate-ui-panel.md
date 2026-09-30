# 审查力度 UI 调参面板（2026-09-29 开工）

> 何时读：实现/审查「网页面板实时调审查力度」功能时。设计决定与平台取证已固化在 `docs/handover/decisions.md`（同日「审查力度 UI 调参面板」行）与本文件；改机制前先读 README 的机制与配置节。

## 已定设计（用户拍板）

- **UI 优先**：面板即产品，改文件降级为初始配置。入口 = 输入框区常驻状态 chip（对齐工作区权限开关交互），点击弹窗直接切档。
- **硬约束**：宿主无 patch 热重载（`patchReload: "startup"`）——插件**自持活配置**，patch 只管初始值；面板改动持久化到插件自己的存储覆盖层，即时生效、零重启。
- **两里程碑**：M1 = 最小四档（off/micro/auto/full）chip + 弹窗切换；M2 = 阈值与路径清单也进弹窗。

## 平台取证（已实证）

| 事实 | 依据 |
|---|---|
| HTTP 面 = `ctx.webServer.register({kind:'exact'\|'prefix', path, handler})`，重复 (kind,path) 抛错，返回 disposer | `@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts` L90-97 |
| 可选挂载范式 = `ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => webCtx.webServer.register(route)))`；headless 下子 fiber 保持 pending，不影响宿主组合 | `dsh-client-connection/lib/index.js` 真实消费方 |
| 顶层 `inject` 加 webServer 会把插件钉死在 web profile（headless 永久 pending）→ 禁止 | cordis inject 门禁实现（`cannot get property without inject`） |
| Config 消费点全部逐事件读 `config.x` → **原位 `Object.assign(config, patch)` 即全量即时生效**，零读点改动 | src/index.ts L110-119/146/176/257/269、src/state.ts 纯函数签名 |
| ~~平台 seed 模块含 `schema-form`~~（2026-09-30 复查证伪：node_modules `@deepseek-ai/*` 与 DSH checkout 两个证据面均无 schema-form/SchemaForm——M2 表单纯手写，M1 已验证该路线；`dsh-client-ui-primitives` 是宿主自用 CSS modules 样式库，非表单组件） | 本仓库静态取证 |

## M0 = Phase 1：host 打底（已完成 2026-09-29：gate 80/80 + realloop 6/6；落地修正：覆盖层路径跟随生效 receiptDir（`config.receiptDir ?? RECEIPT_DIR`），非固定默认目录——receiptDir 是启动级键，boot 内路径稳定，且测试经 baseConfig 天然隔离生产文件）

**语义**：启动序 = schema 默认 → bundle patch（宿主 loader）→ **存储覆盖层**（`~/.dsh/storages/review-gate/config.json`，本插件自持，原子写）。覆盖层只收 `OVERLAY_KEYS`（mode/fullAtFiles/fullAtLines/milestoneAtFiles/maxChain/writeTools/ignoreGlobs/alwaysFullGlobs/noNewReviewsBeforeDemotion）；`pitfallsFile`/`receiptDir` 是启动级路径键，刻意排除。

**落点**：

1. `src/config-live.ts`（新）：`OVERLAY_KEYS` / `overlayPath` / `readOverlay`（坏文件静默回 {}）/ `applyOverlay`（原位合并，数组拷贝）/ `pickOverlay`（只取已知键）/ `saveOverlay`（tmp+rename 原子发布）。index.ts `export *` 重导出。
2. `src/index.ts`：
   - `apply()` 开头快照 `bootConfig`（freeze）→ 合并覆盖层 → 再读 pitfallsText（顺序不能反）。
   - `ctx.inject(['webServer'], webCtx => webCtx.effect(() => webCtx.webServer.register(...)))` 挂两条 exact 路由：
     - `GET /plugin/review-gate/config` → `{config, overlay}`，`Cache-Control: no-store`
     - `POST /plugin/review-gate/config` → body 为部分键的 patch；未知键忽略并在响应 `ignored` 列出；校验 = `Config({...bootConfig, ...overlay, ...picked})` 抛错即 400；通过则原位 assign + 存覆盖层 → `{ok, config, overlay, ignored}`
     - `POST /plugin/review-gate/config/reset` → 清覆盖层、恢复 `bootConfig` → `{ok, config}`
     - 方法白名单（非 GET/POST 405）；JSON 解析失败 400；统一 JSON 错误体。
   - 工具 `review_gate_config`（apply 顶层注册，DSL 对齐 review_acknowledge）：`action: get|set|reset` + 显式可选键（mode/fullAtFiles/fullAtLines/milestoneAtFiles/maxChain/noNewReviewsBeforeDemotion/alwaysFullGlobs/ignoreGlobs）；set 走同一条校验+持久化链，返回人话摘要。
3. 不动的东西：`inject = ['tools']` 不加 webServer（headless 兼容红线）；pitfallsText 仍激活时读一次（改 pitfallsFile 属重启级）；`patchReload` 与宿主零接触。

**验收**：build 清；gate 单元全绿（新增覆盖层往返/未知键忽略/POST 校验 400/fake webServer 接线 GET+POST+reset/工具 set-get-reset）；realloop 6/6 不回归；真机（web profile 重启后）curl GET/POST 即时改档 + receipts 照常。

## M1 = Phase 2：client 面板（下一批）

- 双 tsconfig + client tsdown 构建 + `dsh.client` 声明（本仓库首次开 client 半区）。
- 输入框区 chip（slot 接缝候选 `conversation.composer.dock` / `input.left`，**开写前按当版 ui-conversation SlotMap 现查**）+ 点击弹窗（容器候选 composer dock 或 `shell.overlay`，移动优先：限高、内部滚动、大触控目标）。
- 表单捷径：平台 `schema-form` 喂 schemastery schema 自动出控件；改一项 POST 一项，顶角「已生效」反馈；「恢复默认」走 reset 路由。
- 验证矩阵按 skill §8.3：slot 注册/清理、HMR 安全、宽窄屏、reduced motion、真实 GUI profile。

## 禁区

- 不加 `@deepseek-ai/dsh-host-webserver` 依赖（用 typeof 形状守卫消费，与 steer 守卫同款纵深防御——避免为类型引运行时依赖）。
- 不动 review_acknowledge 契约与 receipts 格式（outcome/noNewReviews 语义原样）。
- 不在本批做 client 半区（M1 另起批次，独立验收）。
