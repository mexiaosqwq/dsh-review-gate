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
}
export declare function createState(): GateState;
/** Full review instruction body — injected as a runtime-context section, never as chat content. */
export declare function reviewInstructionText(action: 'micro' | 'full', files: number): string;
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
