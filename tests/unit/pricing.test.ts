import { describe, it, expect } from 'vitest'
import { estimateItemCost, MODEL_PRICING } from '../../src/core/tts/pricing'

// 007 · US5 (T036 / G-PRICING, FR-018/FR-019): pure per-item cost estimate. Character-
// priced models (`tts-1`, `tts-1-hd`) cost by input length. The token-priced
// `gpt-4o-mini-tts` is estimated from an audio-duration model — words ÷ words-per-minute ×
// $/audio-minute — plus a small text-token cost (⌈chars/tokenChars⌉ × $/1M tokens). The
// estimate takes the item text (word count needs the words, not just a length); empty text
// costs $0 for every model. Dependency-free — asserted directly, no repo/network.

describe('MODEL_PRICING', () => {
  it('prices the two character-priced models by $/1M characters', () => {
    expect(MODEL_PRICING['tts-1']).toEqual({ usdPerMillionChars: 15 })
    expect(MODEL_PRICING['tts-1-hd']).toEqual({ usdPerMillionChars: 30 })
  })

  it('prices gpt-4o-mini-tts by audio duration + text tokens', () => {
    expect(MODEL_PRICING['gpt-4o-mini-tts']).toEqual({
      usdPerAudioMinute: 0.015,
      usdPerMillionTextTokens: 0.6,
      wordsPerMinute: 150,
      charsPerToken: 4,
    })
  })
})

describe('estimateItemCost', () => {
  it('prices tts-1 at $15 per 1,000,000 characters of input text', () => {
    expect(estimateItemCost('tts-1', 'x'.repeat(1_000_000))).toEqual({ amountUsd: 15 })
    expect(estimateItemCost('tts-1', 'x'.repeat(500))).toEqual({ amountUsd: (500 / 1_000_000) * 15 })
  })

  it('prices tts-1-hd at $30 per 1,000,000 characters of input text', () => {
    expect(estimateItemCost('tts-1-hd', 'x'.repeat(1_000_000))).toEqual({ amountUsd: 30 })
    expect(estimateItemCost('tts-1-hd', 'x'.repeat(1200))).toEqual({ amountUsd: (1200 / 1_000_000) * 30 })
  })

  it('estimates gpt-4o-mini-tts from audio duration (words ÷ wpm × $/min) plus text tokens', () => {
    const text = Array(150).fill('word').join(' ') // 150 words → exactly 1 minute at 150 wpm
    const audioCost = (150 / 150) * 0.015
    const textCost = (Math.ceil(text.length / 4) / 1_000_000) * 0.6
    expect(estimateItemCost('gpt-4o-mini-tts', text)).toEqual({ amountUsd: audioCost + textCost })
  })

  it('counts only real words for gpt-4o-mini-tts (collapses padding, no empty tokens)', () => {
    const text = '  hello   world  ' // 2 words regardless of surrounding/inner padding
    const audioCost = (2 / 150) * 0.015
    const textCost = (Math.ceil(text.length / 4) / 1_000_000) * 0.6
    expect(estimateItemCost('gpt-4o-mini-tts', text)).toEqual({ amountUsd: audioCost + textCost })
  })

  it('costs $0 for empty text on every model (never unavailable, never NaN)', () => {
    expect(estimateItemCost('tts-1', '')).toEqual({ amountUsd: 0 })
    expect(estimateItemCost('tts-1-hd', '')).toEqual({ amountUsd: 0 })
    expect(estimateItemCost('gpt-4o-mini-tts', '')).toEqual({ amountUsd: 0 })
  })

  it('uses the built-in OpenAI table even when a gateway rate exists for the same id', () => {
    expect(
      estimateItemCost('tts-1', 'x'.repeat(1_000_000), {
        'tts-1': { inputCostPerCharacter: 9 },
      }),
    ).toEqual({ amountUsd: 15 })
  })

  it('uses a gateway character rate for a non-catalog model', () => {
    expect(
      estimateItemCost('elevenlabs/eleven_multilingual_v2', 'abcd', {
        'elevenlabs/eleven_multilingual_v2': { inputCostPerCharacter: 0.00003 },
      }),
    ).toEqual({ amountUsd: 4 * 0.00003 })
  })

  it('prefers inputCostPerCharacter, then outputCostPerCharacter', () => {
    expect(
      estimateItemCost('custom', 'ab', {
        custom: { inputCostPerCharacter: 0.1, outputCostPerCharacter: 0.9 },
      }),
    ).toEqual({ amountUsd: 0.2 })
    expect(
      estimateItemCost('custom', 'ab', {
        custom: { outputCostPerCharacter: 0.5 },
      }),
    ).toEqual({ amountUsd: 1 })
  })

  it('uses outputCostPerSecond at 150 WPM when no character rate is present', () => {
    const text = Array(150).fill('word').join(' ')
    expect(
      estimateItemCost('custom', text, {
        custom: { outputCostPerSecond: 0.001 },
      }),
    ).toEqual({ amountUsd: (150 / 150) * 60 * 0.001 })
  })

  it('ignores non-finite and negative gateway fields', () => {
    expect(
      estimateItemCost('custom', 'hello', {
        custom: {
          inputCostPerCharacter: Number.NaN,
          outputCostPerCharacter: Number.POSITIVE_INFINITY,
          outputCostPerSecond: -1,
        },
      }),
    ).toBe('unavailable')
  })

  it('returns unavailable for an unpriced unknown model — never $0.00', () => {
    expect(estimateItemCost('custom-model', 'hello')).toBe('unavailable')
    expect(estimateItemCost('custom-model', 'hello', {})).toBe('unavailable')
  })

  it('empty text is $0 on a priced gateway model and unavailable when unpriced', () => {
    expect(
      estimateItemCost('custom', '', { custom: { inputCostPerCharacter: 0.1 } }),
    ).toEqual({ amountUsd: 0 })
    expect(estimateItemCost('custom', '')).toBe('unavailable')
  })
})
