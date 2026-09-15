import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSpeech, MAX_INPUT_LENGTH } from '../../src/core/tts/generate'
import { LibraryService } from '../../src/core/library/library-service'
import { SqliteGenerationRepository } from '../../src/core/library/sqlite-repository'
import { FileAudioStore } from '../../src/core/library/audio-store'
import type { TtsProvider } from '../../src/core/tts/provider'
import { respondError } from '../../server/utils/errors'

// Integration coverage for POST /api/generations: the pipeline the route runs
// (generateSpeech -> libraryService.save) over a real file-backed SQLite + the
// real filesystem audio store, with the TTS provider faked at the port boundary
// (research §3 — no network). Domain-error -> HTTP status/envelope is asserted
// through the real `respondError` mapper.

// Port-boundary fake. `calls` lets us prove validation short-circuits before any
// synthesis, and that a failure leaves nothing behind.
class FakeProvider implements TtsProvider {
  calls = 0
  constructor(
    private readonly behavior: 'ok' | 'fail' = 'ok',
    private readonly bytes: Buffer = Buffer.from('fake-mp3'),
  ) {}
  async synthesize(): Promise<Buffer> {
    this.calls++
    if (this.behavior === 'fail') throw new Error('network down')
    return this.bytes
  }
}

// Run the real error mapper exactly as the route does: it reads/writes
// `node.res.statusCode` on the event. This yields the documented HTTP contract
// (400 / 502) from the real domain error — no re-implementation of the mapping.
function mapError(err: unknown): { status: number; code: string } {
  const event = { node: { res: { statusCode: 200 } } }
  const body = respondError(event, err)
  return { status: event.node.res.statusCode, code: body.error.code }
}

let dir: string
let dbPath: string
let audioDir: string
let repo: SqliteGenerationRepository
let service: LibraryService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'echorecall-post-'))
  dbPath = join(dir, 'echorecall.db')
  audioDir = join(dir, 'audio')
  repo = new SqliteGenerationRepository(dbPath)
  // Store rooted at the data dir; Phase-2 flat path is `audio/<id>.mp3`, so the
  // files still land under `audioDir` for audioFileCount() below.
  service = new LibraryService(repo, new FileAudioStore(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function audioFileCount(): Promise<number> {
  try {
    return (await readdir(audioDir)).length
  } catch {
    return 0 // directory never created — nothing was written
  }
}

describe('POST /api/generations', () => {
  it('synthesizes, saves the entry, and persists it across a fresh repository', async () => {
    const provider = new FakeProvider('ok', Buffer.from('the-mp3'))
    const input = { text: 'Hello world', voiceId: 'alloy' }

    const mp3 = await generateSpeech(provider, input)
    const entry = await service.save(input, mp3)

    expect(provider.calls).toBe(1)
    expect(entry).toMatchObject({ text: 'Hello world', voiceId: 'alloy' })
    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Atomic save: a saved entry always has readable audio.
    expect(Buffer.compare(await service.readAudio(entry.id), Buffer.from('the-mp3'))).toBe(0)

    // Persistence: a brand-new repository over the same DB file still sees it
    // (the "survives restart" contract).
    const reopened = new SqliteGenerationRepository(dbPath)
    expect(reopened.get(entry.id)).toMatchObject({ id: entry.id, text: 'Hello world' })
  })

  it('empty text -> 400 EMPTY_INPUT, provider untouched, nothing persisted', async () => {
    const provider = new FakeProvider('ok')
    const err = await generateSpeech(provider, { text: '   ', voiceId: 'alloy' }).catch((e) => e)

    expect(provider.calls).toBe(0)
    expect(service.list().rows).toHaveLength(0)
    expect(await audioFileCount()).toBe(0)
    expect(mapError(err)).toEqual({ status: 400, code: 'EMPTY_INPUT' })
  })

  it('over-length text -> 400 INPUT_TOO_LONG, provider untouched, nothing persisted', async () => {
    const provider = new FakeProvider('ok')
    const text = 'a'.repeat(MAX_INPUT_LENGTH + 1)
    const err = await generateSpeech(provider, { text, voiceId: 'alloy' }).catch((e) => e)

    expect(provider.calls).toBe(0)
    expect(service.list().rows).toHaveLength(0)
    expect(await audioFileCount()).toBe(0)
    expect(mapError(err)).toEqual({ status: 400, code: 'INPUT_TOO_LONG' })
  })

  it('illegal voice -> 400 INVALID_VOICE, provider untouched, nothing persisted', async () => {
    const provider = new FakeProvider('ok')
    const err = await generateSpeech(provider, { text: 'hi', voiceId: '@@@' }).catch((e) => e)

    expect(provider.calls).toBe(0)
    expect(service.list().rows).toHaveLength(0)
    expect(await audioFileCount()).toBe(0)
    expect(mapError(err)).toEqual({ status: 400, code: 'INVALID_VOICE' })
  })

  it('provider failure -> 502 PROVIDER_UNAVAILABLE, nothing persisted, no orphan audio', async () => {
    const provider = new FakeProvider('fail')
    const err = await generateSpeech(provider, { text: 'hi', voiceId: 'alloy' }).catch((e) => e)

    expect(provider.calls).toBe(1) // synthesis attempted...
    expect(service.list().rows).toHaveLength(0) // ...but nothing was saved
    expect(await audioFileCount()).toBe(0) // and no orphan file was left behind
    expect(mapError(err)).toEqual({ status: 502, code: 'PROVIDER_UNAVAILABLE' })
  })

  it('saves under a dated, title-slug path with the chosen format', async () => {
    const provider = new FakeProvider('ok', Buffer.from('flac-bytes'))
    const input = { text: 'Hello world', voiceId: 'alloy', model: 'tts-1-hd', format: 'flac' as const }

    const bytes = await generateSpeech(provider, input)
    const entry = await service.save({ ...input, metadata: { title: 'Hello World' } }, bytes)

    expect(entry.format).toBe('flac')
    expect(entry.path).toMatch(/^audio\/\d{4}\/\d{2}\/\d{2}\/hello-world\.flac$/)
    expect(entry.path.split('/').pop()).toBe('hello-world.flac') // derived filename
    expect(Buffer.compare(await service.readAudio(entry.id), Buffer.from('flac-bytes'))).toBe(0)
    expect(service.list().rows.map((g) => g.id)).toContain(entry.id)
  })

  it('disambiguates two same-title items under the same day (no overwrite)', async () => {
    const provider = new FakeProvider('ok')
    const mk = async (body: Buffer) => {
      const bytes = await generateSpeech(provider, { text: 'x', voiceId: 'alloy' })
      void bytes
      return service.save({ text: 'x', voiceId: 'alloy', format: 'mp3', metadata: { title: 'Same' } }, body)
    }
    const a = await mk(Buffer.from('aaa'))
    const b = await mk(Buffer.from('bbb'))

    expect(a.path).toMatch(/\/same\.mp3$/)
    expect(b.path).toMatch(/\/same_2\.mp3$/)
    // Neither file was overwritten: each reads back its own bytes.
    expect(Buffer.compare(await service.readAudio(a.id), Buffer.from('aaa'))).toBe(0)
    expect(Buffer.compare(await service.readAudio(b.id), Buffer.from('bbb'))).toBe(0)
  })

  it('illegal model -> 400 INVALID_MODEL, provider untouched, nothing persisted', async () => {
    const provider = new FakeProvider('ok')
    const err = await generateSpeech(provider, {
      text: 'hi',
      voiceId: 'alloy',
      model: '@@@',
    }).catch((e) => e)

    expect(provider.calls).toBe(0)
    expect(service.list().rows).toHaveLength(0)
    expect(await audioFileCount()).toBe(0)
    expect(mapError(err)).toEqual({ status: 400, code: 'INVALID_MODEL' })
  })

  it('unknown format -> 400 INVALID_FORMAT, provider untouched, nothing persisted', async () => {
    const provider = new FakeProvider('ok')
    const err = await generateSpeech(provider, {
      text: 'hi',
      voiceId: 'alloy',
      format: 'm4b',
    }).catch((e) => e)

    expect(provider.calls).toBe(0)
    expect(service.list().rows).toHaveLength(0)
    expect(await audioFileCount()).toBe(0)
    expect(mapError(err)).toEqual({ status: 400, code: 'INVALID_FORMAT' })
  })
})
