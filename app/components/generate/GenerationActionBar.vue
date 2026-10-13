<script setup lang="ts">
// 007 · US1 (FR-007): the generation action bar — a queue summary + count badge and
// Save queue / Load queue / Import batch / example + guide discovery / Generate.
// Generate is disabled when the queue is empty or a run is in flight.
// `totalUsd`/`unavailableCount` come from the per-item cost estimate (US5): the
// queue total + a "+N unavailable" note (display-only).
const props = withDefaults(
  defineProps<{
    queueCount: number
    busy?: boolean
    totalUsd?: number
    unavailableCount?: number
  }>(),
  { busy: false, totalUsd: 0, unavailableCount: 0 },
)
const emit = defineEmits<{
  'save-queue': []
  'load-queue': []
  'import-batch': []
  'download-batch-example': []
  generate: []
}>()
// The first track number the derived Track counts up from (007). Session-only — owned by the
// page, defaults to 1 (the first row is track 1, matching the prior always-1-based behavior).
const startTrack = defineModel<number>('startTrack', { default: 1 })
const { t, locale } = useI18n()

/** Format the queue total in the active locale; sub-cent estimates keep up to 4 decimals. */
const totalLabel = computed(() =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(props.totalUsd),
)
</script>

<template>
  <div
    data-test="action-bar"
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted">{{ t('generateNext.actionBar.summary') }}</span>
      <UBadge data-test="queue-count-badge" color="primary" variant="subtle">{{ queueCount }}</UBadge>
      <span data-test="queue-total-cost" class="text-sm text-muted">
        {{ t('generateNext.cost.total', { amount: totalLabel }) }}
      </span>
      <span
        v-if="unavailableCount > 0"
        data-test="queue-unavailable-note"
        class="text-xs text-muted"
      >
        {{ t('generateNext.cost.unavailableNote', { count: unavailableCount }) }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1.5">
        <span id="start-track-label" class="text-sm text-muted whitespace-nowrap">
          {{ t('generateNext.actionBar.startTrack') }}
        </span>
        <UInputNumber
          v-model="startTrack"
          data-test="start-track-input"
          :min="1"
          :aria-label="t('generateNext.actionBar.startTrack')"
          aria-labelledby="start-track-label"
          class="w-24"
        />
      </div>
      <UButton
        data-test="action-save-queue"
        color="neutral"
        variant="outline"
        icon="i-lucide-save"
        :disabled="queueCount === 0"
        @click="emit('save-queue')"
      >
        {{ t('generateNext.actionBar.saveQueue') }}
      </UButton>
      <UButton
        data-test="action-load-queue"
        color="neutral"
        variant="outline"
        icon="i-lucide-folder-open"
        @click="emit('load-queue')"
      >
        {{ t('generateNext.actionBar.loadQueue') }}
      </UButton>
      <UButton
        data-test="action-import-batch"
        color="neutral"
        variant="outline"
        icon="i-lucide-upload"
        @click="emit('import-batch')"
      >
        {{ t('generateNext.actionBar.importBatch') }}
      </UButton>
      <UButton
        data-test="action-download-batch-example"
        color="neutral"
        variant="outline"
        icon="i-lucide-file-down"
        @click="emit('download-batch-example')"
      >
        {{ t('generateNext.actionBar.downloadBatchExample') }}
      </UButton>
      <UButton
        data-test="action-batch-documentation"
        to="https://github.com/PeterOnCode/echorecall/blob/main/docs/batch-import.md"
        target="_blank"
        color="neutral"
        variant="ghost"
        icon="i-lucide-book-open"
      >
        {{ t('generateNext.actionBar.batchDocumentation') }}
      </UButton>
      <UButton
        data-test="action-generate"
        icon="i-lucide-mic"
        :disabled="queueCount === 0 || busy"
        :loading="busy"
        @click="emit('generate')"
      >
        {{ t('generateNext.actionBar.generate') }}
      </UButton>
    </div>
  </div>
</template>
