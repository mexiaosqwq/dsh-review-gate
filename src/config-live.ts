/**
 * Live-config overlay: the web panel's source of truth for review intensity.
 *
 * The host has no patch hot-reload (profile `patchReload: "startup"`), so
 * runtime adjustments persist in an overlay JSON under the default storage
 * dir instead, merged over the activation config in place. Overlay values win
 * until cleared; path keys (pitfallsFile/receiptDir) are deliberately excluded
 * — they are read once at activation and belong to the boot layer.
 *
 * @module dsh-review-gate
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join as joinPath } from 'node:path'
import type { ReviewGateConfig } from './state.js'

/** Keys the panel may adjust at runtime. Path keys are boot-level, excluded. */
export const OVERLAY_KEYS = [
  'mode',
  'fullAtFiles',
  'fullAtLines',
  'milestoneAtFiles',
  'maxChain',
  'writeTools',
  'ignoreGlobs',
  'alwaysFullGlobs',
  'noNewReviewsBeforeDemotion',
] as const

export function overlayPath(dir: string): string {
  return joinPath(dir, 'config.json')
}

/** Read the stored overlay; a missing or corrupt file degrades to {}. */
export function readOverlay(dir: string): Record<string, unknown> {
  try {
    const file = overlayPath(dir)
    if (!existsSync(file)) return {}
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Merge known overlay keys into the config object in place (same reference). */
export function applyOverlay(config: ReviewGateConfig, overlay: Record<string, unknown>): void {
  for (const key of OVERLAY_KEYS) {
    if (key in overlay) {
      const value = overlay[key]
      // Copy arrays so overlay and config never share a mutable reference.
      ;(config as unknown as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value
    }
  }
}

/** Strip a patch down to known overlay keys; anything else is reported ignored. */
export function pickOverlay(patch: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of OVERLAY_KEYS) {
    if (key in patch) {
      const value = patch[key]
      picked[key] = Array.isArray(value) ? [...value] : value
    }
  }
  return picked
}

/** Atomic publish: write a sibling tmp file, then rename over the target. */
export async function saveOverlay(dir: string, overlay: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = overlayPath(dir)
  const tmp = target + '.tmp'
  await writeFile(tmp, JSON.stringify(overlay, null, 2) + '\n')
  await rename(tmp, target)
}
