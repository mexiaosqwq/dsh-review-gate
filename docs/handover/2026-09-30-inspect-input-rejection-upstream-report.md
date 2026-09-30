# inspect 桥接 input 拒收 bug · 上游报告草稿（2026-09-30）

> **状态：草稿，未发布。** 待用户批准后再发 GitHub Discussions（github.com/deepseek-ai/deepseek-harness；README 指定 bug 走 Discussions）。台账 2026-09-29 行曾裁定「暂不报」，本稿为翻案素材——复现已在 2026-09-30 插件重启后复测仍然成立（非瞬态）。
> 下方英文段落为 paste-ready 正文；发布身份/频道由用户定。

---

**Title:** Cordis Inspect: every query with an `input` payload is rejected with `"input" must be an object`, though the declared inputSchema is an (optional) object

**Summary**

All Cordis Inspect providers whose methods declare an object `inputSchema` reject any call that actually passes `input` — including the empty object `{}`. Only the inputless catalog mode works. The failure hits both Host and Client providers identically, so the defect appears to live in the inspect bridge shared by both sides, not in any single provider.

**Repro** (via the `cordis_inspect_query` MCP tool)

| # | Call | Result |
|---|---|---|
| 1 | `platform=host, provider=Event, method=listEvents` (no `input`) | ✅ returns the event catalog |
| 2 | same, `input={}` | ❌ `Host Cordis inspect Event.listEvents rejected input: "input" must be an object` |
| 3 | same, `input={"event":"tools/result"}` | ❌ same error |
| 4 | `platform=client, provider=Event, method=listEvents, input={}` | ❌ `Client Cordis inspect Event.listEvents rejected input: "input" must be an object` |
| 5 | `platform=host, provider=Config, method=listConfigs, input={}` | ❌ same error |

**Expected**

Per the provider manifest, `Event.listEvents` inputSchema is `{"type":"object","properties":{"event":{…}}}` — an object, and optional ("Omit it for the compact directory"). Passing `{}` (or any object satisfying the schema) should be accepted; `{}` should select the same compact catalog as omitting `input`.

**Actual**

Any non-omitted `input` is rejected as "not an object" regardless of content. The error text suggests the validator receives a non-object — plausibly the JSON-serialized *string* of the input (the same string that round-trips intact from the caller's side).

**Impact**

Every progressive-discovery method that needs `input` for its exact-contract mode is unusable, on both platforms: `Service.listService`, `Event.listEvents`, `Config.listConfigs` (host), `Slots.listSubTree`, `Event.listEvents` (client) — only their inputless catalog mode remains reachable. Plugin authors cannot fetch a single exact event/service/config contract and must fall back to reading `node_modules` type declarations.

**Environment**

- `@deepseek-ai/dsh` 0.1.7-rc.2, Android (Termux) host, web profile
- First observed 2026-09-28 during a plugin-contract audit; re-tested 2026-09-30 after a profile restart — reproduces persistently, not transient
- Observed while developing a DSH plugin that inspects Host Event contracts for alignment work
