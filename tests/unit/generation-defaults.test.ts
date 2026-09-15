import { describe, it, expect } from 'vitest'
import {
  getGenerationDefaults,
  setGenerationDefaults,
  clearGenerationDefaults,
  GENERATION_DEFAULTS_CONFIG_KEY,
  type GenerationDefaultsInput,
} from '../../src/core/settings/generation-defaults'
import type { AppConfigRepository } from '../../src/core/settings/app-config-repository'

// Pure unit coverage for the store-backed generation defaults (007 · US3 / G-DEFAULTS,
// FR-011/012/013). Non-secret: persisted as plain JSON in app_config alongside the
// default tags, no crypto/app secret. Sanitization drops unknown voice/model/format
// (validated against the shared catalogs) and an all-blank/all-invalid save clears the
// row. Reads are total — a corrupt row yields {}. Speed is not a configurable default.

/** Minimal in-memory AppConfigRepository for the generation-defaults tests. */
function fakeConfig(initial: Record<string, string> = {}): AppConfigRepository {
  const store = new Map(Object.entries(initial))
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
    },
    delete: (key) => store.delete(key),
  }
}

describe('getGenerationDefaults', () => {
  it('returns {} when no row is stored', () => {
    expect(getGenerationDefaults({ config: fakeConfig() })).toEqual({})
  })

  it('returns {} (never throws) for a corrupt/invalid JSON row', () => {
    const config = fakeConfig({ [GENERATION_DEFAULTS_CONFIG_KEY]: 'not-json{' })
    expect(getGenerationDefaults({ config })).toEqual({})
  })

  it('re-sanitizes a stored row, dropping illegal voice/model/format and stray fields', () => {
    const config = fakeConfig({
      [GENERATION_DEFAULTS_CONFIG_KEY]: JSON.stringify({
        voiceId: '@@@',
        model: 'tts-1',
        format: 'zzz',
        speed: 99,
        bogus: 'x',
      }),
    })
    // voiceId '@@@' is not an acceptable identifier and format 'zzz' is not in the
    // catalog → dropped; speed/bogus are not supported fields → dropped.
    expect(getGenerationDefaults({ config })).toEqual({ model: 'tts-1' })
  })

  it('keeps valid custom identifiers including prefixed gateway ids', () => {
    const config = fakeConfig({
      [GENERATION_DEFAULTS_CONFIG_KEY]: JSON.stringify({
        voiceId: 'azure/en-US-JennyNeural',
        model: 'elevenlabs/eleven_multilingual_v2',
        format: 'mp3',
      }),
    })
    expect(getGenerationDefaults({ config })).toEqual({
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
      format: 'mp3',
    })
  })
})

describe('setGenerationDefaults', () => {
  it('keeps known voice/model/format', () => {
    const config = fakeConfig()
    const saved = setGenerationDefaults({ config }, {
      voiceId: 'alloy',
      model: 'tts-1-hd',
      format: 'flac',
    })
    expect(saved).toEqual({ voiceId: 'alloy', model: 'tts-1-hd', format: 'flac' })
    expect(getGenerationDefaults({ config })).toEqual(saved)
  })

  it('drops illegal values (invalid identifiers, out-of-catalog format, unsupported speed)', () => {
    const config = fakeConfig()
    expect(
      setGenerationDefaults({ config }, {
        voiceId: 'bad id!',
        model: '@@@',
        format: 'zzz',
        speed: 2,
      } as unknown as GenerationDefaultsInput),
    ).toEqual({})
    expect(config.get(GENERATION_DEFAULTS_CONFIG_KEY)).toBeUndefined()
  })

  it('persists valid custom identifiers as generation defaults', () => {
    const config = fakeConfig()
    const saved = setGenerationDefaults({ config }, {
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
      format: 'flac',
    })
    expect(saved).toEqual({
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
      format: 'flac',
    })
    expect(getGenerationDefaults({ config })).toEqual(saved)
  })

  it('persists a single valid field on its own (format only)', () => {
    const config = fakeConfig()
    expect(setGenerationDefaults({ config }, { format: 'flac' })).toEqual({ format: 'flac' })
    expect(getGenerationDefaults({ config })).toEqual({ format: 'flac' })
  })

  it('deletes the row when the sanitized set is empty (save-all-blank ≡ clear)', () => {
    const config = fakeConfig()
    setGenerationDefaults({ config }, { voiceId: 'alloy' })
    expect(getGenerationDefaults({ config })).toEqual({ voiceId: 'alloy' })
    expect(setGenerationDefaults({ config }, {})).toEqual({})
    expect(config.get(GENERATION_DEFAULTS_CONFIG_KEY)).toBeUndefined()
  })

  it('round-trips a full set through get', () => {
    const config = fakeConfig()
    setGenerationDefaults({ config }, { voiceId: 'nova', model: 'gpt-4o-mini-tts', format: 'mp3' })
    expect(getGenerationDefaults({ config })).toEqual({
      voiceId: 'nova',
      model: 'gpt-4o-mini-tts',
      format: 'mp3',
    })
  })
})

describe('clearGenerationDefaults', () => {
  it('removes the row and is idempotent', () => {
    const config = fakeConfig()
    setGenerationDefaults({ config }, { voiceId: 'alloy' })
    expect(clearGenerationDefaults({ config })).toEqual({})
    expect(config.get(GENERATION_DEFAULTS_CONFIG_KEY)).toBeUndefined()
    expect(clearGenerationDefaults({ config })).toEqual({}) // idempotent
  })
})
