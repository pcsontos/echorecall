import {
  DomainError,
  EmptyInputError,
  InputTooLongError,
  InvalidFormatError,
  InvalidModelError,
  InvalidVoiceError,
  ProviderUnavailableError,
} from '../shared/errors'
import type { Format, Model } from '../shared/types'
import { isAcceptableModel, isAcceptableVoice } from './identifiers'
import {
  INSTRUCTIONS_MODEL,
  isKnownFormat,
  type TtsProvider,
} from './provider'

export const MAX_INPUT_LENGTH = 4096

const MIN_SPEED = 0.25
const MAX_SPEED = 4.0
const DEFAULT_SPEED = 1.0

/** User-supplied input for a new generation (model/format/speed/instructions optional). */
export interface GenerationInput {
  text: string
  voiceId: string
  model?: string
  format?: string
  speed?: number
  instructions?: string
}

/**
 * Validate input and synthesize speech. Validation (empty/length, voice, model,
 * format) runs before the provider is contacted, so invalid requests never hit
 * the network. `model`/`format` default to `gpt-4o-mini-tts`/`mp3` when omitted;
 * `speed` is clamped to [0.25, 4.0]; `instructions` is forwarded only for
 * `gpt-4o-mini-tts` (FR-013).
 *
 * @returns audio bytes in the requested format.
 */
export async function generateSpeech(
  provider: TtsProvider,
  input: GenerationInput,
): Promise<Buffer> {
  const text = (input.text ?? '').trim()
  if (text.length === 0) throw new EmptyInputError()
  if (text.length > MAX_INPUT_LENGTH) throw new InputTooLongError(MAX_INPUT_LENGTH)
  const voiceId = (input.voiceId ?? '').trim()
  if (!isAcceptableVoice(voiceId)) throw new InvalidVoiceError(input.voiceId)

  const model = ((input.model ?? INSTRUCTIONS_MODEL).trim() || '') as Model
  if (!isAcceptableModel(model)) throw new InvalidModelError(input.model ?? '')

  const format = (input.format ?? 'mp3') as Format
  if (!isKnownFormat(format)) throw new InvalidFormatError(input.format ?? '')

  const speed = normalizeSpeed(input.speed)
  const instructions = model === INSTRUCTIONS_MODEL ? input.instructions : undefined

  try {
    // Single provider call — no EchoRecall retry/failover loop (gateway-owned).
    return await provider.synthesize({ text, voiceId, model, format, speed, instructions })
  } catch (err) {
    if (err instanceof DomainError) throw err
    throw new ProviderUnavailableError(err instanceof Error ? err.message : undefined)
  }
}

/**
 * Resolve a requested speed to the value actually used for synthesis: clamped to
 * [0.25, 4.0], defaulting to 1.0 when unset/invalid. Shared so the persisted
 * `speed` matches what was synthesized (no impossible values like 99 in the
 * library) — see `server/api/generations.post.ts`.
 */
export function normalizeSpeed(speed?: number): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return DEFAULT_SPEED
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}
