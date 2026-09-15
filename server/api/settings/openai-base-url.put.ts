import { clearUiBaseUrl, setUiBaseUrl } from '#core'
import { getAppConfigRepository } from '../../utils/container'
import { respondError } from '../../utils/errors'

interface BaseUrlBody {
  baseUrl?: string
}

// PUT /api/settings/openai-base-url — persist a normalized http(s) URL as
// plaintext. Empty/whitespace is treated as clear. Does not require APP_SECRET
// and does not call the gateway. Invalid format → 400 INVALID_BASE_URL.
export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<BaseUrlBody>(event)
    const config = useRuntimeConfig()
    const deps = {
      config: getAppConfigRepository(),
      envBaseUrl: (config.openaiBaseUrl as string) || undefined,
    }
    const raw = body?.baseUrl
    if (raw == null || !String(raw).trim()) return clearUiBaseUrl(deps)
    return setUiBaseUrl(deps, raw)
  } catch (err) {
    return respondError(event, err)
  }
})
