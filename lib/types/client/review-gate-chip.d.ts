import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Props the slot renderer binds; M1 consumes none of the runtime hooks. */
export type ReviewGateChipProps = PropsRuntime<'conversation.input.left'>;
/** Chip + popup. All writes POST to the M0 HTTP API and re-read the result. */
export declare function ReviewGateChip(_props: ReviewGateChipProps): import("react").JSX.Element;
//# sourceMappingURL=review-gate-chip.d.ts.map