import { isAcceptableModel, isAcceptableVoice, isKnownFormat } from '#core/client'

// Per-device client view preferences (005 · US3 / FR-012, research §R5, data-model
// §4). The queue table's visible-column set is persisted in localStorage so a user's
// layout choice survives reloads — no server, no schema. SSR-safe: when there is no
// localStorage (server render, or a stripped environment) the composable simply
// falls back to the defaults and skips persistence.

/**
 * The user-toggleable queue columns. The structural `select` (checkbox) and
 * `actions` columns and the primary `text` column are always shown (so a row can
 * always be selected), so they are intentionally NOT part of this set.
 */
export type QueueColumnId = 'source' | 'voice' | 'format' | 'recordedAt' | 'language' | 'status'

const COLUMN_IDS: QueueColumnId[] = ['source', 'voice', 'format', 'recordedAt', 'language', 'status']
const DEFAULT_COLUMNS: Record<QueueColumnId, boolean> = {
  source: true,
  voice: true,
  format: true,
  recordedAt: true,
  language: true,
  status: true,
}
const STORAGE_KEY = 'echorecall:viewprefs:queueColumns'

/** localStorage when present (browser), else undefined (SSR / test without a stub). */
function storage(): Storage | undefined {
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined
}

/** Read the persisted visibility map, keeping only known boolean column flags. */
function readStored(): Partial<Record<QueueColumnId, boolean>> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // JSON.parse can yield null or a primitive (e.g. "null", "42"); only an object
    // has column flags to read, so anything else falls back to the defaults.
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Partial<Record<QueueColumnId, boolean>> = {}
    for (const id of COLUMN_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'boolean') result[id] = value
    }
    return result
  } catch {
    return {}
  }
}

function persist(value: Record<QueueColumnId, boolean>): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage may be unavailable or full; preferences are best-effort.
  }
}

// ---------------------------------------------------------------------------
// 006 · R-COLUMNS / R-FIELDS — Library view preferences (data-model §3.1).
//
// Two ORDERED, toggleable sets persisted per-device. Unlike the (unordered) queue
// columns above, the design's Configure dialogs reorder rows as well as toggle them,
// so each set is an ordered `{ id, visible }[]` (array order == display order). The
// always-on Filename column / Name field are NOT in their sets. Reads merge stored
// over defaults (a newly-added id defaults visible), and a not-all-hidden guard keeps
// at least one entry visible (FR-017/FR-020).
// ---------------------------------------------------------------------------

/** Toggleable file-table columns (Filename is always-on and not in this set). */
export type LibraryColumnId =
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'track'
  | 'genre'
  | 'comment'
  | 'date'
  | 'composer'
  | 'duration'
  | 'bitrate'

export interface LibraryColumnPref {
  id: LibraryColumnId
  visible: boolean
}

/** Toggleable inspector fields (Name is always-on and not in this set). */
export type InspectorFieldId =
  | 'text'
  | 'title'
  | 'artist'
  | 'album'
  | 'comment'
  | 'date'
  | 'track'
  | 'genre'
  | 'encodedBy'
  | 'language'
  | 'albumArtist'
  | 'composer'
  | 'bpm'
  | 'rating'

export interface InspectorFieldPref {
  id: InspectorFieldId
  visible: boolean
}

/**
 * The metadata-field ids the shared MetadataFields form knows how to render (007). Each id is
 * 1:1 with a {@link Metadata} key. The Generate page's *configurable* subset — the fields the
 * Configure Visible Fields dialog toggles/reorders and that are saved onto queue rows — is the
 * narrower {@link METADATA_FIELD_IDS} below: it EXCLUDES `title` and `track`, which are derived
 * automatically at generation time (Title = first 60 chars of the text, Track = the row's
 * 1-based queue position) rather than user-edited. `title`/`track` stay in this union because
 * the same component still renders them for the Library / queue-row editors (no `fields` prop).
 */
export type MetadataFieldId =
  | 'title'
  | 'artist'
  | 'album'
  | 'genre'
  | 'track'
  | 'recordedAt'
  | 'comment'
  | 'languages'
  | 'customText'
  | 'customUrl'

export interface MetadataFieldPref {
  id: MetadataFieldId
  visible: boolean
}

const LIBRARY_COLUMN_IDS: LibraryColumnId[] = [
  'title',
  'artist',
  'album',
  'year',
  'track',
  'genre',
  'comment',
  'date',
  'composer',
  'duration',
  'bitrate',
]
const INSPECTOR_FIELD_IDS: InspectorFieldId[] = [
  'text',
  'title',
  'artist',
  'album',
  'comment',
  'date',
  'track',
  'genre',
  'encodedBy',
  'language',
  'albumArtist',
  'composer',
  'bpm',
  'rating',
]
// The Generate configurable set: `title` and `track` are intentionally absent — they are
// derived at generation time (see useQueue.stampDerivedMetadata), so they are neither shown in
// the metadata form nor listed in the Configure Visible Fields dialog.
const METADATA_FIELD_IDS: MetadataFieldId[] = [
  'artist',
  'album',
  'genre',
  'recordedAt',
  'comment',
  'languages',
  'customText',
  'customUrl',
]
const LIBRARY_COLUMNS_KEY = 'echorecall:viewprefs:libraryColumns'
const INSPECTOR_FIELDS_KEY = 'echorecall:viewprefs:inspectorFields'
const METADATA_FIELDS_KEY = 'echorecall:viewprefs:metadataFields'

// ---------------------------------------------------------------------------
// 007 · US3 (G-DEFAULTS) — per-device "last-selected" generation settings.
//
// The Generate editor resolves each of Voice/Model/Format as last-selected → configured
// default → built-in fallback (FR-012). The last-selected half lives here: a partial
// `{ voiceId?, model?, format? }` persisted per-device in localStorage. A per-field reset
// drops just that field so it falls back to the configured default (FR-013). Reads keep
// only well-typed fields; SSR-safe fallback to {}. Speed is not remembered — synthesis
// always runs at 1×.
// ---------------------------------------------------------------------------

/** The generation-settings fields that remember a last-selected value. */
export type GenSettingField = 'voiceId' | 'model' | 'format'

export interface GenSettingsPref {
  voiceId?: string
  model?: string
  format?: string
}

const GEN_SETTINGS_KEY = 'echorecall:viewprefs:genSettings'

/** Keep only catalog-valid values so stale client storage cannot override safe defaults. */
function sanitizeGenSettings(input: unknown): GenSettingsPref {
  if (!input || typeof input !== 'object') return {}
  const src = input as Record<string, unknown>
  const out: GenSettingsPref = {}
  if (typeof src.voiceId === 'string' && isAcceptableVoice(src.voiceId)) out.voiceId = src.voiceId.trim()
  if (typeof src.model === 'string' && isAcceptableModel(src.model)) out.model = src.model.trim()
  if (typeof src.format === 'string' && isKnownFormat(src.format)) out.format = src.format
  return out
}

function readGenSettings(): GenSettingsPref {
  try {
    const raw = storage()?.getItem(GEN_SETTINGS_KEY)
    return sanitizeGenSettings(raw ? JSON.parse(raw) : undefined)
  } catch {
    return {}
  }
}

/**
 * Coerce arbitrary stored/incoming input into a clean ordered visibility list:
 * keep known ids in the given order (deduped, an explicit `false` honoured, anything
 * else visible), then append any canonical ids that are missing (default visible) so
 * a newly-added id always appears. Unknown ids are dropped.
 */
function sanitizeOrdered<T extends string>(input: unknown, ids: readonly T[]): { id: T; visible: boolean }[] {
  const known = new Set<string>(ids)
  const seen = new Set<T>()
  const result: { id: T; visible: boolean }[] = []
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        const id = (entry as { id?: unknown }).id
        if (typeof id === 'string' && known.has(id) && !seen.has(id as T)) {
          seen.add(id as T)
          result.push({ id: id as T, visible: (entry as { visible?: unknown }).visible !== false })
        }
      }
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) result.push({ id, visible: true })
  }
  return result
}

function readOrdered<T extends string>(key: string, ids: readonly T[]): { id: T; visible: boolean }[] {
  try {
    const raw = storage()?.getItem(key)
    return sanitizeOrdered(raw ? JSON.parse(raw) : undefined, ids)
  } catch {
    return sanitizeOrdered(undefined, ids)
  }
}

function persistRaw(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    // Best-effort; preferences degrade gracefully when storage is unavailable.
  }
}

export function useViewPreferences() {
  // Stored value merged over the defaults so a newly-added column defaults to visible.
  const queueColumns = ref<Record<QueueColumnId, boolean>>({ ...DEFAULT_COLUMNS, ...readStored() })
  // Persist on any change (the columns dialog mutates this via v-model, FR-012). Sync
  // flush keeps a fresh instance's read deterministic right after a change.
  watch(queueColumns, (value) => persist(value), { deep: true, flush: 'sync' })

  /**
   * Set a column's visibility, enforcing the not-all-hidden guard (FR-012): the last
   * remaining visible column can't be hidden.
   */
  function setColumn(id: QueueColumnId, visible: boolean): void {
    if (!visible && queueColumns.value[id]) {
      const visibleCount = COLUMN_IDS.filter((c) => queueColumns.value[c]).length
      if (visibleCount <= 1) return
    }
    queueColumns.value = { ...queueColumns.value, [id]: visible }
  }

  // 006 — ordered, toggleable Library column + inspector field sets.
  const libraryColumns = ref<LibraryColumnPref[]>(readOrdered(LIBRARY_COLUMNS_KEY, LIBRARY_COLUMN_IDS))
  const inspectorFields = ref<InspectorFieldPref[]>(readOrdered(INSPECTOR_FIELDS_KEY, INSPECTOR_FIELD_IDS))
  watch(libraryColumns, (v) => persistRaw(LIBRARY_COLUMNS_KEY, v), { deep: true, flush: 'sync' })
  watch(inspectorFields, (v) => persistRaw(INSPECTOR_FIELDS_KEY, v), { deep: true, flush: 'sync' })

  /** Commit a (possibly reordered + retoggled) column set; refuses to hide all. */
  function setLibraryColumns(next: LibraryColumnPref[]): void {
    const clean = sanitizeOrdered(next, LIBRARY_COLUMN_IDS)
    if (!clean.some((c) => c.visible)) return
    libraryColumns.value = clean
  }
  function resetLibraryColumns(): void {
    libraryColumns.value = sanitizeOrdered(undefined, LIBRARY_COLUMN_IDS)
  }

  /** Commit a (possibly reordered + retoggled) inspector field set; refuses to hide all. */
  function setInspectorFields(next: InspectorFieldPref[]): void {
    const clean = sanitizeOrdered(next, INSPECTOR_FIELD_IDS)
    if (!clean.some((f) => f.visible)) return
    inspectorFields.value = clean
  }
  function resetInspectorFields(): void {
    inspectorFields.value = sanitizeOrdered(undefined, INSPECTOR_FIELD_IDS)
  }

  // 007 — ordered, toggleable Generate metadata fields (only visible fields are saved onto
  // queue rows; see useQueue's metadata projection).
  const metadataFields = ref<MetadataFieldPref[]>(readOrdered(METADATA_FIELDS_KEY, METADATA_FIELD_IDS))
  watch(metadataFields, (v) => persistRaw(METADATA_FIELDS_KEY, v), { deep: true, flush: 'sync' })

  /** Commit a (possibly reordered + retoggled) metadata field set; refuses to hide all. */
  function setMetadataFields(next: MetadataFieldPref[]): void {
    const clean = sanitizeOrdered(next, METADATA_FIELD_IDS)
    if (!clean.some((f) => f.visible)) return
    metadataFields.value = clean
  }
  function resetMetadataFields(): void {
    metadataFields.value = sanitizeOrdered(undefined, METADATA_FIELD_IDS)
  }

  // 007 · US3 — last-selected generation settings (per-device).
  const genSettings = ref<GenSettingsPref>(readGenSettings())
  watch(genSettings, (v) => persistRaw(GEN_SETTINGS_KEY, v), { deep: true, flush: 'sync' })

  /** Remember a field's last-selected value (called when the user changes a control). */
  function setGenSetting<K extends GenSettingField>(field: K, value: GenSettingsPref[K]): void {
    genSettings.value = { ...genSettings.value, [field]: value }
  }

  /** Forget a field's last-selected value so it falls back to the configured default. */
  function resetGenSetting(field: GenSettingField): void {
    genSettings.value = Object.fromEntries(
      Object.entries(genSettings.value).filter(([key]) => key !== field),
    ) as GenSettingsPref
  }

  return {
    queueColumns,
    setColumn,
    libraryColumns,
    setLibraryColumns,
    resetLibraryColumns,
    inspectorFields,
    setInspectorFields,
    resetInspectorFields,
    metadataFields,
    setMetadataFields,
    resetMetadataFields,
    genSettings,
    setGenSetting,
    resetGenSetting,
  }
}
