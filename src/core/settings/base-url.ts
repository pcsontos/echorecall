import { InvalidBaseUrlError } from '../shared/errors'
import type { AppConfigRepository } from './app-config-repository'

/** The single app_config row holding the in-app speech gateway Base URL (plaintext). */
export const OPENAI_BASE_URL_CONFIG_KEY = 'openai_base_url'

const MAX_BASE_URL_LENGTH = 2048

export type BaseUrlSource = 'ui' | 'env' | 'none'

export interface BaseUrlStatus {
  baseUrl?: string
  source: BaseUrlSource
}

export interface BaseUrlDeps {
  config: AppConfigRepository
  /** NUXT_OPENAI_BASE_URL from the environment. */
  envBaseUrl?: string
}

/**
 * Trim, reject non-http(s) / overlong values, and strip a single trailing slash.
 * Empty/whitespace/`null`/`undefined` → unset. Does not add or remove `/v1`.
 */
export function parseBaseUrl(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_BASE_URL_LENGTH) throw new InvalidBaseUrlError()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new InvalidBaseUrlError()
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidBaseUrlError()
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

function tryParse(raw: string | undefined | null): string | undefined {
  try {
    return parseBaseUrl(raw)
  } catch {
    return undefined
  }
}

/** Per-request destination precedence: in-app → env → unset (SDK default). */
export function resolveBaseUrl(deps: BaseUrlDeps): string | undefined {
  return tryParse(deps.config.get(OPENAI_BASE_URL_CONFIG_KEY)) ?? tryParse(deps.envBaseUrl)
}

/** Source-tagged status for Settings. A missing row never throws. */
export function getBaseUrlStatus(deps: BaseUrlDeps): BaseUrlStatus {
  const ui = tryParse(deps.config.get(OPENAI_BASE_URL_CONFIG_KEY))
  if (ui) return { baseUrl: ui, source: 'ui' }
  const env = tryParse(deps.envBaseUrl)
  if (env) return { baseUrl: env, source: 'env' }
  return { source: 'none' }
}

/**
 * Store (or replace) the in-app Base URL as plaintext. Throws INVALID_BASE_URL
 * and writes nothing when the value is empty or not an absolute http(s) URL.
 * Does not require NUXT_APP_SECRET.
 */
export function setUiBaseUrl(deps: BaseUrlDeps, raw: string): { baseUrl: string; source: 'ui' } {
  const parsed = parseBaseUrl(raw)
  if (!parsed) throw new InvalidBaseUrlError()
  deps.config.set(OPENAI_BASE_URL_CONFIG_KEY, parsed)
  return { baseUrl: parsed, source: 'ui' }
}

/** Delete the in-app row and report the resulting (env/none) status. */
export function clearUiBaseUrl(deps: BaseUrlDeps): BaseUrlStatus {
  deps.config.delete(OPENAI_BASE_URL_CONFIG_KEY)
  return getBaseUrlStatus(deps)
}
