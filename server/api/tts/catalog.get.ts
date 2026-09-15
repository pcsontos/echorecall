import {
  MODELS,
  VOICES,
  createSpeechGatewayClient,
  GatewayDiscoveryError,
  mergeSpeechCatalog,
  type ConnectionTestCode,
} from '#core'
import { resolveActiveApiKey, resolveActiveBaseUrl } from '../../utils/container'
import { respondError } from '../../utils/errors'

function discoveryCode(err: unknown): ConnectionTestCode {
  if (err instanceof GatewayDiscoveryError) return err.code
  return 'UNKNOWN'
}

// GET /api/tts/catalog — merged built-in ∪ gateway Generate catalog. Discovery
// failure is a 200 with builtin entries + catalogError; it never 401s Generate.
export default defineEventHandler(async (event) => {
  try {
    const apiKey = resolveActiveApiKey()
    const baseURL = resolveActiveBaseUrl()
    if (!baseURL || !apiKey) {
      const merged = mergeSpeechCatalog({ builtinVoices: VOICES, builtinModels: MODELS })
      return { ...merged, rates: {} }
    }

    try {
      const client = createSpeechGatewayClient({ apiKey, baseURL })
      const [gatewayModels, gatewayVoices, rates] = await Promise.all([
        client.listModels(),
        client.listVoices(),
        client.listRates(),
      ])
      const merged = mergeSpeechCatalog({
        builtinVoices: VOICES,
        builtinModels: MODELS,
        gatewayVoices,
        gatewayModels,
      })
      return { ...merged, rates }
    } catch (err) {
      const merged = mergeSpeechCatalog({
        builtinVoices: VOICES,
        builtinModels: MODELS,
        catalogError: discoveryCode(err),
      })
      return { ...merged, rates: {} }
    }
  } catch (err) {
    return respondError(event, err)
  }
})
