import { describe, expect, it, vi } from 'vitest'
import {
  GatewayDiscoveryError,
  createSpeechGatewayClient,
} from '../../src/core/tts/gateway-client'

// 009 · US2: injectable SpeechGatewayClient. Default adapter uses SDK models.list
// plus optional GET {baseURL}/model/info. Unit tests inject both; no live network.
// Speech-mode is attached from model/info when present; rates parse finite cost
// fields; failures map to UNREACHABLE / UNAUTHORIZED / TIMEOUT / UNKNOWN.
// A 404 from /model/info is "not implemented", not a catalog error.

const BASE_URL = 'http://localhost:4000/v1'
const INFO_URL = `${BASE_URL}/model/info`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function openaiList(ids: string[]) {
  return {
    models: {
      list: vi.fn(async () => ({ data: ids.map((id) => ({ id })) })),
    },
  }
}

describe('createSpeechGatewayClient', () => {
  it('lists model ids from injected models.list when /model/info is 404', async () => {
    const openai = openaiList(['gpt-4o', 'elevenlabs/eleven_multilingual_v2'])
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }))
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    const models = await client.listModels()
    expect(openai.models.list).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledWith(
      INFO_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    )
    expect(models).toEqual([
      { id: 'gpt-4o' },
      { id: 'elevenlabs/eleven_multilingual_v2' },
    ])
    expect(await client.listRates()).toEqual({})
    expect(await client.listVoices()).toEqual([])
  })

  it('attaches mode from /model/info so speech models can be filtered downstream', async () => {
    const openai = openaiList(['gpt-4o', 'elevenlabs/eleven_multilingual_v2', 'azure/speech'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { model_name: 'gpt-4o', model_info: { mode: 'chat' } },
          {
            model_name: 'elevenlabs/eleven_multilingual_v2',
            model_info: { mode: 'audio_speech' },
          },
          { model_name: 'azure/speech', model_info: { mode: 'audio' } },
        ],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    const models = await client.listModels()
    expect(models).toEqual([
      { id: 'gpt-4o', mode: 'chat' },
      { id: 'elevenlabs/eleven_multilingual_v2', mode: 'audio_speech' },
      { id: 'azure/speech', mode: 'audio' },
    ])
  })

  it('attaches provider from model_info.litellm_provider', async () => {
    const openai = openaiList(['elevenlabs/eleven_multilingual_v2'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            model_name: 'elevenlabs/eleven_multilingual_v2',
            model_info: { mode: 'audio_speech', litellm_provider: 'elevenlabs' },
          },
        ],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    expect(await client.listModels()).toEqual([
      { id: 'elevenlabs/eleven_multilingual_v2', mode: 'audio_speech', provider: 'elevenlabs' },
    ])
  })

  it('falls back to litellm_params.custom_llm_provider when litellm_provider is absent', async () => {
    const openai = openaiList(['azure/speech'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            model_name: 'azure/speech',
            litellm_params: { custom_llm_provider: 'azure' },
            model_info: { mode: 'audio' },
          },
        ],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    expect(await client.listModels()).toEqual([
      { id: 'azure/speech', mode: 'audio', provider: 'azure' },
    ])
  })

  it('omits provider when /model/info is 404 or the row has no provider field', async () => {
    const openai = openaiList(['unlabeled'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [{ model_name: 'unlabeled', model_info: { mode: 'audio_speech' } }],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    expect(await client.listModels()).toEqual([{ id: 'unlabeled', mode: 'audio_speech' }])
  })

  it('parses finite character and per-second rates and ignores non-finite fields', async () => {
    const openai = openaiList(['priced', 'broken'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            model_name: 'priced',
            model_info: {
              mode: 'audio_speech',
              input_cost_per_character: 0.00003,
              output_cost_per_character: 0.00004,
              output_cost_per_second: 0.001,
            },
          },
          {
            model_name: 'broken',
            model_info: {
              mode: 'audio_speech',
              input_cost_per_character: Number.NaN,
              output_cost_per_second: Number.POSITIVE_INFINITY,
            },
          },
        ],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    const rates = await client.listRates()
    expect(rates).toEqual({
      priced: {
        inputCostPerCharacter: 0.00003,
        outputCostPerCharacter: 0.00004,
        outputCostPerSecond: 0.001,
      },
    })
    // Catalog payload shape: camelCase GatewayRate fields, no snake_case leak.
    expect(JSON.parse(JSON.stringify({ rates }))).toEqual({
      rates: {
        priced: {
          inputCostPerCharacter: 0.00003,
          outputCostPerCharacter: 0.00004,
          outputCostPerSecond: 0.001,
        },
      },
    })
  })

  it('lists voices only when the info payload clearly includes them', async () => {
    const openai = openaiList(['elevenlabs/eleven_multilingual_v2'])
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            model_name: 'elevenlabs/eleven_multilingual_v2',
            model_info: { mode: 'audio_speech' },
            voices: [
              { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
              'Jenny',
            ],
          },
        ],
      }),
    )
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai,
      fetch: fetchFn,
    })

    expect(await client.listVoices()).toEqual([
      { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
      { id: 'Jenny', label: 'Jenny' },
    ])
  })

  it('maps models.list failures to typed GatewayDiscoveryError codes', async () => {
    const cases: { err: unknown; code: string }[] = [
      { err: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), code: 'UNREACHABLE' },
      { err: Object.assign(new Error('denied'), { status: 401 }), code: 'UNAUTHORIZED' },
      { err: Object.assign(new Error('slow'), { name: 'TimeoutError' }), code: 'TIMEOUT' },
      { err: new Error('nope'), code: 'UNKNOWN' },
    ]
    for (const { err, code } of cases) {
      const client = createSpeechGatewayClient({
        apiKey: 'sk-test',
        baseURL: BASE_URL,
        openai: { models: { list: async () => { throw err } } },
        fetch: async () => new Response(null, { status: 404 }),
      })
      await expect(client.listModels()).rejects.toMatchObject({
        name: GatewayDiscoveryError.name,
        code,
      })
    }
  })

  it('maps a non-404 /model/info failure to GatewayDiscoveryError', async () => {
    const client = createSpeechGatewayClient({
      apiKey: 'sk-test',
      baseURL: BASE_URL,
      openai: openaiList(['tts-1']),
      fetch: async () => new Response(null, { status: 401 }),
    })
    await expect(client.listModels()).rejects.toMatchObject({
      name: GatewayDiscoveryError.name,
      code: 'UNAUTHORIZED',
    })
  })
})
