import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import { useQueue } from '../../app/composables/useQueue'
import { useGeneration } from '../../app/composables/useGeneration'

// 007 · US4 (T031 / FR-015/FR-016/FR-017): generation-run progress + graceful cancel.
// generateAll now tracks reactive `progress` (current file, per-item succeeded/failed,
// not-generated) and honours a `cancelRequested` flag checked BETWEEN items — the
// in-flight file finishes, then the loop breaks before the next (no AbortController).
// A per-item failure is recorded and skipped; the run continues (FR-015).
//
// Like the sibling generate-remove-on-success test, this wires the real composables
// together in node, shimming the Vue reactivity globals and stubbing $fetch — no Nuxt
// runtime, no network.

const g = globalThis as unknown as Record<string, unknown>
g.ref = ref
g.computed = computed
g.watch = watch

// The mock invokes this for each generated item's text, letting a test trigger a cancel
// while a specific item is in flight (simulating the user confirming cancel mid-run).
let onGenerating: ((text: string) => void) | null = null

beforeEach(() => {
  onGenerating = null
  g.$fetch = vi.fn(async (url: string, opts: { body: { text?: string } }) => {
    if (url === '/api/generations') {
      const text = opts.body.text ?? ''
      onGenerating?.(text)
      if (text === 'boom') throw { data: { error: { message: 'boom failed' } } }
      return { id: `id-${text}`, audioUrl: `/api/generations/id-${text}/audio` }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
})

describe('generation progress — full run (US4)', () => {
  it('reports a completed run with per-item results', async () => {
    const q = useQueue()
    q.addItem('a')
    q.addItem('b')
    q.addItem('c')
    const gen = useGeneration()

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    const p = gen.progress.value
    expect(p.state).toBe('completed')
    expect(p.total).toBe(3)
    expect(p.succeeded).toEqual(['id-a', 'id-b', 'id-c'])
    expect(p.failed).toEqual([])
    expect(p.notGenerated).toEqual([])
    expect(p.current).toBeNull()
  })

  it('records a failure and continues the run (isolated failure, FR-015)', async () => {
    const q = useQueue()
    q.addItem('a')
    const boom = q.addItem('boom')!
    q.addItem('c')
    const gen = useGeneration()

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    const p = gen.progress.value
    expect(p.state).toBe('completed')
    expect(p.succeeded).toEqual(['id-a', 'id-c'])
    expect(p.failed).toEqual([{
      clientId: boom.clientId,
      label: 'boom',
      error: 'boom failed',
    }])
    expect(p.notGenerated).toEqual([])
  })

  it('keeps prior successes and continues after a later per-item HTTP error (009 · US3)', async () => {
    g.$fetch = vi.fn(async (url: string, opts: { body: { text?: string } }) => {
      if (url !== '/api/generations') throw new Error(`unexpected fetch: ${url}`)
      const text = opts.body.text ?? ''
      if (text === 'failover') return { id: 'id-failover', audioUrl: '/api/generations/id-failover/audio' }
      if (text === 'dead') throw { data: { error: { message: 'gateway 502' } } }
      return { id: `id-${text}`, audioUrl: `/api/generations/id-${text}/audio` }
    })

    const q = useQueue()
    q.addItem('failover')
    const dead = q.addItem('dead')!
    q.addItem('later')
    const gen = useGeneration()

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    const p = gen.progress.value
    expect(p.state).toBe('completed')
    expect(p.succeeded).toEqual(['id-failover', 'id-later'])
    expect(p.failed).toEqual([{
      clientId: dead.clientId,
      label: 'dead',
      error: 'gateway 502',
    }])
    expect(p.notGenerated).toEqual([])
    expect(q.items.value.map((item) => item.text)).toEqual(['dead'])
    expect(gen.lastBatchIds.value).toEqual(['id-failover', 'id-later'])
  })
})

describe('generation progress — confirm-then-stop (US4 / FR-016/FR-017)', () => {
  it('finishes the in-flight item then breaks before the next; remaining reported not-generated', async () => {
    const q = useQueue()
    q.addItem('a')
    q.addItem('b')
    const c = q.addItem('c')!
    const gen = useGeneration()

    // Simulate the user confirming cancel while item b is being generated.
    onGenerating = (text) => {
      if (text === 'b') gen.requestCancel()
    }

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    const p = gen.progress.value
    expect(p.state).toBe('cancelled')
    // a and b were generated (b was in flight when cancel was requested, and finished);
    // c was never started and is reported not-generated.
    expect(p.succeeded).toEqual(['id-a', 'id-b'])
    expect(p.failed).toEqual([])
    expect(p.notGenerated.map((i) => i.clientId)).toEqual([c.clientId])
    expect(p.current).toBeNull()
    // The two successes left the queue; the not-generated row remains for retry.
    expect(q.items.value.map((i) => i.clientId)).toEqual([c.clientId])
  })

  it('reports an unprocessed failed retry as not-generated after cancellation', async () => {
    const q = useQueue()
    q.addItem('a')
    q.addItem('b')
    const retry = q.addItem('retry')!
    retry.status = 'failed'
    retry.error = 'failed on an earlier run'
    const gen = useGeneration()

    onGenerating = (text) => {
      if (text === 'b') gen.requestCancel()
    }

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    expect(gen.progress.value.state).toBe('cancelled')
    expect(gen.progress.value.notGenerated.map((item) => item.clientId)).toEqual([retry.clientId])
    expect(q.items.value.map((item) => item.clientId)).toEqual([retry.clientId])
  })

  it('does not cancel when the flag is never set (normal completion)', async () => {
    const q = useQueue()
    q.addItem('a')
    q.addItem('b')
    const gen = useGeneration()

    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)

    expect(gen.progress.value.state).toBe('completed')
    expect(gen.progress.value.notGenerated).toEqual([])
  })

  it('reset() returns progress to idle and clears a pending cancel between runs', async () => {
    const gen = useGeneration()
    gen.requestCancel()
    gen.reset()
    expect(gen.progress.value.state).toBe('idle')

    const q = useQueue()
    q.addItem('a')
    await gen.generateAll(q.generateTarget.value, q.speed.value, q.removeItem)
    // The stale cancel request must not leak into the fresh run.
    expect(gen.progress.value.state).toBe('completed')
  })
})
