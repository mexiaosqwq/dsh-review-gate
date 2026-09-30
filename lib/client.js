window.__ModuleLoader__.load({ id: "dsh-review-gate", factory: (require) => {
var __modules = {};
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
const MODES = ['off', 'micro', 'auto', 'full'];
const MODE_LABEL = { off: '关闭', micro: '快扫', auto: '自动', full: '全面' };
const API = '/plugin/review-gate/config';
const RESET = '/plugin/review-gate/config/reset';
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
    /** Pull the effective mode for the current scope from the API. */
    const refresh = async (forScope) => {
        try {
            const res = await fetch(API, { cache: 'no-store' });
            if (!res.ok)
                return;
            const body = (await res.json());
            const asMode = (v) => typeof v === 'string' && MODES.includes(v) ? v : null;
            const global = asMode(body.config?.mode);
            const own = sessionId !== undefined ? asMode(body.sessions?.[sessionId]) : null;
            setMode(forScope === 'session' ? (own ?? global) : global);
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
    const applyMode = async (next) => {
        setStatus('…');
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(scope === 'session' ? { mode: next, scope, sessionId } : { mode: next }),
            });
            if (!res.ok) {
                setStatus(`调整失败（HTTP ${String(res.status)}）`);
                return;
            }
            setMode(next);
            setStatus(scope === 'session' ? `已生效（本会话）：${MODE_LABEL[next]}` : `已生效（全局默认）：${MODE_LABEL[next]}`);
        }
        catch {
            setStatus('调整失败（网络异常）');
        }
    };
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
                    padding: '4px 8px',
                    minHeight: 28,
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
                        } }), (0, jsx_runtime_1.jsxs)("div", { "data-review-gate": "panel", role: "dialog", "aria-label": "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6", style: {
                            position: 'fixed',
                            left: 12,
                            right: 12,
                            maxWidth: 440,
                            margin: '0 auto',
                            bottom: 84,
                            zIndex: 9991,
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
                                }) }), (0, jsx_runtime_1.jsx)("div", { style: {
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
                                }) }), (0, jsx_runtime_1.jsx)("div", { "data-review-gate": "status", style: {
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