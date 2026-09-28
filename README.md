---
description: "Automatic post-turn code review gate for DSH — after a turn that wrote files, the agent is steered back to self-review before the turn closes."
kind: "package-bundle"
---

# dsh-review-gate

## 是什么

DSH 的回合级代码复审闸门。每当一个回合里发生了文件写入（write/edit），在回合即将关闭时自动把 agent 拉回来执行一轮自我复审，复审通过才允许收工。把「改动需要全面复审」从文档约定（AGENTS.md §10.5）升级为 harness 层的强制机制——不依赖 agent 自觉，不需要用户提醒。

机制参照 Qoder Security 的渐进式扫描：小改动走 L1 轻度快扫，大改动走全面五步复审。

> **v2 计划（回执化 + 证据化）**：`docs/superpowers/plans/2026-09-27-review-gate-v2.md`——`review_acknowledge` 结构化回执、git diff 证据注入、多 session 隔离、回执审计日志的设计与实施步骤。

> **v4 计划（真时序测试基建）**：`docs/superpowers/plans/2026-09-28-review-gate-v4-realloop-tests.md`——用第一方 `dsh-agent-loop-testkit` 建真实 AgentLoop 测试车道，实证裁决真回合 steer、ack 自清重放零拦截、waterfall 单槽 veto 语义（fs-intent 车道死活）。

> **夜间批次 v5**：`docs/superpowers/plans/2026-09-28-overnight-v5.md`（2026-09-28 晚自主推进剧本 + 晨间 digest 在文末）与 `docs/handover/decisions.md`（决定台账：每项拍板/挂起/可逆性）。

## 机制

**时序目标：干活 → 复审 → 总结（含复审结论）**——复审是收尾流程的内嵌步骤，不是总结之后的补丁。

1. 插件监听 `tools/result`：write/edit 类工具调用按 session 记录被写文件，**每次写即时重新分档**（`auto`：文件数 ≥ `fullAtFiles` 或 diff 行数 ≥ `fullAtLines` → 全面；否则 → 快扫）并置 pendingReview。bash 命令命中写模式（重定向/`sed -i`/`mv`/`rm`/`npm install`…）也会武装快扫。
2. **事中引导（带证据）**：pendingReview 期间 `system-prompt/assemble` 监听器向 runtime-context 注入 `review-gate` 命名段——含复审指令 + **本回合 git diff 证据**（懒取证一次，300 行截断，非 git 降级）+ bash 疑似写入命令清单（bash 直写不进 diff）。不进对话流。
3. **完成信号 = `review_acknowledge` 回执工具**：模型完成复审后必须调用它提交结构化回执（action / files / findings / fixes_made / summary），回执落 `~/.dsh/storages/review-gate/receipts.jsonl` 审计日志（写入失败静默）。ack 后的回合关闭直接放行；每次新写操作会使旧回执失效（新改动欠新复审）。
4. **兜底拦截与止损**：回合将关时 pendingReview 非空且未 ack → steer 一条极简驱动消息（指向回执工具），pendingReview 保留（驱动后补 ack 仍有效）；连续未 ack 关闭最多 `maxChain` 次后止损放行。
5. 防循环与恢复：用户新消息被认领（`agent/inbox/claimed`）时 chain 衰减 1——止损后**每个用户回合保底恢复 1 轮复审**；无写操作且无 bash 命中的回合把 chain 清零。

## 部署约定

**Slot 所有权与依赖链路**：本插件与 dsh-fs-observation-policy 消费同类文件系统信号，但两者不同 slot、互不竞争——policy 挂在 base 层先激活，其 fs-intent 监听器不调 `next()` 即终裁整链（waterfall first-registrant 语义，realloop veto 测试实证），因此在 v5-T3 之前 review-gate 的 fs-intent 监听器从未被调用过（死车道），现已整体清除。**结论：review-gate 不依赖 fs-intent 车道，无 slot 竞争敏感面**——写跟踪完全走自有通道（见下），升级/换层不影响分档决策与拦截行为。

**tools/result 兜底为何充分**：写跟踪的完整信号面 = `tools/result`（write/edit 按 `writeTools` 清单识别）+ bash 写模式启发式（partial：bash 直写不进 FileSystem service，事件层不可见，只有命令模式启发式部分覆盖——方向保守，宁多触发不漏触发）。fs-intent 本可覆盖「走 FileSystem service 但工具名不在 writeTools 的未来工具」，但该能力在宿主上从未生效（上述死车道），删除无行为回退——单信号时代 Set.add 幂等性天然防同文件重复计数。

**重启契约**：宿主加载插件 bundle 后不重读磁盘——更新插件代码后必须重启目标 profile 才生效（实测教训：v3.3 修复提交后 16 小时旧 bundle 仍在跑，造成拦截-重发循环复发与排查误导）。`npm run build` 只更新 `lib/`，不触碰运行中的宿主。

## 安装

```sh
dsh plugin --profile web add ~/dsh-review-gate
```

重启目标 profile 后生效。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `off` 关闭 / `micro` 固定快扫 / `full` 固定全面 / `auto` 按改动体量分档 |
| `fullAtFiles` | `3` | `auto` 模式下，改动文件数达到该值走全面复审 |
| `fullAtLines` | `150` | diff 增删行数达到该值，快扫升格全面（行数在取证时懒判定） |
| `maxChain` | `2` | 连续未 ack 的拦截上限（止损） |
| `writeTools` | `["write","edit"]` | 视为代码写入的工具名 |
| `receiptDir` | `~/.dsh/storages/review-gate` | 回执审计日志目录 |
| `noNewReviewsBeforeDemotion` | `3` | 连续 K 次 full 复审零新发现后，会话漂移（milestone）不再升格全面复审（收敛疲劳防护；不影响基本分档与止损） |

**已知边界（ceiling）**：bash 里的文件写不走 FileSystem service（事件层不可见），只有命令模式启发式部分覆盖（有误报/漏报，只武装不阻断）；`agent.steer()` 为 `Agent` 接口契约成员（dsh-agent runtime-types 实证，四个注入方法全契约化）——`typeof` 守卫保留作纵深防御（防运行时装配差异），失效语义仍为不触发复审而非报错；写失败的工具调用（如 edit 报错）也会计入改动——方向保守，多触发一次复审无害；`turn-stopping` 语义是「模型暂时不欠响应」，回合中间的停顿也会触发拦截（可能与进行中的工作交叠）；用户中断会清空 inbox，待执行的复审随之取消（用户干预优先）；复审质量仍取决于模型自身执行指令的认真程度——闸门保证「复审必发生」（回执可审计），diff 证据消除「凭记忆复审」，但不保证「复审必找出所有 bug」；自定义 source kind 的消息在会话重建时依赖 inbox 投影对 source 的容忍（待审窗口极短，最坏丢失一次复审提示）。

## 验证

```sh
dsh --profile web --dump-config   # 应出现 id: review-gate 层
# 重启 web profile 后，任意含文件写入的任务结束时会出现折叠的复审通知，
# 且 agent 被拉回执行 L1 快扫 / 全面复审；复审完成后模型调用 review_acknowledge
# 回执（工具卡片可见），~/.dsh/storages/review-gate/receipts.jsonl 留有审计行
```

单元测试：`node --test test/gate.test.mjs`（68 例：分档决策/写跟踪/上下文注入形态/回执工具六路径/防循环止损/claimed 衰减/apply 接线/多 agent 隔离/diff 取证与行数升档/bash 启发式/收敛疲劳防护/receipts 终态）+ `node --test test/realloop.test.mjs`（6 例真时序车道，dsh-agent-loop-testkit 驱动真实 AgentLoop：挂载冒烟×2 / maxChain 止损裁决 / ack 即结算与重放零拦截 / waterfall 单槽 veto 语义 / noNewReviews 双源交叉断言）。

已知边界：`fs/write-intent` 与 `fs/edit-intent` 车道已不再接线（v5-T3 清除；判定依据 = veto 语义双闭合——policy 先注册终裁、后注册观察者永不被调用），写跟踪由 `tools/result` 车道承担。claimed 衰减按 source 门控（`source.kind==='review-gate'` 的 driver 消息不衰减），否则 steer 续步 claim 会打穿 maxChain 止损。
