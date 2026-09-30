# 决定台账（待追认；用户每次互动时 lead 先给 digest）

| 日期 | 决定点 | 默认动作/挂起 | 可逆性与回退成本 | 依据路径 | 状态 |
|---|---|---|---|---|---|
| 2026-09-28 | devDep `@deepseek-ai/dsh-agent-loop-testkit@0.1.7-rc.2` | 已用（v4-T1 起，随计划批准生效） | 可逆：package.json -1 行 + lock 还原，零代码耦合 | docs/superpowers/plans/2026-09-28-review-gate-v4-realloop-tests.md | 已追认（用户「都做」含计划执行） |
| 2026-09-28 | maxChain 修复 = source 门控（非初裁 turn 门控） | 已落码 commit 5f4717c | 可逆：revert 单 commit；closer PASS + lead 亲验 | docs/handover/2026-09-28-v4-T2-lib-worker.md | 已追认（用户「都做」时在案） |
| 2026-09-28 | src 三刀拆分（R1） | 已落码 commit 1ce5290 | 可逆：revert 单 commit；机械搬移+脚本实证 | docs/handover/2026-09-28-v5-R1-worker.md | 用户明示（「都做」） |
| 2026-09-28 | F1 三件（A noNewReviews / B outcome / 边界枚举条） | worker 施工中 | 可逆：功能新增，revert 单 commit | docs/superpowers/plans/2026-09-28-overnight-v5.md T1 | 用户明示（「都做」+「好的」） |
| 2026-09-28 | 夜间批次 T2-T5（本计划） | 授权源=「晚上就麻烦你了…明天早上看看结果」 | 各任务独立 commit，单项可回退 | docs/superpowers/plans/2026-09-28-overnight-v5.md | 本台账即授权记录 |
| 2026-09-28 | 防锚定二审（fork 能力） | 挂起：插件无强制 fork，等 spec 草案（T5②） | 不适用（未落码） | docs/handover/2026-09-28-codex-deep-scout.md L117-119 | 待用户晨审 |
| 2026-09-28 | 五分区评审输入对齐 | 挂起：等 spec 草案（T5①） | 不适用（未落码） | 借用面盘点② | 待用户晨审 |
| 2026-09-29 | 晨间拍板 1（T6 Top3 契约对齐） | 已落码（P2：steer ceiling 更正 / assemble_degraded 诊断收据 / Config optional 化） | 可逆：revert 单 commit | docs/handover/2026-09-28-v5-P2-worker.md | 用户明示（「1 2 现在先开工」） |
| 2026-09-29 | 晨间拍板 2（五分区微调） | 已落码（pitfalls 来源标注 +1 行、「diff 为准」并入步骤 1） | 可逆：revert 单 commit | 同上 | 用户明示（同上） |
| 2026-09-29 | 晨间拍板 3/4（reviewerSubagent / stop_loss 密度） | 维持缓办；实数据首读（2026-09-29）：真机 7 ack / 0 stop_loss / noNewReviews 全 0——stop_loss 密度无忧，reviewerSubagent 门槛仍不足（真机 full 仅 1 次） | 不适用 | receipts.jsonl 数据盘点 | 用户裁定缓办（数据已入档，随时复裁） |
| 2026-09-29 | 晨间拍板 5（inspect 桥接 bug 报上游） | 用户裁定：暂不报（bug 现象与复现存 T6 报告①，随时翻案） | 不适用 | T6 报告① | 已裁定（暂不报） |
| 2026-09-29 | closer P2 两候选（README 配置表补行 / 来源标注测试断言） | 已收编（2026-09-29，同测试隔离修复 commit）：README 表补 4 行（pitfallsFile + 同表缺口 milestoneAtFiles/ignoreGlobs/alwaysFullGlobs）、断言 +2 行 | 可逆：revert 单 commit | docs/handover/2026-09-28-v5-P2-CL-closer.md | 已收编 |
| 2026-09-29 | 清理生产 receipts.jsonl 存量测试污染行 | 用户批准执行：按「测试文件声明的 fixture 名集合」精确过滤（34 名，删 392 行：ack1/2/3 各 91、selfclear 50、decay/clr/ack4 各 23），真机会话（session-* 与子代理裸 uuid 共 62 行）全保留；全量备份 receipts.jsonl.bak-2026-09-29（454 行），脚本一次性 /tmp/clean-receipts.mjs 跑后即弃 | 可逆：备份文件原样可回滚 | receipts.jsonl 数据盘点 + commit 7cf675e（测试侧防新增） | 已裁定（已执行） |
| 2026-09-29 | 开源许可定 MIT + 补 LICENSE 文件 | 用户拍板「那就 MIT」；署名用 git 作者身份 mexiaosqwq（版权行 2026），README License 节链 LICENSE | 可逆：换许可 = 重写 LICENSE + package.json | README 发布重写批（0bbd1e7）遗留项收尾 | 已裁定（已执行） |
| 2026-09-29 | AGENTS.md 入库（反转此前「本地指引不入库」惯例） | 用户拍板「源于其他开发者 ai 也进行协助 pr」——AGENTS.md 是跨 AI 可读的项目知识库，外部协作者的 agent 需要它拿红线与验证链；README 开发节加发现入口；发布前内容审查通过（全技术内容，无敏感信息） | 可逆：git rm 单文件 | 本台账行 + commit（同批） | 已裁定（已执行） |
| 2026-09-29 | 审查力度 UI 调参面板（方案定稿，挂起待开工） | 用户裁定「再等等」。方向=UI 优先（面板即产品，文件编辑降级为初始配置）：host 打底=活配置引用+存储覆盖层（config.json 原子写）+HTTP 路由 GET/POST /plugin/review-gate/config（ctx.webServer.register 实证）+agent 工具；硬事实=宿主无 patch 热重载（patchReload: startup），改文件必重启，故面板自持活配置、patch 只管初始值。**入口定稿（用户追加拍板）=输入框区常驻状态 chip，对齐工作区权限开关的既有交互**：chip 显示当前档位（off/micro/auto/full 一眼可见），点击弹出切换弹窗直接改；slot 接缝候选 conversation.composer.dock / input.left / input.model 同区，弹窗容器候选 composer dock 或 shell.overlay，实现期按当版 SlotMap 现查。两里程碑=最小四档切换 chip+弹窗→阈值+标签输入进弹窗；1-2 天当量 | 可逆：纯增量功能，revert 单 commit | 本轮方案讨论 + dsh-plugin-development skill 取证 | 执行中（M0 host 打底已落码全绿；M1 面板 client 半区待做） |
| 2026-09-30 | 审查力度按会话隔离（不同会话不同档） | 已落码：effective(agent) = boot ⊕ 全局 overlay ⊕ 会话 overlay[agentId]，会话层内存态（agent.id 不跨重启）；作用域默认刻意不对称——工具缺省=session、HTTP 缺省=global；面板 chip 弹窗带 本会话/全局 切换（props.sessionId） | 可逆：revert 24ce9a7+75fbb58 两 commit | 用户原话「不同会话之间审查是相同的,没隔离起来，这是不对的」+「审查力度按照当会话默认的」 | 已追认（用户拍板后实现，真机验收过 boot 层） |
| 2026-09-30 | review_gate_config 默认 scope=session（纠偏 75fbb58 的 global 回退） | 另一 agent 修 brace bug 时按「与 HTTP 契约一致」回退了工具默认，但留下了「缺省=本会话」描述文案=声明-实效劈叉；恢复 session 默认（有 agentId 时，无 agentId 降级 global=M0 测试兼容） | 可逆：revert 单 commit（24ce9a7） | 用户会话隔离拍板 + 描述/代码一致性 | 已追认（用户验收运行中宿主 scope:session 生效） |
| 2026-09-30 | lib/ 发布闸门（中间态构建不得上线） | build 链三闸：sanity-lib（host 导入自检）+ client-smoke 共享执行器（构建发布前与产物测试同源）+ staging→smoke→POSIX rename 原子发布；拒绝路径端到端实测（注入 boot-kill 同款坏模块 → exit 1 + lib 字节不变） | 可逆：revert 562682d+c359988 | 用户判例「没一口气改全就直接生效」+「滥用项目构建道具」（npm install 探针式连跑毁树 / lib 当草稿区） | 已追认（full 全检查收口，连续两轮零新发现） |
| 2026-09-30 | 「审查」触发词常驻契约 + 主动评审结算 | assemble 常驻 review-gate-usage 段（按会话档位执行插件协议 + ack 回执）；ack 两形态（无 pendingReview / 零写入无 state）落 source:on_request 回执，游离 ack 可审计；usage 段与 pendingReview 段均过 braceGuard | 可逆：revert 单 commit（4a69bb7） | 用户原话「告诉AI进行'审查'字眼,应该自动调用这个插件的审查」+ full 全检查实锤 ack 死头修复 | 已追认（本轮 full 协议即新契约首次实弹全链路） |
| 2026-09-30 | 面板 UI 重设计（用户判「忒丑」） | 主题令牌化（--dsw-* 跟随明暗、玻璃拟态、分段控件、作用域切换）；取代 M1 硬编码暗色面板 | 可逆：revert chip 文件 | 用户原话「这他妈也忒丑了」 | 已实现（视觉待用户真机点验） |
