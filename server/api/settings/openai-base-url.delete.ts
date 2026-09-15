import { clearUiBaseUrl } from '#core'
import { getAppConfigRepository } from '../../utils/container'
import { respondError } from '../../utils/errors'

// DELETE /api/settings/openai-base-url — drop the in-app override so env (or
// the public OpenAI default) applies. Returns the resulting { baseUrl?, source }.
export default defineEventHandler((event) => {
  try {
    const config = useRuntimeConfig()
    return clearUiBaseUrl({
      config: getAppConfigRepository(),
      envBaseUrl: (config.openaiBaseUrl as string) || undefined,
    })
  } catch (err) {
    return respondError(event, err)
  }
})
