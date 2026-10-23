import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from '../scripts/receipts-stats.mjs'

test('receipts stats: today counts reviews, findings, severity, zero-finding', () => {
  const now = new Date(2026, 9, 22, 12, 0, 0).getTime()
  const today = new Date(2026, 9, 22, 8, 0, 0).getTime()
  const yesterday = new Date(2026, 9, 21, 8, 0, 0).getTime()
  const rows = [
    {
      ts: today,
      outcome: 'acknowledged',
      action: 'full',
      findings: [{ severity: 'major' }, { severity: 'minor' }],
      cost: { diffLines: 40, intercepts: 1 },
    },
    { ts: today, outcome: 'acknowledged', action: 'micro', findings: [], cost: { diffLines: 8, intercepts: 1 } },
    { ts: today, outcome: 'waived' },
    { ts: today, outcome: 'stop_loss' },
    { ts: yesterday, outcome: 'acknowledged', action: 'full', findings: [{ severity: 'critical' }] },
  ]
  const s = summarize(rows, now)
  assert.equal(s.total, 5)
  assert.equal(s.today.reviews, 2)
  assert.equal(s.today.full, 1)
  assert.equal(s.today.micro, 1)
  assert.equal(s.today.zeroFinding, 1)
  assert.equal(s.today.findings, 2)
  assert.equal(s.today.bySeverity.major, 1)
  assert.equal(s.today.bySeverity.minor, 1)
  assert.equal(s.today.bySeverity.critical, 0)
  assert.equal(s.today.waived, 1)
  assert.equal(s.today.stopLoss, 1)
  assert.equal(s.today.avgDiffLines, 24)
  assert.equal(s.today.avgChain, 1)

  // ---- day-window rider (2026-10-23 lead F1/F2): the window is half-open
  // [todayStart, todayEnd) — the exact midnight counts, yesterday's last
  // millisecond and tomorrow's midnight do not, and a non-numeric ts never
  // reaches total. Asserted on a second summarize() so the plan-given numbers
  // above stay untouched.
  const todayStart = new Date(2026, 9, 22, 0, 0, 0).getTime()
  const todayEnd = todayStart + 24 * 60 * 60 * 1000
  const edge = summarize(
    [
      { ts: todayStart, outcome: 'acknowledged', action: 'micro', findings: [] },
      { ts: todayStart - 1, outcome: 'acknowledged', action: 'full', findings: [{ severity: 'critical' }] },
      { ts: todayEnd, outcome: 'acknowledged', action: 'micro', findings: [] },
      { ts: 'nope', outcome: 'acknowledged', action: 'micro', findings: [] },
    ],
    now,
  )
  assert.equal(edge.total, 3, 'non-numeric ts is skipped from total')
  assert.equal(edge.today.reviews, 1, 'only [todayStart, todayEnd) rows count as reviews')
  assert.equal(edge.today.micro, 1, 'the exact-midnight row is inside the window')
  assert.equal(edge.today.full, 0, 'yesterday 23:59:59.999 is outside the window')
  assert.equal(edge.today.bySeverity.critical, 0, 'outside-window findings never enter bySeverity')
})

// ---- Batch 1 Task 3 rider (§11.5 #2): the other bucket keeps historical
// severity drift (37 rows high/medium/low + 9 missing, 2026-10-05 → 10-10)
// visible instead of silently dropping it. Non-array findings rows (4 in the
// real log) count as zero findings — never as a crash. ----

test('receipts stats: non-four-value and missing severities land in the other bucket', () => {
  const now = new Date(2026, 9, 22, 12, 0, 0).getTime()
  const today = new Date(2026, 9, 22, 8, 0, 0).getTime()
  const rows = [
    {
      ts: today,
      outcome: 'acknowledged',
      action: 'full',
      findings: [
        { severity: 'high' },
        { severity: 'medium' },
        { severity: 'low' },
        { note: 'severity missing' },
        { severity: 'major' },
      ],
    },
    { ts: today, outcome: 'acknowledged', action: 'micro', findings: 3 },
  ]
  const s = summarize(rows, now)
  assert.equal(s.today.reviews, 2)
  assert.equal(s.today.bySeverity.other, 4, 'high/medium/low/missing all counted as other')
  assert.equal(s.today.bySeverity.major, 1, 'the four-value vocabulary still buckets normally')
  assert.equal(s.today.findings, 5, 'non-array findings contribute zero findings')
  assert.equal(s.today.zeroFinding, 1, 'a non-array findings row counts as zero-finding')
  const bucketed = Object.values(s.today.bySeverity).reduce((a, b) => a + b, 0)
  assert.equal(bucketed, s.today.findings, 'no finding may be silently dropped from the buckets')
})
