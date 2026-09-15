// Client-safe subset of the core's public API. Everything re-exported here is
// browser/SSR-safe: it transitively imports no Node built-ins, better-sqlite3,
// openai, or filesystem code. Browser-side adapters (Vue components/composables)
// import from '#core/client'; server code imports the full API from '#core'.
export * from './shared/types'
export * from './shared/errors'

export {
  VOICES,
  MODELS,
  FORMATS,
  INSTRUCTIONS_MODEL,
  MAX_UPLOAD_BYTES,
  isKnownVoice,
  isKnownModel,
  isKnownFormat,
  formatInfo,
} from './tts/provider'
export type { TtsProvider } from './tts/provider'
export type {
  CatalogEntry,
  ConnectionTestCode,
  ConnectionTestResult,
  GatewayRate,
  SpeechCatalog,
} from './tts/catalog'
export { MAX_INPUT_LENGTH, normalizeSpeed } from './tts/generate'
// Per-item cost estimate (007 · US5): pure, browser-safe pricing for the Generate editor.
export { MODEL_PRICING, estimateItemCost } from './tts/pricing'
export type { CostEstimate } from './tts/pricing'

// Naming rules (slug) — shared so the client preview matches the server result.
export { slugify } from './naming/slug'

// Structured batch contract and browser-safe parser.
export type {
  BatchBaseInput,
  BatchDefaults,
  BatchDocumentError,
  BatchDocumentErrorCode,
  BatchDocumentErrorScope,
  BatchDocumentV1,
  BatchFormat,
  BatchIssue,
  BatchIssueCode,
  BatchItem,
  BatchParseResult,
  BatchPreview,
  BatchPreviewCounts,
  BatchSourceLocation,
  CandidateDisplay,
  ImportCandidate,
  InvalidImportCandidate,
  MetadataPatch,
  ParseBatchRequest,
  ResolvedQueueInput,
  ValidImportCandidate,
} from './batch/contract'
export { parseBatch } from './batch/parse-batch'
export { parseJson } from './batch/parse-json'
export type { ParseJsonResult } from './batch/parse-json'
export { parseText } from './batch/parse-text'
export { parseYaml } from './batch/parse-yaml'
export type { ParseYamlResult } from './batch/parse-yaml'

// Legacy line-import summary; unified callers should use parseBatch/parseText above.
export { parseUploadText } from './batch/parse-upload'
export type { ParsedUpload } from './batch/parse-upload'
