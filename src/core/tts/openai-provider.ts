import OpenAI from 'openai'
import type { SpeechCreateParams } from 'openai/resources/audio/speech'
import type { Format, Model } from '../shared/types'
import { INSTRUCTIONS_MODEL } from './provider'
import type { TtsProvider } from './provider'

export interface OpenAiTtsConfig {
  apiKey: string
  /** Optional OpenAI-compatible gateway. Omitted → public OpenAI default. */
  baseURL?: string
}

/**
 * OpenAI TTS adapter — the only place the OpenAI network call lives. Constructed
 * per request from the resolved API key and optional base URL (UI → env
 * precedence is applied by the caller). The model/format/speed/instructions all
 * come from the validated request, so this adapter just maps them onto the SDK.
 */
export class OpenAiTtsProvider implements TtsProvider {
  private readonly client: OpenAI

  constructor(config: OpenAiTtsConfig) {
    this.client = new OpenAI(
      config.baseURL
        ? { apiKey: config.apiKey, baseURL: config.baseURL }
        : { apiKey: config.apiKey },
    )
  }

  async synthesize(input: {
    text: string
    voiceId: string
    model: Model
    format: Format
    speed: number
    instructions?: string
  }): Promise<Buffer> {
    const params: SpeechCreateParams = {
      model: input.model,
      // voiceId is validated against our catalog (which mirrors OpenAI's voices)
      // before this adapter is reached; cast to the SDK's narrower union.
      voice: input.voiceId as SpeechCreateParams['voice'],
      input: input.text,
      response_format: input.format,
    }
    // `instructions` is honoured only by gpt-4o-mini-tts (FR-013); `speed` is
    // honoured by tts-1 / tts-1-hd (gpt-4o-mini-tts steers pace via instructions
    // instead), so we only send each where it applies.
    if (input.model === INSTRUCTIONS_MODEL) {
      if (input.instructions) params.instructions = input.instructions
    } else if (input.speed !== 1) {
      params.speed = input.speed
    }
    const response = await this.client.audio.speech.create(params)
    return Buffer.from(await response.arrayBuffer())
  }
}
