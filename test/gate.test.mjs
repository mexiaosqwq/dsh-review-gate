import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideReview,
  trackWrite,
  buildReviewMessage,
  createState,
  handleTurnStopping,
} from '../lib/index.js'

const baseConfig = {
  mode: 'auto',
  fullAtFiles: 3,
  fullAtLines: 150,
  milestoneAtFiles: 10,
  maxChain: 2,
  writeTools: ['write', 'edit'],
  ignoreGlobs: [],
  alwaysFullGlobs: [],
  // Test receipts must never land in the production audit log — appendReceipt
  // self-creates the dir, so a deterministic per-run tmp path is enough.
  receiptDir: join(_tmpdir(), 'rg-gate-test-' + process.pid),
}

test('decideReview: no writes -> skip', () => {
  assert.equal(decideReview({ writeFiles: 0, chain: 0, config: baseConfig }), 'skip')
})

test('decideReview: mode off -> skip even with writes', () => {
  assert.equal(
    decideReview({ writeFiles: 5, chain: 0, config: { ...baseConfig, mode: 'off' } }),
    'skip',
  )
})

test('decideReview: auto + small change -> micro', () => {
  assert.equal(decideReview({ writeFiles: 2, chain: 0, config: baseConfig }), 'micro')
})

test('decideReview: auto + files at threshold -> full', () => {
  assert.equal(decideReview({ writeFiles: 3, chain: 0, config: baseConfig }), 'full')
})

test('decideReview: fixed micro mode -> micro', () => {
  assert.equal(
    decideReview({ writeFiles: 9, chain: 0, config: { ...baseConfig, mode: 'micro' } }),
    'micro',
  )
})

test('decideReview: fixed full mode -> full', () => {
  assert.equal(
    decideReview({ writeFiles: 1, chain: 0, config: { ...baseConfig, mode: 'full' } }),
    'full',
  )
})

test('decideReview: chain at max -> skip (loop guard)', () => {
  assert.equal(decideReview({ writeFiles: 2, chain: 2, config: baseConfig }), 'skip')
})

test('decideReview: chain below max still grades', () => {
  assert.equal(decideReview({ writeFiles: 2, chain: 1, config: baseConfig }), 'micro')
})

test('trackWrite: write/edit count, bash does not', () => {
  const files = new Set()
  trackWrite(files, 'write', { file_path: '/a.ts' }, baseConfig)
  trackWrite(files, 'edit', { file_path: '/b.ts' }, baseConfig)
  trackWrite(files, 'bash', { command: 'echo hi > /c.ts' }, baseConfig)
  assert.equal(files.size, 2)
})

test('trackWrite: same file deduplicated', () => {
  const files = new Set()
  trackWrite(files, 'write', { file_path: '/a.ts' }, baseConfig)
  trackWrite(files, 'edit', { file_path: '/a.ts' }, baseConfig)
  assert.equal(files.size, 1)
})

test('trackWrite: custom writeTools respected', () => {
  const files = new Set()
  const cfg = { ...baseConfig, writeTools: ['apply_patch'] }
  trackWrite(files, 'apply_patch', { file_path: '/a.ts' }, cfg)
  assert.equal(files.size, 1)
  trackWrite(files, 'write', { file_path: '/b.ts' }, cfg)
  assert.equal(files.size, 1, 'write not in custom list -> ignored')
})

test('trackWrite: non-string or missing file_path ignored', () => {
  const files = new Set()
  trackWrite(files, 'write', {}, baseConfig)
  trackWrite(files, 'write', { file_path: 42 }, baseConfig)
  trackWrite(files, 'write', undefined, baseConfig)
  assert.equal(files.size, 0)
})

test('buildReviewMessage: micro carries gate tag, level word, file count, blocks + source', () => {
  const msg = buildReviewMessage('micro', 2)
  const text = msg.content.map((b) => b.text ?? '').join('')
  assert.ok(text.includes('[review-gate]'), 'has gate tag')
  assert.ok(text.includes('快扫'), 'names the light scan')
  assert.ok(text.includes('2'), 'mentions file count')
  assert.equal(msg.role, 'user')
  assert.ok(msg.source, 'has source')
})

test('buildReviewMessage: full carries all five review steps', () => {
  const msg = buildReviewMessage('full', 5)
  const text = msg.content.map((b) => b.text ?? '').join('')
  for (const keyword of ['diff 全读', '爆炸半径', '测试批判', '回归面', '规格对照']) {
    assert.ok(text.includes(keyword), `mentions step: ${keyword}`)
  }
})

test('handleTurnStopping: writes -> steers graded review, counts chain, clears files', () => {
  const state = createState()
  trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig)
  trackWrite(state.files, 'write', { file_path: '/b.ts' }, baseConfig)
  state.pendingReview = { action: 'micro', files: 2 } // as the write-time listener arms it
  const steered = []
  const action = handleTurnStopping(state, (m) => steered.push(m), baseConfig)
  assert.equal(action, 'micro')
  assert.equal(steered.length, 1)
  assert.equal(state.files.size, 0, 'files cleared for next turn')
  assert.equal(state.chain, 1, 'chain counted')
})

test('handleTurnStopping: clean turn -> skip and resets chain', () => {
  const state = createState()
  state.chain = 2
  const steered = []
  const action = handleTurnStopping(state, (m) => steered.push(m), baseConfig)
  assert.equal(action, 'skip')
  assert.equal(steered.length, 0)
  assert.equal(state.chain, 0, 'chain reset by clean turn')
})

test('handleTurnStopping: consecutive review chain respects maxChain', () => {
  const state = createState()
  trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig)
  state.pendingReview = { action: 'micro', files: 1 }
  assert.equal(handleTurnStopping(state, () => {}, baseConfig), 'micro') // chain 1
  trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig) // review fixed something
  state.pendingReview = { action: 'micro', files: 1 }
  assert.equal(handleTurnStopping(state, () => {}, baseConfig), 'micro') // chain 2
  trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig)
  // stop-loss: at maxChain the write-time grading skips, so nothing is armed
  state.pendingReview = null
  assert.equal(handleTurnStopping(state, () => {}, baseConfig), 'skip', 'maxChain reached')
})

// ---- apply() wiring with a minimal fake ctx ----

function fakeCtx() {
  const listeners = new Map()
  const registered = []
  const injectCalls = []
  const ctx = {
    listeners,
    registered,
    injectCalls,
    tools: { register: (d) => { registered.push(d); return () => {} } },
    // Lazy optional-service mount (e.g. ['webServer']): captured, NOT invoked
    // by default — mirrors a headless composition where the service never
    // arrives. Tests drive it manually via injectCalls.
    inject(deps, fn) {
      injectCalls.push({ deps, fn })
      return () => {}
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
      return () => {
        const arr = listeners.get(event)
        if (arr) listeners.set(event, arr.filter((f) => f !== fn))
      }
    },
    effect(genFn) {
      const disposers = []
      const gen = genFn()
      let r = gen.next()
      while (!r.done) {
        if (typeof r.value === 'function') disposers.push(r.value)
        r = gen.next()
      }
      if (typeof r.value === 'function') disposers.push(r.value)
      ctx.effectDisposers = disposers
      return () => disposers.forEach((d) => d())
    },
    effectDisposers: [],
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args)
    },
  }
  return ctx
}

test('apply: registers the three expected event listeners', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  for (const event of ['tools/result', 'agent/turn-stopping', 'agent/disposed']) {
    assert.ok(ctx.listeners.get(event)?.length === 1, `listener for ${event}`)
  }
})

test('apply: end-to-end write then turn-stopping steers a review', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 's1', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('tools/result', { name: 'bash', arguments: { command: 'rm x' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 1, 'review steered')
  assert.ok(steered[0].source.kind === 'review-gate', 'driver uses folded context kind')
  assert.ok(steered[0].source.summary, 'driver carries a one-line notice summary')
})

test('apply: turn without writes does not steer', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 's2', steer: (m) => steered.push(m) }
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0)
})

test('apply: agents are isolated by session id', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const a1 = { id: 'x1', steer: (m) => steered.push('x1') }
  const a2 = { id: 'x2', steer: (m) => steered.push('x2') }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent: a1 })
  ctx.emit('agent/turn-stopping', { agent: a2, turn: 1, signal: new AbortController().signal })
  assert.deepEqual(steered, [], "another session's writes don't trigger this agent")
  ctx.emit('agent/turn-stopping', { agent: a1, turn: 1, signal: new AbortController().signal })
  assert.deepEqual(steered, ['x1'])
})

test('apply: disposed agent state is cleaned up', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'gone', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/disposed', { agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0, 'no steer after dispose')
})

test('apply: agent without steer method is tolerated', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const agent = { id: 'nosteer' }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  assert.doesNotThrow(() =>
    ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }),
  )
})

test('apply: effect dispose unregisters all listeners', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  assert.equal(ctx.effectDisposers.length, 5, 'five core listeners yielded as disposers (tool registration collects itself via the plugin context; fs-intent listeners removed in v5-T3)')
  assert.equal(ctx.listeners.get('agent/turn-stopping').length, 1)
  for (const d of ctx.effectDisposers) d()
  for (const event of ['tools/result', 'agent/turn-stopping', 'agent/disposed']) {
    assert.equal(ctx.listeners.get(event).length, 0, `${event} unregistered`)
  }
})

test('handleTurnStopping: maxChain skip clears files for next turn', () => {
  const state = createState()
  state.chain = 2
  trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig)
  assert.equal(handleTurnStopping(state, () => {}, baseConfig), 'skip')
  assert.equal(state.files.size, 0, 'files cleared so next turn starts fresh')
  assert.equal(state.chain, 2, 'chain kept until a clean turn resets it')
})

test('apply: claimed event decays chain so next user turn regains review', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'decay', steer: (m) => steered.push(m) }
  // 回合内复审循环打到 maxChain：两次复审后第三次拦截
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c1
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c2
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // skip
  assert.equal(steered.length, 2)
  // 用户下一条消息被认领 → chain 衰减
  ctx.emit('agent/inbox/claimed', { agent, message: {}, turn: 2 })
  // 新回合写文件 → 应恢复复审（chain 1 < 2）
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/b.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })
  assert.equal(steered.length, 3, 'review regains after claimed decay')
})

test('apply: review prompt demands changed-file inventory', async () => {
  const { buildReviewMessage } = await import('../lib/index.js')
  const msg = buildReviewMessage('micro', 1)
  const text = msg.content.map((b) => b.text ?? '').join('')
  assert.ok(text.includes('改动文件清单'), 'micro demands inventory to force real reading')
  const full = buildReviewMessage('full', 1)
  assert.ok(full.content.map((b) => b.text ?? '').join('').includes('改动文件清单'))
})

test('buildReviewMessage: source is a non-user context kind so UI renders it folded', async () => {
  const { buildReviewMessage } = await import('../lib/index.js')
  const msg = buildReviewMessage('micro', 2)
  assert.equal(msg.source.kind, 'review-gate', 'custom kind -> client renders as context node')
  assert.equal(msg.source.form, 'notice', 'notice form -> one-line collapsed row')
  assert.ok(typeof msg.source.summary === 'string' && msg.source.summary.length > 0)
})

// ---- context-injection architecture: instruction via assemble, minimal driver ----

test('handleTurnStopping: sets pendingReview and steers only a minimal driver message', async () => {
  const mod = await import('../lib/index.js')
  const state = mod.createState()
  mod.trackWrite(state.files, 'write', { file_path: '/a.ts' }, baseConfig)
  state.pendingReview = { action: 'micro', files: 1 } // armed by the write-time listener
  const steered = []
  const action = mod.handleTurnStopping(state, (m) => steered.push(m), baseConfig)
  assert.equal(action, 'micro')
  assert.ok(state.pendingReview, 'pendingReview kept so the driver round can still acknowledge')
  assert.equal(state.chain, 1, 'chain counted — stop-loss now guards the loop instead of disarming')
  // driver message must NOT contain the full instruction body
  const text = steered[0].content.map((b) => b.text ?? '').join('')
  assert.ok(text.length < 120, `driver is short, got ${text.length}`)
  assert.ok(!text.includes('逐行读'), 'driver does not carry the instruction body')
})

test('assemble listener injects review instruction as a named context section', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const agent = { id: 'asm', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  // before the turn-stopping interrupt: instruction is live in the context
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  assert.ok(listener, 'assemble listener registered')
  const preA = { contexts: [], sections: [], tools: [], variables: {} }
  const pre = await listener(preA, { agent }, () => Promise.resolve(preA))
  const section = pre.contexts.find((c) => c.name === 'review-gate')
  assert.ok(section, 'review-gate context section injected')
  assert.ok(section.text.includes('逐行读'), 'section carries the full instruction')
  // after the interrupt: pendingReview survives, so the reviewing turn's own
  // requests still carry the instruction
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  const postA = { contexts: [], sections: [], tools: [], variables: {} }
  const post = await listener(postA, { agent }, () => Promise.resolve(postA))
  assert.ok(post.contexts.find((c) => c.name === 'review-gate'), 'instruction stays live through the reviewing turn (ack pending)')
})

test('assemble listener injects nothing when no review is pending', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const assembly = { contexts: [], sections: [], tools: [], variables: {} }
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const out = await listener(assembly, {}, async () => assembly)
  assert.equal(out.contexts.find((c) => c.name === 'review-gate'), undefined)
})

test('unacknowledged closes stop at maxChain and the instruction settles', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'clr', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c1
  // 复审轮（只读、无 ack）结束 → 给第二轮补审机会，仍拦截（chain=2）
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 2, 'reviewing turn without ack gets one more chance')
  // 连续无视 → maxChain 止损，指令随之消失
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 2, 'stop-loss caps the chain')
  const assembly = { contexts: [], sections: [], tools: [], variables: {} }
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const out = await listener(assembly, { agent }, async () => assembly)
  assert.equal(out.contexts.find((c) => c.name === 'review-gate'), undefined, 'instruction gone after stop-loss settles')
})

// ---- review as an in-flight wrap-up step, not a post-summary interruption ----

test('write tool result immediately sets pendingReview so the instruction leads the wrap-up', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const agent = { id: 'early', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  const assembly = { contexts: [], sections: [], tools: [], variables: {} }
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const out = await listener(assembly, { agent }, async () => assembly)
  const section = out.contexts.find((c) => c.name === 'review-gate')
  assert.ok(section, 'instruction injected the moment writes happen, before the summary')
  assert.ok(section.text.includes('最终总结'), 'instruction frames review as pre-summary step')
  assert.ok(section.text.includes('总结必须并入复审结论'), 'review conclusion merges into the summary')
})

test('turn-stopping with pending review steers a resume-style driver, not a redo', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'boot', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  const text = steered[0].content.map((b) => b.text ?? '').join('')
  assert.ok(text.includes('最终总结'), 'driver tells the model the ending must be a summary')
  assert.ok(text.includes('review_acknowledge'), 'driver routes completion through the receipt tool — ack made it unconditional')
})

test('escalation: third written file upgrades the pending instruction to full', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const agent = { id: 'esc', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/b.ts' }, agent })
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const mk = () => ({ contexts: [], sections: [], tools: [], variables: {} })
  const midA = mk()
  const mid = await listener(midA, { agent }, () => Promise.resolve(midA))
  assert.ok(mid.contexts.find((c) => c.name === 'review-gate').text.includes('快扫'), 'small change -> light scan')
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/c.ts' }, agent })
  const fullA = mk()
  const full = await listener(fullA, { agent }, () => Promise.resolve(fullA))
  assert.ok(full.contexts.find((c) => c.name === 'review-gate').text.includes('全面复审'), 'at threshold -> full audit')
})

// ---- v2: review_acknowledge receipt tool is the sole review-completion signal ----

function getAck(ctx) {
  return ctx.registered.find((t) => t.name === 'review_acknowledge')
}

test('apply: review_acknowledge tool is registered', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  assert.ok(getAck(ctx), 'review_acknowledge registered')
})

test('ack: acknowledged receipt lets the turn close without interception', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = getAck(ctx)
  const steered = []
  const agent = { id: 'ack1', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  const out = await ack.execute(
    { action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'diff 通读无问题' },
    { agent },
  )
  assert.ok(String(out).includes('回执'), 'receipt acknowledged in tool output')
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0, 'no interception after acknowledgment')
})

test('ack: without receipt the gate intercepts but pendingReview survives; late ack then passes', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = getAck(ctx)
  const steered = []
  const agent = { id: 'ack2', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'edit', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c1
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c2 — pendingReview kept
  assert.equal(steered.length, 2, 'both closes intercepted while unacknowledged')
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: '补审' }, { agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 2, 'late ack accepted — turn closes')
})

test('ack: stale receipt invalidated by a fresh write; no pending review -> ignored', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = getAck(ctx)
  const steered = []
  const agent = { id: 'ack3', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: '先审' }, { agent })
  // a) stale ack: a new write re-arms and must reset acknowledged
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/b.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 1, 'fresh write invalidates the stale receipt')
  // b) no pending review (fresh agent, zero writes): ack is ignored
  const out = await ack.execute(
    { action: 'micro', files: [], findings: [], fixes_made: false, summary: '乱调' },
    { agent: { id: 'ack3b', steer: () => {} } },
  )
  assert.ok(String(out).includes('忽略'), 'ack without pending review is ignored')
})

test('ack: maxChain stop-loss still passes unacknowledged closes', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'ack4', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c1
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // c2
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal }) // chain at max -> pass
  assert.equal(steered.length, 2, 'stop-loss caps interception at maxChain')
})

test('ack: instruction text demands the receipt call', async () => {
  const { reviewInstructionText } = await import('../lib/index.js')
  for (const action of ['micro', 'full']) {
    const text = reviewInstructionText(action, 1)
    assert.ok(text.includes('review_acknowledge'), `${action} instruction demands the receipt tool`)
  }
  const { DRIVER_HINT } = await import('../lib/index.js')
  assert.ok(DRIVER_HINT.includes('review_acknowledge'), 'driver points at the receipt tool')
  const annotated = reviewInstructionText('full', 1, '坑：globToRegExp 不支持 ? 通配', 'pitfalls.md')
  assert.ok(annotated.includes('> 来源：pitfalls.md') && annotated.includes('坑：globToRegExp'), 'pitfalls body and provenance line injected')
})

// ---- v2 Task 2: git-diff evidence injected into the review instruction ----

import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile as _execFile } from 'node:child_process'
import { promisify as _promisify } from 'node:util'
import { tmpdir as _tmpdir } from 'node:os'
const runGit = _promisify(_execFile)

async function mkdtempGitRepo() {
  const dir = await mkdtemp(join(_tmpdir(), 'rg-git-'))
  await runGit('git', ['-C', dir, 'init'])
  await runGit('git', ['-C', dir, 'config', 'user.email', 't@t'])
  await runGit('git', ['-C', dir, 'config', 'user.name', 't'])
  await writeFile(join(dir, 'a.txt'), 'base\n')
  await writeFile(join(dir, 'a.tsx'), 'base\n')
  await runGit('git', ['-C', dir, 'add', '.'])
  await runGit('git', ['-C', dir, 'commit', '-m', 'base'])
  await writeFile(join(dir, 'a.txt'), 'base\nnew line\n')
  return dir
}

test('collectDiff: git repo returns a diff, non-git dir returns null', async () => {
  const { collectDiff } = await import('../lib/index.js')
  const dir = await mkdtempGitRepo()
  const diff = await collectDiff([join(dir, 'a.txt')])
  assert.ok(diff, 'git repo should yield a diff')
  assert.match(diff, /\+new line/)
  const plain = await mkdtemp(join(_tmpdir(), 'rg-plain-'))
  await writeFile(join(plain, 'x.txt'), 'x')
  assert.equal(await collectDiff([join(plain, 'x.txt')]), null, 'non-git dir -> null')
})

test('assemble: diff containing {{...}} (JSX style) must not kill the turn', async () => {
  // Real-world killer (2026-09-30): a chip restyle diff carried JSX
  // `style={{ ... }}`; the host interpolator (dsh-system-prompt
  // renderContextSections) runs over EVERY runtime context with no
  // interpolate:false escape, saw `{{` + `}}`, and threw
  // `malformed prompt variable reference … in context "review-gate"` —
  // agent-loop preStep died and the whole reviewing turn failed, repeatedly.
  const { apply } = await import('../lib/index.js')
  const { renderContextSections } = await import('@deepseek-ai/dsh-system-prompt')
  const ctx = fakeCtx()
  const dir = await mkdtempGitRepo()
  await writeFile(join(dir, 'a.tsx'), 'base\nconst x = <div style={{ color: "red" }} />\n')
  apply(ctx, { ...baseConfig, fullAtLines: 9999 })
  const agent = { id: 'jsx', steer: () => {} }
  ctx.emit('tools/result', { name: 'edit', arguments: { file_path: join(dir, 'a.tsx') }, agent })
  const assembly = { contexts: [], sections: [], tools: [], variables: {} }
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const out = await listener(assembly, { agent }, async () => assembly)
  const section = out.contexts.find((c) => c.name === 'review-gate')
  assert.ok(section, 'section injected')
  assert.ok(section.text.includes('style={{'), 'diff evidence preserves the JSX braces verbatim')
  // The decisive assertion: the host render path must NOT throw on this text.
  const rendered = renderContextSections(out)
  const renderedSection = rendered.find((c) => c.name === 'review-gate')
  assert.ok(renderedSection, 'section survives host-side interpolation')
  assert.ok(renderedSection.text.includes('style={{ color'), 'brace content renders back byte-identical')
})

test('assemble: review section carries the diff evidence and line count upgrades to full', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const dir = await mkdtempGitRepo()
  // 6 changed lines against a fullAtLines of 5
  await writeFile(join(dir, 'a.txt'), 'base\n1\n2\n3\n4\n5\n6\n')
  const cfg = { ...baseConfig, fullAtLines: 5 }
  apply(ctx, cfg)
  const agent = { id: 'dif', steer: () => {} }
  ctx.emit('tools/result', { name: 'edit', arguments: { file_path: join(dir, 'a.txt') }, agent })
  const assembly = { contexts: [], sections: [], tools: [], variables: {} }
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const out = await listener(assembly, { agent }, async () => assembly)
  const section = out.contexts.find((c) => c.name === 'review-gate')
  assert.ok(section, 'section injected')
  assert.ok(section.text.includes('全面复审'), '6 changed lines >= fullAtLines(5) upgrades to full')
  assert.ok(section.text.includes('diff'), 'section carries diff evidence')
  assert.match(section.text, /\+1/, 'diff body contains the added line')
})

// ---- v2 Task 3: receipts persisted to a JSONL audit log ----

import fs from 'node:fs/promises'

test('appendReceipt: appends one JSON line; write failure is swallowed', async () => {
  const { appendReceipt } = await import('../lib/index.js')
  const dir = await mkdtemp(join(_tmpdir(), 'rg-audit-'))
  await appendReceipt(dir, { action: 'micro', files: ['/a.ts'], findings: 0 })
  const line = (await fs.readFile(join(dir, 'receipts.jsonl'), 'utf8')).trim()
  assert.deepEqual(JSON.parse(line).files, ['/a.ts'], 'receipt line persisted')
  // 目录路径指向一个文件 → appendFile 报 ENOTDIR，必须被吞掉
  await assert.doesNotReject(
    appendReceipt(join(dir, 'receipts.jsonl'), { action: 'full', files: [], findings: 0 }),
  )
})

test('ack: receipt lands in the audit log', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  // mkdtemp random dir (v5-T2): a fixed path leaked residue rows whenever a
  // failing round crashed before cleanup, poisoning the next run's single-line
  // JSON.parse — same pattern as the v5-F1 cases.
  const receiptDir = await mkdtemp(join(_tmpdir(), 'rg-ack-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'audit', steer: () => {} }
  try {
    ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
    await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
    const line = (await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim()
    const rec = JSON.parse(line)
    assert.equal(rec.action, 'micro')
    assert.equal(rec.agentId, 'audit')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

// ---- v2 Task 4: bash write-pattern heuristic (partial blind-spot cover) ----

test('decideReview: bashWrites alone grades micro', async () => {
  const { decideReview, BASH_WRITE_RE } = await import('../lib/index.js')
  assert.equal(decideReview({ writeFiles: 0, bashWrites: true, chain: 0, config: baseConfig }), 'micro')
  assert.equal(decideReview({ writeFiles: 0, bashWrites: false, chain: 0, config: baseConfig }), 'skip')
  assert.ok(BASH_WRITE_RE.test('echo hi > /x.txt'), 'redirect matches')
  assert.ok(BASH_WRITE_RE.test('rm -rf build'), 'rm matches')
  assert.ok(BASH_WRITE_RE.test('npm i left-pad'), 'npm install matches')
  assert.equal(BASH_WRITE_RE.test('ls -la'), false, 'harmless ls does not match')
  assert.equal(BASH_WRITE_RE.test('cat package.json'), false, 'cat does not match')
})

test('apply: bash write-pattern command arms a micro review with the command listed', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'bsh', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'bash', arguments: { command: 'echo x > /tmp/patch.txt' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 1, 'bash write arms the gate')
  const text = steered[0].content.map((b) => b.text ?? '').join('')
  assert.ok(typeof text === 'string')
})

test('apply: harmless bash command does not arm the gate', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const steered = []
  const agent = { id: 'cat', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'bash', arguments: { command: 'cat /tmp/patch.txt' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0, 'cat alone never arms the gate')
})

// ---- v3: signal layer (fs-intent), noise filter, milestone audit, cost meter ----

// v5-T3: the fs/write-intent and fs/edit-intent tests were removed — the lane
// is no longer wired (dead-lane code cleared; verdict = veto semantics double
// closure). Their pass-through semantics documentation lives on in the
// realloop veto test.

test('ignoreGlobs: matched paths never arm the gate', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, { ...baseConfig, ignoreGlobs: ['**/*.md', '**/pnpm-lock.yaml'] })
  const steered = []
  const agent = { id: 'ig', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/p/README.md' }, agent })
  ctx.emit('tools/result', { name: 'edit', arguments: { file_path: '/p/pnpm-lock.yaml' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 0, 'docs and lockfiles are noise, not code')
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/p/a.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 1, 'code still arms')
})

test('milestone: cumulative files since last full review force full depth', async () => {
  const { decideReview } = await import('../lib/index.js')
  assert.equal(
    decideReview({ writeFiles: 3, sessionFiles: 12, chain: 0, config: baseConfig }),
    'full',
    'cumulative drift triggers a milestone audit',
  )
  // 1 file alone grades micro (1 < fullAtFiles 3) even with 9 accumulated.
  assert.equal(decideReview({ writeFiles: 1, sessionFiles: 9, chain: 0, config: baseConfig }), 'micro')
})

test('ack: receipt carries cost fields for transparency', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await fs.mkdtemp(join(_tmpdir(), 'rg-cost-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'cost', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
  const rec = JSON.parse((await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim())
  assert.ok('cost' in rec, 'receipt records review cost (Qoder-style transparency)')
  await fs.rm(receiptDir, { recursive: true, force: true })
})

test('full instruction includes data-flow tracing step', async () => {
  const { reviewInstructionText } = await import('../lib/index.js')
  assert.ok(reviewInstructionText('full', 1).includes('数据流'), 'full audit traces source→sink data flow')
})

// ---- v3.1: alwaysFullGlobs, findings flywheel, continuation short-circuit ----

test('alwaysFullGlobs: touching a core contract file forces full depth', async () => {
  const { decideReview } = await import('../lib/index.js')
  const cfg = { ...baseConfig, alwaysFullGlobs: ['**/spec/**', '**/entity/**'] }
  assert.equal(
    decideReview({ writeFiles: 1, paths: ['/p/spec/总纲.md'], chain: 0, config: cfg }),
    'full',
    'core contract edits always get a full audit',
  )
  assert.equal(
    decideReview({ writeFiles: 1, paths: ['/p/a.ts'], chain: 0, config: cfg }),
    'micro',
    'ordinary files keep auto grading',
  )
})

test('ack: findings are persisted in full, not as a count', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await fs.mkdtemp(join(_tmpdir(), 'rg-find-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'fly', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  const finding = { file: '/a.ts', line: 3, severity: 'major', note: 'copied block not renamed' }
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [finding], fixes_made: true, summary: 'fixed' }, { agent })
  const rec = JSON.parse((await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim())
  assert.deepEqual(rec.findings, [finding], 'findings flywheel needs the full structured list')
  await fs.rm(receiptDir, { recursive: true, force: true })
})

test('pitfallsFile: full instruction carries the known project pitfalls section', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const pitfalls = join(_tmpdir(), 'rg-pitfalls.md')
  await fs.writeFile(pitfalls, '- JS 弱转判界: +null===0')
  apply(ctx, { ...baseConfig, pitfallsFile: pitfalls })
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const agent = { id: 'pit', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/p/a.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/p/b.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/p/c.ts' }, agent })
  const a = { contexts: [], sections: [], tools: [], variables: {} }
  const out = await listener(a, { agent }, async () => a)
  const sec = out.contexts.find((c) => c.name === 'review-gate')
  assert.ok(sec?.text.includes('JS 弱转判界'), 'full review sees the distilled pitfalls')
  await fs.rm(pitfalls, { force: true })
})

test('ack: clean-state call short-circuits without logging an empty receipt', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await fs.mkdtemp(join(_tmpdir(), 'rg-short-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'sc', steer: () => {} }
  const result = await ack.execute({ action: 'micro', files: [], findings: [], fixes_made: false, summary: 'probe' }, { agent })
  assert.ok(result.includes('回执忽略'), 'continuation-replayed calls get an explicit skip hint')
  const file = join(receiptDir, 'receipts.jsonl')
  assert.equal(await fs.access(file).then(() => true, () => false), false, 'no empty receipt line is written')
  await fs.rm(receiptDir, { recursive: true, force: true })
})

test('driver hint tells an already-acknowledged model it may close directly', async () => {
  const { DRIVER_HINT } = await import('../lib/index.js')
  assert.ok(DRIVER_HINT.includes('已回执'), 'replayed hint is ignorable by wording')
})

test('ack: a replayed call after settlement clears residue without a second receipt', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await fs.mkdtemp(join(_tmpdir(), 'rg-residue-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'res', steer: () => {} }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
  // Steer keeps pendingReview armed; the client may replay the hint afterwards.
  const again = await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'replay' }, { agent })
  assert.ok(again.includes('已完成'), 'replayed call points the model to close directly')
  const lines = (await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim().split('\n')
  assert.equal(lines.length, 1, 'exactly one receipt for one review')
  await fs.rm(receiptDir, { recursive: true, force: true })
})

// ---- v3.2: Codex Security reviewer recipe (five borrowings) ----

test('full instruction carries the Codex reviewer recipe', async () => {
  const { reviewInstructionText } = await import('../lib/index.js')
  const text = reviewInstructionText('full', 1)
  assert.ok(text.includes('Forward') && text.includes('Backward'), 'four reviewer perspectives are listed')
  assert.ok(text.includes('三连接'), 'conclusions must connect input→control→sink')
  assert.ok(text.includes('逐行读过'), 'coverage honesty: only truly read files count')
  assert.ok(text.includes('critical'), 'severity calibration matrix is stated')
  assert.ok(text.includes('不可信分析数据'), 'injected evidence is declared untrusted data')
})

// ---- v3.3: real-host state machine fixes (ack self-clear; dual-signal dedup
// was cleared in v5-T3 with the dead fs-intent lane) ----

test('tools/result re-emission of the same file counts once (Set idempotence)', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, { ...baseConfig, milestoneAtFiles: 2 })
  const steered = []
  const agent = { id: 'dd', steer: (m) => steered.push(m) }
  // v5-T3 semantics: single signal (tools/result), repeat emissions of the
  // same file_path collapse via Set.add — x twice + y + z = 3 real files.
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/q/x.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/q/x.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/q/y.ts' }, agent })
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/q/z.ts' }, agent })
  ctx.emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
  assert.equal(steered.length, 1)
  // Check the assemble injection, which is where the file count lives (the
  // driver hint is count-free).
  const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
  const a = { contexts: [], sections: [], tools: [], variables: {} }
  const out = await listener(a, { agent }, async () => a)
  const sec = out.contexts.find((c) => c.name === 'review-gate')
  assert.ok(sec?.text.includes('3 个文件'), 'idempotence keeps the true file count (3, not 4)')
})

test('ack self-clears pendingReview — a replayed close never steers again', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const ack = getAck(ctx)
  const steered = []
  const agent = { id: 'selfclear', steer: (m) => steered.push(m) }
  ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
  // Same turn closes again (client continuation): no second steer, no chain growth.
  const action = ctx.listeners.get('agent/turn-stopping')?.[0]?.(
    { agent, turn: 1, signal: new AbortController().signal },
  )
  assert.equal(steered.length, 0, 'ack settled the pending review — replayed closes pass silently')
  assert.equal(action ?? 'micro', 'micro', 'returns the settled action without re-arming')
})

// ---- v5-F1 A: convergence fatigue guard (noNewReviews) ----

test('decideReview: milestone drift still escalates while noNewReviews < K (default 3 via fallback)', async () => {
  const { decideReview } = await import('../lib/index.js')
  // baseConfig has no noNewReviewsBeforeDemotion key: the ?? 3 fallback arms it.
  assert.equal(
    decideReview({ writeFiles: 1, sessionFiles: 10, noNewReviews: 2, chain: 0, config: baseConfig }),
    'full',
    'drift escalation holds below the demotion threshold',
  )
})

test('decideReview: after K zero-finding full reviews drift no longer escalates, base grading untouched', async () => {
  const { decideReview } = await import('../lib/index.js')
  const cfg = { ...baseConfig, noNewReviewsBeforeDemotion: 3 }
  assert.equal(
    decideReview({ writeFiles: 1, sessionFiles: 10, noNewReviews: 3, chain: 0, config: cfg }),
    'micro',
    'spent drift signal can no longer escalate on its own',
  )
  // micro/full base grading untouched: fullAtFiles still forces full.
  assert.equal(
    decideReview({ writeFiles: 3, sessionFiles: 10, noNewReviews: 5, chain: 0, config: cfg }),
    'full',
    'fullAtFiles base grading survives the fatigue guard',
  )
})

test('ack: noNewReviews counter increments on zero-finding full settlements and resets otherwise', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await mkdtemp(join(_tmpdir(), 'rg-f1-counter-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'fatigue', steer: () => {} }
  const arm = () => ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
  try {
    arm()
    await ack.execute({ action: 'full', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
    arm()
    await ack.execute({ action: 'full', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
    arm()
    await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
    const lines = (await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 3, 'three settlements, three receipt lines')
    const costs = lines.map((l) => JSON.parse(l).cost.noNewReviews)
    assert.deepEqual(costs, [1, 2, 0], 'zero-finding full increments, any other settlement resets')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

// ---- v5-F1 B: receipts outcome (acknowledged | stop_loss) ----

test('receipts: stop-loss close lands an outcome:stop_loss line with the reviewed files', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await mkdtemp(join(_tmpdir(), 'rg-f1-stoploss-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const agent = { id: 'stoploss', steer: () => {} }
  const steered = []
  agent.steer = (m) => steered.push(m)
  const ts = ctx.listeners.get('agent/turn-stopping')?.[0]
  try {
    ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/sl.ts' }, agent })
    ts({ agent, turn: 1, signal: new AbortController().signal })
    ts({ agent, turn: 1, signal: new AbortController().signal })
    ts({ agent, turn: 1, signal: new AbortController().signal })
    assert.equal(steered.length, 2, 'maxChain=2 steers twice before the stop-loss close')
    // fire-and-forget receipt (mkdir + appendFile spans multiple awaits): give
    // the event loop real time before reading the file
    await new Promise((r) => setTimeout(r, 25))
    const lines = (await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1, 'only the stop-loss close writes a receipt line')
    const rec = JSON.parse(lines[0])
    assert.equal(rec.outcome, 'stop_loss')
    assert.equal(rec.chain, 2)
    assert.deepEqual(rec.files, ['/sl.ts'], 'files snapshot survives the nulling stop-loss branch')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('receipts: acknowledged settlement line carries outcome:acknowledged', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await mkdtemp(join(_tmpdir(), 'rg-f1-ack-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const ack = getAck(ctx)
  const agent = { id: 'ackline', steer: () => {} }
  try {
    ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/a.ts' }, agent })
    await ack.execute({ action: 'micro', files: ['/a.ts'], findings: [], fixes_made: false, summary: 'ok' }, { agent })
    const rec = JSON.parse((await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim())
    assert.equal(rec.outcome, 'acknowledged')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('assemble: armed review with no agent identity lands an assemble_degraded receipt', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  const receiptDir = await mkdtemp(join(_tmpdir(), 'rg-p2-degraded-'))
  apply(ctx, { ...baseConfig, receiptDir })
  const agent = { id: 'deg', steer: () => {} }
  try {
    const assembly = { contexts: [], sections: [], tools: [], variables: {} }
    // Arm the gate for one agent, then hit assemble without any agent identity.
    ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/d.ts' }, agent })
    const listener = ctx.listeners.get('system-prompt/assemble')?.[0]
    await listener(assembly, {}, async () => assembly)
    await new Promise((r) => setTimeout(r, 25))
    const rec = JSON.parse((await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim())
    assert.equal(rec.outcome, 'assemble_degraded')
    assert.equal(rec.agentId, 'unknown')
    // With an agent identity on context, no alarm fires.
    ctx.emit('tools/result', { name: 'write', arguments: { file_path: '/e.ts' }, agent })
    await listener(assembly, { agent }, async () => assembly)
    await new Promise((r) => setTimeout(r, 25))
    const lines = (await fs.readFile(join(receiptDir, 'receipts.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1, 'normal assemble does not alarm')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

// ---- live-config overlay (the web panel's source of truth) ----

test('config-live: readOverlay on a missing dir degrades to {}', async () => {
  const { readOverlay } = await import('../lib/index.js')
  assert.deepEqual(readOverlay(join(_tmpdir(), 'rg-nonexistent-' + process.pid)), {})
})

test('config-live: applyOverlay mutates in place, copies arrays, ignores unknown keys', async () => {
  const { applyOverlay } = await import('../lib/index.js')
  const cfg = { ...baseConfig }
  applyOverlay(cfg, { mode: 'full', ignoreGlobs: ['docs/**'], bogus: 'x' })
  assert.equal(cfg.mode, 'full')
  assert.deepEqual(cfg.ignoreGlobs, ['docs/**'])
  assert.equal('bogus' in cfg, false, 'unknown key never leaks into config')
})

test('config-live: pickOverlay strips path keys and unknown keys', async () => {
  const { pickOverlay } = await import('../lib/index.js')
  const picked = pickOverlay({ mode: 'full', nope: 1, receiptDir: '/evil', pitfallsFile: '/evil.md' })
  assert.deepEqual(picked, { mode: 'full' }, 'path keys are boot-level, never patchable')
})

test('config-live: saveOverlay round-trips', async () => {
  const { saveOverlay, readOverlay } = await import('../lib/index.js')
  const dir = join(_tmpdir(), 'rg-overlay-' + process.pid)
  try {
    await saveOverlay(dir, { mode: 'micro' })
    assert.deepEqual(readOverlay(dir), { mode: 'micro' })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('apply: stored overlay merges over boot config at activation', async () => {
  const { apply, saveOverlay } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-boot-' + process.pid)
  await saveOverlay(receiptDir, { mode: 'full' })
  try {
    const cfg = { ...baseConfig, receiptDir }
    const ctx = fakeCtx()
    apply(ctx, cfg)
    assert.equal(cfg.mode, 'full', 'overlay merged in place at boot')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('apply: headless (inject uncalled) still activates; exactly one webServer inject captured', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  assert.equal(ctx.injectCalls.length, 1, 'one lazy inject for the web API')
  assert.deepEqual(ctx.injectCalls[0].deps, ['webServer'])
  assert.equal(ctx.listeners.get('tools/result')?.length, 1, 'gate still armed in headless')
})

// ---- live-config HTTP API (mounted via the webServer inject) ----

function mountWebApi(ctx) {
  const routes = []
  for (const { fn } of ctx.injectCalls) {
    fn({
      effect: (fn2) => fn2(),
      webServer: { register: (r) => { routes.push(r); return () => {} } },
    })
  }
  return routes
}

function mockReq(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

function mockRes() {
  const res = {
    code: 0,
    headers: null,
    body: null,
    writeHead(code, headers) {
      res.code = code
      res.headers = headers
    },
    end(raw) {
      res.body = JSON.parse(raw)
    },
  }
  return res
}

test('config api: two exact routes registered via the webServer inject', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const routes = mountWebApi(ctx)
  assert.deepEqual(
    routes.map((r) => r.path),
    ['/plugin/review-gate/config', '/plugin/review-gate/config/reset'],
  )
  assert.ok(routes.every((r) => r.kind === 'exact'))
})

test('config api: GET reads config; POST applies patch live and persists overlay', async () => {
  const { apply, readOverlay } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-api-' + process.pid)
  try {
    const ctx = fakeCtx()
    apply(ctx, { ...baseConfig, receiptDir })
    const api = mountWebApi(ctx).find((r) => r.path === '/plugin/review-gate/config')
    const got = mockRes()
    await api.handler(mockReq('GET'), got)
    assert.equal(got.code, 200)
    assert.equal(got.body.config.mode, 'auto')

    const posted = mockRes()
    await api.handler(mockReq('POST', { mode: 'full', bogus: 1 }), posted)
    assert.equal(posted.code, 200)
    assert.equal(posted.body.ok, true)
    assert.deepEqual(posted.body.ignored, ['bogus'], 'unknown keys reported, not fatal')

    const reread = mockRes()
    await api.handler(mockReq('GET'), reread)
    assert.equal(reread.body.config.mode, 'full', 'mutation is live for subsequent reads')
    assert.deepEqual(readOverlay(receiptDir), { mode: 'full' }, 'overlay persisted')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('config api: POST with an invalid value -> 400 and config untouched', async () => {
  const { apply } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-api-bad-' + process.pid)
  try {
    const ctx = fakeCtx()
    apply(ctx, { ...baseConfig, receiptDir })
    const api = mountWebApi(ctx).find((r) => r.path === '/plugin/review-gate/config')
    const bad = mockRes()
    await api.handler(mockReq('POST', { mode: 'nonsense' }), bad)
    assert.equal(bad.code, 400)
    assert.ok(bad.body.error, 'error message present')
    const got = mockRes()
    await api.handler(mockReq('GET'), got)
    assert.equal(got.body.config.mode, 'auto', 'invalid patch left no trace')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('config api: reset restores boot values and clears the overlay', async () => {
  const { apply, readOverlay } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-api-reset-' + process.pid)
  try {
    const ctx = fakeCtx()
    apply(ctx, { ...baseConfig, receiptDir })
    const routes = mountWebApi(ctx)
    const api = routes.find((r) => r.path === '/plugin/review-gate/config')
    const reset = routes.find((r) => r.path === '/plugin/review-gate/config/reset')
    await api.handler(mockReq('POST', { mode: 'full', fullAtFiles: 9 }), mockRes())
    const done = mockRes()
    await reset.handler(mockReq('POST'), done)
    assert.equal(done.code, 200)
    assert.equal(done.body.config.mode, 'auto', 'boot values restored')
    assert.equal(done.body.config.fullAtFiles, 3, 'boot threshold restored')
    assert.deepEqual(readOverlay(receiptDir), {}, 'overlay cleared on disk')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('config api: malformed body -> 400; wrong method -> 405', async () => {
  const { apply } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-api-40x-' + process.pid)
  try {
    const ctx = fakeCtx()
    apply(ctx, { ...baseConfig, receiptDir })
    const api = mountWebApi(ctx).find((r) => r.path === '/plugin/review-gate/config')
    const raw = { method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from('{not json') } }
    const bad = mockRes()
    await api.handler(raw, bad)
    assert.equal(bad.code, 400, 'invalid JSON -> 400')
    const del = mockRes()
    await api.handler(mockReq('DELETE'), del)
    assert.equal(del.code, 405, 'method whitelist -> 405')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

// ---- review_gate_config tool (the agent-facing twin of the HTTP API) ----

function getConfigTool(ctx) {
  return ctx.registered.find((t) => t.name === 'review_gate_config')
}

test('review_gate_config: get / set / reset round-trip with live effect', async () => {
  const { apply, decideReview, readOverlay } = await import('../lib/index.js')
  const receiptDir = join(_tmpdir(), 'rg-tool-' + process.pid)
  try {
    const ctx = fakeCtx()
    apply(ctx, { ...baseConfig, receiptDir })
    const tool = getConfigTool(ctx)
    assert.ok(tool, 'review_gate_config registered')

    const got = JSON.parse(await tool.execute({ action: 'get' }))
    assert.equal(got.config.mode, 'auto')

    const setOut = await tool.execute({ action: 'set', mode: 'full', maxChain: 3 })
    assert.ok(String(setOut).includes('已生效'), 'set reports success')
    assert.ok(String(setOut).includes('"full"'), 'set echoes the applied value')
    // Live semantics: the state machine grades through the mutated config.
    assert.equal(
      decideReview({ writeFiles: 1, chain: 0, config: { ...baseConfig, mode: 'full' } }),
      'full',
      'full mode grades full regardless of size',
    )
    assert.deepEqual(readOverlay(receiptDir), { mode: 'full', maxChain: 3 }, 'overlay persisted')

    // Invalid enum values are rejected upstream by defineTool's schema.
    await assert.rejects(
      () => tool.execute({ action: 'set', mode: 'bogus' }),
      /must be one of/,
      'enum violations throw at the tool boundary',
    )
    // Out-of-range numbers pass the tool schema but fail the Config parse
    // (fullAtFiles has min 1) — this is the live-config validation layer.
    const bad = await tool.execute({ action: 'set', fullAtFiles: 0 })
    assert.ok(String(bad).includes('校验失败'), 'range violation rejected with a message')
    const stillFull = JSON.parse(await tool.execute({ action: 'get' }))
    assert.equal(stillFull.config.mode, 'full', 'rejected patch left no trace')

    const resetOut = await tool.execute({ action: 'reset' })
    assert.ok(String(resetOut).includes('恢复'), 'reset reports success')
    const after = JSON.parse(await tool.execute({ action: 'get' }))
    assert.equal(after.config.mode, 'auto', 'boot mode restored')
    assert.equal(after.config.maxChain, 2, 'boot maxChain restored')
    assert.deepEqual(after.overlay, {}, 'overlay cleared')
    assert.deepEqual(readOverlay(receiptDir), {}, 'overlay cleared on disk')
  } finally {
    await fs.rm(receiptDir, { recursive: true, force: true })
  }
})

test('review_gate_config: set with no keys lists available keys, writeTools excluded', async () => {
  const { apply } = await import('../lib/index.js')
  const ctx = fakeCtx()
  apply(ctx, baseConfig)
  const tool = getConfigTool(ctx)
  const out = String(await tool.execute({ action: 'set' }))
  assert.ok(out.includes('未提供任何可设键'), 'empty set hints at available keys')
  assert.equal(out.includes('writeTools'), false, 'advanced internal knob stays off the tool face')
})
