// Full public API of the framework-agnostic core. Server adapters (Nitro/CLI)
// import from here; browser-side adapters import the safe subset from './client'
// (alias '#core/client') so server-only deps never reach the client bundle.
export * from './client'
export type {
  CatalogEntry,
  ConnectionTestCode,
  ConnectionTestResult,
  GatewayRate,
  SpeechCatalog,
} from './tts/catalog'

// Domain orchestration: browser-safe at runtime, but needs a server-provided
// TtsProvider, so it lives in the server entry only.
export { generateSpeech } from './tts/generate'

// Server-only adapters — these pull in Node built-ins, better-sqlite3, openai,
// and the filesystem, so they must never be imported from '#core/client'.
export { newId } from './shared/ids'
export { OpenAiTtsProvider } from './tts/openai-provider'
export type { OpenAiTtsConfig } from './tts/openai-provider'

export type {
  BulkCleanFilter,
  GenerationRepository,
  LibraryListResult,
  NewGenerationRecord,
} from './library/repository'
export { DEFAULT_PAGE_SIZE } from './library/repository'
export { SqliteGenerationRepository } from './library/sqlite-repository'
export { FileAudioStore } from './library/audio-store'
// 006 · R-AUDIOPROPS — read-only audio-properties reader (taglib `audioProperties`).
export { readAudioProperties } from './library/audio-properties'
export type { AudioPropertiesReader, TagLibLike, AudioFileLike } from './library/audio-properties'
export { LibraryService } from './library/library-service'
export type { SaveInput, SaveResult } from './library/library-service'

// Multi-format tagging (AudioTagger port + taglib-wasm adapter + use-case).
export type { AudioTagger, TagResult } from './tagging/tagger'
export { skippedFields, UNSUPPORTED_FIELDS } from './tagging/tagger'
export { tagAudio } from './tagging/tag-audio'
export { TagLibAudioTagger } from './tagging/taglib-tagger'

// Naming (filesystem-safe slug + dated, collision-safe filename allocation).
export { MAX_SLUG_LENGTH } from './naming/slug'
export { datedDir, allocateFilename } from './naming/filename'

// In-app OpenAI key (US8): encrypted-at-rest storage + per-request UI→env
// precedence. Server-only (node:crypto, better-sqlite3) — never import from
// '#core/client'.
export type { AppConfigRepository } from './settings/app-config-repository'
export { SqliteAppConfigRepository } from './settings/app-config-repository'
export { encryptSecret, decryptSecret } from './settings/crypto'
export {
  resolveApiKey,
  getKeyStatus,
  setUiKey,
  clearUiKey,
  testApiKey,
  mapConnectionError,
  maskKey,
  OPENAI_KEY_CONFIG_KEY,
} from './settings/api-key'
export type { KeyStatus, KeySource, KeyDeps, ConnectionDrafts } from './settings/api-key'
export {
  parseBaseUrl,
  resolveBaseUrl,
  getBaseUrlStatus,
  setUiBaseUrl,
  clearUiBaseUrl,
  OPENAI_BASE_URL_CONFIG_KEY,
} from './settings/base-url'
export type { BaseUrlStatus, BaseUrlSource, BaseUrlDeps } from './settings/base-url'
// Default tag values (003): non-secret, store-backed pre-fills for the form,
// editable from the Settings tab. Replaces the removed env reader (no NUXT_DEFAULT_TAG_*).
export {
  getDefaultTags,
  setDefaultTags,
  clearDefaultTags,
  DEFAULT_TAGS_CONFIG_KEY,
} from './settings/default-tags'
export type { DefaultTagsDeps, DefaultTagsInput } from './settings/default-tags'
// Generation defaults (007 · US3): non-secret, store-backed Voice/Model/Format/Speed
// defaults for the Generate editor, editable from the Settings modal alongside Default Tags.
export {
  getGenerationDefaults,
  setGenerationDefaults,
  clearGenerationDefaults,
  GENERATION_DEFAULTS_CONFIG_KEY,
} from './settings/generation-defaults'
export type {
  GenerationDefaults,
  GenerationDefaultsDeps,
  GenerationDefaultsInput,
} from './settings/generation-defaults'
