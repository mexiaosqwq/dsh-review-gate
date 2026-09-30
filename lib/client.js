window.__ModuleLoader__.load({ id: "dsh-review-gate", factory: (require) => {
var __modules = {};
__modules["review-gate-form.js"] = function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GateDashboard = GateDashboard;
exports.GateForm = GateForm;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * The popup's tuning form + dashboard (M2, 2026-09-30 user-approved scope):
 * five numeric thresholds, two glob list editors, the writeTools advanced
 * drawer, and a live counters readout fed by the GET API's `states`/`receipts`
 * observation plane.
 *
 * Every mutation goes through `onPatch` (the chip's HTTP POST wrapper) — one
 * field, one POST, config echo refreshes the drafts. Pure presentation beyond
 * that: field-level validation only (numeric range, the `?` glob trap —
 * globToRegExp silently miscompiles `?`, so the input rejects it up front).
 *
 * @module dsh-review-gate/client
 */
const react_1 = require("react");
const LABEL = { fontSize: 12, fontWeight: 600 };
const HINT = { fontSize: 10, opacity: 0.55, marginTop: 1 };
const INPUT = {
    width: 72,
    minHeight: 30,
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
    background: 'var(--dsw-menu-surface-fill, #fff)',
    color: 'inherit',
    fontSize: 13,
    padding: '2px 8px',
};
const INPUT_BORDER = '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))';
/** The six numeric thresholds: key, label, hint, schema min (mirrors Config). */
const NUM_FIELDS = [
    { key: 'fullAtFiles', label: '升全面 · 文件数', hint: '回合内写入文件数 ≥ 此值 → 全面复审', min: 1 },
    { key: 'fullAtLines', label: '升全面 · diff 行数', hint: '快扫档 diff 行数 ≥ 此值 → 现场升格全面', min: 1 },
    { key: 'exemptBelowLines', label: '免审 · 单文件行数', hint: 'auto 档单文件 diff 改动 < 此值 → 本回合免复审（0=关闭）', min: 0 },
    { key: 'milestoneAtFiles', label: '里程碑 · 漂移文件数', hint: '会话累计新文件 ≥ 此值 → 全面复审', min: 1 },
    { key: 'maxChain', label: '连续拦截止损', hint: '连续拦截 N 轮未复审 → 放行止损', min: 1 },
    { key: 'noNewReviewsBeforeDemotion', label: '疲劳降档阈值', hint: '连续 N 次全面复审零发现 → 里程碑不再升格', min: 0 },
];
/** The two glob lists + the advanced drawer's writeTools. */
const GLOB_FIELDS = [
    { key: 'ignoreGlobs', label: '豁免清单', hint: '命中即不触发复审 · 支持 * 与 **/，不支持 ?' },
    { key: 'alwaysFullGlobs', label: '强制全面清单', hint: '命中即全面复审 · 支持 * 与 **/，不支持 ?' },
];
const DANGER = 'var(--dsw-alias-state-danger, #d5494a)';
/**
 * Dashboard row: session counters (against their configured limits) + today's
 * receipt totals. Session row hides when the gate has no state for this
 * conversation yet.
 */
function GateDashboard(props) {
    const maxChain = typeof props.cfg.maxChain === 'number' ? props.cfg.maxChain : 2;
    const milestone = typeof props.cfg.milestoneAtFiles === 'number' ? props.cfg.milestoneAtFiles : 10;
    const s = props.stateRow;
    const today = props.receipts?.today;
    return ((0, jsx_runtime_1.jsxs)("div", { "data-review-gate": "dashboard", style: {
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
            padding: '6px 10px',
            marginBottom: 10,
            fontSize: 11,
            lineHeight: 1.7,
            opacity: 0.9,
        }, children: [s ? ((0, jsx_runtime_1.jsxs)("div", { children: ["\u672C\u4F1A\u8BDD\uFF1A", s.pending
                        ? `待复审 ${s.pending.action}·${s.pending.files}文件 · `
                        : '', "\u94FE ", s.chain, "/", maxChain, " \u00B7 \u6F02\u79FB ", s.sessionFiles, "/", milestone, " \u00B7 \u75B2\u52B3 ", s.noNewReviews] })) : ((0, jsx_runtime_1.jsx)("div", { style: { opacity: 0.6 }, children: "\u672C\u4F1A\u8BDD\uFF1A\u5C1A\u65E0\u5199\u5165\u8BB0\u5F55" })), today ? ((0, jsx_runtime_1.jsxs)("div", { children: ["\u4ECA\u65E5\uFF1A\u590D\u5BA1 ", today.reviews, " \u00B7 \u6B62\u635F ", today.stopLoss] })) : null] }));
}
/**
 * Thresholds + glob lists + advanced drawer. `cfg` is the effective config of
 * the active scope; POST success refreshes it via the parent (config echo),
 * which also resets the drafts.
 */
function GateForm(props) {
    const [drafts, setDrafts] = (0, react_1.useState)({});
    const [fieldErr, setFieldErr] = (0, react_1.useState)({});
    const [globInput, setGlobInput] = (0, react_1.useState)({});
    // Config echo (POST response / scope switch / refresh) resets the drafts.
    (0, react_1.useEffect)(() => {
        const next = {};
        for (const f of NUM_FIELDS)
            next[f.key] = String(props.cfg[f.key] ?? '');
        setDrafts(next);
        setFieldErr({});
        setGlobInput({});
    }, [props.cfg]);
    const commitNumber = async (key, min) => {
        const raw = (drafts[key] ?? '').trim();
        setFieldErr((e) => ({ ...e, [key]: '' }));
        if (raw === String(props.cfg[key] ?? ''))
            return; // untouched
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n) || n < min || !Number.isInteger(n)) {
            setFieldErr((e) => ({ ...e, [key]: `需 ≥ ${min} 的整数` }));
            return;
        }
        const ok = await props.onPatch({ [key]: n });
        if (!ok)
            setDrafts((d) => ({ ...d, [key]: String(props.cfg[key] ?? '') }));
    };
    const addGlob = async (key) => {
        const v = (globInput[key] ?? '').trim();
        if (!v)
            return;
        if (v.includes('?')) {
            setFieldErr((e) => ({ ...e, [key]: '不支持 ? —— 请用 * 或 **/' }));
            return;
        }
        const list = Array.isArray(props.cfg[key]) ? props.cfg[key] : [];
        if (list.includes(v)) {
            setFieldErr((e) => ({ ...e, [key]: '已在清单中' }));
            return;
        }
        setFieldErr((e) => ({ ...e, [key]: '' }));
        setGlobInput((g) => ({ ...g, [key]: '' }));
        await props.onPatch({ [key]: [...list, v] });
    };
    const removeGlob = async (key, v) => {
        const list = Array.isArray(props.cfg[key]) ? props.cfg[key] : [];
        await props.onPatch({ [key]: list.filter((x) => x !== v) });
    };
    const numRow = (f) => ((0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [(0, jsx_runtime_1.jsx)("div", { style: LABEL, children: f.label }), (0, jsx_runtime_1.jsx)("div", { style: HINT, children: f.hint }), fieldErr[f.key] ? (0, jsx_runtime_1.jsx)("div", { style: { fontSize: 10, color: DANGER, marginTop: 1 }, children: fieldErr[f.key] }) : null] }), (0, jsx_runtime_1.jsx)("input", { type: "text", inputMode: "numeric", value: drafts[f.key] ?? '', onChange: (e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value })), onBlur: () => { void commitNumber(f.key, f.min); }, onKeyDown: (e) => { if (e.key === 'Enter')
                    e.currentTarget.blur(); }, style: { ...INPUT, borderColor: fieldErr[f.key] ? DANGER : INPUT_BORDER } })] }, f.key));
    const globRow = (f) => {
        const list = Array.isArray(props.cfg[f.key]) ? props.cfg[f.key] : [];
        return ((0, jsx_runtime_1.jsxs)("div", { style: { marginBottom: 9 }, children: [(0, jsx_runtime_1.jsx)("div", { style: LABEL, children: f.label }), (0, jsx_runtime_1.jsx)("div", { style: HINT, children: f.hint }), fieldErr[f.key] ? (0, jsx_runtime_1.jsx)("div", { style: { fontSize: 10, color: DANGER, marginTop: 1 }, children: fieldErr[f.key] }) : null, list.length > 0 && ((0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }, children: list.map((g) => ((0, jsx_runtime_1.jsxs)("span", { style: {
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            borderRadius: 7, padding: '3px 4px 3px 8px', fontSize: 11,
                            background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
                        }, children: [g, (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": `移除 ${g}`, "data-review-gate": "icon-btn", onClick: () => { void removeGlob(f.key, g); }, style: { border: 'none', background: 'transparent', color: 'inherit', opacity: 0.55, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 2 }, children: "\u00D7" })] }, g))) })), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 6, marginTop: 5 }, children: [(0, jsx_runtime_1.jsx)("input", { type: "text", value: globInput[f.key] ?? '', placeholder: "**/*.md", onChange: (e) => setGlobInput((g) => ({ ...g, [f.key]: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter') {
                                e.preventDefault();
                                void addGlob(f.key);
                            } }, style: { ...INPUT, flex: 1, width: 'auto' } }), (0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "mode-btn", onClick: () => { void addGlob(f.key); }, style: {
                                minHeight: 30, padding: '0 12px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
                                background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))', color: 'inherit',
                            }, children: "\u6DFB\u52A0" })] })] }, f.key));
    };
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [NUM_FIELDS.map(numRow), (0, jsx_runtime_1.jsxs)("details", { style: { marginBottom: 9 }, children: [(0, jsx_runtime_1.jsx)("summary", { style: { ...LABEL, cursor: 'pointer', listStyle: 'none' }, children: "\u9AD8\u7EA7 \u00B7 \u5199\u5165\u5DE5\u5177\u6E05\u5355" }), (0, jsx_runtime_1.jsx)("div", { style: HINT, children: "\u54EA\u4E9B\u5DE5\u5177\u540D\u7B97\u5199\u5165\uFF08bash \u523B\u610F\u4E0D\u5728\u5185\uFF0C\u8D70\u547D\u4EE4\u6A21\u5F0F\u542F\u53D1\u5F0F\uFF09" }), (0, jsx_runtime_1.jsx)("div", { style: { marginTop: 5 }, children: (() => {
                            const list = Array.isArray(props.cfg.writeTools) ? props.cfg.writeTools : [];
                            return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 4 }, children: list.map((g) => ((0, jsx_runtime_1.jsxs)("span", { style: {
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                borderRadius: 7, padding: '3px 4px 3px 8px', fontSize: 11,
                                                background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
                                            }, children: [g, (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": `移除 ${g}`, "data-review-gate": "icon-btn", onClick: () => { void removeGlob('writeTools', g); }, style: { border: 'none', background: 'transparent', color: 'inherit', opacity: 0.55, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 2 }, children: "\u00D7" })] }, g))) }), (0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', gap: 6, marginTop: 5 }, children: [(0, jsx_runtime_1.jsx)("input", { type: "text", value: globInput.writeTools ?? '', placeholder: "multiedit", onChange: (e) => setGlobInput((g) => ({ ...g, writeTools: e.target.value })), onKeyDown: (e) => { if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    void addGlob('writeTools');
                                                } }, style: { ...INPUT, flex: 1, width: 'auto' } }), (0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "mode-btn", onClick: () => { void addGlob('writeTools'); }, style: {
                                                    minHeight: 30, padding: '0 12px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
                                                    background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))', color: 'inherit',
                                                }, children: "\u6DFB\u52A0" })] })] }));
                        })() })] }), GLOB_FIELDS.map(globRow)] }));
}
};
__modules["review-gate-chip.js"] = function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewGateChip = ReviewGateChip;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * The composer intensity chip: shows the session's live review mode, opens a
 * popup to switch it.
 *
 * 2026-09-30 redesign (user verdict on v1: "忒丑了"): the panel now speaks the
 * host's design language — `--dsw-*` alias tokens (light/dark theme aware,
 * same fills the host's own menus use), glass backdrop blur, a segmented
 * control instead of four bare boxes, and a compact scope toggle (本会话 vs
 * 全局默认). Writes go to the plugin's HTTP config API on the same origin:
 * session scope carries the slot's `sessionId` so two conversations never
 * bleed into each other (in-memory on the host, by design — agent ids do not
 * survive a boot); global scope persists to the overlay file.
 *
 * No portal: a `position: fixed` child escapes the composer layout without
 * leaving the host React tree. One plugin-owned <style> tag carries the
 * keyframes + hover rules (deduped by id, mirroring the official CSS injector
 * pattern — the hand-rolled build has no CSS pipeline).
 *
 * 2026-09-30 second pass (user: a text label hogs the composer row): the chip
 * shows one of four state glyphs instead of words — a shield (the gate) whose
 * mark identifies the state: slash = off, dot = micro, bolt = auto, check on
 * a filled shield = full. The full glyph's check is stroked in the host
 * surface color so it stays visible on both themes. Unknown state (loading /
 * API error) falls back to a plain shield; the popup keeps the words.
 */
const react_1 = require("react");
const review_gate_form_tsx_1 = require("./review-gate-form.js");
const MODES = ['off', 'micro', 'auto', 'full'];
const MODE_LABEL = { off: '关闭', micro: '快扫', auto: '自动', full: '全面' };
const API = '/plugin/review-gate/config';
const RESET = '/plugin/review-gate/config/reset';
/** Narrow an unknown value to a Mode, or null. */
const asMode = (v) => typeof v === 'string' && MODES.includes(v) ? v : null;
/** Shield silhouette shared by every glyph. */
const SHIELD = 'M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z';
/**
 * The four state glyphs, one per review mode. 24×24 viewBox, currentColor
 * stroke/fill throughout (theme tokens apply); rendered at 18px in the chip.
 */
function ModeIcon({ mode }) {
    const svg = {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
    };
    if (mode === null) {
        // State not known yet (mount fetch pending, or API unreachable).
        return (0, jsx_runtime_1.jsx)("svg", { ...svg, children: (0, jsx_runtime_1.jsx)("path", { d: SHIELD }) });
    }
    if (mode === 'off') {
        return ((0, jsx_runtime_1.jsxs)("svg", { ...svg, children: [(0, jsx_runtime_1.jsx)("path", { d: SHIELD }), (0, jsx_runtime_1.jsx)("path", { d: "M5.5 4.5l13 15" })] }));
    }
    if (mode === 'micro') {
        return ((0, jsx_runtime_1.jsxs)("svg", { ...svg, children: [(0, jsx_runtime_1.jsx)("path", { d: SHIELD }), (0, jsx_runtime_1.jsx)("circle", { cx: 12, cy: 12.7, r: 2.2, fill: "currentColor", stroke: "none" })] }));
    }
    if (mode === 'auto') {
        return ((0, jsx_runtime_1.jsxs)("svg", { ...svg, children: [(0, jsx_runtime_1.jsx)("path", { d: SHIELD }), (0, jsx_runtime_1.jsx)("path", { d: "M13.6 7.5L9.9 13h2.6l-1.3 4.6L15 11.9h-2.6l1.2-4.4z", fill: "currentColor", stroke: "none" })] }));
    }
    // full: solid shield + check stroked in the surface color (visible on both
    // themes — the fill is the label color, the check is the background).
    return ((0, jsx_runtime_1.jsxs)("svg", { ...svg, children: [(0, jsx_runtime_1.jsx)("path", { d: SHIELD, fill: "currentColor", stroke: "none" }), (0, jsx_runtime_1.jsx)("path", { d: "M8.6 12.2l2.4 2.4 4.4-4.8", strokeWidth: 2.2, style: { stroke: 'var(--dsw-menu-surface-fill, #fff)' } })] }));
}
/** Keyframes + hover rules; injected once per page (id-deduped). */
const PANEL_CSS = `
@keyframes rgc-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rgc-pop { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
[data-review-gate="chip"]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)) !important; }
[data-review-gate="mode-btn"]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)) !important; }
[data-review-gate="scope-btn"]:hover:not([data-active="1"]) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)) !important; }
[data-review-gate="ghost"]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)) !important; }
[data-review-gate="icon-btn"]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)) !important; }
`;
/** Chip + popup. All writes POST to the HTTP API; session scope carries the id. */
function ReviewGateChip(props) {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined;
    const [mode, setMode] = (0, react_1.useState)(null);
    const [scope, setScope] = (0, react_1.useState)('session');
    const [open, setOpen] = (0, react_1.useState)(false);
    const [status, setStatus] = (0, react_1.useState)('');
    // M2 form + dashboard state: effective config of the active scope, this
    // session's live counters, and today's receipt totals.
    const [cfg, setCfg] = (0, react_1.useState)(null);
    const [stateRow, setStateRow] = (0, react_1.useState)(null);
    const [today, setToday] = (0, react_1.useState)(null);
    /** Pull the active scope's config/counters from the API. */
    const refresh = async (forScope) => {
        try {
            const qs = forScope === 'session' && sessionId !== undefined
                ? `?sessionId=${encodeURIComponent(sessionId)}`
                : '';
            const res = await fetch(API + qs, { cache: 'no-store' });
            if (!res.ok)
                return;
            const body = (await res.json());
            const global = asMode(body.config?.mode);
            const own = sessionId !== undefined ? asMode(body.sessions?.[sessionId]) : null;
            setMode(forScope === 'session' ? (own ?? global) : global);
            // Session view shows that session's effective full config; global view
            // the global one. The form's drafts reset whenever this object changes.
            setCfg((forScope === 'session' ? body.effective : body.config) ?? body.config ?? null);
            setStateRow(forScope === 'session' && sessionId !== undefined
                ? (body.states?.[sessionId] ?? null)
                : null);
            setToday(body.receipts ?? null);
        }
        catch {
            /* keep the previous label; the chip degrades, never throws */
        }
    };
    (0, react_1.useEffect)(() => {
        // One style tag per page; skip if a previous seat already injected it.
        if (typeof document !== 'undefined' && document.getElementById('review-gate-panel-css') === null) {
            const tag = document.createElement('style');
            tag.id = 'review-gate-panel-css';
            tag.textContent = PANEL_CSS;
            document.head.appendChild(tag);
        }
        void refresh('session');
        // Mount-only: the label refreshes on demand (open/scope switch).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    /** One field, one POST; the echoed config refreshes the form + chip. */
    const applyPatch = async (patch) => {
        setStatus('…');
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(scope === 'session' ? { ...patch, scope, sessionId } : { ...patch }),
            });
            if (!res.ok) {
                setStatus(`调整失败（HTTP ${String(res.status)}）`);
                return false;
            }
            const body = (await res.json());
            if (body.config) {
                setCfg(body.config);
                const m = asMode(body.config.mode);
                if (m)
                    setMode(m);
            }
            const label = typeof patch.mode === 'string' ? MODE_LABEL[patch.mode] : undefined;
            setStatus((scope === 'session' ? '已生效（本会话）' : '已生效（全局默认）') + (label ? `：${label}` : ''));
            return true;
        }
        catch {
            setStatus('调整失败（网络异常）');
            return false;
        }
    };
    const applyMode = (next) => applyPatch({ mode: next });
    const resetAll = async () => {
        setStatus('…');
        try {
            const res = await fetch(RESET, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(scope === 'session' ? { scope, sessionId } : {}),
            });
            if (!res.ok) {
                setStatus(`恢复失败（HTTP ${String(res.status)}）`);
                return;
            }
            setStatus(scope === 'session' ? '已恢复全局默认（本会话）' : '已恢复启动时配置（全局）');
            void refresh(scope);
        }
        catch {
            setStatus('恢复失败（网络异常）');
        }
    };
    const chipTitle = mode === null ? '审查闸门力度（点击调整）' : `审查闸门力度：${MODE_LABEL[mode]}（点击调整）`;
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "chip", title: chipTitle, "aria-label": chipTitle, onClick: () => { setOpen((v) => !v); setStatus(''); void refresh(scope); }, style: {
                    border: 'none',
                    borderRadius: 8,
                    // Fixed square footprint: the composer seat stretched the auto-width
                    // button into a wide rectangle around the 18px glyph (2026-09-30
                    // user report) — pin the box and opt out of flex growth.
                    width: 28,
                    height: 28,
                    padding: 0,
                    flex: '0 0 auto',
                    alignSelf: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-secondary, currentColor)',
                    cursor: 'pointer',
                    opacity: mode === 'off' ? 0.5 : 1,
                }, children: (0, jsx_runtime_1.jsx)(ModeIcon, { mode: mode }) }), open && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { "data-review-gate": "backdrop", onClick: () => { setOpen(false); setStatus(''); }, style: {
                            position: 'fixed', inset: 0, zIndex: 9990,
                            background: 'rgba(0,0,0,0.28)',
                            animation: 'rgc-fade 140ms ease-out',
                        } }), (0, jsx_runtime_1.jsxs)("div", { "data-review-gate": "panel", role: "dialog", "aria-label": "\u5BA1\u67E5\u95F8\u95E8\u8C03\u53C2", style: {
                            position: 'fixed',
                            left: 12,
                            right: 12,
                            maxWidth: 440,
                            margin: '0 auto',
                            bottom: 84,
                            zIndex: 9991,
                            maxHeight: '72vh',
                            overflowY: 'auto',
                            borderRadius: 16,
                            border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
                            background: 'var(--dsw-menu-surface-fill, rgba(250,250,252,0.92))',
                            backdropFilter: 'blur(28px) saturate(1.5)',
                            WebkitBackdropFilter: 'blur(28px) saturate(1.5)',
                            color: 'var(--dsw-alias-label-primary, #1f2329)',
                            padding: '12px 14px 12px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.16), 0 2px 10px rgba(0,0,0,0.08)',
                            fontFamily: 'inherit',
                            animation: 'rgc-pop 170ms cubic-bezier(0.2, 0.9, 0.3, 1)',
                        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6" }), (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": "\u5173\u95ED", "data-review-gate": "icon-btn", onClick: () => { setOpen(false); setStatus(''); }, style: {
                                            border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #888)',
                                            fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 6, borderRadius: 8,
                                        }, children: "\u00D7" })] }), (0, jsx_runtime_1.jsx)("div", { style: {
                                    display: 'flex', gap: 3, padding: 3, borderRadius: 10,
                                    background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))',
                                    marginBottom: 8,
                                }, children: ['session', 'global'].map((s) => {
                                    const active = s === scope;
                                    return ((0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "scope-btn", "data-active": active ? '1' : '0', onClick: () => { setScope(s); setStatus(''); void refresh(s); }, style: {
                                            flex: 1, minHeight: 28, borderRadius: 8, border: 'none', fontSize: 12,
                                            cursor: 'pointer', fontWeight: active ? 600 : 400,
                                            background: active ? 'var(--dsw-menu-surface-fill, #fff)' : 'transparent',
                                            color: active
                                                ? 'var(--dsw-alias-label-primary, #1f2329)'
                                                : 'var(--dsw-alias-label-secondary, #5a6070)',
                                            boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'background 120ms ease',
                                        }, children: s === 'session' ? '本会话' : '全局默认' }, s));
                                }) }), (0, jsx_runtime_1.jsx)(review_gate_form_tsx_1.GateDashboard, { stateRow: stateRow, receipts: today, cfg: cfg ?? {} }), (0, jsx_runtime_1.jsx)("div", { style: {
                                    display: 'flex', gap: 3, padding: 3, borderRadius: 12,
                                    background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))',
                                }, children: MODES.map((m) => {
                                    const active = m === mode;
                                    return ((0, jsx_runtime_1.jsxs)("button", { type: "button", "data-review-gate": "mode-btn", disabled: active, onClick: () => { void applyMode(m); }, style: {
                                            flex: 1,
                                            minHeight: 46,
                                            borderRadius: 9,
                                            border: 'none',
                                            background: active ? 'var(--dsw-menu-surface-fill, #fff)' : 'transparent',
                                            color: active
                                                ? 'var(--dsw-alias-label-primary, #1f2329)'
                                                : 'var(--dsw-alias-label-secondary, #5a6070)',
                                            fontSize: 13,
                                            fontWeight: active ? 600 : 400,
                                            cursor: active ? 'default' : 'pointer',
                                            boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'background 120ms ease',
                                            opacity: m === 'off' && !active ? 0.7 : 1,
                                        }, children: [MODE_LABEL[m], (0, jsx_runtime_1.jsx)("div", { style: { fontSize: 10, opacity: 0.6, marginTop: 1 }, children: m })] }, m));
                                }) }), cfg !== null && ((0, jsx_runtime_1.jsx)("div", { style: { marginTop: 12 }, children: (0, jsx_runtime_1.jsx)(review_gate_form_tsx_1.GateForm, { cfg: cfg, onPatch: applyPatch }) })), (0, jsx_runtime_1.jsx)("div", { "data-review-gate": "status", style: {
                                    marginTop: 8,
                                    minHeight: 16,
                                    fontSize: 12,
                                    color: status.startsWith('调整失败') || status.startsWith('恢复失败')
                                        ? 'var(--dsw-alias-state-danger, #d5494a)'
                                        : 'var(--dsw-alias-state-success-primary, #3d9a50)',
                                }, children: status }), (0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "ghost", onClick: () => { void resetAll(); }, style: {
                                    marginTop: 4,
                                    minHeight: 36,
                                    width: '100%',
                                    borderRadius: 10,
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--dsw-alias-label-secondary, #5a6070)',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                }, children: scope === 'session' ? '恢复全局默认（本会话）' : '恢复启动时配置（全局）' })] })] }))] }));
}
};
__modules["index.js"] = function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.apply = apply;
const review_gate_chip_tsx_1 = require("./review-gate-chip.js");
/** Services the client half needs from the browser module table. */
exports.inject = ['slots'];
/**
 * Mount the intensity chip into the composer tool row.
 * @param ctx - client root context.
 */
function apply(ctx) {
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'review-gate-intensity-chip',
        order: 20,
        inject: () => ({}),
    }, review_gate_chip_tsx_1.ReviewGateChip));
}
};
var __cache = {};
function __localRequire(id) {
  if (id.charCodeAt(0) !== 46) return require(id);
  id = id.slice(2);
  var cached = __cache[id];
  if (cached !== undefined) return cached.exports;
  var module = { exports: {} };
  __cache[id] = module;
  __modules[id](__localRequire, module, module.exports);
  return module.exports;
}
var module = { exports: {} };
__modules["index.js"](__localRequire, module, module.exports);
return module.exports;
} });