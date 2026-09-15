import OpenAI from 'openai'
import { mapConnectionError } from '../settings/api-key'
import type { ConnectionTestCode, GatewayRate } from './catalog'

const DEFAULT_TIMEOUT_MS = 10_000

export interface SpeechGatewayModel {
  id: string
  label?: string
  mode?: string
}

export interface SpeechGatewayVoice {
  id: string
  label?: string
}

export interface SpeechGatewayClient {
  listModels(): Promise<SpeechGatewayModel[]>
  listVoices(): Promise<SpeechGatewayVoice[]>
  listRates(): Promise<Record<string, GatewayRate>>
}

export interface SpeechGatewayClientDeps {
  apiKey: string
  baseURL: string
  openai?: { models: { list: () => Promise<{ data: Array<{ id: string }> }> } }
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Typed catalog-discovery failure. Never includes the API key. */
export class GatewayDiscoveryError extends Error {
  readonly code: ConnectionTestCode

  constructor(code: ConnectionTestCode, message?: string) {
    super(message ?? code)
    this.name = 'GatewayDiscoveryError'
    this.code = code
  }
}

interface ModelInfoRow {
  model_name?: unknown
  model_info?: unknown
  voices?: unknown
}

interface ModelInfoPayload {
  data?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseInfoRows(payload: unknown): ModelInfoRow[] {
  const root = asRecord(payload)
  const data = root?.data
  if (!Array.isArray(data)) return []
  return data.filter((row): row is ModelInfoRow => asRecord(row) !== undefined)
}

function infoMode(row: ModelInfoRow): string | undefined {
  const info = asRecord(row.model_info)
  return typeof info?.mode === 'string' ? info.mode : undefined
}

function infoRates(row: ModelInfoRow): GatewayRate | undefined {
  const info = asRecord(row.model_info)
  if (!info) return undefined
  const rate: GatewayRate = {}
  const input = finiteNumber(info.input_cost_per_character)
  const output = finiteNumber(info.output_cost_per_character)
  const perSecond = finiteNumber(info.output_cost_per_second)
  if (input !== undefined) rate.inputCostPerCharacter = input
  if (output !== undefined) rate.outputCostPerCharacter = output
  if (perSecond !== undefined) rate.outputCostPerSecond = perSecond
  return Object.keys(rate).length > 0 ? rate : undefined
}

function infoVoices(row: ModelInfoRow): SpeechGatewayVoice[] {
  if (!Array.isArray(row.voices)) return []
  const voices: SpeechGatewayVoice[] = []
  for (const item of row.voices) {
    if (typeof item === 'string' && item.trim()) {
      voices.push({ id: item, label: item })
      continue
    }
    const rec = asRecord(item)
    if (typeof rec?.id === 'string' && rec.id.trim()) {
      voices.push({
        id: rec.id,
        label: typeof rec.label === 'string' && rec.label.trim() ? rec.label : rec.id,
      })
    }
  }
  return voices
}

function wrapDiscovery(err: unknown): GatewayDiscoveryError {
  if (err instanceof GatewayDiscoveryError) return err
  return new GatewayDiscoveryError(
    mapConnectionError(err),
    err instanceof Error ? err.message : undefined,
  )
}

/**
 * Injectable speech-gateway catalog client. Default adapter: SDK `models.list()`
 * plus optional `GET {baseURL}/model/info`. A 404 on `/model/info` means the
 * gateway does not publish extra metadata — not a catalog error.
 */
export function createSpeechGatewayClient(deps: SpeechGatewayClientDeps): SpeechGatewayClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchFn = deps.fetch ?? fetch
  const openai =
    deps.openai ??
    new OpenAI({ apiKey: deps.apiKey, baseURL: deps.baseURL, timeout: timeoutMs })
  const infoUrl = `${deps.baseURL.replace(/\/$/, '')}/model/info`

  let infoPromise: Promise<ModelInfoRow[] | null> | undefined

  async function loadInfo(): Promise<ModelInfoRow[] | null> {
    if (!infoPromise) {
      infoPromise = (async () => {
        try {
          const response = await fetchFn(infoUrl, {
            headers: { Authorization: `Bearer ${deps.apiKey}` },
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (response.status === 404) return null
          if (!response.ok) {
            throw new GatewayDiscoveryError(mapConnectionError({ status: response.status }))
          }
          const payload = (await response.json()) as ModelInfoPayload
          return parseInfoRows(payload)
        } catch (err) {
          throw wrapDiscovery(err)
        }
      })()
    }
    return infoPromise
  }

  return {
    async listModels() {
      try {
        const listed = await openai.models.list()
        const rows = await loadInfo()
        const byName = new Map<string, ModelInfoRow>()
        for (const row of rows ?? []) {
          if (typeof row.model_name === 'string') byName.set(row.model_name, row)
        }
        return listed.data.map((model) => {
          const row = byName.get(model.id)
          const mode = row ? infoMode(row) : undefined
          return mode ? { id: model.id, mode } : { id: model.id }
        })
      } catch (err) {
        throw wrapDiscovery(err)
      }
    },

    async listVoices() {
      const rows = await loadInfo()
      if (!rows) return []
      const seen = new Set<string>()
      const voices: SpeechGatewayVoice[] = []
      for (const row of rows) {
        for (const voice of infoVoices(row)) {
          if (seen.has(voice.id)) continue
          seen.add(voice.id)
          voices.push(voice)
        }
      }
      return voices
    },

    async listRates() {
      const rows = await loadInfo()
      if (!rows) return {}
      const rates: Record<string, GatewayRate> = {}
      for (const row of rows) {
        if (typeof row.model_name !== 'string') continue
        const rate = infoRates(row)
        if (rate) rates[row.model_name] = rate
      }
      return rates
    },
  }
}
