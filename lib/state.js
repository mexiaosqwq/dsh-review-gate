// Gate state machine core: per-session write accounting, review depth grading,
// and the turn-stopping settlement logic. Split out of index.ts in v5-R1 as a
// pure mechanical move (zero logic changes); comments carried verbatim, with
// block comments rewritten as line comments so a stray `*/` cannot truncate
// them mid-flight.
import { buildDriverMessage } from './instruction.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join as joinPath } from 'node:path';
import { promisify } from 'node:util';
// Decide whether the closing turn owes a review, and at what depth.
export function decideReview(input) {
    const { writeFiles, bashWrites, sessionFiles, paths, noNewReviews, chain, config } = input;
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
    // Convergence fatigue guard (v5-F1): after K consecutive zero-finding full
    // reviews the milestone drift signal is treated as spent — it can no longer
    // escalate to full on its own. micro/full base grading, maxChain stop-loss
    // and claimed decay are untouched.
    const drifted = (sessionFiles ?? 0) >= config.milestoneAtFiles &&
        (noNewReviews ?? 0) < (config.noNewReviewsBeforeDemotion ?? 3);
    const core = (paths ?? []).some((p) => config.alwaysFullGlobs.some((g) => globToRegExp(g).test(p)));
    return writeFiles >= config.fullAtFiles || drifted || core ? 'full' : 'micro';
}
// Count changed lines in a unified diff: every + or - line except the +++/---
// file headers. Shared by the assemble escalation and the trivial-write waiver.
export function countChangedLines(diffText) {
    return diffText
        .split('\n')
        .filter((l) => (l.startsWith('+') && !l.startsWith('+++')) ||
        (l.startsWith('-') && !l.startsWith('---'))).length;
}
// Trivial-write waiver (2026-09-30 user-approved): in `auto` mode, exactly one
// tracked file with a genuinely tiny diff owes no review at all. Evaluated at
// the assemble evidence probe, which already measured the diff — zero extra
// subprocess cost. Fixed modes stay literal (the user chose them deliberately);
// a missing diff measurement (non-git) or a bash write-pattern hit (untracked
// blind spot) never waives — 宁多触发不漏触发.
export function shouldWaive(input) {
    const threshold = input.exemptBelowLines ?? 0;
    if (threshold <= 0)
        return false;
    if (input.mode !== 'auto')
        return false;
    if (input.action !== 'micro')
        return false;
    if (input.fileCount !== 1)
        return false;
    if (input.bashWrites)
        return false;
    return input.changedLines !== null && input.changedLines < threshold;
}
// Minimal glob to RegExp for ignoreGlobs: double-star spans directories (and
// the slash before it is optional), single-star stays within one segment. A
// literal question-mark wildcard is NOT supported — it would collide with the
// quantifier character that the globstar expansion introduces (real bug
// caught by the glob round-trip check); add an explicit pattern instead.
export function globToRegExp(glob) {
    // Tokenize globstars before the single-star pass. Substituting `(?:.*/)?` /
    // `.*` first and then running the `*` pass rewrites the inserted `.*` into
    // `.[^/]*`, collapsing every `**` to a single-segment `*` (2026-10-23 bug:
    // `**/auth/**` failed to match multi-level absolute paths).
    const body = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '(?:.*/)?')
        .replace(/\u0001/g, '.*');
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
        pushHistory: [],
        pendingReview: null,
        acknowledged: false,
        noNewReviews: 0,
    };
}
// Settle the open turn's write tracking (files + bash heuristics) in one place.
// (export added in v5-R1: the acknowledge tool in index.ts now imports this —
// previously module-private; zero body changes.)
export function clearTurnWrites(state) {
    state.files.clear();
    state.bashWrites = false;
    state.bashCommands = [];
    state.pushHistory = [];
}
/**
 * Record one bash command for the push-escalation lane (Batch 2 · 3b-①).
 * Pure channel, no decision: the escalation rule lands separately. Non-string
 * and empty input is ignored; each entry is capped at 300 chars and the list
 * keeps the newest 20 (oldest shifted out) so a chatty session cannot grow it.
 */
export function recordPushHistory(history, command) {
    if (typeof command !== 'string' || command === '')
        return;
    history.push(command.length > 300 ? command.slice(0, 300) : command);
    if (history.length > 20)
        history.shift();
}
/**
 * Push-class detector for the escalation lane (Batch 2 · 3b-②). Reads the
 * history `recordPushHistory` filled. Deliberately coarse — 宁多审 (user
 * ruling): `git push --dry-run` still counts, and a match anywhere after
 * whitespace/newline counts too (`cd x && git push`, multi-line scripts). The
 * `(^|\s)…(?=\s|$|[;&|)])` fences keep lookalikes such as `cat git push.txt`
 * out while still catching shell-separated forms (`git push; …`, `git push&& …`).
 */
const PUSH_RE = /(^|\s)git\s+push(?=\s|$|[;&|)])|(^|\s)gh\s+pr\s+create(?=\s|$|[;&|)])|(^|\s)npm\s+publish(?=\s|$|[;&|)])/;
/** True when any recorded bash command looks like a push-class action. */
export function shouldEscalateForPush(commands) {
    return commands.some((command) => PUSH_RE.test(command));
}
// The host process cwd is not the session workspace, so a `~/…` path used to
// reach git as a literal relative pathspec: when cwd happened to be a repo the
// diff came back '' (false "zero net change"); otherwise null ("not a git
// repo"). Expand `~` / `~/…` to the home directory before any path handling
// (2026-10-24 fix). Absolute and relative paths keep their old behaviour.
function expandTilde(p) {
    if (p === '~')
        return homedir();
    if (p.startsWith('~/'))
        return joinPath(homedir(), p.slice(2));
    return p;
}
// Evidence for the review: the git diff of the touched files, PLUS any of those
// files git does not track yet. '' = git worked but the turn has zero net change
// vs HEAD (waiver-eligible); null = no git repo / no paths / git failure (no
// measurement — conservative). Truncated to 300 lines so a huge change cannot
// blow up the context.
export async function collectDiff(files) {
    const resolved = files.map(expandTilde);
    const first = resolved[0];
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
        const { stdout } = await execFileP('git', ['-C', root, 'diff', 'HEAD', '--', ...resolved], { timeout: 2000, maxBuffer: 4 << 20 });
        // `git diff` structurally never shows untracked files, so a newly created
        // file — the most review-worthy artifact an agent produces — used to read
        // as an empty diff: false "zero net change" evidence, and (auto mode) a
        // waiver that skipped the review entirely. Render those paths as additions
        // (2026-10-10 fix; audit proved 164/202 zero-measurement waivers were
        // brand-new files that were simply absent from HEAD).
        let text = stdout;
        for (const rel of await untrackedAmong(root, resolved)) {
            const added = await diffNewFile(joinPath(root, rel));
            if (added)
                text += (text && !text.endsWith('\n') ? '\n' : '') + added;
        }
        if (!text.trim())
            return '';
        const lines = text.split('\n');
        // ponytail: fixed 300-line cap — a reviewer fetches the tail itself; an
        // untracked file never shows up in `git diff`, so point at the file too.
        if (lines.length > 300) {
            return lines.slice(0, 300).join('\n') + '\n…（已截断：跟踪文件的尾部自行 git diff，未跟踪新文件请直接读该文件）';
        }
        return text;
    }
    catch {
        return null;
    }
}
// Untracked (and not git-ignored) paths among `files`, relative to the repo
// root. --exclude-standard keeps build artifacts/node_modules out of the
// evidence, matching what `git diff` itself would have shown.
async function untrackedAmong(root, files) {
    const { stdout } = await execFileP('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '--', ...files], { timeout: 2000, maxBuffer: 1 << 20 });
    return stdout.split('\n').filter(Boolean);
}
// One untracked file as an all-additions unified diff. `git diff --no-index`
// exits 1 whenever the two sides differ — i.e. in every interesting case — so
// the diff has to be read off the rejection; throwing it away would turn real
// evidence into "no measurement".
async function diffNewFile(absPath) {
    try {
        const { stdout } = await execFileP('git', ['diff', '--no-index', '--', '/dev/null', absPath], { timeout: 2000, maxBuffer: 4 << 20 });
        return stdout;
    }
    catch (err) {
        const stdout = err.stdout;
        return typeof stdout === 'string' ? stdout : '';
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
