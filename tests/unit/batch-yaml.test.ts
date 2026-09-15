import { describe, expect, it } from 'vitest'
import type { BatchBaseInput, BatchParseResult } from '../../src/core/batch/contract'
import { parseBatch } from '../../src/core/batch/parse-batch'

const base: BatchBaseInput = {
  voiceId: 'alloy',
  model: 'tts-1',
  format: 'wav',
  instructions: 'Base instructions',
  metadata: {
    artist: 'Base artist',
    album: 'Base album',
    languages: ['eng'],
    customText: [{ description: 'Base key', value: 'Base value' }],
  },
}

function parseYaml(content: string): BatchParseResult {
  return parseBatch({ content, filename: 'batch.yaml', format: 'yaml', base })
}

function expectBlockingCode(result: BatchParseResult, code: string): void {
  expect(result).toMatchObject({ ok: false, error: { code } })
}

describe('YAML batch import – canonical resolution (008 · US1)', () => {
  it('resolves base → defaults → item overrides while preserving order and multiline text', () => {
    const result = parseYaml(`
schema: echorecall.batch
version: 1
defaults:
  voiceId: nova
  model: gpt-4o-mini-tts
  format: mp3
  instructions: Default instructions
  metadata:
    album: Default album
    genre: spoken
    languages: [hun]
    customText:
      - description: Default key
        value: Default value
items:
  - text: |-
      First line
      Second line
  - text: Second item
    voiceId: echo
    format: flac
    instructions: null
    metadata:
      title: Custom title
      artist: null
      languages: [deu]
      customText: []
`)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)

    expect(result.preview).toMatchObject({
      filename: 'batch.yaml',
      format: 'yaml',
      counts: { valid: 2, rejected: 0, blank: 0 },
      canConfirm: true,
    })
    expect(result.preview.candidates.map((candidate) => candidate.location)).toEqual([
      { kind: 'item', number: 1 },
      { kind: 'item', number: 2 },
    ])

    const [first, second] = result.preview.candidates
    expect(first?.valid).toBe(true)
    expect(second?.valid).toBe(true)
    if (!first?.valid || !second?.valid) throw new Error('Expected two valid candidates')

    expect(first.input).toEqual({
      text: 'First line\nSecond line',
      voiceId: 'nova',
      model: 'gpt-4o-mini-tts',
      format: 'mp3',
      instructions: 'Default instructions',
      metadata: {
        artist: 'Base artist',
        album: 'Default album',
        genre: 'spoken',
        languages: ['hun'],
        customText: [{ description: 'Default key', value: 'Default value' }],
      },
    })
    expect(second.input).toEqual({
      text: 'Second item',
      voiceId: 'echo',
      model: 'gpt-4o-mini-tts',
      format: 'flac',
      metadata: {
        title: 'Custom title',
        album: 'Default album',
        genre: 'spoken',
        languages: ['deu'],
      },
    })
  })

  it('uses YAML 1.2 scalar semantics rather than YAML 1.1 booleans', () => {
    const result = parseYaml(`
schema: echorecall.batch
version: 1
items:
  - text: yes
`)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    const candidate = result.preview.candidates[0]
    expect(candidate?.valid).toBe(true)
    if (candidate?.valid) expect(candidate.input.text).toBe('yes')
  })

  it.each([
    ['missing schema', 'version: 1\nitems: []', 'schema'],
    ['wrong schema', 'schema: echorecall.queue\nversion: 1\nitems: []', 'schema'],
    ['missing version', 'schema: echorecall.batch\nitems: []', 'version'],
    ['unsupported version', 'schema: echorecall.batch\nversion: 2\nitems: []', 'version'],
  ])('blocks a document with %s', (_label, content, code) => {
    expectBlockingCode(parseYaml(content), code)
  })
})

describe('YAML batch import – syntax safety (008 · US1)', () => {
  it('rejects duplicate mapping keys', () => {
    expectBlockingCode(
      parseYaml('schema: echorecall.batch\nschema: echorecall.batch\nversion: 1\nitems: []'),
      'duplicateKey',
    )
  })

  it('rejects explicit/custom tags', () => {
    expectBlockingCode(
      parseYaml('schema: echorecall.batch\nversion: 1\nitems:\n  - text: !secret hidden'),
      'customTag',
    )
  })

  it('rejects an unused anchor', () => {
    expectBlockingCode(
      parseYaml('schema: echorecall.batch\nversion: 1\nitems:\n  - text: &copy Hello'),
      'anchor',
    )
  })

  it('rejects aliases even when their anchor would otherwise be valid YAML', () => {
    expectBlockingCode(
      parseYaml(`
schema: echorecall.batch
version: 1
defaults: &shared
  voiceId: alloy
items:
  - <<: *shared
    text: Hello
`),
      'alias',
    )
  })

  it('rejects multiple YAML documents', () => {
    expectBlockingCode(
      parseYaml(`
schema: echorecall.batch
version: 1
items: []
---
schema: echorecall.batch
version: 1
items: []
`),
      'malformed',
    )
  })
})

describe('YAML batch import – custom identifiers (009 · US2)', () => {
  it('accepts prefixed custom voiceId and model as valid items', () => {
    const result = parseYaml(`
schema: echorecall.batch
version: 1
items:
  - text: Hello from a gateway voice
    voiceId: azure/en-US-JennyNeural
    model: elevenlabs/eleven_multilingual_v2
`)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    expect(result.preview.counts).toEqual({ valid: 1, rejected: 0, blank: 0 })
    const candidate = result.preview.candidates[0]
    expect(candidate?.valid).toBe(true)
    if (!candidate?.valid) throw new Error('Expected a valid candidate')
    expect(candidate.input.voiceId).toBe('azure/en-US-JennyNeural')
    expect(candidate.input.model).toBe('elevenlabs/eleven_multilingual_v2')
  })

  it('still emits invalidVoice/invalidModel for empty or illegal identifiers', () => {
    const result = parseYaml(`
schema: echorecall.batch
version: 1
items:
  - text: Bad identifiers
    voiceId: ""
    model: "bad id!"
`)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    const candidate = result.preview.candidates[0]
    expect(candidate?.valid).toBe(false)
    if (candidate?.valid !== false) throw new Error('Expected a rejected candidate')
    expect(candidate.issues).toEqual(
      expect.arrayContaining([
        { code: 'invalidVoice', path: 'items[0].voiceId' },
        { code: 'invalidModel', path: 'items[0].model' },
      ]),
    )
  })
})
