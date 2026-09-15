import type {
  CostEstimate,
  Format,
  GatewayRate,
  ListItem,
  Metadata,
  Model,
  ResolvedQueueInput,
} from '#core/client'
import { MAX_INPUT_LENGTH, estimateItemCost, formatInfo, parseUploadText } from '#core/client'
import { toRaw } from 'vue'
// Types only (imported by relative path per the repo typecheck gotcha): the saved-
// queue document `serialize`/`loadDocument` round-trip through (005 · US2 / FR-013).
import type { QueueFileDocument, QueueFileItem } from './useQueueFile'
import type { MetadataFieldId } from './useViewPreferences'

export type ItemStatus = 'queued' | 'generating' | 'done' | 'failed'

/** A queue row plus its transient per-item generation status (never persisted). */
export interface QueueItem extends ListItem {
  status: ItemStatus
  error?: string
  result?: { id: string; audioUrl: string; skippedTags?: string[] }
  /**
   * Where the row came from (005 source column): `'upload'` carries the uploaded
   * filename in {@link QueueItem.sourceName}; `'text'` is an ad-hoc typed entry.
   */
  source: 'upload' | 'text'
  /** The uploaded file's name when `source === 'upload'`; absent for typed rows. */
  sourceName?: string
  /**
   * Set once the row's metadata is edited individually (US3). Tells
   * {@link useQueue.applyMetadataToPending} to leave this row alone so its per-row
   * metadata survives generation instead of being overwritten by the shared form set.
   */
  metadataEdited?: boolean
}

export interface UploadSummary {
  added: number
  skippedBlank: number
  rejectedTooLong: number
}

export interface AppendImportedOptions {
  metadataMode: 'structured' | 'text'
}

/**
 * Client-derived cost aggregate for the queue (007 · US5 / G-PRICING, FR-018/FR-019).
 * `perItem` maps each row's clientId to its estimate (from `item.text.length` +
 * `item.model`); `totalUsd` sums ONLY estimable amounts (an unavailable item is never
 * counted as $0); `unavailableCount` drives the "+ N unavailable" note. Display-only —
 * derived, never persisted, and never gates Generate.
 */
export interface QueueCost {
  perItem: Map<string, CostEstimate>
  totalUsd: number
  unavailableCount: number
}

/** Fields a single queue row can be edited with (US3); each key is optional. */
export type ItemPatch = Partial<Pick<ListItem, 'text' | 'voiceId' | 'model' | 'format' | 'instructions' | 'metadata'>>

/**
 * Client-side queue filters (005 · US3 / FR-010, data-model §2). Each set field
 * narrows the visible rows; an unset field imposes no constraint. Applied in-memory
 * over the queue alongside the free-text search.
 */
export interface QueueFilters {
  voiceId?: string
  format?: Format
  album?: string
  recordedAt?: string
  language?: string
}

/** Why a text edit was refused (empty after trim, or over the input cap). */
export type TextRejection = 'empty' | 'tooLong'

/** Outcome of {@link useQueue.updateItem}: a refused edit, or the applied row. */
export type UpdateResult =
  | { ok: false; reason: TextRejection | 'notFound' }
  | { ok: true; item: QueueItem; tagsSkipped: boolean }

/**
 * Validate queue-row text the same way uploads and generation do: trimmed,
 * non-blank, within {@link MAX_INPUT_LENGTH}. Returns the trimmed value to store
 * on success, or the rejection reason so the editor can keep the previous value.
 */
export function validateItemText(text: string): { ok: true; text: string } | { ok: false; reason: TextRejection } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'tooLong' }
  return { ok: true, text: trimmed }
}

/** True when a format carries no tags (AAC/PCM), so embedded metadata is skipped. */
export function isUntaggableFormat(format: Format): boolean {
  return formatInfo(format)?.taggable === 'none'
}

/** Options for {@link useQueue}. */
export interface UseQueueOptions {
  /**
   * The metadata fields currently visible in the Configure Visible Fields dialog (007). Only
   * these fields are written onto queue rows; a hidden configurable field is stripped from a
   * row's saved metadata. Omitted keeps every field (the pre-feature behavior). Non-configurable
   * keys (e.g. deployment default tags for fields not in the metadata form) always pass through.
   */
  visibleMetadataFields?: () => readonly MetadataFieldId[]
  /** Gateway-reported rates from GET /api/tts/catalog. Empty/omitted → unknown models unavailable. */
  gatewayRates?: () => Readonly<Record<string, GatewayRate>>
}

/**
 * Ephemeral batch queue (FR-001/010). Holds the per-row list plus the form-level
 * voice/model/format/speed applied to every row. Lives only in client state and
 * is never sent anywhere except, row by row, to the generate endpoint.
 */
export function useQueue(options?: UseQueueOptions) {
  const items = ref<QueueItem[]>([])
  const voiceId = ref('')
  const model = ref<Model>('gpt-4o-mini-tts')
  const format = ref<Format>('mp3')
  const speed = ref(1)
  // Form-level metadata applied to every newly-added row (US2). Each row gets its
  // own deep copy so later per-row edits (US3) never mutate the shared defaults.
  const metadata = ref<Metadata>({})
  // Which row is shown in the detail editor (005 redesign); driven by list
  // selection and toolbar prev/next navigation.
  const activeId = ref<string | null>(null)
  // Multi-select set (by clientId) backing the checkbox column — used for bulk
  // delete and as the Generate target (checked-else-all).
  const checkedIds = ref<Set<string>>(new Set())
  // Free-text search (over item text + uploaded filename) and per-field filters that
  // narrow the visible rows client-side (US3 / FR-009/010).
  const searchTerm = ref('')
  const filters = ref<QueueFilters>({})

  // The configurable metadata fields (mirrors useViewPreferences' METADATA_FIELD_IDS). Only
  // the currently-visible subset is written onto a row; a hidden configurable field is dropped
  // before the row's metadata is saved (007). Any key outside this list — e.g. deployment
  // defaults for fields not in the metadata form, or the derived `title`/`track` — is always
  // preserved. `title` and `track` are intentionally NOT configurable: they are derived at
  // generation time by {@link stampDerivedMetadata}, so the projection must never strip them.
  const configurableMetadataFields: MetadataFieldId[] = [
    'artist', 'album', 'genre', 'recordedAt', 'comment', 'languages', 'customText', 'customUrl',
  ]
  const visibleMetadataFields = () => options?.visibleMetadataFields?.() ?? configurableMetadataFields
  // A primitive derived from the visible set so the metadata watcher re-projects rows when the
  // user shows/hides a field (not only when the form metadata itself changes).
  const visibleMetadataKey = computed(() => [...visibleMetadataFields()].join(','))

  /** Clone `m`, dropping any configurable field that is currently hidden (007). */
  function projectMetadata(m: Metadata): Metadata {
    const visible = new Set<string>(visibleMetadataFields())
    const clone = cloneMetadata(m)
    for (const key of configurableMetadataFields) {
      if (!visible.has(key)) Reflect.deleteProperty(clone, key)
    }
    return clone
  }

  // The form-level Voice/Model/Format/Metadata are live batch settings: editing any of them
  // rewrites that field on every row already in the queue — not just future rows — so the
  // per-item + total cost recalculates immediately (a Model change is what re-prices a row).
  // Since the redesigned Generate page has no per-row editor, the form is the only editor, so
  // a form change is an explicit "apply to all". Already-generated (`done`) rows are left
  // alone; metadata additionally skips rows edited individually (`metadataEdited`) so their
  // per-row values survive. Speed is intentionally NOT written through — it is not stored per
  // row and the cost estimate never depends on it (it applies only at generation time). An
  // empty queue makes every watcher a no-op, so mount-time resolution and per-field reset
  // (which both drive these refs) propagate harmlessly.
  watch(voiceId, (v) => {
    for (const item of items.value) if (item.status !== 'done') item.voiceId = v
  })
  watch(model, (v) => {
    for (const item of items.value) if (item.status !== 'done') item.model = v
  })
  watch(format, (v) => {
    for (const item of items.value) if (item.status !== 'done') item.format = v
  })
  // Re-projects on a form-metadata edit AND on a visibility change (showing a field re-adds its
  // value from the form; hiding one drops it from every non-edited row).
  watch(
    [metadata, visibleMetadataKey],
    () => {
      for (const item of items.value) {
        if (item.status !== 'done' && !item.metadataEdited) item.metadata = projectMetadata(metadata.value)
      }
    },
    { deep: true },
  )

  function makeItem(text: string, source: QueueItem['source'], sourceName?: string): QueueItem {
    // A new row inherits only the visible fields of the shared form metadata (007); the
    // recording date is NOT pre-stamped here (007 · US6 / FR-020). useGeneration fills it
    // for each attempt and retains it only on success, which also keeps failed retries fresh.
    const itemMetadata = projectMetadata(metadata.value)
    return {
      clientId: newClientId(),
      text,
      voiceId: voiceId.value,
      model: model.value,
      format: format.value,
      metadata: itemMetadata,
      status: 'queued',
      source,
      ...(sourceName ? { sourceName } : {}),
    }
  }

  /** Append one row from trimmed text; ignores blank input. */
  function addItem(text: string): QueueItem | null {
    const trimmed = text.trim()
    if (trimmed.length === 0) return null
    const item = makeItem(trimmed, 'text')
    items.value.push(item)
    return items.value.at(-1) ?? null
  }

  function addItems(texts: string[]): void {
    for (const text of texts) addItem(text)
  }

  /**
   * Parse uploaded `.txt` content into appended rows and report the summary. Each
   * row is tagged `source: 'upload'` and carries the originating `filename` (when
   * provided) so the queue's source column can show it (FR-006).
   */
  function addFromUpload(content: string, filename?: string): UploadSummary {
    const parsed = parseUploadText(content)
    for (const parsedItem of parsed.items) {
      items.value.push(makeItem(parsedItem.text, 'upload', filename))
    }
    return {
      added: parsed.added,
      skippedBlank: parsed.skippedBlank,
      rejectedTooLong: parsed.rejectedTooLong,
    }
  }

  /** Append already-normalized import inputs without disturbing existing queue state. */
  function appendImported(
    inputs: readonly ResolvedQueueInput[],
    filename: string,
    options: AppendImportedOptions,
  ): QueueItem[] {
    const appended = inputs.map((input): QueueItem => ({
      clientId: newClientId(),
      text: input.text,
      voiceId: input.voiceId,
      model: input.model,
      format: input.format,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
      metadata: cloneMetadata(input.metadata),
      metadataEdited: options.metadataMode === 'structured',
      status: 'queued',
      source: 'upload',
      sourceName: filename,
    }))
    items.value.push(...appended)
    return appended
  }

  function removeItem(clientId: string): void {
    items.value = items.value.filter((i) => i.clientId !== clientId)
    forget([clientId])
  }

  /** Drop client ids from the checked set and clear the active id if it was removed. */
  function forget(clientIds: string[]): void {
    if (checkedIds.value.size > 0) {
      const next = new Set(checkedIds.value)
      for (const id of clientIds) next.delete(id)
      checkedIds.value = next
    }
    if (activeId.value !== null && clientIds.includes(activeId.value)) activeId.value = null
  }

  /** Remove several rows at once (multi-select delete), clearing their state. */
  function removeMany(clientIds: string[]): void {
    const drop = new Set(clientIds)
    items.value = items.value.filter((i) => !drop.has(i.clientId))
    forget(clientIds)
  }

  /** Toggle one row's membership in the checked set (reassigned for reactivity). */
  function toggleChecked(clientId: string): void {
    const next = new Set(checkedIds.value)
    if (next.has(clientId)) next.delete(clientId)
    else next.add(clientId)
    checkedIds.value = next
  }

  /**
   * Header-checkbox behaviour over the given rows: if every one is already
   * checked, clear them; otherwise check them all. Operates on the rows passed in
   * (the currently visible/filtered set), leaving any off-list selection intact.
   */
  function toggleAll(rows: QueueItem[]): void {
    const ids = rows.map((r) => r.clientId)
    const allChecked = ids.length > 0 && ids.every((id) => checkedIds.value.has(id))
    const next = new Set(checkedIds.value)
    if (allChecked) for (const id of ids) next.delete(id)
    else for (const id of ids) next.add(id)
    checkedIds.value = next
  }

  /**
   * Apply a per-row edit to a single queue item, affecting only that row (US3).
   * Text is revalidated (empty/over-cap edits are refused and the previous value
   * kept); `instructions` are retained across model changes (the server applies
   * them only for the instructions-capable model); `metadata` is never discarded
   * when switching to an untaggable format — the caller is warned via
   * `tagsSkipped` instead. Mutates the row in place to preserve its identity.
   */
  function updateItem(clientId: string, patch: ItemPatch): UpdateResult {
    const item = items.value.find((i) => i.clientId === clientId)
    if (!item) return { ok: false, reason: 'notFound' }

    if (patch.text !== undefined) {
      const validated = validateItemText(patch.text)
      if (!validated.ok) return { ok: false, reason: validated.reason }
      item.text = validated.text
    }
    if (patch.voiceId !== undefined) item.voiceId = patch.voiceId
    if (patch.model !== undefined) item.model = patch.model
    if (patch.format !== undefined) item.format = patch.format
    if (patch.instructions !== undefined) item.instructions = patch.instructions
    if (patch.metadata !== undefined) {
      item.metadata = cloneMetadata(patch.metadata)
      item.metadataEdited = true
    }

    return { ok: true, item, tagsSkipped: isUntaggableFormat(item.format) }
  }

  function clear(): void {
    items.value = []
    checkedIds.value = new Set()
    activeId.value = null
  }

  /**
   * Reorder the queue to match `orderedClientIds` — the new row order produced by a
   * drag-and-drop in the QueuePanel (007). The same row objects are kept (identity
   * preserved), only their order changes, so per-row status/selection/edits survive.
   * Robust to a partial or stale list: unknown ids are skipped, and any queue item
   * absent from the list keeps its relative order appended after the named ones (so a
   * concurrent add can never drop a row). Since the derived Track is the row's queue
   * position, generating after a reorder renumbers the tracks to the new order.
   */
  function reorder(orderedClientIds: string[]): void {
    const byId = new Map(items.value.map((i) => [i.clientId, i]))
    const next: QueueItem[] = []
    for (const id of orderedClientIds) {
      const item = byId.get(id)
      if (item) {
        next.push(item)
        byId.delete(id)
      }
    }
    for (const item of items.value) if (byId.has(item.clientId)) next.push(item)
    items.value = next
  }

  /**
   * Seed the shared form-level metadata with deployment-provided defaults (US10 /
   * FR-048). Title is never defaulted, so it is stripped even if present. New rows
   * clone this metadata in {@link makeItem}, so the defaults reach both the form and
   * every newly-added row.
   *
   * Defaults arrive from an async fetch on mount, so a fast user may type before they
   * land. They are merged *behind* whatever the user already set — defaults only fill
   * still-empty fields — so an early edit is never clobbered and every default stays
   * overridable/clearable (FR-048).
   */
  function setDefaults(defaults: Metadata): void {
    const seeded = cloneMetadata(defaults)
    delete seeded.title
    const userEntered = Object.fromEntries(
      Object.entries(metadata.value).filter(
        ([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
      ),
    )
    metadata.value = { ...seeded, ...userEntered } as Metadata
  }

  /**
   * Apply the current form-level metadata to every not-yet-generated row in the
   * batch that hasn't been edited individually. Called right before generation so
   * the metadata shown on the form reaches the batch — including rows added before
   * it was filled (single shared editor). A row with its own per-row metadata edit
   * is left untouched so its values survive generation. The batch defaults to the
   * whole queue, but the caller passes the actual generate target (checked-else-all)
   * so rows that are NOT being generated are never silently overwritten (FR-005a).
   */
  function applyMetadataToPending(target: QueueItem[] = items.value): void {
    for (const item of target) {
      if (item.status !== 'done' && !item.metadataEdited) item.metadata = projectMetadata(metadata.value)
    }
  }

  /**
   * Stamp the derived Title + Track onto each target row right before generation (007). Neither
   * is user-editable on Generate (both are removed from the metadata form + Configure Visible
   * Fields dialog); they are derived here so every generated recording carries a sensible title
   * and its queue position as a track number:
   *
   * - **Title** — the first 120 characters of the row's text, ellipsised when longer. Filled only
   *   when the row has no title, so a title carried in from an imported queue survives.
   * - **Track** — the row's position in the full queue (what the QueuePanel shows) offset by
   *   `startTrack` (the first track number configured in the action bar, default 1), always
   *   refreshed so it matches the current order. The first row gets `startTrack`, the next
   *   `startTrack + 1`, and so on.
   *
   * Runs AFTER {@link applyMetadataToPending} so the projection (which never touches
   * title/track) can't drop the derived values.
   */
  function stampDerivedMetadata(target: QueueItem[] = items.value, startTrack = 1): void {
    for (const item of target) {
      if (item.status === 'done') continue
      const next = cloneMetadata(item.metadata)
      if (next.title === undefined || next.title === '') next.title = deriveTitle(item.text)
      const position = items.value.indexOf(item)
      if (position >= 0) next.track = String(position + startTrack)
      item.metadata = next
    }
  }

  // The rows currently shown by the list pane: the queue narrowed by the free-text
  // search and the per-field filters (US3 / FR-009/010), order preserved. A simple
  // O(n) scan per change — adequate well past the ≥200-row target (SC-003) without
  // virtualization. `generateTarget` and the prev/next navigation derive from it so
  // they always track what the user can see.
  const visibleItems = computed(() => {
    const term = searchTerm.value.trim().toLowerCase()
    const f = filters.value
    return items.value.filter((item) => {
      if (term && !`${item.text} ${item.sourceName ?? ''}`.toLowerCase().includes(term)) return false
      if (f.voiceId && item.voiceId !== f.voiceId) return false
      if (f.format && item.format !== f.format) return false
      if (f.album && (item.metadata?.album ?? '') !== f.album) return false
      if (f.recordedAt && (item.metadata?.recordedAt ?? '') !== f.recordedAt) return false
      if (f.language && !(item.metadata?.languages ?? []).includes(f.language)) return false
      return true
    })
  })

  /**
   * What a Generate run processes (FR-005a): the checked rows if any are checked,
   * otherwise the ENTIRE queue. Derived from `items`, not `visibleItems`: search and
   * filters are a view-only concern (US3) and must never change what gets generated —
   * a checked row hidden by a filter is still processed, and with nothing checked the
   * whole queue runs regardless of any active filter. (Only metadata stamping and the
   * prev/next navigation track the visible set.) A fresh array so removing rows on
   * success (US2) can't disturb the in-flight iteration.
   */
  const generateTarget = computed(() =>
    checkedIds.value.size > 0
      ? items.value.filter((i) => checkedIds.value.has(i.clientId))
      : [...items.value],
  )

  // Per-item + total cost estimate over the whole queue (US5 / FR-018/FR-019). Each row
  // is priced by its own model against its text (chars for the character-priced models,
  // spoken duration for gpt-4o-mini-tts); any unavailable (unknown-model) row is counted
  // separately and excluded from the total, never treated as $0.
  const queueCost = computed<QueueCost>(() => {
    const perItem = new Map<string, CostEstimate>()
    let totalUsd = 0
    let unavailableCount = 0
    for (const item of items.value) {
      const estimate = estimateItemCost(item.model, item.text, options?.gatewayRates?.())
      perItem.set(item.clientId, estimate)
      if (estimate === 'unavailable') unavailableCount++
      else totalUsd += estimate.amountUsd
    }
    return { perItem, totalUsd, unavailableCount }
  })

  // Active-selection navigation for the toolbar prev/next (FR-005), over the
  // visible rows; disabled at the boundaries.
  const activeIndex = computed(() => visibleItems.value.findIndex((i) => i.clientId === activeId.value))
  const hasPrev = computed(() => activeIndex.value > 0)
  const hasNext = computed(
    () => activeIndex.value >= 0 && activeIndex.value < visibleItems.value.length - 1,
  )
  function selectPrev(): void {
    if (hasPrev.value) activeId.value = visibleItems.value[activeIndex.value - 1]!.clientId
  }
  function selectNext(): void {
    if (hasNext.value) activeId.value = visibleItems.value[activeIndex.value + 1]!.clientId
  }

  /** Snapshot the queue as a versioned saved-queue document (regeneratable inputs only). */
  function serialize(): QueueFileDocument {
    return {
      schema: 'echorecall.queue',
      version: 1,
      items: items.value.map((item) => {
        const fileItem: QueueFileItem = {
          text: item.text,
          voiceId: item.voiceId,
          model: item.model,
          format: item.format,
          metadata: cloneMetadata(item.metadata),
          source: item.source,
        }
        if (item.instructions !== undefined) fileItem.instructions = item.instructions
        if (item.source === 'upload' && item.sourceName !== undefined) {
          fileItem.sourceName = item.sourceName
        }
        return fileItem
      }),
    }
  }

  /** Replace the queue with the rows from an imported document (fresh ids/state). */
  function loadDocument(doc: QueueFileDocument): void {
    items.value = doc.items.map((fileItem) => ({
      clientId: newClientId(),
      text: fileItem.text,
      voiceId: fileItem.voiceId,
      model: fileItem.model,
      format: fileItem.format,
      metadata: cloneMetadata(fileItem.metadata),
      metadataEdited: Object.keys(fileItem.metadata).length > 0,
      status: 'queued',
      source: fileItem.source,
      ...(fileItem.instructions !== undefined ? { instructions: fileItem.instructions } : {}),
      ...(fileItem.sourceName !== undefined ? { sourceName: fileItem.sourceName } : {}),
    }))
    checkedIds.value = new Set()
    activeId.value = null
  }

  return {
    items,
    voiceId,
    model,
    format,
    speed,
    metadata,
    activeId,
    checkedIds,
    searchTerm,
    filters,
    visibleItems,
    generateTarget,
    queueCost,
    activeIndex,
    hasPrev,
    hasNext,
    selectPrev,
    selectNext,
    serialize,
    loadDocument,
    projectMetadata,
    addItem,
    addItems,
    addFromUpload,
    appendImported,
    removeItem,
    removeMany,
    toggleChecked,
    toggleAll,
    updateItem,
    reorder,
    applyMetadataToPending,
    stampDerivedMetadata,
    setDefaults,
    clear,
  }
}

/**
 * Derive a row's title from its text (007): chopped at the first line break (the script
 * textarea allows multi-line text, but a Title tag should hold only the first line — the rest
 * is discarded, not joined in), then the first 120 characters of that line, with an ellipsis
 * appended when longer. A first line of 120 characters or fewer is used as-is.
 */
function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0]!.trim()
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
}

/** Deep copy of a Metadata value (JSON-safe: plain strings/arrays only). */
function cloneMetadata(metadata: Metadata): Metadata {
  return structuredClone(deepToRaw(metadata)) as Metadata
}

/** Recursively remove Vue proxies so the platform clone algorithm can consume nested arrays. */
function deepToRaw(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(deepToRaw)
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, entry]) => [key, deepToRaw(entry)]),
  )
}

/**
 * A unique client id for a queue row. Prefers `crypto.randomUUID`, but falls back
 * to a v4-shaped id when it is unavailable — `crypto.randomUUID` requires a secure
 * context, so a self-hosted deployment reached over plain HTTP on a LAN address
 * (not `localhost`) would otherwise crash on add/import. These ids are ephemeral,
 * client-only keys, so the non-cryptographic fallback is acceptable.
 */
function newClientId(): string {
  const cryptoObj = globalThis.crypto
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16)
    const value = char === 'x' ? rand : (rand % 4) + 8
    return value.toString(16)
  })
}
