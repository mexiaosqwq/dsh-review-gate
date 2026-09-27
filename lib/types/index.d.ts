import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/**
 * Declare the plugin's own user-message source kind. The client renders any
 * user message whose source kind is not 'user' as a collapsed context node
 * (same presentation as developer messages), so the review instruction never
 * shows up as a chat bubble — it is context injected into the turn.
 */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'review-gate': {
            kind: 'review-gate';
        } & ContextFormed;
    }
}
/** Review depth selection. `auto` grades by changed-file count; fixed modes always apply when writes happened. */
export type ReviewMode = 'off' | 'micro' | 'full' | 'auto';
export interface ReviewGateConfig {
    /** `off` disables the gate entirely. */
    readonly mode: ReviewMode;
    /** At or above this many changed files, `auto` grades a turn as `full`. */
    readonly fullAtFiles: number;
    /** Maximum consecutive review turns (review found a bug, agent fixed it, gate fires again). */
    readonly maxChain: number;
    /** Tool names whose executions count as code writes. bash is deliberately excluded. */
    readonly writeTools: readonly string[];
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    mode: z<"off" | "micro" | "full" | "auto", "off" | "micro" | "full" | "auto", "defined">;
    fullAtFiles: z<number, number, "defined">;
    maxChain: z<number, number, "defined">;
    writeTools: z<string[], string[], "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    mode: z<"off" | "micro" | "full" | "auto", "off" | "micro" | "full" | "auto", "defined">;
    fullAtFiles: z<number, number, "defined">;
    maxChain: z<number, number, "defined">;
    writeTools: z<string[], string[], "defined">;
}>>, "plain">;
export type ReviewAction = 'skip' | 'micro' | 'full';
/** Decide whether the closing turn owes a review, and at what depth. */
export declare function decideReview(input: {
    writeFiles: number;
    chain: number;
    config: Pick<ReviewGateConfig, 'mode' | 'fullAtFiles' | 'maxChain'>;
}): ReviewAction;
/** Record one tool execution as a code write when its tool is a tracked write tool. */
export declare function trackWrite(files: Set<string>, toolName: string, args: unknown, config: Pick<ReviewGateConfig, 'writeTools'>): void;
/**
 * Legacy single-message form (instruction inside one folded context row).
 * Kept for compatibility; the live gate uses buildDriverMessage + assemble
 * injection instead. Tests still cover its shape.
 */
export declare function buildReviewMessage(action: 'micro' | 'full', fileCount: number): UserMessage;
/** Per-session gate state: files written during the open turn + consecutive review chain count. */
export interface GateState {
    files: Set<string>;
    chain: number;
    /** While set, the assemble listener injects the review instruction as a runtime-context section. */
    pendingReview: {
        action: 'micro' | 'full';
        files: number;
    } | null;
    /** Set by the review_acknowledge tool — the sole review-completion signal. */
    acknowledged: boolean;
}
export declare function createState(): GateState;
/** Full review instruction body — injected as a runtime-context section, never as chat content. */
export declare function reviewInstructionText(action: 'micro' | 'full', files: number): string;
/** Minimal driver message: exists to keep the loop running; the instruction rides in the runtime context. */
export declare const DRIVER_HINT = "(review-gate) \u6536\u5C3E\u590D\u5BA1\u672A\u5B8C\u6210\uFF1A\u8BF7\u6267\u884C\u8FD0\u884C\u65F6\u4E0A\u4E0B\u6587\u4E2D\u7684\u590D\u5BA1\uFF0C\u5B8C\u6210\u540E\u8C03\u7528 review_acknowledge \u56DE\u6267\uFF0C\u7136\u540E\u8F93\u51FA\u6700\u7EC8\u603B\u7ED3\uFF08\u542B\u590D\u5BA1\u7ED3\u8BBA\u4E0E\u672C\u6B21\u4EFB\u52A1\u505A\u4E86\u4EC0\u4E48\uFF09\u3002";
/**
 * Turn-closing hook: consume the write-time grading (pendingReview) and steer
 * the wrap-up review when one is armed. Depth capping (maxChain) happens at
 * write time in the tools/result listener; a write-free closing turn resets
 * the chain. The instruction itself rides the runtime-context section.
 */
export declare function handleTurnStopping(state: GateState, steer: (message: UserMessage) => void, config: ReviewGateConfig): ReviewAction;
/** Cordis plugin identity. */
export declare const name = "review-gate";
export declare function apply(ctx: Context, config: ReviewGateConfig): void;
