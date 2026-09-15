import { describe, expect, it } from 'vitest'
import {
  mergeSpeechCatalog,
  firstModelIdForProvider,
  listModelProviders,
  modelsForProvider,
} from '../../src/core/tts/catalog'

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
      { id: 'tts-1', label: 'tts-1', source: 'builtin', provider: 'openai' },
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin', provider: 'openai' },
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

  it('tags builtin models as openai and copies gateway provider', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      gatewayModels: [
        { id: 'elevenlabs/eleven_multilingual_v2', provider: 'elevenlabs' },
        { id: 'mystery-tts' },
      ],
    })
    expect(catalog.models).toEqual([
      { id: 'tts-1', label: 'tts-1', source: 'builtin', provider: 'openai' },
      { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin', provider: 'openai' },
      {
        id: 'elevenlabs/eleven_multilingual_v2',
        label: 'elevenlabs/eleven_multilingual_v2',
        source: 'gateway',
        provider: 'elevenlabs',
      },
      { id: 'mystery-tts', label: 'mystery-tts', source: 'gateway' },
    ])
  })

  it('does not invent a provider for retained-only models', () => {
    const catalog = mergeSpeechCatalog({
      builtinVoices,
      builtinModels,
      retainedModel: 'imported-model',
    })
    expect(catalog.models.at(-1)).toEqual({
      id: 'imported-model',
      label: 'imported-model',
      source: 'retained',
    })
  })
})

describe('listModelProviders / modelsForProvider', () => {
  const models = [
    { id: 'tts-1', label: 'tts-1', source: 'builtin' as const, provider: 'openai' },
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin' as const, provider: 'openai' },
    {
      id: 'elevenlabs/eleven_multilingual_v2',
      label: 'elevenlabs/eleven_multilingual_v2',
      source: 'gateway' as const,
      provider: 'elevenlabs',
    },
    { id: 'mystery-tts', label: 'mystery-tts', source: 'gateway' as const },
    { id: 'azure/speech', label: 'azure/speech', source: 'gateway' as const, provider: 'azure' },
  ]

  it('lists openai first, other providers in catalog order, other last', () => {
    expect(listModelProviders(models)).toEqual(['openai', 'elevenlabs', 'azure', 'other'])
  })

  it('filters models by provider and treats missing provider as other', () => {
    expect(modelsForProvider(models, 'openai').map((entry) => entry.id)).toEqual([
      'tts-1',
      'gpt-4o-mini-tts',
    ])
    expect(modelsForProvider(models, 'elevenlabs').map((entry) => entry.id)).toEqual([
      'elevenlabs/eleven_multilingual_v2',
    ])
    expect(modelsForProvider(models, 'other').map((entry) => entry.id)).toEqual(['mystery-tts'])
  })

  it('returns the first model id for a provider', () => {
    expect(firstModelIdForProvider(models, 'elevenlabs')).toBe('elevenlabs/eleven_multilingual_v2')
    expect(firstModelIdForProvider(models, 'missing')).toBeUndefined()
  })
})
