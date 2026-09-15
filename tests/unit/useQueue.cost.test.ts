import { describe, expect, it } from 'vitest'
import { computed, nextTick, ref, watch } from 'vue'
import { useQueue } from '../../app/composables/useQueue'

// 007 · US5 (T037 / G-PRICING, FR-018/FR-019): useQueue derives a `queueCost` aggregate —
// a per-item estimate map (keyed by clientId, from item.text + item.model), a `totalUsd`
// that sums ONLY estimable amounts (any unavailable/unknown-model item is never counted as
// $0), and an `unavailableCount`. All three real models are now estimable (gpt-4o-mini-tts
// via its audio-duration model). Display-only; it never affects the queue or generation.
//
// useQueue relies on Nuxt auto-imports (ref/computed); shim them onto globalThis, node env.
const g = globalThis as unknown as Record<string, unknown>
g.ref = ref
g.computed = computed
g.watch = watch

describe('useQueue queueCost (US5)', () => {
  it('maps a per-item estimate by clientId from text length and the row model', () => {
    const q = useQueue()
    q.model.value = 'tts-1'
    const a = q.addItem('hello')! // 5 chars
    const cost = q.queueCost.value
    expect(cost.perItem.get(a.clientId)).toEqual({ amountUsd: (5 / 1_000_000) * 15 })
  })

  it('sums every estimable model into totalUsd, including gpt-4o-mini-tts', () => {
    // The form model is now a live batch setting (it re-tags every queued row on change), so
    // heterogeneous per-row models come from the per-row path (updateItem / a loaded queue),
    // not from changing the form between adds.
    const q = useQueue()
    const a = q.addItem('aaaa')! // 4 chars → tts-1
    const b = q.addItem('bbbb')! // 1 word → gpt-4o-mini-tts (audio-duration estimate)
    const c = q.addItem('cc')! // 2 chars → tts-1-hd
    q.updateItem(a.clientId, { model: 'tts-1' })
    q.updateItem(b.clientId, { model: 'gpt-4o-mini-tts' })
    q.updateItem(c.clientId, { model: 'tts-1-hd' })

    // gpt-4o-mini-tts 'bbbb': 1 word → 1/150 min audio + ⌈4/4⌉=1 text token
    const gptCost = (1 / 150) * 0.015 + (1 / 1_000_000) * 0.6
    const cost = q.queueCost.value
    expect(cost.unavailableCount).toBe(0)
    expect(cost.totalUsd).toBeCloseTo((4 / 1_000_000) * 15 + gptCost + (2 / 1_000_000) * 30, 12)
  })

  it('re-prices every queued row live when the form model changes (batch settings)', async () => {
    // Regression: changing Voice/Model/Format on the form must rewrite the already-queued
    // rows so the per-item + total cost recalculates immediately, not only for future rows.
    // The write-through runs in a watcher (default flush), so await a tick — the same point
    // the real UI updates the row before re-render.
    const q = useQueue()
    q.model.value = 'tts-1'
    const a = q.addItem('hello')! // 5 chars
    expect(q.queueCost.value.perItem.get(a.clientId)).toEqual({ amountUsd: (5 / 1_000_000) * 15 })

    q.model.value = 'tts-1-hd'
    await nextTick()
    expect(a.model).toBe('tts-1-hd')
    expect(q.queueCost.value.perItem.get(a.clientId)).toEqual({ amountUsd: (5 / 1_000_000) * 30 })
    expect(q.queueCost.value.totalUsd).toBeCloseTo((5 / 1_000_000) * 30, 12)
  })

  it('gives gpt-4o-mini-tts a positive per-item estimate (no longer unavailable)', () => {
    const q = useQueue()
    q.model.value = 'gpt-4o-mini-tts'
    q.addItem('hello world')
    const cost = q.queueCost.value
    const est = cost.perItem.get(q.items.value[0]!.clientId)
    expect(est).not.toBe('unavailable')
    expect((est as { amountUsd: number }).amountUsd).toBeGreaterThan(0)
    expect(cost.totalUsd).toBeGreaterThan(0)
    expect(cost.unavailableCount).toBe(0)
  })

  it('is empty for an empty queue', () => {
    const q = useQueue()
    const cost = q.queueCost.value
    expect(cost.perItem.size).toBe(0)
    expect(cost.totalUsd).toBe(0)
    expect(cost.unavailableCount).toBe(0)
  })

  it('includes gateway-priced custom models in totalUsd and counts unpriced ones as unavailable', async () => {
    const rates = {
      'elevenlabs/eleven_multilingual_v2': { inputCostPerCharacter: 0.00003 },
    }
    const q = useQueue({ gatewayRates: () => rates })
    const priced = q.addItem('abcd')!
    const unpriced = q.addItem('xyz')!
    q.updateItem(priced.clientId, { model: 'elevenlabs/eleven_multilingual_v2' })
    q.updateItem(unpriced.clientId, { model: 'unknown-custom' })
    await nextTick()

    expect(q.queueCost.value.perItem.get(priced.clientId)).toEqual({ amountUsd: 4 * 0.00003 })
    expect(q.queueCost.value.perItem.get(unpriced.clientId)).toBe('unavailable')
    expect(q.queueCost.value.unavailableCount).toBe(1)
    expect(q.queueCost.value.totalUsd).toBeCloseTo(4 * 0.00003, 12)
  })
})
