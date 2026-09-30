/**
 * Review gate client half: the composer intensity chip + tap popup.
 *
 * Contributes one chip to the host's `conversation.input.left` list slot
 * ("compact controls at the left of the composer tool row", session-scoped —
 * the same seat the composer plus button lives in). The chip mirrors the live
 * mode and opens a tap-first popup to switch it; every write goes straight to
 * the plugin's HTTP config API on the same origin (see src/index.ts routes).
 *
 * Build: tsc (tsconfig.client.json) -> scripts/build-client.mjs wraps the
 * CommonJS emit into the DSH browser loader closure (`window.__ModuleLoader__`).
 * Platform modules (react, the slots service) stay `require()` externals
 * resolved by the host module table; only our own modules are inlined.
 *
 * @module dsh-review-gate/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Services the client half needs from the browser module table. */
export declare const inject: string[];
/**
 * Mount the intensity chip into the composer tool row.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map