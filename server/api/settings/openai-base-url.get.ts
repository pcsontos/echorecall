import { getBaseUrlStatus } from '#core'
import { getAppConfigRepository } from '../../utils/container'
import { respondError } from '../../utils/errors'

// GET /api/settings/openai-base-url — in-app / env / none. A missing row is
// `{ source: "none" }`, never a 500. The URL is configuration, not a secret.
export default defineEventHandler((event) => {
  try {
    const config = useRuntimeConfig()
    return getBaseUrlStatus({
      config: getAppConfigRepository(),
      envBaseUrl: (config.openaiBaseUrl as string) || undefined,
    })
  } catch (err) {
    return respondError(event, err)
  }
})
