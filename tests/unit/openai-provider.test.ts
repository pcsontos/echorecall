import { beforeEach, describe, expect, it, vi } from 'vitest'

const { OpenAIMock } = vi.hoisted(() => ({ OpenAIMock: vi.fn() }))

vi.mock('openai', () => ({ default: OpenAIMock }))

// Unit coverage for the OpenAI SDK constructor options (009 · US1): an optional
// `baseURL` is passed through when set and omitted when unset so the SDK keeps
// its public OpenAI default. No network calls.

beforeEach(() => {
  OpenAIMock.mockReset()
})

async function provider() {
  const { OpenAiTtsProvider } = await import('../../src/core/tts/openai-provider')
  return OpenAiTtsProvider
}

describe('OpenAiTtsProvider SDK construction', () => {
  it('omits baseURL when no custom destination is configured', async () => {
    const OpenAiTtsProvider = await provider()
    new OpenAiTtsProvider({ apiKey: 'sk-test' })
    expect(OpenAIMock).toHaveBeenCalledTimes(1)
    const opts = OpenAIMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.apiKey).toBe('sk-test')
    expect(opts).not.toHaveProperty('baseURL')
  })

  it('passes the optional baseURL through to the SDK constructor', async () => {
    const OpenAiTtsProvider = await provider()
    new OpenAiTtsProvider({ apiKey: 'sk-test', baseURL: 'http://localhost:4000/v1' })
    expect(OpenAIMock).toHaveBeenCalledTimes(1)
    expect(OpenAIMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'http://localhost:4000/v1',
      }),
    )
  })
})
