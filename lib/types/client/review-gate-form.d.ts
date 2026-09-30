/** One session's live counters, as shipped by GET /plugin/review-gate/config. */
export interface GateStateSummary {
    chain: number;
    sessionFiles: number;
    noNewReviews: number;
    openWrites: number;
    bashWrites: boolean;
    pending: {
        action: string;
        files: number;
    } | null;
}
/** Receipt audit-log tail stats (today-only counts + newest line). */
export interface ReceiptStats {
    today: {
        reviews: number;
        stopLoss: number;
    };
    last: {
        ts: number;
        outcome?: string;
        action?: string;
    } | null;
}
/**
 * Dashboard row: session counters (against their configured limits) + today's
 * receipt totals. Session row hides when the gate has no state for this
 * conversation yet.
 */
export declare function GateDashboard(props: {
    stateRow: GateStateSummary | null;
    receipts: ReceiptStats | null;
    cfg: Record<string, unknown>;
}): JSX.Element;
/**
 * Thresholds + glob lists + advanced drawer. `cfg` is the effective config of
 * the active scope; POST success refreshes it via the parent (config echo),
 * which also resets the drafts.
 */
export declare function GateForm(props: {
    cfg: Record<string, unknown>;
    onPatch: (patch: Record<string, unknown>) => Promise<boolean>;
}): JSX.Element;
//# sourceMappingURL=review-gate-form.d.ts.map