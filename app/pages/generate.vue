<script setup lang="ts">
import type { BatchBaseInput, Format, Metadata, Model } from '#core/client'

// 007 · The Generate surface (FR-002 cutover). Single vertically-scrolling page — page intro →
// two-column editor (Script / Generation settings) with a full-width Metadata row below →
// generation action bar + pending-queue panel. A focused queue builder: generated
// recordings are managed on the separate Library tab (/library), so the Generate page does
// not embed the Library workspace. Replaced the 005 two-pane QueueList + metadata editor.
// Accent = the app's `indigo` primary.
// View preferences are read first so the queue can be told which metadata fields are visible
// (only visible fields are saved onto rows — Configure Visible Fields, 007).
const { genSettings, setGenSetting, resetGenSetting, metadataFields, setMetadataFields } =
  useViewPreferences()
const { catalog, loadCatalog } = useSpeechCatalog()
const {
  items,
  voiceId,
  model,
  format,
  speed,
  metadata,
  checkedIds,
  generateTarget,
  queueCost,
  serialize,
  loadDocument,
  projectMetadata,
  addItem,
  appendImported,
  removeItem,
  removeMany,
  toggleChecked,
  toggleAll,
  reorder,
  clear: clearQueue,
  applyMetadataToPending,
  stampDerivedMetadata,
  setDefaults,
} = useQueue({
  visibleMetadataFields: () => metadataFields.value.filter((f) => f.visible).map((f) => f.id),
  gatewayRates: () => catalog.value.rates,
})
const { generating, progress, generateAll, requestCancel, reset } = useGeneration()
const { exportQueue, importQueue } = useQueueFile()
const {
  state: batchImportState,
  preview: batchPreview,
  error: batchImportError,
  selectBatchFile,
  cancelBatchImport,
  confirmedInputs,
  finishBatchImport,
  downloadBatchExample,
} = useBatchImport()
const { t } = useI18n()
const batchStatusMessage = computed(() => {
  if (batchImportState.value.status === 'reading' || batchImportState.value.status === 'parsing') {
    return t('generateNext.batchImport.parsing', { filename: batchImportState.value.filename })
  }
  if (batchImportState.value.status === 'preview') {
    return t('generateNext.batchImport.ready', {
      valid: batchImportState.value.preview.counts.valid,
      rejected: batchImportState.value.preview.counts.rejected,
    })
  }
  return ''
})
const batchErrorMessage = computed(() => {
  if (!batchImportError.value) return ''
  const error = batchImportError.value
  const message = t(`generateNext.batchImport.error.${error.code}`)
  const location = [
    error.path,
    error.line === undefined ? undefined : `line ${error.line}`,
    error.column === undefined ? undefined : `column ${error.column}`,
  ].filter(Boolean).join(' · ')
  return location ? `${message} (${location})` : message
})

// The first track number the derived Track counts up from (session-only, defaults to 1). Set
// in the action bar; passed to stampDerivedMetadata so row 1 gets this number and later rows
// increment from it. Not persisted — a fresh session starts back at 1.
const startTrack = ref(1)

// Configure Visible Fields modal state (007): the applied set persists via useViewPreferences,
// which drives both the form's rendered fields and the queue's metadata projection.
const metadataFieldsOpen = ref(false)
function onApplyMetadataFields(next: typeof metadataFields.value) {
  setMetadataFields(next)
}

// 007 · US3 (G-DEFAULTS, FR-012/FR-013). Each of Voice/Model/Format resolves as
// last-selected (client, `genSettings`) → configured default (server) → built-in fallback.
// The configured half is fetched once on mount. Explicit update handlers persist user changes
// and protect choices made while the defaults request is still pending from being overwritten
// by initialization. A per-field reset forgets the last-selected value and restores the
// configured default (or the built-in fallback when none is configured). Speed is not resolved here:
// synthesis always runs at 1× (`speed` stays the queue's fixed default), so it has no
// UI control and no defaults resolution.
type ConfiguredDefaults = { voiceId?: string; model?: string; format?: string }
type GenSettingField = keyof ConfiguredDefaults
const configuredDefaults = ref<ConfiguredDefaults>({})
const settingsReady = ref(false)
const settingsChangedDuringLoad = new Set<GenSettingField>()

const fallbackVoice = () => catalog.value.voices[0]?.id ?? ''

function resolveSettings() {
  const ls = genSettings.value
  const cd = configuredDefaults.value
  if (!settingsChangedDuringLoad.has('voiceId')) {
    voiceId.value = ls.voiceId ?? cd.voiceId ?? fallbackVoice()
  }
  if (!settingsChangedDuringLoad.has('model')) {
    model.value = (ls.model ?? cd.model ?? 'gpt-4o-mini-tts') as Model
  }
  if (!settingsChangedDuringLoad.has('format')) {
    format.value = (ls.format ?? cd.format ?? 'mp3') as Format
  }
}

function onVoiceChanged(value: string) {
  if (!settingsReady.value) settingsChangedDuringLoad.add('voiceId')
  voiceId.value = value
  setGenSetting('voiceId', value)
}

function onModelChanged(value: Model) {
  if (!settingsReady.value) settingsChangedDuringLoad.add('model')
  model.value = value
  setGenSetting('model', value)
}

function onFormatChanged(value: Format) {
  if (!settingsReady.value) settingsChangedDuringLoad.add('format')
  format.value = value
  setGenSetting('format', value)
}

/** Per-field reset (FR-013): forget the last-selected value, restore the configured default. */
function onResetSetting(field: GenSettingField) {
  resetGenSetting(field)
  if (!settingsReady.value) settingsChangedDuringLoad.delete(field)
  const cd = configuredDefaults.value
  if (field === 'voiceId') voiceId.value = cd.voiceId ?? fallbackVoice()
  else if (field === 'model') model.value = (cd.model ?? 'gpt-4o-mini-tts') as Model
  else format.value = (cd.format ?? 'mp3') as Format
}

// Hidden inputs: `.json` saved-queue load and the unified batch picker.
const queueFileInput = ref<HTMLInputElement | null>(null)
const batchFileInput = ref<HTMLInputElement | null>(null)
const pendingDoc = ref<ReturnType<typeof serialize> | null>(null)
const confirmReplace = ref(false)
const importError = ref<string | null>(null)

onMounted(async () => {
  // Catalog, default tags, and generation defaults are best-effort: a degraded/offline env
  // just falls back to built-ins rather than blanking the whole page.
  try {
    await loadCatalog()
  } catch {
    // catalog optional — useSpeechCatalog already keeps builtin + catalogError
  }
  try {
    const { defaultTags } = await $fetch<{ defaultTags: Metadata }>('/api/settings/defaults')
    if (defaultTags && Object.keys(defaultTags).length > 0) setDefaults(defaultTags)
  } catch {
    // defaults optional
  }
  try {
    const { generationDefaults } = await $fetch<{ generationDefaults: ConfiguredDefaults }>(
      '/api/settings/generation-defaults',
    )
    configuredDefaults.value = generationDefaults ?? {}
  } catch {
    // generation defaults optional
  }
  // Resolve the three controls (last-selected → configured → fallback), preserving any
  // explicit user choices made while these best-effort requests were pending.
  resolveSettings()
  await nextTick()
  settingsReady.value = true
})

function onAdd(text: string) {
  addItem(text)
}

/** Bulk-remove the currently checked rows from the queue (client-only, no confirm needed). */
function onDeleteSelected() {
  removeMany([...checkedIds.value])
}

// 007 · US4 (G-CANCEL, FR-014): the generation progress modal opens on Generate,
// disables the page while the run is in flight (`generating`), and — via the modal's
// in-modal confirm — allows a graceful stop. It stays open on the end summary until the
// user dismisses it (`done`), which closes it and resets the progress state.
const progressOpen = ref(false)

async function onGenerate() {
  if (items.value.length === 0 || generating.value) return
  // Resolve the target once (checked-else-all), stamp the form metadata onto its
  // un-edited rows, derive the Title + Track that are not user-editable on Generate,
  // then generate and drop each success from the queue. useGeneration stamps a blank
  // recording date per item and retains it only when that item succeeds (US6 / FR-020).
  const target = generateTarget.value
  applyMetadataToPending(target)
  stampDerivedMetadata(target, startTrack.value)
  reset()
  progressOpen.value = true
  await generateAll(target, speed.value, removeItem)
  // Generated recordings are managed on the Library tab (/library); the run's outcome is
  // shown in the progress modal's end summary.
}

/** The modal's cancel-confirm was accepted: request a graceful stop (finish in-flight). */
function onProgressConfirmCancel() {
  requestCancel()
}

/** Dismiss the end summary: close the modal and clear the progress state. */
function onProgressDone() {
  progressOpen.value = false
  reset()
}

function onSaveQueue() {
  exportQueue(serialize())
}

function onLoadQueue() {
  queueFileInput.value?.click()
}

function onImportBatch() {
  batchFileInput.value?.click()
}

/** Validate a picked `.json` queue file and replace the queue with its rows. */
async function onQueueFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-selecting the same file
  if (!file) return
  const result = await importQueue(file)
  if (!result.ok) {
    importError.value = t(`generate.queueFile.error.${result.reason}`)
    return
  }
  importError.value = null
  if (items.value.length > 0) {
    pendingDoc.value = result.doc
    confirmReplace.value = true
  } else {
    loadDocument(result.doc)
  }
}

function onConfirmReplace() {
  if (pendingDoc.value) loadDocument(pendingDoc.value)
  pendingDoc.value = null
  confirmReplace.value = false
}

function onCancelReplace() {
  pendingDoc.value = null
  confirmReplace.value = false
}

/** Freeze current Generate values, then parse a picked batch into a preview. */
async function onBatchFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importError.value = null
  const base: BatchBaseInput = {
    voiceId: voiceId.value,
    model: model.value,
    format: format.value,
    metadata: projectMetadata(metadata.value),
  }
  await selectBatchFile(file, base)
}

function onConfirmBatchImport() {
  if (!batchPreview.value?.canConfirm) return
  const filename = batchPreview.value.filename
  const metadataMode = batchPreview.value.format === 'text' ? 'text' : 'structured'
  const appended = appendImported(confirmedInputs(), filename, { metadataMode })
  finishBatchImport(appended.length)
}

function onCancelBatchImport() {
  cancelBatchImport()
  nextTick(() => {
    document.querySelector<HTMLButtonElement>('[data-test="action-import-batch"]')?.focus()
  })
}
</script>

<template>
  <div data-test="generate-next" class="flex flex-col gap-6" :inert="generating">
    <!-- Page intro -->
    <section data-test="gen-page-intro" class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold">{{ t('generateNext.intro.title') }}</h1>
      <p class="text-sm text-muted">{{ t('generateNext.intro.subtitle') }}</p>
    </section>

    <!-- Two-column generation editor: Script + Generation settings on the top row,
         Metadata on its own full-width row below (no resizable split — FR-003). -->
    <section data-test="gen-editor" class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div data-test="gen-col-script" class="flex flex-col gap-2">
        <ScriptEntryPanel @add="onAdd" />
      </div>
      <div data-test="gen-col-settings" class="flex flex-col gap-2">
        <p
          v-if="catalog.catalogError"
          data-test="catalog-error"
          role="status"
          class="text-sm text-muted"
        >
          {{ t(`generateNext.settings.catalogError.${catalog.catalogError}`) }}
        </p>
        <GenerationSettingsPanel
          :voice-id="voiceId"
          :model="model"
          :format="format"
          :voices="catalog.voices"
          :models="catalog.models"
          @update:voice-id="onVoiceChanged"
          @update:model="onModelChanged"
          @update:format="onFormatChanged"
          @reset="onResetSetting"
        />
      </div>
      <div data-test="gen-col-metadata" class="flex flex-col gap-2 lg:col-span-2">
        <MetadataFields
          v-model="metadata"
          :fields="metadataFields"
          @configure="metadataFieldsOpen = true"
        />
      </div>
    </section>

    <!-- Generation action bar + pending-queue panel -->
    <section data-test="gen-action-bar-region" class="flex flex-col gap-3">
      <GenerationActionBar
        v-model:start-track="startTrack"
        :queue-count="items.length"
        :busy="generating"
        :total-usd="queueCost.totalUsd"
        :unavailable-count="queueCost.unavailableCount"
        @save-queue="onSaveQueue"
        @load-queue="onLoadQueue"
        @import-batch="onImportBatch"
        @download-batch-example="downloadBatchExample"
        @generate="onGenerate"
      />
      <QueuePanel
        :items="items"
        :cost="queueCost"
        :selected-ids="checkedIds"
        @remove="removeItem"
        @toggle="toggleChecked"
        @toggle-all="toggleAll(items)"
        @delete-selected="onDeleteSelected"
        @reorder="reorder"
        @clear="clearQueue"
      />
      <p v-if="importError" data-test="queue-import-error" role="alert" class="text-sm text-error">
        {{ importError }}
      </p>
      <p
        v-if="batchStatusMessage"
        data-test="batch-import-status"
        role="status"
        aria-live="polite"
        class="sr-only"
      >
        {{ batchStatusMessage }}
      </p>
      <p
        v-if="batchImportError"
        data-test="batch-import-error"
        role="alert"
        class="text-sm text-error"
      >
        {{ batchErrorMessage }}
      </p>
      <p
        v-if="batchImportState.status === 'imported'"
        data-test="batch-import-success"
        role="status"
        class="text-sm text-success"
      >
        {{ t('generateNext.batchImport.success', {
          added: batchImportState.added,
          rejected: batchImportState.rejected,
          filename: batchImportState.filename,
        }) }}
      </p>
    </section>

    <!-- Hidden saved-queue and unified batch inputs (display:none keeps them out of the
         tab order / a11y tree; the action-bar buttons are the accessible triggers). -->
    <input
      ref="queueFileInput"
      data-test="queue-file-input"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onQueueFileChosen"
    >
    <input
      ref="batchFileInput"
      data-test="batch-file-input"
      type="file"
      accept=".txt,.yaml,.yml,.json,text/plain,application/yaml,text/yaml,application/json"
      class="hidden"
      @change="onBatchFileChosen"
    >

    <BatchImportPreviewDialog
      v-if="batchPreview"
      :open="true"
      :preview="batchPreview"
      @confirm="onConfirmBatchImport"
      @cancel="onCancelBatchImport"
    />

    <ConfirmDialog
      :open="confirmReplace"
      :title="t('generate.queueFile.replaceTitle')"
      :message="t('generate.queueFile.replaceMessage', { count: items.length })"
      :confirm-label="t('generate.queueFile.replaceConfirm')"
      :cancel-label="t('generate.queueFile.replaceCancel')"
      @confirm="onConfirmReplace"
      @cancel="onCancelReplace"
    />

    <!-- Generation progress modal (US4 — teleports to body, so the inert root above
         never disables it). Opens on Generate; the modal's in-modal confirm drives a
         graceful stop; the end summary stays until dismissed. -->
    <GenerationProgressModal
      :open="progressOpen"
      :progress="progress"
      @confirm-cancel="onProgressConfirmCancel"
      @done="onProgressDone"
    />

    <!-- Configure Visible Fields modal for the metadata editor (007): toggle + reorder the
         fields; only visible fields render in the form and are saved onto queue rows. -->
    <MetadataFieldsDialog
      v-model:open="metadataFieldsOpen"
      :fields="metadataFields"
      @apply="onApplyMetadataFields"
    />
  </div>
</template>
