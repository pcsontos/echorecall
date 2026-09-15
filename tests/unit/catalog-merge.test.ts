import { describe, expect, it } from 'vitest'
import { mergeSpeechCatalog } from '../../src/core/tts/catalog'

// 009 · US2: Generate Voice/Model lists are the union of the built-in catalog and
// the gateway catalog. Pure merge — no network. Builtin first, gateway-only
// append, case-sensitive de-dupe (builtin wins), retained current/imported ids,
// mode filter, and catalogError fallback to builtin + retained.

const builtinVoices = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'nova', label: 'Nova' },
] as const

const builtinModels = ['tts-1', 'gpt-4o-mini-tts'] as const

describe('mergeSpeechCatalog', () => {
  it('starts with built-in voices and models (source builtin)', () => {
    const catalog = mergeSpeechCatalog({ builtinVoices, builtinModels })
    expect(catalog.voices).toEqual([
      { id: 'alloy', label: 'Alloy', source: 'builtin' },
      { id: 'nova', label: 'Nova', source: 'builtin' },
    ])
    expect(catalog.models).toEqual([
      { id: 'tts-1', label: 'tts-1', source: 'builtin' },
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin' },
    ])
    expect(catalog.catalogError).toBeUndefined()
  })

  it('appends gateway-only ids after builtins', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayVoices: [{ id: '21m00Tcm4TlvDq8ikWAM' }],
      gatewayModels: [{ id: 'elevenlabs/eleven_multilingual_v2' }],
    })
    expect(catalog.voices.map((entry) => entry.id)).toEqual([
      'alloy',
      'nova',
      '21m00Tcm4TlvDq8ikWAM',
    ])
    expect(catalog.voices.at(-1)).toEqual({
      id: '21m00Tcm4TlvDq8ikWAM',
      label: '21m00Tcm4TlvDq8ikWAM',
      source: 'gateway',
    })
    expect(catalog.models.map((entry) => entry.id)).toEqual([
      'tts-1',
      'gpt-4o-mini-tts',
      'elevenlabs/eleven_multilingual_v2',
    ])
    expect(catalog.models.at(-1)?.source).toBe('gateway')
  })

  it('de-duplicates gateway ids case-sensitively, keeping the builtin entry', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayVoices: [{ id: 'alloy', label: 'Gateway Alloy' }, { id: 'Alloy' }],
      gatewayModels: [{ id: 'tts-1' }, { id: 'TTS-1' }],
    })
    expect(catalog.voices).toEqual([
      { id: 'alloy', label: 'Alloy', source: 'builtin' },
      { id: 'nova', label: 'Nova', source: 'builtin' },
      { id: 'Alloy', label: 'Alloy', source: 'gateway' },
    ])
    expect(catalog.models.map((entry) => [entry.id, entry.source])).toEqual([
      ['tts-1', 'builtin'],
      ['gpt-4o-mini-tts', 'builtin'],
      ['TTS-1', 'gateway'],
    ])
  })

  it('appends retained current/imported ids that are still missing', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayModels: [{ id: 'elevenlabs/eleven_multilingual_v2' }],
      retainedVoiceId: 'azure/en-US-JennyNeural',
      retainedModel: 'imported-model',
    })
    expect(catalog.voices.at(-1)).toEqual({
      id: 'azure/en-US-JennyNeural',
      label: 'azure/en-US-JennyNeural',
      source: 'retained',
    })
    expect(catalog.models.at(-1)).toEqual({
      id: 'imported-model',
      label: 'imported-model',
      source: 'retained',
    })
  })

  it('does not retain an id already present from builtin or gateway', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayModels: [{ id: 'elevenlabs/eleven_multilingual_v2' }],
      retainedVoiceId: 'alloy',
      retainedModel: 'elevenlabs/eleven_multilingual_v2',
    })
    expect(catalog.voices.filter((entry) => entry.id === 'alloy')).toHaveLength(1)
    expect(catalog.voices[0]?.source).toBe('builtin')
    expect(catalog.models.filter((entry) => entry.id === 'elevenlabs/eleven_multilingual_v2')).toHaveLength(1)
    expect(catalog.models.find((entry) => entry.id === 'elevenlabs/eleven_multilingual_v2')?.source).toBe(
      'gateway',
    )
  })

  it('keeps audio_speech and audio models when any advertised model has a mode', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayModels: [
        { id: 'gpt-4o', mode: 'chat' },
        { id: 'elevenlabs/eleven_multilingual_v2', mode: 'audio_speech' },
        { id: 'azure/speech', mode: 'audio' },
        { id: 'whisper', mode: 'audio_transcription' },
      ],
    })
    expect(catalog.models.map((entry) => entry.id)).toEqual([
      'tts-1',
      'gpt-4o-mini-tts',
      'elevenlabs/eleven_multilingual_v2',
      'azure/speech',
    ])
  })

  it('keeps every gateway model id when none advertise a mode', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayModels: [{ id: 'foo' }, { id: 'bar' }],
    })
    expect(catalog.models.map((entry) => entry.id)).toEqual([
      'tts-1',
      'gpt-4o-mini-tts',
      'foo',
      'bar',
    ])
  })

  it('on catalogError keeps builtin + retained and ignores gateway entries', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayVoices: [{ id: 'should-not-appear' }],
      gatewayModels: [{ id: 'should-not-appear' }],
      retainedVoiceId: 'imported-voice',
      retainedModel: 'imported-model',
      catalogError: 'UNREACHABLE',
    })
    expect(catalog.catalogError).toBe('UNREACHABLE')
    expect(catalog.voices.map((entry) => entry.id)).toEqual(['alloy', 'nova', 'imported-voice'])
    expect(catalog.models.map((entry) => entry.id)).toEqual([
      'tts-1',
      'gpt-4o-mini-tts',
      'imported-model',
    ])
    expect(catalog.voices.find((entry) => entry.id === 'imported-voice')?.source).toBe('retained')
  })
})
