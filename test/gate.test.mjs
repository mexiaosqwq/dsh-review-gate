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
  maxChain: 2,
  writeTools: ['write', 'edit'],
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
  const ctx = {
    listeners,
    registered,
    tools: { register: (d) => { registered.push(d); return () => {} } },
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
  assert.equal(ctx.effectDisposers.length, 6, 'five listeners + one tool registration yielded as disposers')
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
})
