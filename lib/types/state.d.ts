import type { UserMessage } from '@deepseek-ai/dsh-llm';
export type ReviewMode = 'off' | 'micro' | 'full' | 'auto';
export interface ReviewGateConfig {
    /** `off` disables the gate entirely. */
    readonly mode: ReviewMode;
    /** At or above this many changed files, `auto` grades a turn as `full`. */
    readonly fullAtFiles: number;
    /** At or above this many added/removed diff lines, the pending instruction escalates to `full`. */
    readonly fullAtLines: number;
    /** Cumulative session files since the last full review that force a milestone audit. */
    readonly milestoneAtFiles: number;
    /** Maximum consecutive review turns (review found a bug, agent fixed it, gate fires again). */
    readonly maxChain: number;
    /** Tool names whose executions count as code writes. bash is deliberately excluded. */
    readonly writeTools: readonly string[];
    readonly ignoreGlobs: readonly string[];
    readonly alwaysFullGlobs: readonly string[];
    readonly pitfallsFile?: string;
    /** Receipt audit-log directory. Defaults to ~/.dsh/storages/review-gate. */
    readonly receiptDir?: string;
    /** After this many consecutive full reviews with zero new findings, milestone drift no longer escalates to full (converged-session fatigue guard; default 3). */
    readonly noNewReviewsBeforeDemotion?: number;
    /** auto mode only: a single-file turn whose diff has fewer changed lines than this owes no review at all (0 disables; default 10). */
    readonly exemptBelowLines?: number;
    /**
     * Opt-in recording of this turn's bash commands for the push-escalation lane
     * (Batch 2 · 3b-①). Default false leaves every existing behaviour untouched.
     */
    readonly escalateOnPush?: boolean;
}
export type ReviewAction = 'skip' | 'micro' | 'full';
export declare function decideReview(input: {
    writeFiles: number;
    /** A bash command matched the write-pattern heuristic (no file path known). */
    bashWrites?: boolean;
    /** Cumulative session files since the last full review — drift toward a milestone audit. */
    sessionFiles?: number;
    /** Changed file paths, checked against alwaysFullGlobs. */
    paths?: readonly string[];
    /** Consecutive full reviews with zero new findings (optional; 0 = milestone escalation always armed, backward compatible). */
    noNewReviews?: number;
    chain: number;
    config: Pick<ReviewGateConfig, 'mode' | 'fullAtFiles' | 'milestoneAtFiles' | 'maxChain' | 'alwaysFullGlobs' | 'noNewReviewsBeforeDemotion'>;
}): ReviewAction;
export declare function countChangedLines(diffText: string): number;
export declare function shouldWaive(input: {
    mode: ReviewMode;
    action: ReviewAction;
    /** Tracked files snapshotted at arm time (bash-only arms have none). */
    fileCount: number;
    bashWrites: boolean;
    /** Changed (+/-) diff lines; null = no measurement available. */
    changedLines: number | null;
    /** Waiver threshold; 0/undefined disables the waiver entirely. */
    exemptBelowLines?: number;
}): boolean;
export declare function globToRegExp(glob: string): RegExp;
export declare function isIgnored(path: string, globs: readonly string[]): boolean;
export declare const BASH_WRITE_RE: RegExp;
export declare function trackWrite(files: Set<string>, toolName: string, args: unknown, config: Pick<ReviewGateConfig, 'writeTools' | 'ignoreGlobs'>): void;
export interface GateState {
    files: Set<string>;
    chain: number;
    /** Cumulative files this session since the last full review (milestone drift). */
    sessionFiles: number;
    /** A bash command matched BASH_WRITE_RE during the open turn. */
    bashWrites: boolean;
    /** The matched bash commands (<= 5), shown to the reviewing model. */
    bashCommands: string[];
    /**
     * Bash commands recorded for the optional push-escalation lane (Batch 2 ·
     * 3b-①): newest 20, each truncated to 300 chars. Only filled while
     * `escalateOnPush` is on; memory-only, never persisted, never injected into
     * the instruction (unlike bashCommands), cleared on settlement.
     */
    pushHistory: string[];
    /** While set, the assemble listener injects the review instruction as a runtime-context section. */
    pendingReview: {
        action: 'micro' | 'full';
        files: number;
        /** Absolute paths snapshotted at arm time (state.files is cleared on interception). */
        paths: string[];
        /** Cached diff evidence; '' = probed, zero net change; null = no git evidence (non-git or git failure). */
        diffText?: string | null;
    } | null;
    /** Set by the review_acknowledge tool — the sole review-completion signal. */
    acknowledged: boolean;
    /** Consecutive full reviews settled with zero new findings (convergence fatigue counter; v5-F1). */
    noNewReviews: number;
}
export declare function createState(): GateState;
export declare function clearTurnWrites(state: GateState): void;
/**
 * Record one bash command for the push-escalation lane (Batch 2 · 3b-①).
 * Pure channel, no decision: the escalation rule lands separately. Non-string
 * and empty input is ignored; each entry is capped at 300 chars and the list
 * keeps the newest 20 (oldest shifted out) so a chatty session cannot grow it.
 */
export declare function recordPushHistory(history: string[], command: unknown): void;
export declare function collectDiff(files: readonly string[]): Promise<string | null>;
export declare function handleTurnStopping(state: GateState, steer: (message: UserMessage) => void, config: ReviewGateConfig): ReviewAction;
