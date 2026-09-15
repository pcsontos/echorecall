import type { Model } from '../shared/types'
import type { GatewayRate } from './catalog'

// 007 · US5 (G-PRICING, FR-018/FR-019): pure, dependency-free per-item cost estimation.
// Character-priced models (`tts-1`, `tts-1-hd`) have a published $/1M-characters rate.
// The token-priced `gpt-4o-mini-tts` has no character rate, so it is estimated from an
// audio-duration model: words ÷ words-per-minute gives minutes, minutes × $/audio-minute
// gives the (dominant) audio cost, plus a small text-input-token cost. Approximate — the
// true cost depends on the generated audio's duration — but a usable pre-generation figure.
// Lives in the core so it is CLI-reachable and re-exported through the client subset.

/** Descriptor for a character-priced model: a flat USD rate per 1,000,000 input characters. */
type CharPricing = { usdPerMillionChars: number }

/**
 * Descriptor for the token-priced `gpt-4o-mini-tts`, estimated by generated-audio duration.
 * Audio dominates; the text-input tokens are a minor add-on. Rates from OpenAI's pricing
 * table (audio ≈ $0.015 per generated minute; text input $0.60 / 1M tokens).
 */
type DurationPricing = {
  usdPerAudioMinute: number
  usdPerMillionTextTokens: number
  wordsPerMinute: number
  charsPerToken: number
}

/**
 * Per-model pricing. Character-priced models carry `usdPerMillionChars`; the token-priced
 * model carries a duration descriptor. Approximate published TTS rates.
 */
export const MODEL_PRICING: Readonly<Record<Model, CharPricing | DurationPricing>> = {
  'tts-1': { usdPerMillionChars: 15 },
  'tts-1-hd': { usdPerMillionChars: 30 },
  'gpt-4o-mini-tts': {
    usdPerAudioMinute: 0.015,
    usdPerMillionTextTokens: 0.6,
    wordsPerMinute: 150,
    charsPerToken: 4,
  },
}

/** A per-item estimate: a dollar amount, or `'unavailable'` for an unpriced (unknown) model. */
export type CostEstimate = { amountUsd: number } | 'unavailable'

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Estimate one item's cost from its model and input `text`. Built-in OpenAI table
 * wins; otherwise a gateway character or per-second rate; otherwise `'unavailable'`
 * — never `$0.00` for an unpriced non-empty unknown model.
 */
export function estimateItemCost(
  model: Model,
  text: string,
  gatewayRates?: Readonly<Record<string, GatewayRate>>,
): CostEstimate {
  const pricing = MODEL_PRICING[model]
  if (pricing) {
    if ('usdPerMillionChars' in pricing) {
      return { amountUsd: (text.length / 1_000_000) * pricing.usdPerMillionChars }
    }
    const words = wordCount(text)
    const audioCost = (words / pricing.wordsPerMinute) * pricing.usdPerAudioMinute
    const textTokens = Math.ceil(text.length / pricing.charsPerToken)
    const textCost = (textTokens / 1_000_000) * pricing.usdPerMillionTextTokens
    return { amountUsd: audioCost + textCost }
  }

  const rate = gatewayRates?.[model]
  const perCharacter =
    finiteNonNegative(rate?.inputCostPerCharacter) ?? finiteNonNegative(rate?.outputCostPerCharacter)
  if (perCharacter !== undefined) {
    return { amountUsd: text.length * perCharacter }
  }
  const perSecond = finiteNonNegative(rate?.outputCostPerSecond)
  if (perSecond !== undefined) {
    return { amountUsd: (wordCount(text) / 150) * 60 * perSecond }
  }
  return 'unavailable'
}

/**
 * Gateway-reported input cost per character for a model id, when present and
 * finite. Does not fall back to output or per-second rates (those stay in
 * estimateItemCost). Used as the Generate Model-row rate label.
 */
export function inputCostPerCharacter(
  model: string,
  gatewayRates?: Readonly<Record<string, GatewayRate>>,
): number | undefined {
  return finiteNonNegative(gatewayRates?.[model]?.inputCostPerCharacter)
}
