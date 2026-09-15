/** One selectable voice or model in the merged Generate catalog. */
export interface CatalogEntry {
  id: string
  label: string
  source: 'builtin' | 'gateway' | 'retained'
}

/** Gateway-reported pre-generation rate fields for a model id. */
export interface GatewayRate {
  inputCostPerCharacter?: number
  outputCostPerCharacter?: number
  outputCostPerSecond?: number
}

/** Why catalog discovery or Test Connection failed. */
export type ConnectionTestCode = 'NO_KEY' | 'UNREACHABLE' | 'UNAUTHORIZED' | 'TIMEOUT' | 'UNKNOWN'

/** Merged Generate catalog plus optional gateway rates and discovery error. */
export interface SpeechCatalog {
  voices: CatalogEntry[]
  models: CatalogEntry[]
  rates: Record<string, GatewayRate>
  catalogError?: ConnectionTestCode
}

/** Outcome of Settings Test Connection. Never includes the API key. */
export type ConnectionTestResult = { ok: true } | { ok: false; code: ConnectionTestCode }

const SPEECH_MODES = new Set(['audio_speech', 'audio'])

export interface MergeSpeechCatalogInput {
  builtinVoices: readonly { id: string; label: string }[]
  builtinModels: readonly string[]
  gatewayVoices?: readonly { id: string; label?: string }[]
  gatewayModels?: readonly { id: string; label?: string; mode?: string }[]
  retainedVoiceId?: string
  retainedModel?: string
  catalogError?: SpeechCatalog['catalogError']
}

function filterGatewayModels(
  models: readonly { id: string; label?: string; mode?: string }[],
): readonly { id: string; label?: string }[] {
  const anyMode = models.some((model) => model.mode)
  if (!anyMode) return models
  return models.filter((model) => model.mode !== undefined && SPEECH_MODES.has(model.mode))
}

function entry(id: string, label: string, source: CatalogEntry['source']): CatalogEntry {
  return { id, label, source }
}

/**
 * Pure Generate-catalog merge: built-in first, gateway-only append, case-sensitive
 * de-dupe (builtin wins), optional retained current/imported ids, speech-mode
 * filter, and catalogError fallback (builtin + retained only).
 */
export function mergeSpeechCatalog(
  input: MergeSpeechCatalogInput,
): Pick<SpeechCatalog, 'voices' | 'models' | 'catalogError'> {
  const voices: CatalogEntry[] = input.builtinVoices.map((voice) =>
    entry(voice.id, voice.label, 'builtin'),
  )
  const models: CatalogEntry[] = input.builtinModels.map((id) => entry(id, id, 'builtin'))
  const voiceIds = new Set(voices.map((voice) => voice.id))
  const modelIds = new Set(models.map((model) => model.id))

  if (!input.catalogError) {
    for (const voice of input.gatewayVoices ?? []) {
      if (voiceIds.has(voice.id)) continue
      voices.push(entry(voice.id, voice.label ?? voice.id, 'gateway'))
      voiceIds.add(voice.id)
    }
    for (const model of filterGatewayModels(input.gatewayModels ?? [])) {
      if (modelIds.has(model.id)) continue
      models.push(entry(model.id, model.label ?? model.id, 'gateway'))
      modelIds.add(model.id)
    }
  }

  const retainedVoice = input.retainedVoiceId?.trim()
  if (retainedVoice && !voiceIds.has(retainedVoice)) {
    voices.push(entry(retainedVoice, retainedVoice, 'retained'))
  }
  const retainedModel = input.retainedModel?.trim()
  if (retainedModel && !modelIds.has(retainedModel)) {
    models.push(entry(retainedModel, retainedModel, 'retained'))
  }

  return input.catalogError
    ? { voices, models, catalogError: input.catalogError }
    : { voices, models }
}
