import { describe, expect, it } from 'vitest'
import { useQueueFile, type QueueFileDocument } from '../../app/composables/useQueueFile'

// Saved-queue file format (005 · US2 / FR-013, research §R4, data-model §3). The
// queue is exported as a versioned JSON document and re-imported after validation:
// import reproduces the regeneratable rows (text/voice/model/format/instructions/
// metadata/source/sourceName) and never the transient status/result/clientId. A
// malformed or incompatible file is rejected with a typed reason so the caller can
// show a localized message and leave the current queue untouched. Pure logic, so it
// runs in the plain-node env (the download side-effect lives in exportQueue and is
// not exercised here).

function fileOf(content: string): File {
  return new File([content], 'q.echoqueue.json', { type: 'application/json' })
}

const VALID_DOC: QueueFileDocument = {
  schema: 'echorecall.queue',
  version: 1,
  items: [
    {
      text: 'Uploaded line',
      voiceId: 'alloy',
      model: 'gpt-4o-mini-tts',
      format: 'mp3',
      instructions: 'calm and warm',
      metadata: { title: 'A', album: 'Songs', recordedAt: '2026-06-24', languages: ['eng'] },
      source: 'upload',
      sourceName: 'notes.txt',
    },
    {
      text: 'Typed line',
      voiceId: 'echo',
      model: 'tts-1',
      format: 'flac',
      metadata: {},
      source: 'text',
    },
  ],
}

describe('useQueueFile.importQueue – round-trip', () => {
  it('reproduces the regeneratable rows from an exported document', async () => {
    const { importQueue } = useQueueFile()
    const result = await importQueue(fileOf(JSON.stringify(VALID_DOC)))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.schema).toBe('echorecall.queue')
    expect(result.doc.version).toBe(1)
    expect(result.doc.items).toEqual(VALID_DOC.items)
  })

  it('defaults a missing metadata object to {} and tolerates extra fields', async () => {
    const { importQueue } = useQueueFile()
    const raw = JSON.stringify({
      schema: 'echorecall.queue',
      version: 1,
      extra: 'ignored',
      items: [{ text: 'x', voiceId: 'alloy', model: 'tts-1', format: 'mp3', source: 'text' }],
    })
    const result = await importQueue(fileOf(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.items[0]!.metadata).toEqual({})
  })
})

describe('useQueueFile.importQueue – rejects malformed/incompatible files', () => {
  it('rejects a wrong schema discriminator with reason "schema"', async () => {
    const { importQueue } = useQueueFile()
    const raw = JSON.stringify({ schema: 'something.else', version: 1, items: [] })
    const result = await importQueue(fileOf(raw))
    expect(result).toEqual({ ok: false, reason: 'schema' })
  })

  it('rejects an unknown version with reason "version"', async () => {
    const { importQueue } = useQueueFile()
    const raw = JSON.stringify({ schema: 'echorecall.queue', version: 2, items: [] })
    const result = await importQueue(fileOf(raw))
    expect(result).toEqual({ ok: false, reason: 'version' })
  })

  it('rejects invalid JSON with reason "shape"', async () => {
    const { importQueue } = useQueueFile()
    const result = await importQueue(fileOf('{ not json'))
    expect(result).toEqual({ ok: false, reason: 'shape' })
  })

  it('rejects a non-array items field with reason "shape"', async () => {
    const { importQueue } = useQueueFile()
    const raw = JSON.stringify({ schema: 'echorecall.queue', version: 1, items: 'nope' })
    const result = await importQueue(fileOf(raw))
    expect(result).toEqual({ ok: false, reason: 'shape' })
  })

  it('rejects an item with empty text, unknown model, or unknown format (reason "shape")', async () => {
    const { importQueue } = useQueueFile()
    const cases = [
      { text: '   ', voiceId: 'alloy', model: 'tts-1', format: 'mp3', source: 'text' },
      { text: 'ok', voiceId: 'alloy', model: '@@@', format: 'mp3', source: 'text' },
      { text: 'ok', voiceId: 'alloy', model: 'tts-1', format: 'xyz', source: 'text' },
      { text: 'ok', voiceId: '', model: 'tts-1', format: 'mp3', source: 'text' },
    ]
    for (const item of cases) {
      const raw = JSON.stringify({ schema: 'echorecall.queue', version: 1, items: [item] })
      const result = await importQueue(fileOf(raw))
      expect(result).toEqual({ ok: false, reason: 'shape' })
    }
  })
})
