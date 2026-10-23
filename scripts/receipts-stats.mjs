#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEVERITIES = ['critical', 'major', 'minor', 'info']
// §11.5 rider: historical receipts drifted off this vocabulary (37 rows used
// high/medium/low, 9 carried no severity at all). Those must stay visible in
// the audit summary instead of vanishing from the buckets, so every finding
// that is not one of the four values lands in `other`.
const BUCKETS = [...SEVERITIES, 'other']

const avg = (xs) =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
const rate = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 1000)

export function summarize(rows, now = Date.now()) {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const todayStart = midnight.getTime()
  // Half-open window: without the upper bound a row stamped in the future
  // (clock skew, hand-edited log, a stale now argument) would be counted as
  // "today" forever.
  const todayEnd = todayStart + 24 * 60 * 60 * 1000
  const today = {
    reviews: 0,
    full: 0,
    micro: 0,
    zeroFinding: 0,
    findings: 0,
    bySeverity: Object.fromEntries(BUCKETS.map((s) => [s, 0])),
    stopLoss: 0,
    waived: 0,
  }
  const diffLines = []
  const chains = []

  for (const row of rows) {
    if (!row || typeof row.ts !== 'number') continue
    if (row.ts < todayStart || row.ts >= todayEnd) continue
    if (row.outcome === 'stop_loss') {
      today.stopLoss += 1
      continue
    }
    if (row.outcome === 'waived') {
      today.waived += 1
      continue
    }
    if (row.action === undefined) continue

    today.reviews += 1
    if (row.action === 'full') today.full += 1
    if (row.action === 'micro') today.micro += 1
    // Historical rows (4 of them) wrote findings as a number, not an array:
    // count those as zero findings rather than crashing.
    const findings = Array.isArray(row.findings) ? row.findings : []
    today.findings += findings.length
    if (findings.length === 0) today.zeroFinding += 1
    for (const f of findings) {
      const severity = f && typeof f === 'object' ? f.severity : undefined
      if (SEVERITIES.includes(severity)) today.bySeverity[severity] += 1
      else today.bySeverity.other += 1
    }
    if (typeof row.cost?.diffLines === 'number') diffLines.push(row.cost.diffLines)
    if (typeof row.cost?.intercepts === 'number') chains.push(row.cost.intercepts)
  }

  return {
    total: rows.filter((r) => r && typeof r.ts === 'number').length,
    today: {
      ...today,
      fullRatio: rate(today.full, today.reviews),
      zeroFindingRate: rate(today.zeroFinding, today.reviews),
      waiverRate: rate(today.waived, today.reviews + today.waived),
      stopLossRate: rate(today.stopLoss, today.reviews + today.stopLoss),
      avgDiffLines: avg(diffLines),
      avgChain: avg(chains),
    },
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const file =
    process.argv[2] ?? join(homedir(), '.dsh', 'storages', 'review-gate', 'receipts.jsonl')
  const raw = await readFile(file, 'utf8').catch(() => '')
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
  console.log(JSON.stringify(summarize(rows), null, 2))
}
