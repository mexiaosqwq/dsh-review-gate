import type { ReviewGateConfig } from './state.js';
/** Keys the panel may adjust at runtime. Path keys are boot-level, excluded. */
export declare const OVERLAY_KEYS: readonly ["mode", "fullAtFiles", "fullAtLines", "exemptBelowLines", "milestoneAtFiles", "maxChain", "writeTools", "ignoreGlobs", "alwaysFullGlobs", "noNewReviewsBeforeDemotion"];
export declare function overlayPath(dir: string): string;
/** Read the stored overlay; a missing or corrupt file degrades to {}. */
export declare function readOverlay(dir: string): Record<string, unknown>;
/** Merge known overlay keys into the config object in place (same reference). */
export declare function applyOverlay(config: ReviewGateConfig, overlay: Record<string, unknown>): void;
/** Strip a patch down to known overlay keys; anything else is reported ignored. */
export declare function pickOverlay(patch: Record<string, unknown>): Record<string, unknown>;
/** Atomic publish: write a sibling tmp file, then rename over the target. */
export declare function saveOverlay(dir: string, overlay: Record<string, unknown>): Promise<void>;
