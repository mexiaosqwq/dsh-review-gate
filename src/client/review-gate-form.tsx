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
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/** One session's live counters, as shipped by GET /plugin/review-gate/config. */
export interface GateStateSummary {
  chain: number
  sessionFiles: number
  noNewReviews: number
  openWrites: number
  bashWrites: boolean
  pending: { action: string; files: number } | null
}

/** Receipt audit-log tail stats (today-only counts + newest line). */
export interface ReceiptStats {
  today: { reviews: number; stopLoss: number }
  last: { ts: number; outcome?: string; action?: string } | null
}

const LABEL: CSSProperties = { fontSize: 12, fontWeight: 600 }
const HINT: CSSProperties = { fontSize: 10, opacity: 0.55, marginTop: 1 }
const INPUT: CSSProperties = {
  width: 72,
  minHeight: 30,
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))',
  background: 'var(--dsw-menu-surface-fill, #fff)',
  color: 'inherit',
  fontSize: 13,
  padding: '2px 8px',
}
const INPUT_BORDER = '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.25))'

/** The six numeric thresholds: key, label, hint, schema min (mirrors Config). */
const NUM_FIELDS = [
  { key: 'fullAtFiles', label: '升全面 · 文件数', hint: '回合内写入文件数 ≥ 此值 → 全面复审', min: 1 },
  { key: 'fullAtLines', label: '升全面 · diff 行数', hint: '快扫档 diff 行数 ≥ 此值 → 现场升格全面', min: 1 },
  { key: 'exemptBelowLines', label: '免审 · 单文件行数', hint: 'auto 档单文件 diff 改动 < 此值 → 本回合免复审（0=关闭）', min: 0 },
  { key: 'milestoneAtFiles', label: '里程碑 · 漂移文件数', hint: '会话累计新文件 ≥ 此值 → 全面复审', min: 1 },
  { key: 'maxChain', label: '连续拦截止损', hint: '连续拦截 N 轮未复审 → 放行止损', min: 1 },
  { key: 'noNewReviewsBeforeDemotion', label: '疲劳降档阈值', hint: '连续 N 次全面复审零发现 → 里程碑不再升格', min: 0 },
] as const

/** The two glob lists + the advanced drawer's writeTools. */
const GLOB_FIELDS = [
  { key: 'ignoreGlobs', label: '豁免清单', hint: '命中即不触发复审 · 支持 * 与 **/，不支持 ?' },
  { key: 'alwaysFullGlobs', label: '强制全面清单', hint: '命中即全面复审 · 支持 * 与 **/，不支持 ?' },
] as const

const DANGER = 'var(--dsw-alias-state-danger, #d5494a)'

/**
 * Dashboard row: session counters (against their configured limits) + today's
 * receipt totals. Session row hides when the gate has no state for this
 * conversation yet.
 */
export function GateDashboard(props: {
  stateRow: GateStateSummary | null
  receipts: ReceiptStats | null
  cfg: Record<string, unknown>
}): JSX.Element {
  const maxChain = typeof props.cfg.maxChain === 'number' ? props.cfg.maxChain : 2
  const milestone = typeof props.cfg.milestoneAtFiles === 'number' ? props.cfg.milestoneAtFiles : 10
  const s = props.stateRow
  const today = props.receipts?.today
  return (
    <div
      data-review-gate="dashboard"
      style={{
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.2))',
        padding: '6px 10px',
        marginBottom: 10,
        fontSize: 11,
        lineHeight: 1.7,
        opacity: 0.9,
      }}
    >
      {s ? (
        <div>
          本会话：
          {s.pending
            ? `待复审 ${s.pending.action}·${s.pending.files}文件 · `
            : ''}
          链 {s.chain}/{maxChain} · 漂移 {s.sessionFiles}/{milestone} · 疲劳 {s.noNewReviews}
        </div>
      ) : (
        <div style={{ opacity: 0.6 }}>本会话：尚无写入记录</div>
      )}
      {today ? (
        <div>今日：复审 {today.reviews} · 止损 {today.stopLoss}</div>
      ) : null}
    </div>
  )
}

/**
 * Thresholds + glob lists + advanced drawer. `cfg` is the effective config of
 * the active scope; POST success refreshes it via the parent (config echo),
 * which also resets the drafts.
 */
export function GateForm(props: {
  cfg: Record<string, unknown>
  onPatch: (patch: Record<string, unknown>) => Promise<boolean>
}): JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({})
  const [globInput, setGlobInput] = useState<Record<string, string>>({})

  // Config echo (POST response / scope switch / refresh) resets the drafts.
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const f of NUM_FIELDS) next[f.key] = String(props.cfg[f.key] ?? '')
    setDrafts(next)
    setFieldErr({})
    setGlobInput({})
  }, [props.cfg])

  const commitNumber = async (key: string, min: number): Promise<void> => {
    const raw = (drafts[key] ?? '').trim()
    setFieldErr((e) => ({ ...e, [key]: '' }))
    if (raw === String(props.cfg[key] ?? '')) return // untouched
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n) || n < min || !Number.isInteger(n)) {
      setFieldErr((e) => ({ ...e, [key]: `需 ≥ ${min} 的整数` }))
      return
    }
    const ok = await props.onPatch({ [key]: n })
    if (!ok) setDrafts((d) => ({ ...d, [key]: String(props.cfg[key] ?? '') }))
  }

  const addGlob = async (key: string): Promise<void> => {
    const v = (globInput[key] ?? '').trim()
    if (!v) return
    if (v.includes('?')) {
      setFieldErr((e) => ({ ...e, [key]: '不支持 ? —— 请用 * 或 **/' }))
      return
    }
    const list = Array.isArray(props.cfg[key]) ? (props.cfg[key] as string[]) : []
    if (list.includes(v)) {
      setFieldErr((e) => ({ ...e, [key]: '已在清单中' }))
      return
    }
    setFieldErr((e) => ({ ...e, [key]: '' }))
    setGlobInput((g) => ({ ...g, [key]: '' }))
    await props.onPatch({ [key]: [...list, v] })
  }

  const removeGlob = async (key: string, v: string): Promise<void> => {
    const list = Array.isArray(props.cfg[key]) ? (props.cfg[key] as string[]) : []
    await props.onPatch({ [key]: list.filter((x) => x !== v) })
  }

  const numRow = (f: (typeof NUM_FIELDS)[number]) => (
    <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={LABEL}>{f.label}</div>
        <div style={HINT}>{f.hint}</div>
        {fieldErr[f.key] ? <div style={{ fontSize: 10, color: DANGER, marginTop: 1 }}>{fieldErr[f.key]}</div> : null}
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={drafts[f.key] ?? ''}
        onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
        onBlur={() => { void commitNumber(f.key, f.min) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        style={{ ...INPUT, borderColor: fieldErr[f.key] ? DANGER : INPUT_BORDER }}
      />
    </div>
  )

  const globRow = (f: (typeof GLOB_FIELDS)[number]) => {
    const list = Array.isArray(props.cfg[f.key]) ? (props.cfg[f.key] as string[]) : []
    return (
      <div key={f.key} style={{ marginBottom: 9 }}>
        <div style={LABEL}>{f.label}</div>
        <div style={HINT}>{f.hint}</div>
        {fieldErr[f.key] ? <div style={{ fontSize: 10, color: DANGER, marginTop: 1 }}>{fieldErr[f.key]}</div> : null}
        {list.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {list.map((g) => (
              <span
                key={g}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  borderRadius: 7, padding: '3px 4px 3px 8px', fontSize: 11,
                  background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
                }}
              >
                {g}
                <button
                  type="button"
                  aria-label={`移除 ${g}`}
                  data-review-gate="icon-btn"
                  onClick={() => { void removeGlob(f.key, g) }}
                  style={{ border: 'none', background: 'transparent', color: 'inherit', opacity: 0.55, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 2 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
          <input
            type="text"
            value={globInput[f.key] ?? ''}
            placeholder="**/*.md"
            onChange={(e) => setGlobInput((g) => ({ ...g, [f.key]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addGlob(f.key) } }}
            style={{ ...INPUT, flex: 1, width: 'auto' }}
          />
          <button
            type="button"
            data-review-gate="mode-btn"
            onClick={() => { void addGlob(f.key) }}
            style={{
              minHeight: 30, padding: '0 12px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
              background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))', color: 'inherit',
            }}
          >
            添加
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {NUM_FIELDS.map(numRow)}

      {/* Advanced drawer: tool-naming semantics, not a per-conversation knob —
          native <details> keeps it collapsed and zero-JS. */}
      <details style={{ marginBottom: 9 }}>
        <summary style={{ ...LABEL, cursor: 'pointer', listStyle: 'none' }}>高级 · 写入工具清单</summary>
        <div style={HINT}>哪些工具名算写入（bash 刻意不在内，走命令模式启发式）</div>
        <div style={{ marginTop: 5 }}>
          {(() => {
            const list = Array.isArray(props.cfg.writeTools) ? (props.cfg.writeTools as string[]) : []
            return (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {list.map((g) => (
                        <span
                          key={g}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            borderRadius: 7, padding: '3px 4px 3px 8px', fontSize: 11,
                            background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))',
                          }}
                        >
                          {g}
                          <button
                            type="button"
                            aria-label={`移除 ${g}`}
                            data-review-gate="icon-btn"
                            onClick={() => { void removeGlob('writeTools', g) }}
                            style={{ border: 'none', background: 'transparent', color: 'inherit', opacity: 0.55, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 2 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                      <input
                        type="text"
                        value={globInput.writeTools ?? ''}
                        placeholder="multiedit"
                        onChange={(e) => setGlobInput((g) => ({ ...g, writeTools: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addGlob('writeTools') } }}
                        style={{ ...INPUT, flex: 1, width: 'auto' }}
                      />
                      <button
                        type="button"
                        data-review-gate="mode-btn"
                        onClick={() => { void addGlob('writeTools') }}
                        style={{
                          minHeight: 30, padding: '0 12px', borderRadius: 8, border: 'none', fontSize: 12, cursor: 'pointer',
                          background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))', color: 'inherit',
                        }}
                      >
                        添加
                      </button>
                    </div>
                  </>
                )
              })()}
        </div>
      </details>

      {GLOB_FIELDS.map(globRow)}
    </>
  )
}
