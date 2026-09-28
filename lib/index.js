import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { BASH_WRITE_RE, clearTurnWrites, collectDiff, createState, decideReview, handleTurnStopping, trackWrite } from './state.js';
import { reviewInstructionText } from './instruction.js';
export * from './instruction.js';
export * from './state.js';
export const Config = z.object({
    mode: z.union(['off', 'micro', 'full', 'auto']).default('auto'),
    fullAtFiles: z.number().min(1).default(3),
    fullAtLines: z.number().min(1).default(150),
    milestoneAtFiles: z.number().min(1).default(10),
    maxChain: z.number().min(1).default(2),
    writeTools: z.array(z.string()).default(['write', 'edit']),
    ignoreGlobs: z.array(z.string()).default([]),
    alwaysFullGlobs: z.array(z.string()).default([]),
    pitfallsFile: z.string(),
    receiptDir: z.string(),
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
    // Distilled pitfalls ride full review instructions. Read once at activation;
    // the file is edited between sessions, not mid-turn.
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
    const gradeAndArm = (state) => {
        const action = decideReview({
            writeFiles: state.files.size,
            bashWrites: state.bashWrites,
            sessionFiles: state.sessionFiles,
            paths: [...state.files],
            noNewReviews: state.noNewReviews,
            chain: state.chain,
            config,
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
            trackWrite(state.files, exec.name, exec.arguments, config);
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
            gradeAndArm(state);
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
            const action = handleTurnStopping(state, (message) => payload.agent.steer?.(message), config);
            // handleTurnStopping stays a pure function: IO lives here. 'skip' with
            // a chain at the cap means the review was given up on — log the
            // terminal state so the review-abandonment rate becomes observable.
            if (action === 'skip' && state.chain >= config.maxChain) {
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
        // The review instruction rides the dynamic runtime context (same channel
        // as memory recalls), not the conversation. While a review is pending,
        // every request in the reviewing turn sees the instruction section.
        yield ctx.on('system-prompt/assemble', async (assembly, context, next) => {
            const out = await next();
            const state = context.agent?.id ? states.get(context.agent.id) : undefined;
            if (state?.pendingReview) {
                const p = state.pendingReview;
                // Lazy evidence probe, once per armed review ('' = probed, nothing).
                if (p.diffText === undefined) {
                    p.diffText = (await collectDiff(p.paths)) ?? '';
                }
                // Line-count escalation: a small file count can still be a big diff.
                if (p.diffText && p.action === 'micro') {
                    const changed = p.diffText
                        .split('\n')
                        .filter((l) => (l.startsWith('+') && !l.startsWith('+++')) ||
                        (l.startsWith('-') && !l.startsWith('---'))).length;
                    if (changed >= config.fullAtLines)
                        p.action = 'full';
                }
                const diffSection = p.diffText
                    ? `\n\n### 本回合改动 diff（HEAD 起）\n\`\`\`diff\n${p.diffText}\n\`\`\``
                    : '\n\n（非 git 环境：请对照你本回合的编辑记录复审）';
                const bashSection = state.bashCommands.length > 0
                    ? '\n\n### bash 疑似写入命令（进程直写不进上面的 diff，请自行核对这些命令改了什么）\n' +
                        state.bashCommands.map((c) => `- \`${c}\``).join('\n')
                    : '';
                out.contexts.push({
                    name: 'review-gate',
                    text: reviewInstructionText(p.action, p.files, pitfallsText) + diffSection + bashSection,
                });
            }
            return out;
        });
    }, 'review-gate listeners');
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
            if (!state)
                return '（当前无待复审回合，回执忽略）';
            // Residue path: steer keeps pendingReview armed and the client may
            // replay the driver hint after the review already settled. Clear the
            // residue and point the model at a short close — never re-log.
            if (state.acknowledged) {
                state.pendingReview = null;
                clearTurnWrites(state);
                return '复审早已完成并回执（本消息为重发），状态已清理。请直接输出简短结案。';
            }
            if (!state.pendingReview) {
                return '（当前无待复审回合，回执忽略）';
            }
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
}
