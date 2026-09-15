import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateSpeech } from '../../src/core/tts/generate'
import { LibraryService } from '../../src/core/library/library-service'
import { SqliteGenerationRepository } from '../../src/core/library/sqlite-repository'
import { FileAudioStore } from '../../src/core/library/audio-store'
import { ProviderUnavailableError } from '../../src/core/shared/errors'
import type { TtsProvider } from '../../src/core/tts/provider'

// 009 · US3: batch items dispatch through the resolved provider. Audio returned
// after an internal gateway failover is a normal success (bytes in → tagged and
// saved). A final provider error fails that item only; prior successes stay in
// the Library and later items still run. No EchoRecall retry/failover loop.

class ScriptedProvider implements TtsProvider {
  calls: string[] = []
  async synthesize(input: { text: string }): Promise<Buffer> {
    this.calls.push(input.text)
    if (input.text === 'dead') throw new Error('gateway 502')
    return Buffer.from(`audio-${input.text}`)
  }
}

let dir: string
let service: LibraryService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'echorecall-gateway-batch-'))
  const repo = new SqliteGenerationRepository(join(dir, 'echorecall.db'))
  service = new LibraryService(repo, new FileAudioStore(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('gateway batch per-item success and failure (009 · US3)', () => {
  it('saves audio from a failover item and isolates a later ProviderUnavailableError', async () => {
    const provider = new ScriptedProvider()

    const failoverBytes = await generateSpeech(provider, {
      text: 'failover',
      voiceId: 'alloy',
      model: 'elevenlabs/eleven_multilingual_v2',
    })
    const failover = await service.save(
      {
        text: 'failover',
        voiceId: 'alloy',
        model: 'elevenlabs/eleven_multilingual_v2',
        format: 'mp3',
        metadata: {},
      },
      failoverBytes,
    )

    await expect(
      generateSpeech(provider, { text: 'dead', voiceId: 'alloy' }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError)
    expect(service.list().rows.map((row) => row.id)).toEqual([failover.id])

    const laterBytes = await generateSpeech(provider, { text: 'later', voiceId: 'nova' })
    const later = await service.save(
      { text: 'later', voiceId: 'nova', format: 'mp3', metadata: {} },
      laterBytes,
    )

    expect(provider.calls).toEqual(['failover', 'dead', 'later'])
    expect(provider.calls).toHaveLength(3)
    expect(service.list().rows.map((row) => row.id).sort()).toEqual([failover.id, later.id].sort())
  })
})
