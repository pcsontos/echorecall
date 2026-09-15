import {
  MODELS,
  VOICES,
  type SpeechCatalog,
} from '#core/client'

function builtinCatalog(): SpeechCatalog {
  return {
    voices: VOICES.map((voice) => ({ id: voice.id, label: voice.label, source: 'builtin' })),
    models: MODELS.map((id) => ({ id, label: id, source: 'builtin' })),
    rates: {},
  }
}

/**
 * Load the merged Generate catalog from GET /api/tts/catalog. Falls back to the
 * built-in catalog (with catalogError) when the request itself fails, so Voice
 * and Model menus never go empty.
 */
export function useSpeechCatalog() {
  const catalog = ref<SpeechCatalog>(builtinCatalog())
  const loading = ref(false)

  async function loadCatalog() {
    loading.value = true
    try {
      catalog.value = await $fetch<SpeechCatalog>('/api/tts/catalog')
    } catch {
      // Our own catalog route is best-effort. Gateway discovery errors arrive as
      // a 200 payload with catalogError set; a failed fetch keeps builtins only.
      catalog.value = builtinCatalog()
    } finally {
      loading.value = false
    }
  }

  return { catalog, loading, loadCatalog }
}
