<script setup lang="ts">
// In-app OpenAI key (US8 / FR-041–045) plus optional API Base URL (009 · US1).
// The key is write-only (masked status only). The Base URL is configuration and
// is shown in full. Saving the URL does not require Test Connection or APP_SECRET.
const { t } = useI18n()
const {
  status,
  baseUrlStatus,
  baseUrlDraft,
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
} = useSettings()

const draft = ref('')

onMounted(load)

const storageDisabled = computed(() => status.value?.secretConfigured === false)
const canTest = computed(() => Boolean(status.value?.configured || draft.value.trim()))

async function onSave() {
  // Guard against the Enter key bypassing the button's disabled/loading state
  // (concurrent submits or a submit while storage is disabled).
  if (saving.value || storageDisabled.value) return
  const key = draft.value.trim()
  if (!key) return
  if (await setKey(key)) draft.value = ''
}

async function onSaveUrl() {
  if (saving.value) return
  const raw = baseUrlDraft.value.trim()
  if (!raw) {
    await clearBaseUrl()
    return
  }
  await setBaseUrl(raw)
}

async function onClearUrl() {
  if (saving.value) return
  await clearBaseUrl()
}

async function onTest() {
  if (testing.value || !canTest.value) return
  const body: { baseUrl?: string; key?: string } = { baseUrl: baseUrlDraft.value }
  const key = draft.value.trim()
  if (key) body.key = key
  await testKey(body)
}
</script>

<template>
  <section aria-labelledby="openai-key-heading" class="flex flex-col gap-3">
    <h2 id="openai-key-heading" class="text-base font-semibold">
      {{ t('settings.openaiKey.title') }}
    </h2>
    <p class="text-sm text-muted">{{ t('settings.openaiKey.description') }}</p>

    <p
      v-if="storageDisabled"
      data-test="key-storage-disabled"
      class="rounded border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
    >
      {{ t('settings.openaiKey.disabledNotice') }}
    </p>

    <p data-test="key-status" class="text-sm">
      <template v-if="status?.configured">
        {{ t('settings.openaiKey.current') }}
        <span class="font-mono">{{ status.masked }}</span>
        <span class="text-muted"> · {{ t(`settings.openaiKey.source.${status.source}`) }}</span>
      </template>
      <template v-else>{{ t('settings.openaiKey.none') }}</template>
    </p>

    <UFormField :label="t('settings.openaiKey.inputLabel')">
      <UInput
        v-model="draft"
        data-test="key-input"
        type="password"
        autocomplete="off"
        :placeholder="t('settings.openaiKey.placeholder')"
        :disabled="storageDisabled || saving"
        class="w-full"
        @keydown.enter="onSave"
      />
    </UFormField>

    <p class="text-sm text-muted">{{ t('settings.openaiKey.baseUrlDescription') }}</p>
    <p data-test="base-url-status" class="text-sm">
      <template v-if="baseUrlStatus?.baseUrl">
        {{ t('settings.openaiKey.baseUrlCurrent') }}
        <span class="font-mono">{{ baseUrlStatus.baseUrl }}</span>
        <span class="text-muted">
          · {{ t(`settings.openaiKey.source.${baseUrlStatus.source}`) }}
        </span>
      </template>
      <template v-else>{{ t('settings.openaiKey.baseUrlNone') }}</template>
    </p>

    <UFormField :label="t('settings.openaiKey.baseUrlLabel')">
      <UInput
        v-model="baseUrlDraft"
        data-test="base-url-input"
        type="text"
        autocomplete="off"
        :placeholder="t('settings.openaiKey.baseUrlPlaceholder')"
        :disabled="saving"
        class="w-full"
        @keydown.enter="onSaveUrl"
      />
    </UFormField>

    <div class="flex flex-wrap gap-2">
      <UButton
        data-test="key-save"
        icon="i-lucide-key-round"
        :loading="saving"
        :disabled="storageDisabled || !draft.trim()"
        @click="onSave"
      >
        {{ t('settings.openaiKey.save') }}
      </UButton>
      <UButton
        data-test="key-clear"
        variant="outline"
        :loading="saving"
        :disabled="storageDisabled || status?.source !== 'ui'"
        @click="clearKey"
      >
        {{ t('settings.openaiKey.clear') }}
      </UButton>
      <UButton
        data-test="base-url-save"
        variant="outline"
        :loading="saving"
        @click="onSaveUrl"
      >
        {{ t('settings.openaiKey.baseUrlSave') }}
      </UButton>
      <UButton
        data-test="base-url-clear"
        variant="outline"
        :loading="saving"
        :disabled="baseUrlStatus?.source !== 'ui'"
        @click="onClearUrl"
      >
        {{ t('settings.openaiKey.baseUrlClear') }}
      </UButton>
      <UButton
        data-test="key-test"
        variant="outline"
        icon="i-lucide-plug"
        :loading="testing"
        :disabled="!canTest"
        @click="onTest"
      >
        {{ t('settings.openaiKey.test') }}
      </UButton>
    </div>

    <p v-if="testResult?.ok" data-test="key-test-ok" class="text-sm text-success">
      {{ t('settings.openaiKey.testOk') }}
    </p>
    <p
      v-else-if="testResult && !testResult.ok"
      data-test="key-test-fail"
      class="text-sm text-error"
    >
      {{ t(`settings.openaiKey.testCodes.${testResult.code}`) }}
    </p>
    <p v-if="error" data-test="key-error" class="text-sm text-error">{{ error }}</p>
    <p v-if="baseUrlError" data-test="base-url-error" class="text-sm text-error">
      {{ baseUrlError }}
    </p>
  </section>
</template>
