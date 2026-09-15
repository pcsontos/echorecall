import { describe, it, expect } from 'vitest'
import {
  parseBaseUrl,
  resolveBaseUrl,
  getBaseUrlStatus,
  setUiBaseUrl,
  clearUiBaseUrl,
  OPENAI_BASE_URL_CONFIG_KEY,
} from '../../src/core/settings/base-url'
import { DomainError } from '../../src/core/shared/errors'
import type { AppConfigRepository } from '../../src/core/settings/app-config-repository'

// Unit coverage for the optional speech gateway Base URL (009 · US1): parse/normalize
// (trim, strip a single trailing slash, never add/remove /v1), reject non-http(s),
// persist the in-app override, and resolve ui → env → unset (SDK default).

const GATEWAY = 'http://localhost:4000/v1'
const ENV_URL = 'https://gateway.example.com/v1'

/** Minimal in-memory AppConfigRepository for the precedence tests. */
function fakeConfig(initial: Record<string, string> = {}): AppConfigRepository {
  const store = new Map(Object.entries(initial))
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
    },
    delete: (key) => store.delete(key),
  }
}

function withUiUrl(url: string): AppConfigRepository {
  return fakeConfig({ [OPENAI_BASE_URL_CONFIG_KEY]: url })
}

describe('parseBaseUrl', () => {
  it('returns undefined for empty, whitespace, null, and undefined', () => {
    expect(parseBaseUrl('')).toBeUndefined()
    expect(parseBaseUrl('   ')).toBeUndefined()
    expect(parseBaseUrl(null)).toBeUndefined()
    expect(parseBaseUrl(undefined)).toBeUndefined()
  })

  it('trims whitespace and strips a single trailing slash', () => {
    expect(parseBaseUrl(`  ${GATEWAY}/  `)).toBe(GATEWAY)
  })

  it('does not add or remove /v1', () => {
    expect(parseBaseUrl('http://localhost:4000')).toBe('http://localhost:4000')
    expect(parseBaseUrl(GATEWAY)).toBe(GATEWAY)
  })

  it('accepts https URLs', () => {
    expect(parseBaseUrl('https://litellm.internal/v1')).toBe('https://litellm.internal/v1')
  })

  it('rejects a value longer than 2048 characters', () => {
    const ok = `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`
    expect(ok.length).toBe(2048)
    expect(parseBaseUrl(ok)).toBe(ok)

    const tooLong = `${ok}x`
    expect(() => parseBaseUrl(tooLong)).toThrow(DomainError)
    try {
      parseBaseUrl(tooLong)
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError)
      expect((err as DomainError).code).toBe('INVALID_BASE_URL')
    }
  })

  it('rejects non-absolute and non-http(s) values without returning a URL', () => {
    for (const raw of [
      'not-a-url',
      '/v1',
      'localhost:4000/v1',
      'ftp://example.com/v1',
      'file:///tmp',
      'javascript:alert(1)',
    ]) {
      expect(() => parseBaseUrl(raw), raw).toThrow(DomainError)
      try {
        parseBaseUrl(raw)
      } catch (err) {
        expect((err as DomainError).code).toBe('INVALID_BASE_URL')
      }
    }
  })
})

describe('resolveBaseUrl precedence (ui → env → unset)', () => {
  it('prefers the in-app URL over the env URL', () => {
    expect(resolveBaseUrl({ config: withUiUrl(GATEWAY), envBaseUrl: ENV_URL })).toBe(GATEWAY)
  })

  it('falls back to the env URL when no in-app URL is stored', () => {
    expect(resolveBaseUrl({ config: fakeConfig(), envBaseUrl: ENV_URL })).toBe(ENV_URL)
  })

  it('returns undefined when neither an in-app nor an env URL is set', () => {
    expect(resolveBaseUrl({ config: fakeConfig() })).toBeUndefined()
  })

  it('treats an empty env string as unset', () => {
    expect(resolveBaseUrl({ config: fakeConfig(), envBaseUrl: '' })).toBeUndefined()
    expect(resolveBaseUrl({ config: fakeConfig(), envBaseUrl: '   ' })).toBeUndefined()
  })

  it('falls back to env when the stored in-app value is invalid', () => {
    expect(resolveBaseUrl({ config: withUiUrl('not-a-url'), envBaseUrl: ENV_URL })).toBe(ENV_URL)
  })
})

describe('getBaseUrlStatus', () => {
  it('reports source "ui" with the stored URL', () => {
    expect(getBaseUrlStatus({ config: withUiUrl(GATEWAY), envBaseUrl: ENV_URL })).toEqual({
      baseUrl: GATEWAY,
      source: 'ui',
    })
  })

  it('reports source "env" when only the environment URL is set', () => {
    expect(getBaseUrlStatus({ config: fakeConfig(), envBaseUrl: ENV_URL })).toEqual({
      baseUrl: ENV_URL,
      source: 'env',
    })
  })

  it('reports source "none" when neither source is set', () => {
    expect(getBaseUrlStatus({ config: fakeConfig() })).toEqual({ source: 'none' })
  })
})

describe('setUiBaseUrl / clearUiBaseUrl persist', () => {
  it('stores the normalized URL as plaintext and reports source "ui"', () => {
    const config = fakeConfig()
    const saved = setUiBaseUrl({ config }, `  ${GATEWAY}/  `)
    expect(saved).toEqual({ baseUrl: GATEWAY, source: 'ui' })
    expect(config.get(OPENAI_BASE_URL_CONFIG_KEY)).toBe(GATEWAY)
  })

  it('rejects an invalid URL with INVALID_BASE_URL and writes nothing', () => {
    const config = fakeConfig()
    let err: unknown
    try {
      setUiBaseUrl({ config }, 'ftp://nope')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DomainError)
    expect((err as DomainError).code).toBe('INVALID_BASE_URL')
    expect(config.get(OPENAI_BASE_URL_CONFIG_KEY)).toBeUndefined()
  })

  it('does not require an app secret to save', () => {
    const config = fakeConfig()
    expect(setUiBaseUrl({ config }, GATEWAY)).toEqual({ baseUrl: GATEWAY, source: 'ui' })
  })

  it('clears the in-app row so env (or unset) applies', () => {
    const config = withUiUrl(GATEWAY)
    expect(clearUiBaseUrl({ config, envBaseUrl: ENV_URL })).toEqual({
      baseUrl: ENV_URL,
      source: 'env',
    })
    expect(config.get(OPENAI_BASE_URL_CONFIG_KEY)).toBeUndefined()

    expect(clearUiBaseUrl({ config: fakeConfig() })).toEqual({ source: 'none' })
  })
})
