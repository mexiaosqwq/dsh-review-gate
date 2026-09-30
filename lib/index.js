import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { BASH_WRITE_RE, clearTurnWrites, collectDiff, countChangedLines, createState, decideReview, handleTurnStopping, shouldWaive, trackWrite, } from './state.js';
import { BRACE_VARIABLES, braceGuard, reviewInstructionText } from './instruction.js';
import { OVERLAY_KEYS, applyOverlay, pickOverlay, readOverlay, saveOverlay } from './config-live.js';
export * from './instruction.js';
export * from './state.js';
export * from './config-live.js';
export const Config = z.object({
    mode: z.union(['off', 'micro', 'full', 'auto']).default('auto'),
    fullAtFiles: z.number().min(1).default(3),
    fullAtLines: z.number().min(1).default(150),
    exemptBelowLines: z.number().min(0).default(10),
    milestoneAtFiles: z.number().min(1).default(10),
    maxChain: z.number().min(1).default(2),
    writeTools: z.array(z.string()).default(['write', 'edit']),
    ignoreGlobs: z.array(z.string()).default([]),
    alwaysFullGlobs: z.array(z.string()).default([]),
    pitfallsFile: z.string().required(false),
    receiptDir: z.string().required(false),
    noNewReviewsBeforeDemotion: z.number().min(0).default(3),
});
/** Cordis plugin identity. */
export const name = 'review-gate';
/**
 * Declared service dependencies: `ctx.tools` is an injectable property and is
 * only readable when the plugin declares it here — cordis establishes the
 * inject context for exactly these services while running apply(). Without
 * this declaration `ctx.tools.register(...)` throws
 * `cannot get property "tools" without inject` and the whole plugin fails to
 * activate (real-host failure 2026-09-27).
 */
export const inject = ['tools'];
/** Default receipt audit-log directory (playwright-plugin storage convention). */
const RECEIPT_DIR = joinPath(homedir(), '.dsh', 'storages', 'review-gate');
/**
 * Append one receipt as a JSON line. Audit must never break the turn: every
 * failure is swallowed.
 */
export async function appendReceipt(dir, receipt) {
    try {
        await mkdir(dir, { recursive: true });
        await appendFile(joinPath(dir, 'receipts.jsonl'), JSON.stringify({ ts: Date.now(), ...receipt }) + '\n');
    }
    catch {
        // ponytail: audit failures are silent — an audit log must never interrupt
        // a review; real diagnosis reads the file directly
    }
}
export function apply(ctx, config) {
    const states = new Map();
    // Live-config overlay (the web panel's source of truth): boot values are the
    // schema defaults plus whatever the bundle patch layer set; the overlay
    // persisted by the panel merges on top in place. Every consumer already
    // reads `config.x` per event, so in-place mutation is instantly live with
    // zero read-site changes. The snapshot powers POST validation and reset.
    // Deliberately NOT annotated as ReviewGateConfig: its arrays must stay
    // mutable for the schemastery validation call below (readonly arrays fail
    // the schema's input type).
    const bootConfig = {
        ...config,
        writeTools: [...(config.writeTools ?? [])],
        ignoreGlobs: [...(config.ignoreGlobs ?? [])],
        alwaysFullGlobs: [...(config.alwaysFullGlobs ?? [])],
    };
    // The overlay lives under the effective receipt dir: receiptDir is a
    // boot-level key (excluded from the overlay), so the path is stable for the
    // process lifetime, and tests isolate via their baseConfig receiptDir.
    const overlayDir = config.receiptDir ?? RECEIPT_DIR;
    const overlay = readOverlay(overlayDir);
    applyOverlay(config, overlay);
    // Per-session config layering (2026-09-30 user requirement): intensity is a
    // per-conversation knob. effective(agent) = boot ⊕ global overlay ⊕ session
    // overlay. Session overlays live in memory only — agent ids do not survive
    // a process boot, so persisting them would be dead data. Consumers already
    // take a config per call, so passing cfgOf(agentId) keeps everything live.
    const sessionOverlays = new Map();
    const sessionConfigs = new Map();
    const rebuildAgentConfig = (agentId) => {
        sessionConfigs.set(agentId, {
            ...bootConfig,
            ...overlay,
            ...sessionOverlays.get(agentId),
        });
    };
    const cfgOf = (agentId) => (agentId !== undefined ? sessionConfigs.get(agentId) : undefined) ?? config;
    // Distilled pitfalls ride full review instructions. Read once at activation;
    // the file is edited between sessions, not mid-turn. (Must stay AFTER the
    // overlay merge so an overlay-provided pitfallsFile is honored at boot.)
    let pitfallsText;
    try {
        if (config.pitfallsFile && existsSync(config.pitfallsFile)) {
            pitfallsText = readFileSync(config.pitfallsFile, 'utf8');
        }
    }
    catch {
        pitfallsText = undefined;
    }
    // Grade immediately so the instruction leads the wrap-up: the model sees
    // "review before your final summary" while still working. Shared by both
    // signal sources (tools/result and fs intents).
    const gradeAndArm = (state, cfg) => {
        const action = decideReview({
            writeFiles: state.files.size,
            bashWrites: state.bashWrites,
            sessionFiles: state.sessionFiles,
            paths: [...state.files],
            noNewReviews: state.noNewReviews,
            chain: state.chain,
            config: cfg,
        });
        if (action === 'skip') {
            state.pendingReview = null;
        }
        else {
            state.pendingReview = {
                action,
                files: state.files.size || (state.bashWrites ? 1 : 0),
                paths: [...state.files],
            };
            // Every fresh write invalidates any prior receipt: new changes owe a
            // new review.
            state.acknowledged = false;
        }
    };
    ctx.effect(function* () {
        yield ctx.on('tools/result', (exec) => {
            if (!exec?.agent?.id)
                return;
            let state = states.get(exec.agent.id);
            if (!state) {
                state = createState();
                states.set(exec.agent.id, state);
            }
            const filesBefore = state.files.size;
            // Single-signal era (v5-T3): the fs-intent lane is gone, no cross-shape
            // dedup needed — trackWrite fires directly (Set.add keeps repeat
            // emissions of the same file idempotent).
            const cfg = cfgOf(exec.agent.id);
            trackWrite(state.files, exec.name, exec.arguments, cfg);
            // bash write-pattern heuristic: a redirected/moving/removing command very
            // likely wrote somewhere we cannot track — arm a review for it.
            if (exec.name === 'bash') {
                const command = exec.arguments?.command;
                if (typeof command === 'string' && BASH_WRITE_RE.test(command)) {
                    state.bashWrites = true;
                    if (state.bashCommands.length < 5)
                        state.bashCommands.push(command);
                }
            }
            // Milestone drift: only a NEW path counts (the fs-intent listener may
            // have added it first — Set growth is the dedup gate).
            if (state.files.size > filesBefore)
                state.sessionFiles += 1;
            gradeAndArm(state, cfg);
        });
        yield ctx.on('agent/turn-stopping', (payload) => {
            const state = states.get(payload.agent.id);
            if (!state)
                return;
            if (typeof payload.agent.steer !== 'function')
                return;
            // Snapshot BEFORE handleTurnStopping: the maxChain stop-loss branch
            // nulls pendingReview, so the reviewed files list must be captured
            // first for the stop_loss audit line (v5-F1).
            const files = state.pendingReview?.paths ?? [];
            const cfg = cfgOf(payload.agent.id);
            const action = handleTurnStopping(state, (message) => payload.agent.steer?.(message), cfg);
            // handleTurnStopping stays a pure function: IO lives here. 'skip' with
            // a chain at the cap means the review was given up on — log the
            // terminal state so the review-abandonment rate becomes observable.
            if (action === 'skip' && state.chain >= cfg.maxChain) {
                void appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                    agentId: payload.agent.id,
                    outcome: 'stop_loss',
                    chain: state.chain,
                    files,
                });
            }
        });
        yield ctx.on('agent/disposed', (payload) => {
            states.delete(payload.agent.id);
            sessionOverlays.delete(payload.agent.id);
            sessionConfigs.delete(payload.agent.id);
        });
        // A newly claimed user message starts a fresh user turn: decay the review
        // chain by one so the gate regains protection after a maxChain stop-loss,
        // instead of staying silent until a write-free turn happens to occur.
        // Source-gated (v4-T2-lib, revises the originally specced turn gate): the
        // driver's steer message carries source.kind 'review-gate'
        // (buildDriverMessage); its next-step re-claim used to cancel the chain
        // increment the turn-stopping handler just applied and defeat maxChain
        // entirely (realloop finding 2026-09-28: unbounded driver-message replay).
        // Gating on the message source implements the "user message" wording of
        // this comment literally, and is immune to the state-creation timing gap
        // (state is born on the first write signal, AFTER the user message's own
        // claim — a turn-based gate loses its baseline there; SEQ evidence in
        // docs/handover/2026-09-28-v4-T2-lib-worker.md).
        yield ctx.on('agent/inbox/claimed', (payload) => {
            if (payload.message?.source?.kind === 'review-gate')
                return;
            const state = states.get(payload.agent.id);
            if (state && state.chain > 0)
                state.chain -= 1;
        });
        /**
         * The review instruction rides the dynamic runtime context (same channel
         * as memory recalls), not the conversation. While a review is pending,
         * every request in the reviewing turn sees the instruction section.
         *
         * Dependency note: `context.agent` is a runtime extension that dsh-agent's
         * `assembleContextFor` adds to the core AssembleContext contract (which
         * only declares scope/signal, dsh-system-prompt types). It exists only
         * while the type-augmentation import at the top of this file
         * (`import type {} from '@deepseek-ai/dsh-agent'`) stays in place — if it
         * or the host-side extension disappears, this listener degrades silently
         * (the review gate stops arming) rather than throwing. The receipt below
         * makes that degradation observable.
         */
        yield ctx.on('system-prompt/assemble', async (assembly, context, next) => {
            // Degradation alarm (v5-P2): an armed review with no agent identity on
            // the assemble context means the gate cannot reach its state — silent
            // stop. One receipt per occurrence: this path appearing at all means
            // the gate is already dead, no throttling needed.
            if (!context.agent?.id && [...states.values()].some((s) => s.pendingReview)) {
                void appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                    agentId: 'unknown',
                    outcome: 'assemble_degraded',
                });
            }
            // The gate-owned brace variable makes {{rg_braces}} resolvable for
            // every context this listener pushes (see braceGuard).
            const out = await next();
            out.variables = { ...out.variables, ...BRACE_VARIABLES };
            const state = context.agent?.id ? states.get(context.agent.id) : undefined;
            // Standing usage contract (2026-09-30 user requirement): a user message
            // asking for a "review" (审查/复审/代码检查) must run THIS plugin's
            // graded protocol at the session's default intensity and settle with a
            // receipt — never a casual write-up. Two lines, always on.
            out.contexts.push({
                name: 'review-gate-usage',
                // braceGuard for uniformity: this lane must stay turn-kill-proof even
                // if the wording ever gains a brace pair.
                text: braceGuard('当用户要求「审查/复审/代码检查/review」某次改动或某些文件时：按当前会话的复审档位执行本插件协议（review_gate_config action=get 可查档位；micro=五分区快扫，full=全面评审），结束后调用 review_acknowledge 结构化回执。缺省档位即会话默认，无需每次确认。'),
            });
            if (state?.pendingReview) {
                const p = state.pendingReview;
                // Lazy evidence probe, once per armed review ('' = zero net change,
                // null = no git evidence).
                if (p.diffText === undefined) {
                    p.diffText = await collectDiff(p.paths);
                }
                const cfg = cfgOf(context.agent?.id);
                const changed = p.diffText === null ? null : countChangedLines(p.diffText);
                // Trivial-write waiver (2026-09-30 user-approved proposal): in auto
                // mode a single tracked file with a tiny diff owes no review at all.
                // The probe above is the measurement — no extra git call. A waived
                // turn logs an audit line (without `action`, so receipt stats keep
                // counting real reviews only) and the closing turn settles as skip.
                if (changed !== null &&
                    shouldWaive({
                        mode: cfg.mode,
                        action: p.action,
                        fileCount: p.paths.length,
                        bashWrites: state.bashWrites,
                        changedLines: changed,
                        exemptBelowLines: cfg.exemptBelowLines,
                    })) {
                    state.pendingReview = null;
                    void appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                        agentId: context.agent?.id,
                        outcome: 'waived',
                        files: p.paths,
                        changedLines: changed,
                    });
                }
                else {
                    // Line-count escalation: a small file count can still be a big diff.
                    if (changed !== null && p.action === 'micro' && changed >= cfg.fullAtLines) {
                        p.action = 'full';
                    }
                    const diffSection = p.diffText === null
                        ? '\n\n（非 git 环境：请对照你本回合的编辑记录复审）'
                        : p.diffText === ''
                            ? '\n\n（空 diff：本回合写入与 HEAD 无净差异——按你的编辑记录自查）'
                            : `\n\n### 本回合改动 diff（HEAD 起）\n\`\`\`diff\n${p.diffText}\n\`\`\``;
                    const bashSection = state.bashCommands.length > 0
                        ? '\n\n### bash 疑似写入命令（进程直写不进上面的 diff，请自行核对这些命令改了什么）\n' +
                            state.bashCommands.map((c) => `- \`${c}\``).join('\n')
                        : '';
                    out.contexts.push({
                        name: 'review-gate',
                        text: braceGuard(reviewInstructionText(p.action, p.files, pitfallsText, config.pitfallsFile) + diffSection + bashSection),
                    });
                }
            }
            return out;
        });
    }, 'review-gate listeners');
    // ---- Live-config HTTP API (the web panel's backend) --------------------
    // webServer only exists in web compositions, so mount lazily via a nested
    // inject: in headless profiles the child fiber simply stays pending and the
    // gate works untouched (a top-level inject would pin the whole plugin to
    // web-only). Consumption is shape-guarded — we deliberately avoid adding a
    // dsh-host-webserver dependency for one registration call (same defense
    // style as the steer guard below).
    const respondJson = (res, code, body) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    /**
     * Receipt audit-log dashboard stats (M2 observation plane). Read-only,
     * failure-soft: a missing/corrupt log degrades to zero counts, never throws.
     * Counts are scoped to today (local midnight); `last` is the newest line.
     */
    const readReceiptStats = () => {
        const empty = { today: { reviews: 0, stopLoss: 0, waived: 0 }, last: null };
        try {
            const file = joinPath(config.receiptDir ?? RECEIPT_DIR, 'receipts.jsonl');
            if (!existsSync(file))
                return empty;
            let raw = readFileSync(file, 'utf8');
            // ponytail: the log grows forever but the dashboard only needs today's
            // tail — read at most the last 64KB, resynced to the first full line
            if (raw.length > 65536)
                raw = raw.slice(raw.indexOf('\n', raw.length - 65536) + 1);
            const midnight = new Date();
            midnight.setHours(0, 0, 0, 0);
            const todayStart = midnight.getTime();
            const stats = { today: { reviews: 0, stopLoss: 0, waived: 0 }, last: null };
            for (const line of raw.split('\n')) {
                if (!line)
                    continue;
                try {
                    const row = JSON.parse(line);
                    if (typeof row.ts !== 'number')
                        continue;
                    const entry = {
                        ts: row.ts,
                        outcome: typeof row.outcome === 'string' ? row.outcome : undefined,
                        action: typeof row.action === 'string' ? row.action : undefined,
                    };
                    stats.last = stats.last === null || entry.ts >= stats.last.ts ? entry : stats.last;
                    if (entry.ts < todayStart)
                        continue;
                    if (entry.outcome === 'stop_loss')
                        stats.today.stopLoss += 1;
                    else if (entry.outcome === 'waived')
                        stats.today.waived += 1;
                    else if (entry.action !== undefined)
                        stats.today.reviews += 1;
                }
                catch { /* torn or foreign line — skip it */ }
            }
            return stats;
        }
        catch {
            return empty;
        }
    };
    // Glob patterns compile through globToRegExp, where a `?` silently changes
    // meaning (regex optional-quantifier) instead of erroring — reject it at the
    // door so the HTTP API carries the same guard as the panel's input.
    const assertGlobsValid = (picked) => {
        for (const key of ['ignoreGlobs', 'alwaysFullGlobs']) {
            const v = picked[key];
            if (Array.isArray(v) && v.some((g) => typeof g === 'string' && g.includes('?'))) {
                throw new Error('glob 模式不支持 ? —— 请用 * 或 **/');
            }
        }
    };
    // Full-schema parse of the candidate config: invalid values (bad enum, NaN,
    // out-of-range) throw; valid ones parse clean. Always validated against
    // boot values + current overlay + the incoming patch, so a patch can never
    // leave the config in a state it could not have booted into.
    const validatePatch = (picked) => {
        Config({ ...bootConfig, ...overlay, ...picked });
    };
    const handleConfigApi = async (req, res) => {
        try {
            if (req.method === 'GET') {
                const sessions = Object.fromEntries([...sessionConfigs.entries()].map(([aid, c]) => [aid, c.mode]));
                // M2 observation plane (2026-09-30): thresholds without gauges are
                // blind tuning — ship the live per-session counters alongside the
                // knobs so the panel shows chain/drift/fatigue next to their limits.
                const stateSummary = Object.fromEntries([...states.entries()].map(([aid, s]) => [aid, {
                        chain: s.chain,
                        sessionFiles: s.sessionFiles,
                        noNewReviews: s.noNewReviews,
                        openWrites: s.files.size,
                        bashWrites: s.bashWrites,
                        pending: s.pendingReview
                            ? { action: s.pendingReview.action, files: s.pendingReview.files }
                            : null,
                    }]));
                // `?sessionId=` opts into that session's effective full config (the
                // panel form's initial values); absent → global view (back-compat).
                const ownConfig = new URL(req.url ?? '/', 'http://localhost')
                    .searchParams.get('sessionId');
                const effective = ownConfig !== null ? sessionConfigs.get(ownConfig) : undefined;
                return respondJson(res, 200, {
                    config: { ...config },
                    overlay: { ...overlay },
                    sessions,
                    states: stateSummary,
                    receipts: readReceiptStats(),
                    effective: effective ? { ...effective } : undefined,
                });
            }
            if (req.method !== 'POST') {
                return respondJson(res, 405, { error: 'method not allowed' });
            }
            let raw = '';
            for await (const chunk of req)
                raw += String(chunk);
            let patch;
            try {
                patch = JSON.parse(raw || '{}');
            }
            catch {
                return respondJson(res, 400, { error: 'invalid JSON body' });
            }
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
                return respondJson(res, 400, { error: 'JSON object body required' });
            }
            const body = patch;
            const scope = body.scope === 'session' ? 'session' : 'global';
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
            const picked = pickOverlay(body);
            const ignored = Object.keys(body).filter((k) => !(k in picked) && k !== 'scope' && k !== 'sessionId');
            try {
                assertGlobsValid(picked);
                if (scope === 'session') {
                    if (sessionId === undefined) {
                        return respondJson(res, 400, { error: 'scope=session requires a sessionId' });
                    }
                    Config({ ...bootConfig, ...overlay, ...sessionOverlays.get(sessionId), ...picked });
                }
                else {
                    validatePatch(picked);
                }
            }
            catch (error) {
                return respondJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
            }
            if (scope === 'session') {
                // Session overlays are in-memory only (agent ids never survive a boot).
                sessionOverlays.set(sessionId, { ...sessionOverlays.get(sessionId), ...picked });
                rebuildAgentConfig(sessionId);
                return respondJson(res, 200, {
                    ok: true,
                    scope,
                    config: { ...sessionConfigs.get(sessionId) },
                });
            }
            Object.assign(overlay, picked);
            applyOverlay(config, picked);
            for (const aid of [...sessionConfigs.keys()])
                rebuildAgentConfig(aid);
            await saveOverlay(overlayDir, overlay);
            respondJson(res, 200, { ok: true, scope: 'global', config: { ...config }, overlay: { ...overlay }, ignored });
        }
        catch (error) {
            respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    };
    const handleConfigReset = async (req, res) => {
        try {
            if (req.method !== 'POST') {
                return respondJson(res, 405, { error: 'method not allowed' });
            }
            let scope = 'global';
            let sessionId;
            try {
                const raw = await new Promise((resolve) => {
                    let body = '';
                    req.on('data', (c) => {
                        body += String(c);
                    });
                    req.on('end', () => resolve(body));
                });
                const parsed = JSON.parse(raw || '{}');
                if (parsed.scope === 'session')
                    scope = 'session';
                if (typeof parsed.sessionId === 'string')
                    sessionId = parsed.sessionId;
            }
            catch {
                // Empty/unreadable body = plain global reset (back-compat).
            }
            if (scope === 'session') {
                if (sessionId === undefined) {
                    return respondJson(res, 400, { error: 'scope=session requires a sessionId' });
                }
                sessionOverlays.delete(sessionId);
                sessionConfigs.delete(sessionId);
                return respondJson(res, 200, { ok: true, scope, config: { ...cfgOf(sessionId) } });
            }
            for (const key of Object.keys(overlay))
                delete overlay[key];
            Object.assign(config, bootConfig);
            for (const aid of [...sessionOverlays.keys()]) {
                sessionOverlays.delete(aid);
                sessionConfigs.delete(aid);
            }
            await saveOverlay(overlayDir, overlay);
            respondJson(res, 200, { ok: true, scope: 'global', config: { ...config } });
        }
        catch (error) {
            respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
    };
    ctx.inject(['webServer'], (webCtx) => {
        const webServer = webCtx.webServer;
        if (!webServer || typeof webServer.register !== 'function')
            return;
        webCtx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugin/review-gate/config',
            // Return the promise so the caller (webserver/tests) can await it.
            handler: (req, res) => handleConfigApi(req, res),
        }));
        webCtx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugin/review-gate/config/reset',
            handler: (req, res) => handleConfigReset(req, res),
        }));
    });
    // The receipt tool: the model calls it after finishing the review demanded by
    // the runtime-context instruction. Registration reads the injectable `tools`
    // service property, which is only available while apply() itself runs —
    // inside the effect generator it throws `cannot get property "tools" without
    // inject` (real-host failure 2026-09-27). Official tools plugins register at
    // the top level of apply(); the registration effect is collected by the
    // plugin context itself, so the returned dispose is not re-yielded.
    ctx.tools.register(defineTool({
        name: 'review_acknowledge',
        description: '复审闸门回执：完成运行时上下文要求的收尾复审后调用，提交结构化复审结论（无待复审回合时调用会被忽略）。',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['micro', 'full'],
                description: '本次执行的复审档位',
            },
            files: {
                type: 'array',
                required: true,
                description: '复审覆盖的文件绝对路径',
            },
            findings: {
                type: 'array',
                description: '发现的问题列表，每项 {file, line?, severity(info|minor|major|critical), note}',
            },
            fixes_made: {
                type: 'boolean',
                required: true,
                description: '是否已就地修复发现的问题',
            },
            summary: {
                type: 'string',
                required: true,
                description: '复审结论一句话',
            },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args, exec) {
            // defineTool already validated args against the parameter schema;
            // its inferred type widens to JsonValue, so narrow once here.
            const a = args;
            const agentId = exec?.agent?.id;
            const state = agentId ? states.get(agentId) : undefined;
            // On-request review settlement (2026-09-30 usage contract): a
            // user-asked review has no armed turn and — in a write-free session —
            // no state at all. Both shapes must still log the receipt
            // (source: on_request) so the audit trail covers requested reviews,
            // not just intercepted ones. Stray acks in dead sessions still log
            // only when an agent id exists (the receipt names its author).
            const settleOnRequest = async () => {
                await appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                    agentId,
                    outcome: 'acknowledged',
                    source: 'on_request',
                    action: a.action,
                    files: a.files,
                    findings: a.findings ?? [],
                    fixes_made: a.fixes_made,
                    summary: a.summary,
                });
                return `复审回执已登记（主动评审，${a.action}，${a.files.length} 文件，findings ${(a.findings ?? []).length} 条${a.fixes_made ? '，已修复' : ''}）。现在输出最终总结（含复审结论）。`;
            };
            if (!state) {
                if (agentId === undefined)
                    return '（当前无待复审回合，回执忽略）';
                return await settleOnRequest();
            }
            // Residue path: steer keeps pendingReview armed and the client may
            // replay the driver hint after the review already settled. Clear the
            // residue and point the model at a short close — never re-log.
            if (state.acknowledged) {
                state.pendingReview = null;
                clearTurnWrites(state);
                return '复审早已完成并回执（本消息为重发），状态已清理。请直接输出简短结案。';
            }
            if (!state.pendingReview)
                return await settleOnRequest();
            state.acknowledged = true;
            // Convergence fatigue counter (v5-F1): a settled full review with zero
            // new findings inches the session toward demoting the milestone
            // escalation; any other settlement resets it.
            state.noNewReviews =
                a.action === 'full' && (a.findings ?? []).length === 0 ? state.noNewReviews + 1 : 0;
            // Findings flywheel: persist the full structured list so recurring bug
            // patterns can later be distilled into the pitfalls file.
            await appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                agentId,
                outcome: 'acknowledged',
                action: a.action,
                files: a.files,
                findings: a.findings ?? [],
                fixes_made: a.fixes_made,
                summary: a.summary,
                cost: {
                    // Qoder-style transparency: what this review cost to demand.
                    intercepts: state.chain,
                    sessionFiles: state.sessionFiles,
                    noNewReviews: state.noNewReviews,
                    diffLines: state.pendingReview.diffText
                        ? state.pendingReview.diffText.split('\n').length
                        : 0,
                },
            });
            // Self-clear NOW: the client can replay the driver hint as a new turn,
            // and without a second turn-stopping the armed review would re-steer
            // forever (real-host finding 2026-09-27). Ack is the settlement point.
            state.pendingReview = null;
            clearTurnWrites(state);
            state.chain = 0;
            return `复审回执已登记（${a.action}，${a.files.length} 文件，findings ${(a.findings ?? []).length} 条${a.fixes_made ? '，已修复' : ''}）。现在输出最终总结（含复审结论）。`;
        },
    }));
    // The live-config tool: the agent-facing twin of the panel's HTTP API.
    // Shares the exact same validation + persistence chain (boot snapshot +
    // overlay + full-schema parse), so chat ("把审查调到 full") and the panel
    // can never drift apart. Registered at apply() top level like
    // review_acknowledge — inside the effect generator it throws without inject.
    ctx.tools.register(defineTool({
        name: 'review_gate_config',
        description: '查看或调整审查闸门力度（即时生效，无需重启）。scope 缺省=本会话（只影响当前会话的复审档位），scope=global 影响所有会话的默认值。action=get 读当前生效配置；set 按提供的键部分更新（仅列出的键有效，未知键忽略）；reset 清除作用域内的覆盖、恢复上级默认（global 时=启动时配置）。',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['get', 'set', 'reset'],
                description: '操作类型',
            },
            scope: {
                type: 'string',
                enum: ['session', 'global'],
                description: '可选：作用域，缺省 session=仅当前会话；global=全局默认',
            },
            mode: {
                type: 'string',
                enum: ['off', 'micro', 'full', 'auto'],
                description: 'set 时可选：复审模式（off 关闸 / micro 快扫 / auto 自动分档 / full 全面）',
            },
            fullAtFiles: { type: 'number', description: 'set 时可选：文件数达到该值升格全面复审' },
            fullAtLines: { type: 'number', description: 'set 时可选：diff 行数达到该值升格全面复审' },
            exemptBelowLines: { type: 'number', description: 'set 时可选：auto 档单文件 diff 改动行数低于该值则整回合免复审（0=关闭）' },
            milestoneAtFiles: { type: 'number', description: 'set 时可选：会话漂移文件数升格阈值' },
            maxChain: { type: 'number', description: 'set 时可选：连续拦截止损上限' },
            noNewReviewsBeforeDemotion: { type: 'number', description: 'set 时可选：连续零发现降格疲劳阈值' },
            alwaysFullGlobs: { type: 'array', description: 'set 时可选：命中即强制全面复审的 glob 清单' },
            ignoreGlobs: { type: 'array', description: 'set 时可选：豁免复审触发的 glob 清单' },
        },
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute(args, exec) {
            const a = args;
            const agentId = exec?.agent?.id;
            // Default scope: global — mirrors the HTTP API
            // (body.scope === 'session' ? 'session' : 'global'). The session lane
            // requires an explicit scope AND an agent id; the agent-less tool call
            // (tests, headless) must keep mutating the global overlay.
            // Default = session (user requirement 2026-09-30: conversation-scoped
            // knobs — "把审查调到 full" must not leak into other sessions, and the
            // tool description documents 缺省=本会话). Global stays one explicit
            // scope:'global' away; no agent id → degrade to global (M0 tests pass
            // exec-less and stay on the global face).
            const scope = a.scope === 'global' || agentId === undefined ? 'global' : 'session';
            if (a.action === 'get') {
                if (scope === 'global') {
                    return JSON.stringify({ scope, config: { ...config }, overlay: { ...overlay } });
                }
                return JSON.stringify({
                    scope,
                    config: { ...cfgOf(agentId) },
                    overlay: (agentId !== undefined ? sessionOverlays.get(agentId) : undefined) ?? {},
                });
            }
            if (a.action === 'reset') {
                if (scope === 'session') {
                    if (agentId === undefined)
                        return '校验失败，未生效：本会话缺少会话标识，无法按会话重置。';
                    sessionOverlays.delete(agentId);
                    sessionConfigs.delete(agentId);
                    return '本会话审查闸门已恢复全局默认（会话覆盖已清除，即时生效）。';
                }
                for (const key of Object.keys(overlay))
                    delete overlay[key];
                Object.assign(config, bootConfig);
                for (const aid of [...sessionOverlays.keys()]) {
                    sessionOverlays.delete(aid);
                    sessionConfigs.delete(aid);
                }
                await saveOverlay(overlayDir, overlay);
                return '审查闸门已恢复启动时配置（全局与全部会话覆盖已清除，即时生效）。';
            }
            const patch = {};
            // The tool exposes every overlay key except writeTools (an advanced
            // internal knob; the HTTP PATCH face still accepts it).
            for (const key of OVERLAY_KEYS) {
                if (key === 'writeTools')
                    continue;
                if (a[key] !== undefined) {
                    patch[key] = a[key];
                }
            }
            if (Object.keys(patch).length === 0) {
                return 'set 未提供任何可设键；可用键：' + OVERLAY_KEYS.filter((k) => k !== 'writeTools').join(', ');
            }
            try {
                assertGlobsValid(patch);
                validatePatch(pickOverlay(patch));
            }
            catch (error) {
                return '校验失败，未生效：' + (error instanceof Error ? error.message : String(error));
            }
            const picked = pickOverlay(patch);
            const applied = Object.keys(picked)
                .map((k) => `${k}=${JSON.stringify(picked[k])}`)
                .join('，');
            if (scope === 'session') {
                if (agentId === undefined)
                    return '校验失败，未生效：本会话缺少会话标识，无法按会话设置。';
                const base = sessionOverlays.get(agentId) ?? {};
                // Validate the full would-be session stack: boot ⊕ global ⊕ session.
                try {
                    Config({ ...bootConfig, ...overlay, ...base, ...picked });
                }
                catch (error) {
                    return '校验失败，未生效：' + (error instanceof Error ? error.message : String(error));
                }
                sessionOverlays.set(agentId, { ...base, ...picked });
                rebuildAgentConfig(agentId);
                return `本会话审查闸门已生效（即时，不影响其他会话）：${applied}`;
            }
            Object.assign(overlay, picked);
            applyOverlay(config, picked);
            for (const aid of [...sessionConfigs.keys()])
                rebuildAgentConfig(aid);
            await saveOverlay(overlayDir, overlay);
            return `审查闸门全局默认已生效（即时）：${applied}`;
        },
    }));
}
