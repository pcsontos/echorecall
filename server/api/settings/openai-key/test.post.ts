import OpenAI from 'openai'
import { testApiKey } from '#core'
import { getAppConfigRepository } from '../../../utils/container'
import { respondError } from '../../../utils/errors'

interface TestBody {
  baseUrl?: string
  key?: string
}

// POST /api/settings/openai-key/test — verify the currently shown URL + key
// (drafts when provided, else the resolved saved/env pair). `models.list()`
// only; 10s timeout; never writes config or audio. Returns `{ ok: true }` or
// `{ ok: false, code }` — the key is never echoed.
export default defineEventHandler(async (event) => {
  try {
    const body = ((await readBody<TestBody>(event)) ?? {}) as TestBody
    const config = useRuntimeConfig()
    return await testApiKey(
      {
        config: getAppConfigRepository(),
        appSecret: (config.appSecret as string) || undefined,
        envKey: (config.openaiApiKey as string) || undefined,
        envBaseUrl: (config.openaiBaseUrl as string) || undefined,
      },
      async (apiKey, baseURL) => {
        await new OpenAI(
          baseURL
            ? { apiKey, baseURL, timeout: 10_000 }
            : { apiKey, timeout: 10_000 },
        ).models.list()
        return true
      },
      body,
    )
  } catch (err) {
    return respondError(event, err)
  }
})
