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
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Props the slot renderer binds; M1 consumes none of the runtime hooks. */
export type ReviewGateChipProps = PropsRuntime<'conversation.input.left'>

type Mode = 'off' | 'micro' | 'auto' | 'full'

const MODES: readonly Mode[] = ['off', 'micro', 'auto', 'full']
const MODE_LABEL: Record<Mode, string> = { off: '关闭', micro: '快扫', auto: '自动', full: '全面' }
const API = '/plugin/review-gate/config'
const RESET = '/plugin/review-gate/config/reset'

/** Read the live mode from the config API; any failure degrades to null. */
async function readMode(): Promise<Mode | null> {
  try {
    const res = await fetch(API, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { config?: { mode?: unknown } }
    const mode = body.config?.mode
    return typeof mode === 'string' && (MODES as readonly string[]).includes(mode) ? (mode as Mode) : null
  } catch {
    return null
  }
}

/** Chip + popup. All writes POST to the M0 HTTP API and re-read the result. */
export function ReviewGateChip(_props: ReviewGateChipProps) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void readMode().then(setMode)
  }, [])

  const applyMode = async (next: Mode): Promise<void> => {
    setStatus('…')
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      if (!res.ok) {
        setStatus(`调整失败（HTTP ${String(res.status)}）`)
        return
      }
      setMode(next)
      setStatus(`已生效：${MODE_LABEL[next]}`)
    } catch {
      setStatus('调整失败（网络异常）')
    }
  }

  const resetAll = async (): Promise<void> => {
    setStatus('…')
    try {
      const res = await fetch(RESET, { method: 'POST' })
      if (!res.ok) {
        setStatus(`恢复失败（HTTP ${String(res.status)}）`)
        return
      }
      setMode(await readMode())
      setStatus('已恢复启动时配置')
    } catch {
      setStatus('恢复失败（网络异常）')
    }
  }

  const chipLabel = mode === null ? '审查' : `审查·${MODE_LABEL[mode]}`

  return (
    <>
      <button
        type="button"
        data-review-gate="chip"
        title="审查闸门力度（点击调整）"
        aria-label="审查闸门力度（点击调整）"
        onClick={() => { setOpen((v) => !v); setStatus('') }}
        style={{
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
        }}
      >
        {chipLabel}
      </button>
      {open && (
        <>
          {/* Outside tap closes the popup; the backdrop sits just under it. */}
          <div
            data-review-gate="backdrop"
            onClick={() => { setOpen(false); setStatus('') }}
            style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'transparent' }}
          />
          <div
            data-review-gate="panel"
            role="dialog"
            aria-label="审查闸门力度"
            style={{
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
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>审查闸门力度</span>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => { setOpen(false); setStatus('') }}
                style={{ border: 'none', background: 'transparent', color: '#aaa', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 4 }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {MODES.map((m) => {
                const active = m === mode
                return (
                  <button
                    key={m}
                    type="button"
                    data-review-gate={`mode-${m}`}
                    disabled={m === mode}
                    onClick={() => { void applyMode(m) }}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      borderRadius: 8,
                      border: active ? '1px solid rgba(120,160,255,0.9)' : '1px solid rgba(255,255,255,0.16)',
                      background: active ? 'rgba(90,130,255,0.28)' : 'rgba(255,255,255,0.06)',
                      color: '#e8e8ea',
                      fontSize: 13,
                      cursor: active ? 'default' : 'pointer',
                    }}
                  >
                    {MODE_LABEL[m]}
                    <div style={{ fontSize: 10, opacity: 0.65, marginTop: 1 }}>{m}</div>
                  </button>
                )
              })}
            </div>
            <div
              data-review-gate="status"
              style={{
                marginTop: 8,
                minHeight: 16,
                fontSize: 12,
                color: status.startsWith('调整失败') || status.startsWith('恢复失败') ? '#ff9a9a' : '#9fd6a0',
              }}
            >
              {status}
            </div>
            <button
              type="button"
              data-review-gate="reset"
              onClick={() => { void resetAll() }}
              style={{
                marginTop: 2,
                minHeight: 32,
                width: '100%',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.16)',
                background: 'rgba(255,255,255,0.06)',
                color: '#cfcfd4',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              恢复启动时配置
            </button>
          </div>
        </>
      )}
    </>
  )
}
