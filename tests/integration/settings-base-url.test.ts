import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteAppConfigRepository } from '../../src/core/settings/app-config-repository'
import {
  getBaseUrlStatus,
  setUiBaseUrl,
  clearUiBaseUrl,
  resolveBaseUrl,
  OPENAI_BASE_URL_CONFIG_KEY,
} from '../../src/core/settings/base-url'
import { DomainError } from '../../src/core/shared/errors'
import { respondError } from '../../server/utils/errors'

// Integration coverage for the in-app speech gateway Base URL (009 · US1),
// exercising the real pipeline the Settings routes run: a file-backed SQLite
// app_config store + parse/resolve + the shared error mapper. The thin h3
// envelopes are out of scope for this plain-Node suite (matching settings-key);
// rejections are mapped through respondError to confirm the HTTP status the
// client would observe. Saving a URL does not require NUXT_APP_SECRET.

const GATEWAY = 'http://localhost:4000/v1'
const ENV_URL = 'https://gateway.example.com/v1'

function mapError(err: unknown): { status: number; code: string } {
  const event = { node: { res: { statusCode: 200 } } }
  const body = respondError(event, err)
  return { status: event.node.res.statusCode, code: body.error.code }
}

let dir: string
let config: SqliteAppConfigRepository

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'echorecall-base-url-'))
  config = new SqliteAppConfigRepository(join(dir, 'echorecall.db'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GET /api/settings/openai-base-url (core)', () => {
  it('returns source "none" when no row exists (never 500s)', () => {
    expect(getBaseUrlStatus({ config })).toEqual({ source: 'none' })
  })

  it('returns the env URL when no in-app row exists', () => {
    expect(getBaseUrlStatus({ config, envBaseUrl: ENV_URL })).toEqual({
      baseUrl: ENV_URL,
      source: 'env',
    })
  })
})

describe('PUT /api/settings/openai-base-url (core)', () => {
  it('persists the normalized URL as plaintext without an app secret', () => {
    const put = setUiBaseUrl({ config }, ` ${GATEWAY}/ `)
    expect(put).toEqual({ baseUrl: GATEWAY, source: 'ui' })

    const get = getBaseUrlStatus({ config, envBaseUrl: ENV_URL })
    expect(get).toEqual({ baseUrl: GATEWAY, source: 'ui' })

    const stored = config.get(OPENAI_BASE_URL_CONFIG_KEY)
    expect(stored).toBe(GATEWAY)

    const reopened = new SqliteAppConfigRepository(join(dir, 'echorecall.db'))
    expect(getBaseUrlStatus({ config: reopened })).toEqual({ baseUrl: GATEWAY, source: 'ui' })
  })

  it('rejects an invalid URL with 400 INVALID_BASE_URL and leaves the previous value', () => {
    setUiBaseUrl({ config }, GATEWAY)
    let err: unknown
    try {
      setUiBaseUrl({ config }, 'not-a-url')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DomainError)
    expect(mapError(err)).toEqual({ status: 400, code: 'INVALID_BASE_URL' })
    expect(config.get(OPENAI_BASE_URL_CONFIG_KEY)).toBe(GATEWAY)
    expect(getBaseUrlStatus({ config })).toEqual({ baseUrl: GATEWAY, source: 'ui' })
  })
})

describe('DELETE /api/settings/openai-base-url (core)', () => {
  it('clears the in-app row and falls back to env, then to unset', () => {
    setUiBaseUrl({ config }, GATEWAY)
    expect(resolveBaseUrl({ config, envBaseUrl: ENV_URL })).toBe(GATEWAY)

    const cleared = clearUiBaseUrl({ config, envBaseUrl: ENV_URL })
    expect(cleared).toEqual({ baseUrl: ENV_URL, source: 'env' })
    expect(config.get(OPENAI_BASE_URL_CONFIG_KEY)).toBeUndefined()
    expect(resolveBaseUrl({ config, envBaseUrl: ENV_URL })).toBe(ENV_URL)

    expect(clearUiBaseUrl({ config })).toEqual({ source: 'none' })
    expect(resolveBaseUrl({ config })).toBeUndefined()
  })
})
