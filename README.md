---
description: "Automatic post-turn code review gate for DSH — after a turn that wrote files, the agent is steered back to self-review before the turn closes."
kind: "package-bundle"
---

# dsh-review-gate

## 是什么

DSH 的回合级代码复审闸门。每当一个回合里发生了文件写入（write/edit），在回合即将关闭时自动把 agent 拉回来执行一轮自我复审，复审通过才允许收工。把「改动需要全面复审」从文档约定（AGENTS.md §10.5）升级为 harness 层的强制机制——不依赖 agent 自觉，不需要用户提醒。

机制参照 Qoder Security 的渐进式扫描：小改动走 L1 轻度快扫，大改动走全面五步复审。

> **v2 计划（回执化 + 证据化）**：`docs/superpowers/plans/2026-09-27-review-gate-v2.md`——`review_acknowledge` 结构化回执、git diff 证据注入、多 session 隔离、回执审计日志的设计与实施步骤。

## 机制

**时序目标：干活 → 复审 → 总结（含复审结论）**——复审是收尾流程的内嵌步骤，不是总结之后的补丁。

1. 插件监听 `tools/result`：write/edit 类工具调用按 session 记录被写文件，**每次写即时重新分档**（`auto`：文件数 ≥ `fullAtFiles` → 全面；否则 → 快扫）并置 pendingReview。
2. **事中引导**：pendingReview 期间 `system-prompt/assemble` 监听器向 `assembly.contexts` 注入 `review-gate` 命名段——渲染进 runtime-context 快照（与记忆召回同通道），模型在每轮请求的动态上下文区看到「收尾前先复审，结论并入最终总结」。不进对话流。
3. **兜底拦截**：回合将关时 host 发 `agent/turn-stopping`（serial）→ pendingReview 非空 → 插件 steer 一条极简驱动消息（一句话，notice 折叠条）：「若尚未执行复审，现在执行；若已执行，直接输出最终总结（含复审结论与本次做了什么）」。agent-loop 发现 next-step 非空 → 不关闭回合 → 复审步骤执行——**两种路径的对话结尾都是总结**。
4. 驱动发出即 disarm（防无限循环）；复审轮内若产生修复写操作会重新武装再拦一轮，单回合内连续复审最多 `maxChain` 轮。
5. 防循环与恢复：用户新消息被认领（`agent/inbox/claimed`）时 chain 衰减 1——maxChain 止损后**每个用户回合保底恢复 1 轮复审**；无写操作的回合把 chain 清零。

## 安装

```sh
dsh plugin --profile web add ~/dsh-review-gate
```

重启目标 profile 后生效。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | `off` 关闭 / `micro` 固定快扫 / `full` 固定全面 / `auto` 按文件数分档 |
| `fullAtFiles` | `3` | `auto` 模式下，改动文件数达到该值走全面复审 |
| `maxChain` | `2` | 连续复审链上限（复审→修复→再复审） |
| `writeTools` | `["write","edit"]` | 视为代码写入的工具名 |

**已知边界（ceiling）**：bash 里的文件写不跟踪（bash 无法可靠判定是否写代码）；`agent.steer()` 是 agent-loop 的运行时能力而非 `Agent` 接口的类型契约，harness 未来若改名会静默失效（有 `typeof` 守卫，表现为不触发复审而非报错）；写失败的工具调用（如 edit 报错）也会计入改动——方向保守，多触发一次复审无害；`turn-stopping` 语义是「模型暂时不欠响应」，回合中间的停顿也会触发拦截（可能与进行中的工作交叠）；用户中断会清空 inbox，待执行的复审随之取消（用户干预优先）；复审质量取决于模型自身执行指令的认真程度——闸门保证「复审必发生」，指令通过强制「先列改动文件清单」提高敷衍成本，但不保证「复审必找出所有 bug」；自定义 source kind 的消息在会话重建时依赖 inbox 投影对 source 的容忍（待审窗口极短，最坏丢失一次复审提示）。

## 验证

```sh
dsh --profile web --dump-config   # 应出现 id: review-gate 层
# 重启 web profile 后，任意含文件写入的任务结束时会出现折叠的复审通知，
# 且 agent 被拉回执行 L1 快扫 / 全面复审
```

单元测试：`npm test`（35 例：分档决策/写跟踪/上下文注入形态/防循环状态机/claimed 衰减/apply 接线/多 agent 隔离）。
