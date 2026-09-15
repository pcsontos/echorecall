import { describe, it, expect } from 'vitest'
import { generateSpeech, MAX_INPUT_LENGTH, normalizeSpeed } from '../../src/core/tts/generate'
import {
  EmptyInputError,
  InputTooLongError,
  InvalidFormatError,
  InvalidModelError,
  InvalidVoiceError,
  ProviderUnavailableError,
} from '../../src/core/shared/errors'
import type { TtsProvider } from '../../src/core/tts/provider'

const okProvider: TtsProvider = { synthesize: async () => Buffer.from('mp3-bytes') }

/** Records the last input the provider was asked to synthesize. */
function recordingProvider() {
  const calls: Parameters<TtsProvider['synthesize']>[0][] = []
  const provider: TtsProvider = {
    synthesize: async (input) => {
      calls.push(input)
      return Buffer.from('mp3-bytes')
    },
  }
  return { provider, calls }
}

describe('generateSpeech', () => {
  it('returns MP3 bytes for valid input', async () => {
    const bytes = await generateSpeech(okProvider, { text: 'hello', voiceId: 'alloy' })
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('rejects empty / whitespace input WITHOUT calling the provider', async () => {
    let called = false
    const spy: TtsProvider = {
      synthesize: async () => {
        called = true
        return Buffer.from('x')
      },
    }
    await expect(generateSpeech(spy, { text: '   ', voiceId: 'alloy' })).rejects.toBeInstanceOf(
      EmptyInputError,
    )
    expect(called).toBe(false)
  })

  it('rejects input over the max length', async () => {
    const long = 'a'.repeat(MAX_INPUT_LENGTH + 1)
    await expect(generateSpeech(okProvider, { text: long, voiceId: 'alloy' })).rejects.toBeInstanceOf(
      InputTooLongError,
    )
  })

  it('accepts input exactly at the max length', async () => {
    const exact = 'a'.repeat(MAX_INPUT_LENGTH)
    await expect(generateSpeech(okProvider, { text: exact, voiceId: 'alloy' })).resolves.toBeTruthy()
  })

  it('accepts a custom identifier voice and forwards it to the provider', async () => {
    const { provider, calls } = recordingProvider()
    await generateSpeech(provider, { text: 'hi', voiceId: 'bogus' })
    expect(calls[0]).toMatchObject({ voiceId: 'bogus' })
  })

  it('rejects an empty, illegal, or overlong voice WITHOUT calling the provider', async () => {
    const { provider, calls } = recordingProvider()
    await expect(generateSpeech(provider, { text: 'hi', voiceId: '' })).rejects.toBeInstanceOf(
      InvalidVoiceError,
    )
    await expect(generateSpeech(provider, { text: 'hi', voiceId: '@@@' })).rejects.toBeInstanceOf(
      InvalidVoiceError,
    )
    await expect(
      generateSpeech(provider, { text: 'hi', voiceId: 'a'.repeat(129) }),
    ).rejects.toBeInstanceOf(InvalidVoiceError)
    expect(calls).toHaveLength(0)
  })

  it('maps provider failures to ProviderUnavailableError', async () => {
    const failProvider: TtsProvider = {
      synthesize: async () => {
        throw new Error('network down')
      },
    }
    await expect(
      generateSpeech(failProvider, { text: 'hi', voiceId: 'alloy' }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('accepts a custom identifier model and forwards it to the provider', async () => {
    const { provider, calls } = recordingProvider()
    await generateSpeech(provider, { text: 'hi', voiceId: 'alloy', model: 'gpt-9000' })
    expect(calls[0]).toMatchObject({ model: 'gpt-9000' })
  })

  it('accepts prefixed gateway voice and model identifiers', async () => {
    const { provider, calls } = recordingProvider()
    await generateSpeech(provider, {
      text: 'hi',
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
    })
    expect(calls[0]).toMatchObject({
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
    })
  })

  it('rejects an empty or overlong model WITHOUT calling the provider', async () => {
    const { provider, calls } = recordingProvider()
    await expect(
      generateSpeech(provider, { text: 'hi', voiceId: 'alloy', model: '' }),
    ).rejects.toBeInstanceOf(InvalidModelError)
    await expect(
      generateSpeech(provider, { text: 'hi', voiceId: 'alloy', model: 'a'.repeat(129) }),
    ).rejects.toBeInstanceOf(InvalidModelError)
    expect(calls).toHaveLength(0)
  })

  it('rejects an unknown format WITHOUT calling the provider', async () => {
    const { provider, calls } = recordingProvider()
    await expect(
      generateSpeech(provider, { text: 'hi', voiceId: 'alloy', format: 'm4b' }),
    ).rejects.toBeInstanceOf(InvalidFormatError)
    expect(calls).toHaveLength(0)
  })

  it('accepts a valid model + format and forwards them to the provider', async () => {
    const { provider, calls } = recordingProvider()
    await generateSpeech(provider, {
      text: 'hi',
      voiceId: 'alloy',
      model: 'tts-1-hd',
      format: 'flac',
      speed: 1.5,
    })
    expect(calls[0]).toMatchObject({ model: 'tts-1-hd', format: 'flac', speed: 1.5 })
  })

  it('forwards the normalized (clamped) speed, not the raw request value', async () => {
    const over = recordingProvider()
    await generateSpeech(over.provider, { text: 'hi', voiceId: 'alloy', model: 'tts-1', speed: 99 })
    expect(over.calls[0]!.speed).toBe(4)

    const under = recordingProvider()
    await generateSpeech(under.provider, { text: 'hi', voiceId: 'alloy', model: 'tts-1', speed: 0.1 })
    expect(under.calls[0]!.speed).toBe(0.25)
  })

  it('forwards instructions only for gpt-4o-mini-tts', async () => {
    const mini = recordingProvider()
    await generateSpeech(mini.provider, {
      text: 'hi',
      voiceId: 'alloy',
      model: 'gpt-4o-mini-tts',
      instructions: 'Speak slowly',
    })
    expect(mini.calls[0]!.instructions).toBe('Speak slowly')

    const plain = recordingProvider()
    await generateSpeech(plain.provider, {
      text: 'hi',
      voiceId: 'alloy',
      model: 'tts-1',
      instructions: 'Speak slowly',
    })
    expect(plain.calls[0]!.instructions).toBeUndefined()
  })
})

describe('normalizeSpeed', () => {
  it('clamps to [0.25, 4.0] and defaults to 1.0 when unset/invalid', () => {
    expect(normalizeSpeed(1.5)).toBe(1.5)
    expect(normalizeSpeed(99)).toBe(4)
    expect(normalizeSpeed(0.1)).toBe(0.25)
    expect(normalizeSpeed(undefined)).toBe(1)
    expect(normalizeSpeed(Number.NaN)).toBe(1)
  })
})
