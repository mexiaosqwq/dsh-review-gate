# sessionFiles 历史虚增根因定论（2026-10-04，receipts 全量数据分析）

> v4-T4 报告挂账「sessionFiles 历史虚增的真实根因另行归因（嫌疑：bashWrites / receipts 自写信号），等重启后 receipts 数据定论」。本报告基于 517 条 receipts（09-27 → 10-04，8 天、跨 v3.0→v5 多代 lib）完成定论，挂账销账。

## 结论

**现行 v5 代码不存在任何已知 sessionFiles 虚增通路，无需代码改动。** 历史观察的根因 = v3.2 的 ack 不自清 pendingReview → client 重放 driver 消息造成 re-steer 循环 → 循环回合内同一文件在 clearTurnWrites 后反复 re-add，计数虚高。该缺陷 v3.3（b919a28「ack self-clears pendingReview」）已修，注释明确记着 real-host finding 2026-09-27。

## 证据链

1. **三大嫌疑机制性排除**：
   - `bashWrites`：布尔旗标，v3（be6e9e0）到 v5（c92be42）任何版本都不参与 sessionFiles 计数（increment 只看 files Set 增长）。
   - receipts 自写信号：闸门自身回执是进程内 `appendFile`，不经 tools/result，无事件通路。
   - fs-intent 车道：真机死车道（T4 静态五源 + 运行时语义双闭合），v5-T3 已整体删除。
2. **数据面零异常**：292 条带 `cost.sessionFiles` 的行 100% 可归因——268 行单调事件语义、21 行回落全部对应宿主重启/dispose 清态（states 在内存，重启即丢）、3 行为 full 结算前快照。无任何未解释异常。
3. **跟踪层无路径形状对**：waived 行（203 条）是唯一来自 trackWrite 原始集合的直接证据，路径 100% 绝对形态、零 `~/`-绝对形状对。receipts 里出现的 `~/` 形状全部来自 acked 行的模型自报清单（v3 起 `files: a.files`），是回显噪音不是跟踪层证据。
4. **v3.3 的双信号去重是合成场景守卫**：b919a28 的测试手动构造 `fs/write-intent` + `tools/result` 双发；真机上 policy veto 使 fs-intent 永不触发，该场景不存在——去重逻辑守的是死车道（T4 已判，无害 no-op，v5-T3 随车道一起删除）。
5. **09-27 当晚 sf 轨迹自洽**：23:00→23:17 五行（1→1→3→1）与现行事件语义完全吻合，计数器本身当晚也无虚增痕迹——原始观察更可能来自 re-steer 循环回合里注入文件数的虚高，而非 sessionFiles 计数器本身。

## 语义澄清（非缺陷，分析时须知）

- `sessionFiles` 是**写事件**语义：每回合闭合清空 files Set，同一文件跨回合再写会重新计数；只在 full 回执清零。与 docstring「Cumulative files」的直觉（去重文件数）有出入。数据实况：78 个 full 中 11 个由漂移触发（sf≥10），疲劳守卫（noNewReviewsBeforeDemotion）生效期间 micro 行 sf 最高到 34。
- 宿主重启会清零所有会话的 GateState（含 sessionFiles）——分析轨迹时回落≠异常。

## 后续数据挖掘注意

receipts 的 `files` 字段双轨：`acknowledged` = 模型自报（可含 `~/` 形状、可含未跟踪文件，如 10-04 09:47 行的 seshat-analysis-tasks.jsonl——后台分析引擎进程直写被列进自报）；`waived` / `stop_loss` = 闸门跟踪原始集合。**做统计只用后者。**（已同步 README「唯一完成信号」节。）
