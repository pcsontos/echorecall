import { parseBaseUrl, type ConnectionTestResult } from '#core/client'

/**
 * Masked status of the in-app OpenAI key, as served by the Settings API. The
 * plaintext key is never returned (FR-041); the UI only ever sees this shape.
 */
export interface OpenAiKeyStatus {
  configured: boolean
  masked?: string
  source: 'ui' | 'env' | 'none'
  secretConfigured: boolean
}

/** Optional speech gateway Base URL status (configuration, not a secret). */
export interface OpenAiBaseUrlStatus {
  baseUrl?: string
  source: 'ui' | 'env' | 'none'
}

/** Pull the stable domain error code out of an `$fetch` failure, if any. */
function errorCode(err: unknown): string | undefined {
  const data = (err as { data?: { error?: { code?: string }; data?: { error?: { code?: string } } } })
    ?.data
  return data?.error?.code ?? data?.data?.error?.code
}

/**
 * Manage the in-app OpenAI key and optional Base URL from Settings (US8 /
 * 009 · US1): load masked key status + URL, set/clear each independently,
 * and Test Connection against the values currently shown. Saving a URL does
 * not require NUXT_APP_SECRET and does not require a prior test.
 */
export function useSettings() {
  const { t } = useI18n()
  const status = ref<OpenAiKeyStatus | null>(null)
  const baseUrlStatus = ref<OpenAiBaseUrlStatus | null>(null)
  const baseUrlDraft = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<ConnectionTestResult | null>(null)
  const error = ref<string | null>(null)
  const baseUrlError = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    baseUrlError.value = null
    try {
      status.value = await $fetch<OpenAiKeyStatus>('/api/settings/openai-key')
    } catch {
      error.value = t('settings.openaiKey.errors.load')
    }
    try {
      const loaded = await $fetch<OpenAiBaseUrlStatus>('/api/settings/openai-base-url')
      baseUrlStatus.value = loaded
      // Don't clobber a URL the user already typed while this GET was in flight.
      if (!baseUrlDraft.value) baseUrlDraft.value = loaded.baseUrl ?? ''
    } catch {
      baseUrlError.value = t('settings.openaiKey.errors.baseUrlLoad')
    } finally {
      loading.value = false
    }
  }

  /** Store (encrypted) a new key; returns true on success so the caller can clear its input. */
  async function setKey(key: string): Promise<boolean> {
    saving.value = true
    error.value = null
    testResult.value = null
    try {
      status.value = await $fetch<OpenAiKeyStatus>('/api/settings/openai-key', {
        method: 'PUT',
        body: { key },
      })
      return true
    } catch (err) {
      error.value =
        errorCode(err) === 'KEY_STORAGE_DISABLED'
          ? t('settings.openaiKey.errors.disabled')
          : t('settings.openaiKey.errors.save')
      return false
    } finally {
      saving.value = false
    }
  }

  /** Clear the in-app key, reverting to the env key. */
  async function clearKey(): Promise<void> {
    saving.value = true
    error.value = null
    testResult.value = null
    try {
      status.value = await $fetch<OpenAiKeyStatus>('/api/settings/openai-key', { method: 'DELETE' })
    } catch {
      error.value = t('settings.openaiKey.errors.clear')
    } finally {
      saving.value = false
    }
  }

  /** Persist a Base URL (or reject invalid format). Does not call Test Connection. */
  async function setBaseUrl(baseUrl: string): Promise<boolean> {
    saving.value = true
    baseUrlError.value = null
    testResult.value = null
    try {
      parseBaseUrl(baseUrl)
    } catch {
      baseUrlError.value = t('settings.openaiKey.errors.invalidBaseUrl')
      saving.value = false
      return false
    }
    try {
      baseUrlStatus.value = await $fetch<OpenAiBaseUrlStatus>('/api/settings/openai-base-url', {
        method: 'PUT',
        body: { baseUrl },
      })
      baseUrlDraft.value = baseUrlStatus.value.baseUrl ?? baseUrlDraft.value
      return true
    } catch (err) {
      baseUrlError.value =
        errorCode(err) === 'INVALID_BASE_URL'
          ? t('settings.openaiKey.errors.invalidBaseUrl')
          : t('settings.openaiKey.errors.baseUrlSave')
      return false
    } finally {
      saving.value = false
    }
  }

  /** Clear the in-app Base URL, reverting to env or the public OpenAI default. */
  async function clearBaseUrl(): Promise<void> {
    saving.value = true
    baseUrlError.value = null
    testResult.value = null
    try {
      baseUrlStatus.value = await $fetch<OpenAiBaseUrlStatus>('/api/settings/openai-base-url', {
        method: 'DELETE',
      })
      baseUrlDraft.value = baseUrlStatus.value.baseUrl ?? ''
    } catch {
      baseUrlError.value = t('settings.openaiKey.errors.baseUrlClear')
    } finally {
      saving.value = false
    }
  }

  /**
   * Test the currently shown URL + key (drafts when provided). Never writes
   * config or audio. Typed `{ ok }` / `{ ok: false, code }` — never the key.
   */
  async function testKey(drafts?: { baseUrl?: string; key?: string }): Promise<void> {
    testing.value = true
    error.value = null
    testResult.value = null
    try {
      testResult.value = await $fetch<ConnectionTestResult>('/api/settings/openai-key/test', {
        method: 'POST',
        body: drafts ?? {},
      })
    } catch {
      testResult.value = { ok: false, code: 'UNKNOWN' }
    } finally {
      testing.value = false
    }
  }

  return {
    status,
    baseUrlStatus,
    baseUrlDraft,
    loading,
    saving,
    testing,
    testResult,
    error,
    baseUrlError,
    load,
    setKey,
    clearKey,
    setBaseUrl,
    clearBaseUrl,
    testKey,
  }
}
