import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Props the slot renderer binds; `sessionId` comes from ui-session's merge. */
export type ReviewGateChipProps = PropsRuntime<'conversation.input.left'>;
/** Chip + popup. All writes POST to the HTTP API; session scope carries the id. */
export declare function ReviewGateChip(props: ReviewGateChipProps): import("react").JSX.Element;
//# sourceMappingURL=review-gate-chip.d.ts.map