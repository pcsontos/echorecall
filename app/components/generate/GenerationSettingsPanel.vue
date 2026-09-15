<script setup lang="ts">
import {
  BUILTIN_MODEL_PROVIDER,
  FORMATS,
  MODELS,
  OTHER_MODEL_PROVIDER,
  firstModelIdForProvider,
  listModelProviders,
  modelProviderOf,
  modelsForProvider,
  type CatalogEntry,
  type Format,
  type Model,
  type Voice,
} from '#core/client'

// 007 · US1/US3 (FR-005/FR-013) / 009 · US2: Voice / Model / Format over the merged
// catalog. Speed is not exposed (synthesis always runs at 1×). A current value
// missing from the catalog is appended as a retained item — no write-in control.
// Provider filters Model; it is not persisted separately.
type GenSettingField = 'voiceId' | 'model' | 'format'

const props = defineProps<{
  voices: ReadonlyArray<CatalogEntry | Voice>
  models?: ReadonlyArray<CatalogEntry>
}>()
const voiceId = defineModel<string>('voiceId', { required: true })
const model = defineModel<Model>('model', { required: true })
const format = defineModel<Format>('format', { required: true })
const emit = defineEmits<{ reset: [field: GenSettingField] }>()
const { t } = useI18n()

function asEntries(
  items: ReadonlyArray<CatalogEntry | Voice> | undefined,
  fallback: CatalogEntry[],
): CatalogEntry[] {
  if (!items || items.length === 0) return fallback
  return items.map((item) => {
    const source = 'source' in item ? item.source : 'builtin'
    const provider = 'provider' in item ? item.provider : undefined
    return provider
      ? { id: item.id, label: item.label, source, provider }
      : { id: item.id, label: item.label, source }
  })
}

function withRetained(items: CatalogEntry[], current: string): CatalogEntry[] {
  if (!current || items.some((item) => item.id === current)) return items
  return [
    ...items,
    { id: current, label: t('generateNext.settings.retained', { id: current }), source: 'retained' },
  ]
}

const builtinModels: CatalogEntry[] = MODELS.map((id) => ({
  id,
  label: id,
  source: 'builtin',
  provider: BUILTIN_MODEL_PROVIDER,
}))
const voiceItems = computed(() =>
  withRetained(asEntries(props.voices, []), voiceId.value),
)
const allModels = computed(() =>
  withRetained(asEntries(props.models, builtinModels), model.value),
)
const providers = computed(() => listModelProviders(allModels.value))
const showProvider = computed(() => providers.value.length > 1)
const providerItems = computed(() =>
  providers.value.map((id) => ({
    id,
    label: id === OTHER_MODEL_PROVIDER ? t('generateNext.settings.providerOther') : id,
  })),
)
const selectedProvider = computed({
  get(): string {
    const current = allModels.value.find((entry) => entry.id === model.value)
    return current ? modelProviderOf(current) : (providers.value[0] ?? BUILTIN_MODEL_PROVIDER)
  },
  set(provider: string) {
    if (modelsForProvider(allModels.value, provider).some((entry) => entry.id === model.value)) {
      return
    }
    const next = firstModelIdForProvider(allModels.value, provider)
    if (next) model.value = next
  },
})
const modelItems = computed(() => modelsForProvider(allModels.value, selectedProvider.value))
const formatItems = FORMATS.map((f) => ({ id: f.id, label: f.ext.toUpperCase() }))
</script>

<template>
  <div data-test="generation-settings" class="flex flex-col gap-3">
    <div data-test="gen-settings-model-row" class="flex items-end gap-2">
      <UFormField
        v-if="showProvider"
        :label="t('generateNext.settings.provider')"
        class="w-40 shrink-0"
      >
        <USelectMenu
          v-model="selectedProvider"
          data-test="provider"
          value-key="id"
          label-key="label"
          :items="providerItems"
          :create-item="false"
          class="w-full"
        />
      </UFormField>
      <UFormField :label="t('generateNext.settings.model')" class="min-w-0 flex-1">
        <USelectMenu
          v-model="model"
          data-test="model"
          value-key="id"
          label-key="label"
          :items="modelItems"
          :create-item="false"
          class="w-full"
        />
      </UFormField>
      <UButton
        data-test="gen-reset-model"
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        :aria-label="t('generateNext.settings.reset', { field: t('generateNext.settings.model') })"
        @click="emit('reset', 'model')"
      />
    </div>

    <div data-test="gen-settings-voice-format" class="grid grid-cols-2 items-end gap-2">
      <div class="flex min-w-0 items-end gap-2">
        <UFormField :label="t('generateNext.settings.voice')" class="min-w-0 flex-1">
          <USelectMenu
            v-model="voiceId"
            data-test="voice"
            value-key="id"
            label-key="label"
            :items="voiceItems"
            :create-item="false"
            class="w-full"
          />
        </UFormField>
        <UButton
          data-test="gen-reset-voice"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          :aria-label="t('generateNext.settings.reset', { field: t('generateNext.settings.voice') })"
          @click="emit('reset', 'voiceId')"
        />
      </div>
      <div class="flex min-w-0 items-end gap-2">
        <UFormField :label="t('generateNext.settings.format')" class="min-w-0 flex-1">
          <USelectMenu
            v-model="format"
            data-test="format"
            value-key="id"
            label-key="label"
            :items="formatItems"
            class="w-full"
          />
        </UFormField>
        <UButton
          data-test="gen-reset-format"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="ghost"
          :aria-label="t('generateNext.settings.reset', { field: t('generateNext.settings.format') })"
          @click="emit('reset', 'format')"
        />
      </div>
    </div>
  </div>
</template>
