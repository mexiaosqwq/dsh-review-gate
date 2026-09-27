/**
 * dsh-review-gate — automatic post-turn code review gate.
 *
 * After a turn in which the agent wrote files, steer the agent back for a
 * graded self-review (light scan or full audit, auto-selected by change size)
 * before the turn is allowed to close. Inspired by Qoder Security's
 * progressive scan design; enforces the repo's "changes need a full review"
 * rule at the harness level instead of by convention.
 *
 * @module dsh-review-gate
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join as joinPath } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
export const Config = z.object({
    mode: z.union(['off', 'micro', 'full', 'auto']).default('auto'),
    fullAtFiles: z.number().min(1).default(3),
    fullAtLines: z.number().min(1).default(150),
    maxChain: z.number().min(1).default(2),
    writeTools: z.array(z.string()).default(['write', 'edit']),
    receiptDir: z.string(),
});
/** Decide whether the closing turn owes a review, and at what depth. */
export function decideReview(input) {
    const { writeFiles, bashWrites, chain, config } = input;
    if (writeFiles === 0 && !bashWrites)
        return 'skip';
    if (config.mode === 'off')
        return 'skip';
    if (chain >= config.maxChain)
        return 'skip';
    if (config.mode === 'micro')
        return 'micro';
    if (config.mode === 'full')
        return 'full';
    return writeFiles >= config.fullAtFiles ? 'full' : 'micro';
}
/**
 * bash commands that very likely wrote to the filesystem. bash process writes
 * bypass the FileSystem service entirely, so this command-pattern heuristic is
 * the only partial cover for the blind spot — it arms a review, never blocks.
 */
export const BASH_WRITE_RE = /(^|[\s;&|])(>|>>|tee\b|sed\b[^\n]*-i\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bln\b|npm\s+(install|i|add|update)|git\s+checkout\b[^\n]*--\b|git\s+reset\b|git\s+clean\b)/;
/** Record one tool execution as a code write when its tool is a tracked write tool. */
export function trackWrite(files, toolName, args, config) {
    if (!config.writeTools.includes(toolName))
        return;
    const filePath = args?.file_path;
    if (typeof filePath !== 'string' || filePath === '')
        return;
    files.add(filePath);
}
const execFileP = promisify(execFile);
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
/**
 * Evidence for the review: the git diff of the touched files, or null when no
 * git repo / git failure / empty diff. Truncated to 300 lines so a huge change
 * cannot blow up the context.
 */
export async function collectDiff(files) {
    const first = files[0];
    if (!first)
        return null;
    let dir = dirname(first);
    let root = null;
    for (let i = 0; i < 12; i++) {
        if (existsSync(joinPath(dir, '.git'))) {
            root = dir;
            break;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    if (!root)
        return null;
    try {
        const { stdout } = await execFileP('git', ['-C', root, 'diff', 'HEAD', '--', ...files], { timeout: 2000, maxBuffer: 4 << 20 });
        if (!stdout.trim())
            return null;
        const lines = stdout.split('\n');
        // ponytail: fixed 300-line cap — a reviewer re-runs git diff for the tail
        if (lines.length > 300) {
            return lines.slice(0, 300).join('\n') + '\n…（已截断，完整 diff 请自行 git diff）';
        }
        return stdout;
    }
    catch {
        return null;
    }
}
const MICRO_TEXT = (files) => `[review-gate] 本回合已改动 ${files} 个文件。收尾流程：完成所有工作后、给出最终总结之前，先执行 L1 快扫（只读排查）——逐行读本次全部 diff，专查复制粘贴改漏、改名后残留旧引用、条件写反、边界漏判；汇报时先列出改动文件清单（从 diff 读出）。发现问题→立即修复。复审完成后调用 review_acknowledge 工具回执（提交 findings 与结论），最终总结必须并入复审结论。`;
const FULL_TEXT = (files) => `[review-gate] 本回合已改动 ${files} 个文件。收尾流程：给出最终总结之前，先执行全面复审，逐项完成：\n` +
    `0. 先列出本次改动文件清单（从 diff 读出），作为后续每步的检查范围\n` +
    `1. diff 全读：逐行读本次全部改动，以审别人代码的心态专找复制粘贴改漏、改名后残留旧引用、条件写反、边界漏判\n` +
    `2. 爆炸半径：对改动的每个函数/接口 grep 全部调用方，确认签名/语义变化没有漏改下游（含隐式契约：数据格式、事件顺序、状态约定）\n` +
    `3. 测试批判：①测试和实现是否共享同一错误假设 ②有没有路径根本没被测到（边界/异常/并发/空值）③断言是真断言还是恒真\n` +
    `4. 回归面：跑全量相关测试 + 构建，不只跑本次新写的测试\n` +
    `5. 规格对照：改动是否完整覆盖需求，有无擅自缩水或加料\n` +
    `发现问题→立即修复并复验；无问题→说明每步查了什么。以只读排查为主，修复仅限复审发现的缺陷。全部完成后调用 review_acknowledge 工具回执（action/files/findings/fixes_made/summary），最终总结必须并入复审结论——总结是回合的最后一条消息。`;
/**
 * Legacy single-message form (instruction inside one folded context row).
 * Kept for compatibility; the live gate uses buildDriverMessage + assemble
 * injection instead. Tests still cover its shape.
 */
export function buildReviewMessage(action, fileCount) {
    return createUserMessage({
        content: [{ type: 'text', text: reviewInstructionText(action, fileCount) }],
        source: {
            kind: 'review-gate',
            form: 'notice',
            summary: `复审闸门：本回合 ${fileCount} 个文件改动，执行${action === 'micro' ? ' L1 快扫' : '全面复审'}`,
        },
    });
}
export function createState() {
    return {
        files: new Set(),
        chain: 0,
        bashWrites: false,
        bashCommands: [],
        pendingReview: null,
        acknowledged: false,
    };
}
/** Settle the open turn's write tracking (files + bash heuristics) in one place. */
function clearTurnWrites(state) {
    state.files.clear();
    state.bashWrites = false;
    state.bashCommands = [];
}
/** Full review instruction body — injected as a runtime-context section, never as chat content. */
export function reviewInstructionText(action, files) {
    return action === 'micro' ? MICRO_TEXT(files) : FULL_TEXT(files);
}
/** Minimal driver message: exists to keep the loop running; the instruction rides in the runtime context. */
export const DRIVER_HINT = '(review-gate) 收尾复审未完成：请执行运行时上下文中的复审，完成后调用 review_acknowledge 回执，然后输出最终总结（含复审结论与本次任务做了什么）。';
function buildDriverMessage(fileCount) {
    return createUserMessage({
        content: [{ type: 'text', text: DRIVER_HINT }],
        // Custom kind (not 'user'): the client renders this as a collapsed context
        // row with a one-line summary — never a chat bubble.
        source: {
            kind: 'review-gate',
            form: 'notice',
            summary: `复审闸门已触发（${fileCount} 个文件）`,
        },
    });
}
/**
 * Turn-closing hook: consume the write-time grading (pendingReview) and steer
 * the wrap-up review when one is armed. Depth capping (maxChain) happens at
 * write time in the tools/result listener; a write-free closing turn resets
 * the chain. The instruction itself rides the runtime-context section.
 */
export function handleTurnStopping(state, steer, config) {
    if (state.pendingReview) {
        const action = state.pendingReview.action;
        // The receipt tool is the sole completion signal: acknowledged closes pass
        // and settle all state.
        if (state.acknowledged) {
            state.pendingReview = null;
            clearTurnWrites(state);
            state.chain = 0;
            return action;
        }
        // Stop-loss: an unacknowledged model cannot pin the loop forever.
        if (state.chain >= config.maxChain) {
            state.pendingReview = null;
            clearTurnWrites(state);
            return 'skip';
        }
        steer(buildDriverMessage(state.pendingReview.files));
        state.chain += 1;
        // Keep pendingReview armed: a later close in this turn can still ack. Fix
        // writes during the reviewing turn re-grade via the write-time listener.
        clearTurnWrites(state);
        return action;
    }
    // Nothing owed: a write-free closing turn resets the chain; any leftovers
    // are settled.
    if (state.files.size === 0 && !state.bashWrites)
        state.chain = 0;
    clearTurnWrites(state);
    return 'skip';
}
/** Cordis plugin identity. */
export const name = 'review-gate';
export function apply(ctx, config) {
    const states = new Map();
    ctx.effect(function* () {
        yield ctx.on('tools/result', (exec) => {
            if (!exec?.agent?.id)
                return;
            let state = states.get(exec.agent.id);
            if (!state) {
                state = createState();
                states.set(exec.agent.id, state);
            }
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
            // Grade immediately on each write so the instruction leads the wrap-up:
            // the model sees "review before your final summary" while still working.
            const action = decideReview({
                writeFiles: state.files.size,
                bashWrites: state.bashWrites,
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
        });
        yield ctx.on('agent/turn-stopping', (payload) => {
            const state = states.get(payload.agent.id);
            if (!state)
                return;
            if (typeof payload.agent.steer !== 'function')
                return;
            handleTurnStopping(state, (message) => payload.agent.steer?.(message), config);
        });
        yield ctx.on('agent/disposed', (payload) => {
            states.delete(payload.agent.id);
        });
        // A newly claimed user message starts a fresh user turn: decay the review
        // chain by one so the gate regains protection after a maxChain stop-loss,
        // instead of staying silent until a write-free turn happens to occur.
        yield ctx.on('agent/inbox/claimed', (payload) => {
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
                    text: reviewInstructionText(p.action, p.files) + diffSection + bashSection,
                });
            }
            return out;
        });
        // The receipt tool: the model calls it after finishing the review demanded
        // by the runtime-context instruction. Registration flows its schema into
        // prompt assembly automatically.
        yield ctx.tools.register(defineTool({
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
                if (!state || !state.pendingReview) {
                    return '（当前无待复审回合，回执忽略）';
                }
                state.acknowledged = true;
                const findings = a.findings?.length ?? 0;
                await appendReceipt(config.receiptDir ?? RECEIPT_DIR, {
                    agentId,
                    action: a.action,
                    files: a.files,
                    findings,
                    fixes_made: a.fixes_made,
                    summary: a.summary,
                });
                return `复审回执已登记（${a.action}，${a.files.length} 文件，findings ${findings} 条${a.fixes_made ? '，已修复' : ''}）。现在输出最终总结（含复审结论）。`;
            },
        }));
    }, 'review-gate listeners');
}
