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
