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
import z from '@deepseek-ai/schemastery';
export const Config = z.object({
    mode: z.union(['off', 'micro', 'full', 'auto']).default('auto'),
    fullAtFiles: z.number().min(1).default(3),
    maxChain: z.number().min(1).default(2),
    writeTools: z.array(z.string()).default(['write', 'edit']),
});
/** Decide whether the closing turn owes a review, and at what depth. */
export function decideReview(input) {
    const { writeFiles, chain, config } = input;
    if (writeFiles === 0)
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
/** Record one tool execution as a code write when its tool is a tracked write tool. */
export function trackWrite(files, toolName, args, config) {
    if (!config.writeTools.includes(toolName))
        return;
    const filePath = args?.file_path;
    if (typeof filePath !== 'string' || filePath === '')
        return;
    files.add(filePath);
}
const MICRO_TEXT = (files) => `[review-gate] 本回合已改动 ${files} 个文件。收尾流程：完成所有工作后、给出最终总结之前，先执行 L1 快扫（只读排查）——逐行读本次全部 diff，专查复制粘贴改漏、改名后残留旧引用、条件写反、边界漏判；汇报时先列出改动文件清单（从 diff 读出）。发现问题→立即修复。最终总结必须并入复审结论。`;
const FULL_TEXT = (files) => `[review-gate] 本回合已改动 ${files} 个文件。收尾流程：给出最终总结之前，先执行全面复审，逐项完成：\n` +
    `0. 先列出本次改动文件清单（从 diff 读出），作为后续每步的检查范围\n` +
    `1. diff 全读：逐行读本次全部改动，以审别人代码的心态专找复制粘贴改漏、改名后残留旧引用、条件写反、边界漏判\n` +
    `2. 爆炸半径：对改动的每个函数/接口 grep 全部调用方，确认签名/语义变化没有漏改下游（含隐式契约：数据格式、事件顺序、状态约定）\n` +
    `3. 测试批判：①测试和实现是否共享同一错误假设 ②有没有路径根本没被测到（边界/异常/并发/空值）③断言是真断言还是恒真\n` +
    `4. 回归面：跑全量相关测试 + 构建，不只跑本次新写的测试\n` +
    `5. 规格对照：改动是否完整覆盖需求，有无擅自缩水或加料\n` +
    `发现问题→立即修复并复验；无问题→说明每步查了什么。以只读排查为主，修复仅限复审发现的缺陷。最终总结必须并入复审结论——总结是回合的最后一条消息。`;
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
    return { files: new Set(), chain: 0, pendingReview: null };
}
/** Full review instruction body — injected as a runtime-context section, never as chat content. */
export function reviewInstructionText(action, files) {
    return action === 'micro' ? MICRO_TEXT(files) : FULL_TEXT(files);
}
/** Minimal driver message: exists to keep the loop running; the instruction rides in the runtime context. */
const DRIVER_TEXT = '(review-gate) 收尾复审未完成：若尚未执行运行时上下文中的复审，现在执行；若已执行，直接输出最终总结（含复审结论与本次任务做了什么）。';
function buildDriverMessage(fileCount) {
    return createUserMessage({
        content: [{ type: 'text', text: DRIVER_TEXT }],
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
    // The write-time listener already graded the change (and armed pendingReview
    // with the current depth). Here the gate only decides: interrupt the closing
    // turn, or let it pass.
    if (state.pendingReview) {
        const action = state.pendingReview.action;
        steer(buildDriverMessage(state.pendingReview.files));
        state.chain += 1;
        // The driver is out; stop injecting until a fresh write re-arms it (a fix
        // during the reviewing turn re-grades via the write-time listener).
        state.pendingReview = null;
        // Writes of the closing turn are accounted for in pendingReview; clear the
        // set so the reviewing turn accumulates its own (fix) writes afresh.
        state.files.clear();
        return action;
    }
    // Nothing owed: a write-free turn resets the chain; any leftovers are settled.
    if (state.files.size === 0)
        state.chain = 0;
    state.files.clear();
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
            // Grade immediately on each write so the instruction leads the wrap-up:
            // the model sees "review before your final summary" while still working.
            const action = decideReview({
                writeFiles: state.files.size,
                chain: state.chain,
                config,
            });
            state.pendingReview = action === 'skip' ? null : { action, files: state.files.size };
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
                out.contexts.push({
                    name: 'review-gate',
                    text: reviewInstructionText(state.pendingReview.action, state.pendingReview.files),
                });
            }
            return out;
        });
    }, 'review-gate listeners');
}
