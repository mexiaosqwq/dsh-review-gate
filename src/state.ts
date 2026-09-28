// Gate state machine core: per-session write accounting, review depth grading,
// and the turn-stopping settlement logic. Split out of index.ts in v5-R1 as a
// pure mechanical move (zero logic changes); comments carried verbatim, with
// block comments rewritten as line comments so a stray `*/` cannot truncate
// them mid-flight.

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { buildDriverMessage } from './instruction.js'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { promisify } from 'node:util'

// Review depth selection. `auto` grades by changed-file count; fixed modes always apply when writes happened.
export type ReviewMode = 'off' | 'micro' | 'full' | 'auto'

export interface ReviewGateConfig {
  /** `off` disables the gate entirely. */
  readonly mode: ReviewMode
  /** At or above this many changed files, `auto` grades a turn as `full`. */
  readonly fullAtFiles: number
  /** At or above this many added/removed diff lines, the pending instruction escalates to `full`. */
  readonly fullAtLines: number
  /** Cumulative session files since the last full review that force a milestone audit. */
  readonly milestoneAtFiles: number
  /** Maximum consecutive review turns (review found a bug, agent fixed it, gate fires again). */
  readonly maxChain: number
  /** Tool names whose executions count as code writes. bash is deliberately excluded. */
  readonly writeTools: readonly string[]
  // Glob patterns (e.g. '**' + '/*.md') whose writes never arm the gate.
  readonly ignoreGlobs: readonly string[]
  // Glob patterns whose writes ALWAYS arm a full audit (core contract files).
  readonly alwaysFullGlobs: readonly string[]
  // Markdown file of distilled project pitfalls, appended to full review instructions.
  readonly pitfallsFile?: string
  /** Receipt audit-log directory. Defaults to ~/.dsh/storages/review-gate. */
  readonly receiptDir?: string
  /** After this many consecutive full reviews with zero new findings, milestone drift no longer escalates to full (converged-session fatigue guard; default 3). */
  readonly noNewReviewsBeforeDemotion?: number
}

export type ReviewAction = 'skip' | 'micro' | 'full'

// Decide whether the closing turn owes a review, and at what depth.
export function decideReview(input: {
  writeFiles: number
  /** A bash command matched the write-pattern heuristic (no file path known). */
  bashWrites?: boolean
  /** Cumulative session files since the last full review — drift toward a milestone audit. */
  sessionFiles?: number
  /** Changed file paths, checked against alwaysFullGlobs. */
  paths?: readonly string[]
  /** Consecutive full reviews with zero new findings (optional; 0 = milestone escalation always armed, backward compatible). */
  noNewReviews?: number
  chain: number
  config: Pick<
    ReviewGateConfig,
    'mode' | 'fullAtFiles' | 'milestoneAtFiles' | 'maxChain' | 'alwaysFullGlobs' | 'noNewReviewsBeforeDemotion'
  >
}): ReviewAction {
  const { writeFiles, bashWrites, sessionFiles, paths, noNewReviews, chain, config } = input
  if (writeFiles === 0 && !bashWrites) return 'skip'
  if (config.mode === 'off') return 'skip'
  if (chain >= config.maxChain) return 'skip'
  if (config.mode === 'micro') return 'micro'
  if (config.mode === 'full') return 'full'
  // Convergence fatigue guard (v5-F1): after K consecutive zero-finding full
  // reviews the milestone drift signal is treated as spent — it can no longer
  // escalate to full on its own. micro/full base grading, maxChain stop-loss
  // and claimed decay are untouched.
  const drifted =
    (sessionFiles ?? 0) >= config.milestoneAtFiles &&
    (noNewReviews ?? 0) < (config.noNewReviewsBeforeDemotion ?? 3)
  const core = (paths ?? []).some((p) =>
    config.alwaysFullGlobs.some((g) => globToRegExp(g).test(p)),
  )
  return writeFiles >= config.fullAtFiles || drifted || core ? 'full' : 'micro'
}

// Minimal glob to RegExp for ignoreGlobs: double-star spans directories (and
// the slash before it is optional), single-star stays within one segment. A
// literal question-mark wildcard is NOT supported — it would collide with the
// quantifier character that the globstar expansion introduces (real bug
// caught by the glob round-trip check); add an explicit pattern instead.
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${body}$`)
}

// (export added in v5-R1: the fs-intent listener in index.ts now imports this —
// previously module-private; zero body changes.)
export function isIgnored(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path))
}

// bash commands that very likely wrote to the filesystem. bash process writes
// bypass the FileSystem service entirely, so this command-pattern heuristic is
// the only partial cover for the blind spot — it arms a review, never blocks.
export const BASH_WRITE_RE =
  /(^|[\s;&|])(>|>>|tee\b|sed\b[^\n]*-i\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bln\b|npm\s+(install|i|add|update)|git\s+checkout\b[^\n]*--\b|git\s+reset\b|git\s+clean\b)/

// Record one tool execution as a code write when its tool is a tracked write tool.
export function trackWrite(
  files: Set<string>,
  toolName: string,
  args: unknown,
  config: Pick<ReviewGateConfig, 'writeTools' | 'ignoreGlobs'>,
): void {
  if (!config.writeTools.includes(toolName)) return
  const filePath = (args as { file_path?: unknown } | undefined)?.file_path
  if (typeof filePath !== 'string' || filePath === '') return
  if (isIgnored(filePath, config.ignoreGlobs)) return
  files.add(filePath)
}

const execFileP = promisify(execFile)

// Per-session gate state: files written during the open turn + consecutive review chain count.
export interface GateState {
  files: Set<string>
  chain: number
  /** Cumulative files this session since the last full review (milestone drift). */
  sessionFiles: number
  /** A bash command matched BASH_WRITE_RE during the open turn. */
  bashWrites: boolean
  /** The matched bash commands (<= 5), shown to the reviewing model. */
  bashCommands: string[]
  /** While set, the assemble listener injects the review instruction as a runtime-context section. */
  pendingReview: {
    action: 'micro' | 'full'
    files: number
    /** Absolute paths snapshotted at arm time (state.files is cleared on interception). */
    paths: string[]
    /** Cached diff evidence; '' means "probed, none available". */
    diffText?: string
  } | null
  /** Set by the review_acknowledge tool — the sole review-completion signal. */
  acknowledged: boolean
  /** Consecutive full reviews settled with zero new findings (convergence fatigue counter; v5-F1). */
  noNewReviews: number
}

export function createState(): GateState {
  return {
    files: new Set(),
    chain: 0,
    sessionFiles: 0,
    bashWrites: false,
    bashCommands: [],
    pendingReview: null,
    acknowledged: false,
    noNewReviews: 0,
  }
}

// Settle the open turn's write tracking (files + bash heuristics) in one place.
// (export added in v5-R1: the acknowledge tool in index.ts now imports this —
// previously module-private; zero body changes.)
export function clearTurnWrites(state: GateState): void {
  state.files.clear()
  state.bashWrites = false
  state.bashCommands = []
}

// Evidence for the review: the git diff of the touched files, or null when no
// git repo / git failure / empty diff. Truncated to 300 lines so a huge change
// cannot blow up the context.
export async function collectDiff(files: readonly string[]): Promise<string | null> {
  const first = files[0]
  if (!first) return null
  let dir = dirname(first)
  let root: string | null = null
  for (let i = 0; i < 12; i++) {
    if (existsSync(joinPath(dir, '.git'))) {
      root = dir
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (!root) return null
  try {
    const { stdout } = await execFileP(
      'git',
      ['-C', root, 'diff', 'HEAD', '--', ...files],
      { timeout: 2000, maxBuffer: 4 << 20 },
    )
    if (!stdout.trim()) return null
    const lines = stdout.split('\n')
    // ponytail: fixed 300-line cap — a reviewer re-runs git diff for the tail
    if (lines.length > 300) {
      return lines.slice(0, 300).join('\n') + '\n…（已截断，完整 diff 请自行 git diff）'
    }
    return stdout
  } catch {
    return null
  }
}

// Turn-closing hook: consume the write-time grading (pendingReview) and steer
// the wrap-up review when one is armed. Depth capping (maxChain) happens at
// write time in the tools/result listener; a write-free closing turn resets
// the chain. The instruction itself rides the runtime-context section.
export function handleTurnStopping(
  state: GateState,
  steer: (message: UserMessage) => void,
  config: ReviewGateConfig,
): ReviewAction {
  if (state.pendingReview) {
    const action = state.pendingReview.action
    // The receipt tool is the sole completion signal: acknowledged closes pass
    // and settle all state.
    if (state.acknowledged) {
      state.pendingReview = null
      clearTurnWrites(state)
      // A completed full audit settles the session's cumulative drift.
      if (action === 'full') state.sessionFiles = 0
      state.chain = 0
      return action
    }
    // Stop-loss: an unacknowledged model cannot pin the loop forever.
    if (state.chain >= config.maxChain) {
      state.pendingReview = null
      clearTurnWrites(state)
      return 'skip'
    }
    steer(buildDriverMessage(state.pendingReview.files))
    state.chain += 1
    // Keep pendingReview armed: a later close in this turn can still ack. Fix
    // writes during the reviewing turn re-grade via the write-time listener.
    clearTurnWrites(state)
    return action
  }
  // Nothing owed: a write-free closing turn resets the chain; any leftovers
  // are settled.
  if (state.files.size === 0 && !state.bashWrites) state.chain = 0
  clearTurnWrites(state)
  return 'skip'
}
