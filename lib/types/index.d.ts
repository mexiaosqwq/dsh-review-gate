/**
 * dsh-review-gate — automatic post-turn code review gate.
 *
 * After a turn in which the agent wrote files, steer the agent back for a
 * graded self-review (light scan or full audit, auto-selected by change size)
 * before the turn is allowed to close. Inspired by Qoder Security's
 * progressive scan design; enforces the repo's "changes need a full review"
 * rule at the harness level instead of by convention.
 *
 * Wiring layer (v5-R1 split): apply() + Config schema + the receipt tool live
 * here; instruction text/builders are in ./instruction.js and the state
 * machine in ./state.js. Everything below re-exports the full public surface
 * so `import * as gate from 'dsh-review-gate'` keeps working unchanged.
 *
 * @module dsh-review-gate
 */
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ReviewGateConfig } from './state.js';
export * from './instruction.js';
export * from './state.js';
export * from './config-live.js';
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
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    mode: z<"micro" | "full" | "off" | "auto", "micro" | "full" | "off" | "auto", "defined">;
    fullAtFiles: z<number, number, "defined">;
    fullAtLines: z<number, number, "defined">;
    milestoneAtFiles: z<number, number, "defined">;
    maxChain: z<number, number, "defined">;
    writeTools: z<string[], string[], "defined">;
    ignoreGlobs: z<string[], string[], "defined">;
    alwaysFullGlobs: z<string[], string[], "defined">;
    pitfallsFile: z<string, string, "plain">;
    receiptDir: z<string, string, "plain">;
    noNewReviewsBeforeDemotion: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    mode: z<"micro" | "full" | "off" | "auto", "micro" | "full" | "off" | "auto", "defined">;
    fullAtFiles: z<number, number, "defined">;
    fullAtLines: z<number, number, "defined">;
    milestoneAtFiles: z<number, number, "defined">;
    maxChain: z<number, number, "defined">;
    writeTools: z<string[], string[], "defined">;
    ignoreGlobs: z<string[], string[], "defined">;
    alwaysFullGlobs: z<string[], string[], "defined">;
    pitfallsFile: z<string, string, "plain">;
    receiptDir: z<string, string, "plain">;
    noNewReviewsBeforeDemotion: z<number, number, "defined">;
}>>, "plain">;
/** Cordis plugin identity. */
export declare const name = "review-gate";
/**
 * Declared service dependencies: `ctx.tools` is an injectable property and is
 * only readable when the plugin declares it here — cordis establishes the
 * inject context for exactly these services while running apply(). Without
 * this declaration `ctx.tools.register(...)` throws
 * `cannot get property "tools" without inject` and the whole plugin fails to
 * activate (real-host failure 2026-09-27).
 */
export declare const inject: string[];
/**
 * Append one receipt as a JSON line. Audit must never break the turn: every
 * failure is swallowed.
 */
export declare function appendReceipt(dir: string, receipt: Record<string, unknown>): Promise<void>;
export declare function apply(ctx: Context, config: ReviewGateConfig): void;
