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
    /** While set, the assemble listener injects the review instruction as a runtime-context section. */
    pendingReview: {
        action: 'micro' | 'full';
        files: number;
        /** Absolute paths snapshotted at arm time (state.files is cleared on interception). */
        paths: string[];
        /** Cached diff evidence; '' means "probed, none available". */
        diffText?: string;
    } | null;
    /** Set by the review_acknowledge tool — the sole review-completion signal. */
    acknowledged: boolean;
    /** Consecutive full reviews settled with zero new findings (convergence fatigue counter; v5-F1). */
    noNewReviews: number;
}
export declare function createState(): GateState;
export declare function clearTurnWrites(state: GateState): void;
export declare function collectDiff(files: readonly string[]): Promise<string | null>;
export declare function handleTurnStopping(state: GateState, steer: (message: UserMessage) => void, config: ReviewGateConfig): ReviewAction;
