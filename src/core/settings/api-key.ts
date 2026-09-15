import { DomainError, KeyStorageDisabledError } from '../shared/errors'
import type { ConnectionTestCode, ConnectionTestResult } from '../tts/catalog'
import type { AppConfigRepository } from './app-config-repository'
import { parseBaseUrl, resolveBaseUrl } from './base-url'
import { decryptSecret, encryptSecret } from './crypto'

// The single app_config row holding the encrypted in-app OpenAI key.
export const OPENAI_KEY_CONFIG_KEY = 'openai_api_key'

export type KeySource = 'ui' | 'env' | 'none'

/** Masked, source-tagged key status — never carries the plaintext (FR-041). */
export interface KeyStatus {
  configured: boolean
  masked?: string
  source: KeySource
  secretConfigured: boolean
}

export interface KeyDeps {
  config: AppConfigRepository
  /** NUXT_APP_SECRET — absent/empty disables in-app key storage. */
  appSecret?: string
  /** OPENAI_API_KEY from the environment. */
  envKey?: string
  /** NUXT_OPENAI_BASE_URL — used by Test Connection when no draft URL is sent. */
  envBaseUrl?: string
}

/** Optional unsaved Settings values for Test Connection (never persisted). */
export interface ConnectionDrafts {
  baseUrl?: string
  key?: string
}

/**
 * Mask a key to a fixed prefix + its last four characters (never the full key).
 * Keys too short to safely reveal a suffix are masked completely, so a malformed
 * or mistyped secret can't leak through the status (FR-041).
 */
export function maskKey(key: string): string {
  if (key.length < 8) return '●●●●'
  return `●●●●${key.slice(-4)}`
}

/**
 * The decrypted in-app key, or undefined if none is usable. In-app storage is
 * disabled without an app secret, so any stored blob is ignored. A blob that
 * can't be decrypted (rotated/wrong secret, corruption) is treated as absent
 * rather than throwing, so resolution still falls back to env.
 */
function decryptedUiKey(deps: KeyDeps): string | undefined {
  if (!deps.appSecret) return undefined
  const stored = deps.config.get(OPENAI_KEY_CONFIG_KEY)
  if (!stored) return undefined
  try {
    return decryptSecret(stored, deps.appSecret)
  } catch {
    return undefined
  }
}

/** Per-request key precedence: UI (decrypted) → env → undefined (FR-042/045). */
export function resolveApiKey(deps: KeyDeps): string | undefined {
  return decryptedUiKey(deps) ?? (deps.envKey || undefined)
}

/** Masked, source-tagged status for the Settings UI — never the plaintext (FR-041). */
export function getKeyStatus(deps: KeyDeps): KeyStatus {
  const secretConfigured = Boolean(deps.appSecret)
  const ui = decryptedUiKey(deps)
  if (ui) return { configured: true, masked: maskKey(ui), source: 'ui', secretConfigured }
  const env = deps.envKey || undefined
  if (env) return { configured: true, masked: maskKey(env), source: 'env', secretConfigured }
  return { configured: false, source: 'none', secretConfigured }
}

/**
 * Store (or replace) the in-app key, encrypted at rest. Rejected when in-app
 * storage is disabled (no app secret): nothing is written and the env key remains
 * in use (FR-042/043). An empty key is rejected as a 400.
 */
export function setUiKey(deps: KeyDeps, key: string): KeyStatus {
  if (!deps.appSecret) throw new KeyStorageDisabledError()
  const trimmed = key.trim()
  if (!trimmed) throw new DomainError('EMPTY_INPUT', 'API key must not be empty.')
  deps.config.set(OPENAI_KEY_CONFIG_KEY, encryptSecret(trimmed, deps.appSecret))
  return { configured: true, masked: maskKey(trimmed), source: 'ui', secretConfigured: true }
}

/** Clear the in-app key and report the resulting (env/none) status (FR-042). */
export function clearUiKey(deps: KeyDeps): KeyStatus {
  deps.config.delete(OPENAI_KEY_CONFIG_KEY)
  return getKeyStatus(deps)
}

function hasOwn<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/** Map a verifier/network failure to a typed Test Connection code. Never includes the key. */
export function mapConnectionError(err: unknown): ConnectionTestCode {
  if (!err || typeof err !== 'object') return 'UNKNOWN'
  const e = err as {
    status?: number
    code?: string
    name?: string
    cause?: { code?: string }
  }
  if (e.status === 401 || e.status === 403) return 'UNAUTHORIZED'
  if (
    e.name === 'AbortError' ||
    e.name === 'TimeoutError' ||
    e.name === 'APIConnectionTimeoutError' ||
    e.code === 'ETIMEDOUT'
  ) {
    return 'TIMEOUT'
  }
  const code = e.code ?? e.cause?.code
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    e.name === 'APIConnectionError'
  ) {
    return 'UNREACHABLE'
  }
  return 'UNKNOWN'
}

/**
 * Test the currently shown (or resolved) URL + key via an injected verifier
 * (the network call lives in the server adapter). Drafts are never persisted.
 * Reports `{ ok: true }` or `{ ok: false, code }` — never the key.
 */
export async function testApiKey(
  deps: KeyDeps,
  verify: (apiKey: string, baseURL?: string) => Promise<boolean>,
  drafts?: ConnectionDrafts,
): Promise<ConnectionTestResult> {
  const draftKey = drafts?.key?.trim()
  const key = draftKey || resolveApiKey(deps)
  if (!key) return { ok: false, code: 'NO_KEY' }

  let baseURL: string | undefined
  if (drafts && hasOwn(drafts, 'baseUrl')) {
    const raw = drafts.baseUrl
    baseURL = raw?.trim() ? parseBaseUrl(raw) : undefined
  } else {
    baseURL = resolveBaseUrl({ config: deps.config, envBaseUrl: deps.envBaseUrl })
  }

  try {
    const ok = await verify(key, baseURL)
    return ok ? { ok: true } : { ok: false, code: 'UNKNOWN' }
  } catch (err) {
    return { ok: false, code: mapConnectionError(err) }
  }
}
