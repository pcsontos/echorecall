import type { Format, Metadata, Model } from '#core/client'
import { MAX_INPUT_LENGTH, isAcceptableModel, isAcceptableVoice, isKnownFormat } from '#core/client'

// Saved-queue file format (005 · US2 / FR-013, research §R4, data-model §3). The
// queue is saved as a versioned JSON document the user owns — a browser download,
// never server storage — and re-opened from a user-picked file after validation.
// Only the *regeneratable* inputs are carried (text/voice/model/format/
// instructions/metadata/source/sourceName); the transient status/result/clientId
// are never written or read (a fresh clientId is minted on import by the queue).

/** One regeneratable queue row in a saved-queue file (no transient state). */
export interface QueueFileItem {
  text: string
  voiceId: string
  model: Model
  format: Format
  instructions?: string
  metadata: Metadata
  source: 'upload' | 'text'
  sourceName?: string
}

/** The saved-queue file document: a `schema`+`version` envelope around the rows. */
export interface QueueFileDocument {
  schema: typeof SCHEMA
  version: typeof VERSION
  items: QueueFileItem[]
}

/** Outcome of {@link useQueueFile.importQueue}: the parsed doc, or a typed reason. */
export type ImportResult =
  | { ok: true; doc: QueueFileDocument }
  | { ok: false; reason: 'schema' | 'version' | 'shape' }

// This discriminator belongs only to Load queue. Batch JSON is parsed by the
// separate batch adapter and can never enter this replacement workflow.
const SCHEMA = 'echorecall.queue'
const VERSION = 1

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate and normalize one raw item, keeping only the regeneratable fields.
 * Returns null when the item is malformed (empty/over-cap text, missing voice,
 * unknown model/format, or a non-object metadata) so import can reject the file.
 */
function sanitizeItem(raw: unknown): QueueFileItem | null {
  if (!isObject(raw)) return null

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) return null

  if (typeof raw.voiceId !== 'string' || !isAcceptableVoice(raw.voiceId)) return null
  if (typeof raw.model !== 'string' || !isAcceptableModel(raw.model)) return null
  if (typeof raw.format !== 'string' || !isKnownFormat(raw.format)) return null

  if (raw.metadata !== undefined && !isObject(raw.metadata)) return null
  const metadata = (raw.metadata ?? {}) as Metadata

  const source: 'upload' | 'text' = raw.source === 'upload' ? 'upload' : 'text'

  const item: QueueFileItem = {
    text,
    voiceId: raw.voiceId,
    model: raw.model as Model,
    format: raw.format as Format,
    metadata,
    source,
  }
  if (typeof raw.instructions === 'string') item.instructions = raw.instructions
  if (source === 'upload' && typeof raw.sourceName === 'string') item.sourceName = raw.sourceName
  return item
}

export function useQueueFile() {
  /**
   * Serialize the queue document and trigger a browser download. The file is
   * named `<suggestedName>.echoqueue.json`. Browser-only side effect (Blob +
   * anchor click); never called server-side.
   */
  function exportQueue(doc: QueueFileDocument, suggestedName = 'echorecall-queue'): void {
    const filename = `${suggestedName}.echoqueue.json`
    const jsonText = JSON.stringify(doc, null, 2)

    // Data URI provides the most bulletproof client-side download across Firefox and other engines
    // without suffering from premature revokeObjectURL race conditions (which cause Firefox to
    // abort the download into a temporary random `.json.part` file).
    const encoded = encodeURIComponent(jsonText)
    const dataUrl = `data:application/json;charset=utf-8,${encoded}`

    const link = document.createElement('a')
    link.href = dataUrl
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      link.remove()
    }, 100)
  }

  /**
   * Read, parse and validate a user-picked queue file. Resolves to the sanitized
   * document on success, or a typed rejection reason (the current queue is left
   * untouched by the caller): `schema` (wrong discriminator), `version` (unknown
   * major), or `shape` (unparseable JSON / bad items). Forward-tolerant: unknown
   * top-level/item fields are ignored.
   */
  async function importQueue(file: File): Promise<ImportResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      return { ok: false, reason: 'shape' }
    }

    if (!isObject(parsed) || parsed.schema !== SCHEMA) return { ok: false, reason: 'schema' }
    if (parsed.version !== VERSION) return { ok: false, reason: 'version' }
    if (!Array.isArray(parsed.items)) return { ok: false, reason: 'shape' }

    const items: QueueFileItem[] = []
    for (const raw of parsed.items) {
      const item = sanitizeItem(raw)
      if (!item) return { ok: false, reason: 'shape' }
      items.push(item)
    }

    return { ok: true, doc: { schema: SCHEMA, version: VERSION, items } }
  }

  return { exportQueue, importQueue }
}
