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
