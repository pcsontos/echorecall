/** A selectable speaking voice offered by the TTS provider. */
export interface Voice {
  id: string
  label: string
}

/**
 * TTS model identifier. Built-in catalog values are `tts-1`, `tts-1-hd`, and
 * `gpt-4o-mini-tts`; gateway/custom ids are any other non-empty string.
 * Instructions are honoured only by `gpt-4o-mini-tts`.
 */
export type Model = string

/** Output audio formats offered by the provider. */
export type Format = 'mp3' | 'wav' | 'flac' | 'opus' | 'aac' | 'pcm'

/** Static catalog entry describing a format: its extension and tagging capability. */
export interface FormatInfo {
  id: Format
  /** File extension without the dot, e.g. `mp3`. */
  ext: string
  /** Which tagging path applies: ID3v2.4 (mp3/wav), Vorbis comments (flac/opus), or none (aac/pcm). */
  taggable: 'id3' | 'vorbis' | 'none'
}

/** A description-keyed custom free-text tag entry (ID3 TXXX). */
export interface CustomTextEntry {
  description: string
  value: string
}

/** A description-keyed custom URL tag entry (ID3 WXXX; ID3-only). */
export interface CustomUrlEntry {
  description: string
  url: string
}

/**
 * The full, standards-oriented tag set embedded into generated files and
 * persisted alongside a {@link Generation}. Saving replaces the whole set
 * (clearing a field removes it). All fields are optional; an empty set is `{}`.
 */
export interface Metadata {
  title?: string
  artist?: string
  album?: string
  genre?: string
  comment?: string
  /** Full timestamp OR year-only. */
  recordedAt?: string
  /** `n` or `n/total`. */
  track?: string
  /** ISO 639-2 codes; multi-value (ID3 TLAN). */
  languages?: string[]
  customText?: CustomTextEntry[]
  customUrl?: CustomUrlEntry[]
  // --- 006 · R-TAGS: extra editable fields persisted in the existing `tags_extra`
  // JSON column (NO new SQL column, no migration). The taglib mapping writes each as
  // its native ID3 frame (TENC/TPE2/TCOM/TBPM/POPM; `notes` via a custom TXXX). ---
  /** Free-form text/notes (ID3 TXXX). */
  notes?: string
  /** Encoder/encoded-by (ID3 TENC). */
  encodedBy?: string
  /** Album artist / band (ID3 TPE2). */
  albumArtist?: string
  /** Composer (ID3 TCOM). */
  composer?: string
  /** Beats per minute, integer (ID3 TBPM). */
  bpm?: number
  /** Star rating 0–5 (ID3 POPM, mapped 0–255). */
  rating?: number
}

/**
 * 006 · R-AUDIOPROPS — read-only audio properties computed on read from the stored
 * file (taglib `audioProperties`). Never persisted, never edited; missing/unreadable
 * values are simply absent. Surfaced for the status bar + Duration/Bitrate columns.
 */
export interface AudioProperties {
  /** Audio codec, e.g. `MP3`, `FLAC`, `PCM`. */
  codec?: string
  /** Bitrate in kb/s. */
  bitrate?: number
  /** Sample rate in Hz. */
  sampleRate?: number
  /** Duration in seconds. */
  duration?: number
}

/**
 * A persisted text-to-speech library entry. Filename (via `path`) and `metadata`
 * are mutable; `text`, audio bytes, `voiceId`, `model`, `format`, `speed` and
 * `createdAt` are immutable after creation.
 */
export interface Generation {
  id: string
  text: string
  voiceId: string
  /** `null` on legacy rows predating model selection (treated as the default). */
  model: Model | null
  format: Format
  /** `null` on legacy rows (treated as 1.0). */
  speed: number | null
  /** ISO 8601 UTC timestamp. */
  createdAt: string
  /** Stored audio path relative to the data dir, e.g. `audio/2026/06/17/<slug>.mp3`. Authoritative locator. */
  path: string
  /** Embedded tag set; `{}` when none. */
  metadata: Metadata
}

/** User-supplied input for a new generation. */
export interface GenerationInput {
  text: string
  voiceId: string
}

/**
 * An ephemeral, per-session batch queue row (never persisted). `speed` is NOT
 * here — it is a single form-level value applied to every row.
 */
export interface ListItem {
  clientId: string
  text: string
  voiceId: string
  model: Model
  format: Format
  /** Retained across model changes; sent only for `gpt-4o-mini-tts`. */
  instructions?: string
  metadata: Metadata
}

/** Filter for a bulk-clean (FR-037); at least one key must be set (UI + service enforce it). */
export interface BulkCleanFilter {
  /** Inclusive `createdAt` range bounds (ISO 8601). */
  from?: string
  to?: string
  voiceId?: string
}

/** Composable server-side library query (search + filter + sort + pagination). */
export interface LibraryQuery {
  /** Free-text LIKE over title, source text, tags, and filename. */
  q?: string
  voiceId?: string
  format?: Format
  /** Inclusive `createdAt` range bounds (ISO 8601). */
  from?: string
  to?: string
  sort?:
    | 'createdAt'
    | 'title'
    | 'voice'
    | 'format'
    // --- 006 · R-FILTER: additive sort keys over already-existing columns.
    // "Year" + "Date" both map to `recordedAt`; "Filename" to the stored name.
    // Composer/Duration/Bitrate are display-only (NOT sortable).
    | 'filename'
    | 'artist'
    | 'album'
    | 'recordedAt'
    | 'track'
    | 'genre'
    | 'comment'
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number

  // --- 006 · R-FILTER: additive, read-only filters over already-existing columns
  // (no schema/migration). All optional → existing callers/CLI unaffected. ---
  /** Exact match over `tag_genre`. */
  genre?: string
  /** A single ISO 639-2 code matched within the multi-value `tags_extra.languages`. */
  language?: string
  /** Inclusive lower bound over `tag_recorded_at` (recording date, distinct from `createdAt`). */
  recordedFrom?: string
  /** Inclusive upper bound over `tag_recorded_at`. */
  recordedTo?: string
}
