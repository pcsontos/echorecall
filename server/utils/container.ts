import { join } from 'node:path'
import {
  FileAudioStore,
  LibraryService,
  NoApiKeyError,
  OpenAiTtsProvider,
  resolveApiKey,
  resolveBaseUrl,
  SqliteAppConfigRepository,
  SqliteGenerationRepository,
  TagLibAudioTagger,
  type AppConfigRepository,
  type TtsProvider,
} from '#core'

// Memoise the in-flight construction promise (not just the resolved service) so
// concurrent first requests share a single repo/tagger rather than racing to
// build their own — the taglib-wasm module is loaded exactly once.
let libraryServicePromise: Promise<LibraryService> | undefined
let appConfigRepo: AppConfigRepository | undefined

function dataDir(): string {
  const config = useRuntimeConfig()
  return (config.dataDir as string) || join(process.cwd(), 'data')
}

/**
 * Singleton app-config store (encrypted in-app OpenAI key, US8). It opens its own
 * connection to the shared SQLite file (WAL), so it works whether or not the
 * generations repository has been constructed yet. Exposed for the Settings
 * routes, which read/write the key status through it.
 */
export function getAppConfigRepository(): AppConfigRepository {
  if (!appConfigRepo) {
    appConfigRepo = new SqliteAppConfigRepository(join(dataDir(), 'echorecall.db'))
  }
  return appConfigRepo
}

/** Resolve the active OpenAI key per request: in-app (decrypted) → env (FR-042). */
export function resolveActiveApiKey(): string | undefined {
  const config = useRuntimeConfig()
  return resolveApiKey({
    config: getAppConfigRepository(),
    appSecret: (config.appSecret as string) || undefined,
    envKey: (config.openaiApiKey as string) || undefined,
  })
}

/** Resolve the active speech destination: in-app → env → unset (SDK default). */
export function resolveActiveBaseUrl(): string | undefined {
  const config = useRuntimeConfig()
  return resolveBaseUrl({
    config: getAppConfigRepository(),
    envBaseUrl: (config.openaiBaseUrl as string) || undefined,
  })
}

/**
 * Lazily-constructed singleton library service (SQLite + filesystem + tagger).
 * Async because the taglib-wasm `AudioTagger` initialises its WASM module once;
 * it is injected so `save()` embeds metadata before writing. US8 will layer a
 * per-request provider into this wiring.
 */
export function getLibraryService(): Promise<LibraryService> {
  if (!libraryServicePromise) {
    libraryServicePromise = (async () => {
      try {
        const dir = dataDir()
        const repo = new SqliteGenerationRepository(join(dir, 'echorecall.db'))
        // Audio store is rooted at the data dir; stored paths are relative
        // (`audio/YYYY/MM/DD/<slug>.<ext>` for new files, `audio/<id>.mp3` legacy).
        const audio = new FileAudioStore(dir)
        const tagger = await TagLibAudioTagger.create()
        // 006 · R-AUDIOPROPS — reuse the tagger's single WASM instance to decode
        // read-only audio properties on demand (no persistence/migration).
        return new LibraryService(repo, audio, undefined, undefined, tagger, (bytes) =>
          tagger.readAudioProperties(bytes),
        )
      } catch (err) {
        // Don't cache a rejected promise: clear it so a transient failure (WASM
        // load, fs lock, SQLite init) can self-recover on the next request
        // instead of wedging every request until a restart.
        libraryServicePromise = undefined
        throw err
      }
    })()
  }
  return libraryServicePromise
}

/**
 * Resolve a TTS provider per request from the active OpenAI key (UI→env
 * precedence, US8). Raises NO_API_KEY when neither an in-app nor an environment
 * key is configured — thrown before any provider call or save, so nothing is
 * persisted (FR-045).
 */
export function getTtsProvider(): TtsProvider {
  const apiKey = resolveActiveApiKey()
  if (!apiKey) throw new NoApiKeyError()
  const baseURL = resolveActiveBaseUrl()
  return new OpenAiTtsProvider(baseURL ? { apiKey, baseURL } : { apiKey })
}
