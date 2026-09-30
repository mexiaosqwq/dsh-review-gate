window.__ModuleLoader__.load({ id: "dsh-review-gate", factory: (require) => {
var __modules = {};
__modules["review-gate-chip.js"] = function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewGateChip = ReviewGateChip;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * The composer intensity chip: shows the live review mode, opens a popup to
 * switch it. Mobile-first (the author's panel lives on a phone): bottom-sheet
 * fixed panel, ≥32px tap targets, no portal — a `position: fixed` child
 * escapes the composer layout without leaving the host React tree.
 *
 * Theme note (M1 ceiling): the panel uses a neutral dark overlay that reads
 * well on both GUI themes; theme-token integration is deferred until a token
 * map is needed beyond this one surface (upgrade path: dsh-client-ui-theme).
 */
const react_1 = require("react");
const MODES = ['off', 'micro', 'auto', 'full'];
const MODE_LABEL = { off: '关闭', micro: '快扫', auto: '自动', full: '全面' };
const API = '/plugin/review-gate/config';
const RESET = '/plugin/review-gate/config/reset';
/** Read the live mode from the config API; any failure degrades to null. */
async function readMode() {
    try {
        const res = await fetch(API, { cache: 'no-store' });
        if (!res.ok)
            return null;
        const body = (await res.json());
        const mode = body.config?.mode;
        return typeof mode === 'string' && MODES.includes(mode) ? mode : null;
    }
    catch {
        return null;
    }
}
/** Chip + popup. All writes POST to the M0 HTTP API and re-read the result. */
function ReviewGateChip(_props) {
    const [mode, setMode] = (0, react_1.useState)(null);
    const [open, setOpen] = (0, react_1.useState)(false);
    const [status, setStatus] = (0, react_1.useState)('');
    (0, react_1.useEffect)(() => {
        void readMode().then(setMode);
    }, []);
    const applyMode = async (next) => {
        setStatus('…');
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: next }),
            });
            if (!res.ok) {
                setStatus(`调整失败（HTTP ${String(res.status)}）`);
                return;
            }
            setMode(next);
            setStatus(`已生效：${MODE_LABEL[next]}`);
        }
        catch {
            setStatus('调整失败（网络异常）');
        }
    };
    const resetAll = async () => {
        setStatus('…');
        try {
            const res = await fetch(RESET, { method: 'POST' });
            if (!res.ok) {
                setStatus(`恢复失败（HTTP ${String(res.status)}）`);
                return;
            }
            setMode(await readMode());
            setStatus('已恢复启动时配置');
        }
        catch {
            setStatus('恢复失败（网络异常）');
        }
    };
    const chipLabel = mode === null ? '审查' : `审查·${MODE_LABEL[mode]}`;
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "chip", title: "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6\uFF08\u70B9\u51FB\u8C03\u6574\uFF09", "aria-label": "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6\uFF08\u70B9\u51FB\u8C03\u6574\uFF09", onClick: () => { setOpen((v) => !v); setStatus(''); }, style: {
                    border: '1px solid rgba(128,128,128,0.45)',
                    borderRadius: 999,
                    padding: '2px 10px',
                    minHeight: 28,
                    fontSize: 12,
                    lineHeight: '20px',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: mode === 'off' ? 0.55 : 1,
                }, children: chipLabel }), open && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("div", { "data-review-gate": "backdrop", onClick: () => { setOpen(false); setStatus(''); }, style: { position: 'fixed', inset: 0, zIndex: 9990, background: 'transparent' } }), (0, jsx_runtime_1.jsxs)("div", { "data-review-gate": "panel", role: "dialog", "aria-label": "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6", style: {
                            position: 'fixed',
                            left: 12,
                            right: 12,
                            bottom: 76,
                            zIndex: 9991,
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.14)',
                            background: 'rgba(28,28,32,0.98)',
                            color: '#e8e8ea',
                            padding: '10px 12px 12px',
                            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
                            fontFamily: 'inherit',
                        }, children: [(0, jsx_runtime_1.jsxs)("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, children: [(0, jsx_runtime_1.jsx)("span", { style: { fontSize: 13, fontWeight: 600 }, children: "\u5BA1\u67E5\u95F8\u95E8\u529B\u5EA6" }), (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": "\u5173\u95ED", onClick: () => { setOpen(false); setStatus(''); }, style: { border: 'none', background: 'transparent', color: '#aaa', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 4 }, children: "\u00D7" })] }), (0, jsx_runtime_1.jsx)("div", { style: { display: 'flex', gap: 6 }, children: MODES.map((m) => {
                                    const active = m === mode;
                                    return ((0, jsx_runtime_1.jsxs)("button", { type: "button", "data-review-gate": `mode-${m}`, disabled: m === mode, onClick: () => { void applyMode(m); }, style: {
                                            flex: 1,
                                            minHeight: 36,
                                            borderRadius: 8,
                                            border: active ? '1px solid rgba(120,160,255,0.9)' : '1px solid rgba(255,255,255,0.16)',
                                            background: active ? 'rgba(90,130,255,0.28)' : 'rgba(255,255,255,0.06)',
                                            color: '#e8e8ea',
                                            fontSize: 13,
                                            cursor: active ? 'default' : 'pointer',
                                        }, children: [MODE_LABEL[m], (0, jsx_runtime_1.jsx)("div", { style: { fontSize: 10, opacity: 0.65, marginTop: 1 }, children: m })] }, m));
                                }) }), (0, jsx_runtime_1.jsx)("div", { "data-review-gate": "status", style: {
                                    marginTop: 8,
                                    minHeight: 16,
                                    fontSize: 12,
                                    color: status.startsWith('调整失败') || status.startsWith('恢复失败') ? '#ff9a9a' : '#9fd6a0',
                                }, children: status }), (0, jsx_runtime_1.jsx)("button", { type: "button", "data-review-gate": "reset", onClick: () => { void resetAll(); }, style: {
                                    marginTop: 2,
                                    minHeight: 32,
                                    width: '100%',
                                    borderRadius: 8,
                                    border: '1px solid rgba(255,255,255,0.16)',
                                    background: 'rgba(255,255,255,0.06)',
                                    color: '#cfcfd4',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                }, children: "\u6062\u590D\u542F\u52A8\u65F6\u914D\u7F6E" })] })] }))] }));
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
  __modules[id](require, module, module.exports);
  return module.exports;
}
return __localRequire("index.js");
} });