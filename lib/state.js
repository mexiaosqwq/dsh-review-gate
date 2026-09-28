// Gate state machine core: per-session write accounting, review depth grading,
// and the turn-stopping settlement logic. Split out of index.ts in v5-R1 as a
// pure mechanical move (zero logic changes); comments carried verbatim, with
// block comments rewritten as line comments so a stray `*/` cannot truncate
// them mid-flight.
import { buildDriverMessage } from './instruction.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { promisify } from 'node:util';
// Decide whether the closing turn owes a review, and at what depth.
export function decideReview(input) {
    const { writeFiles, bashWrites, sessionFiles, paths, chain, config } = input;
    if (writeFiles === 0 && !bashWrites)
        return 'skip';
    if (config.mode === 'off')
        return 'skip';
    if (chain >= config.maxChain)
        return 'skip';
    if (config.mode === 'micro')
        return 'micro';
    if (config.mode === 'full')
        return 'full';
    const drifted = (sessionFiles ?? 0) >= config.milestoneAtFiles;
    const core = (paths ?? []).some((p) => config.alwaysFullGlobs.some((g) => globToRegExp(g).test(p)));
    return writeFiles >= config.fullAtFiles || drifted || core ? 'full' : 'micro';
}
// Minimal glob to RegExp for ignoreGlobs: double-star spans directories (and
// the slash before it is optional), single-star stays within one segment. A
// literal question-mark wildcard is NOT supported — it would collide with the
// quantifier character that the globstar expansion introduces (real bug
// caught by the glob round-trip check); add an explicit pattern instead.
export function globToRegExp(glob) {
    const body = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
    return new RegExp(`^${body}$`);
}
// (export added in v5-R1: the fs-intent listener in index.ts now imports this —
// previously module-private; zero body changes.)
export function isIgnored(path, globs) {
    return globs.some((g) => globToRegExp(g).test(path));
}
// bash commands that very likely wrote to the filesystem. bash process writes
// bypass the FileSystem service entirely, so this command-pattern heuristic is
// the only partial cover for the blind spot — it arms a review, never blocks.
export const BASH_WRITE_RE = /(^|[\s;&|])(>|>>|tee\b|sed\b[^\n]*-i\b|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bln\b|npm\s+(install|i|add|update)|git\s+checkout\b[^\n]*--\b|git\s+reset\b|git\s+clean\b)/;
// Record one tool execution as a code write when its tool is a tracked write tool.
export function trackWrite(files, toolName, args, config) {
    if (!config.writeTools.includes(toolName))
        return;
    const filePath = args?.file_path;
    if (typeof filePath !== 'string' || filePath === '')
        return;
    if (isIgnored(filePath, config.ignoreGlobs))
        return;
    files.add(filePath);
}
const execFileP = promisify(execFile);
export function createState() {
    return {
        files: new Set(),
        chain: 0,
        sessionFiles: 0,
        bashWrites: false,
        bashCommands: [],
        pendingReview: null,
        acknowledged: false,
    };
}
// Settle the open turn's write tracking (files + bash heuristics) in one place.
// (export added in v5-R1: the acknowledge tool in index.ts now imports this —
// previously module-private; zero body changes.)
export function clearTurnWrites(state) {
    state.files.clear();
    state.bashWrites = false;
    state.bashCommands = [];
}
// Evidence for the review: the git diff of the touched files, or null when no
// git repo / git failure / empty diff. Truncated to 300 lines so a huge change
// cannot blow up the context.
export async function collectDiff(files) {
    const first = files[0];
    if (!first)
        return null;
    let dir = dirname(first);
    let root = null;
    for (let i = 0; i < 12; i++) {
        if (existsSync(joinPath(dir, '.git'))) {
            root = dir;
            break;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    if (!root)
        return null;
    try {
        const { stdout } = await execFileP('git', ['-C', root, 'diff', 'HEAD', '--', ...files], { timeout: 2000, maxBuffer: 4 << 20 });
        if (!stdout.trim())
            return null;
        const lines = stdout.split('\n');
        // ponytail: fixed 300-line cap — a reviewer re-runs git diff for the tail
        if (lines.length > 300) {
            return lines.slice(0, 300).join('\n') + '\n…（已截断，完整 diff 请自行 git diff）';
        }
        return stdout;
    }
    catch {
        return null;
    }
}
// Turn-closing hook: consume the write-time grading (pendingReview) and steer
// the wrap-up review when one is armed. Depth capping (maxChain) happens at
// write time in the tools/result listener; a write-free closing turn resets
// the chain. The instruction itself rides the runtime-context section.
export function handleTurnStopping(state, steer, config) {
    if (state.pendingReview) {
        const action = state.pendingReview.action;
        // The receipt tool is the sole completion signal: acknowledged closes pass
        // and settle all state.
        if (state.acknowledged) {
            state.pendingReview = null;
            clearTurnWrites(state);
            // A completed full audit settles the session's cumulative drift.
            if (action === 'full')
                state.sessionFiles = 0;
            state.chain = 0;
            return action;
        }
        // Stop-loss: an unacknowledged model cannot pin the loop forever.
        if (state.chain >= config.maxChain) {
            state.pendingReview = null;
            clearTurnWrites(state);
            return 'skip';
        }
        steer(buildDriverMessage(state.pendingReview.files));
        state.chain += 1;
        // Keep pendingReview armed: a later close in this turn can still ack. Fix
        // writes during the reviewing turn re-grade via the write-time listener.
        clearTurnWrites(state);
        return action;
    }
    // Nothing owed: a write-free closing turn resets the chain; any leftovers
    // are settled.
    if (state.files.size === 0 && !state.bashWrites)
        state.chain = 0;
    clearTurnWrites(state);
    return 'skip';
}
