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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only augmentation: pulls the conversation SlotMap merge (the
// `conversation.input.left` seat) into the slots contract for this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReviewGateChip } from './review-gate-chip.tsx'

/** Services the client half needs from the browser module table. */
export const inject = ['slots']

/**
 * Mount the intensity chip into the composer tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'review-gate-intensity-chip',
        order: 20,
        inject: () => ({}),
      },
      ReviewGateChip,
    ),
  )
}
