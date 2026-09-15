import { describe, expect, it } from 'vitest'
import type { BatchBaseInput, BatchIssue, ImportCandidate } from '../../src/core/batch/contract'
import { parseBatch } from '../../src/core/batch/parse-batch'

const base: BatchBaseInput = {
  voiceId: 'alloy',
  model: 'tts-1',
  format: 'wav',
  metadata: { artist: 'Base artist' },
}

function parse(content: string) {
  return parseBatch({ content, filename: 'mixed.yaml', format: 'yaml', base })
}

function issues(candidate: ImportCandidate | undefined): BatchIssue[] {
  expect(candidate?.valid).toBe(false)
  return candidate?.valid === false ? candidate.issues : []
}

describe('batch preview – mixed item validation (008 · US2)', () => {
  it('rejects candidates that inherit invalid required generation settings', () => {
    const result = parseBatch({
      content: 'schema: echorecall.batch\nversion: 1\nitems:\n  - text: Inherited settings\n',
      filename: 'uninitialized.yaml',
      format: 'yaml',
      base: {
        voiceId: '',
        model: '' as BatchBaseInput['model'],
        format: '' as BatchBaseInput['format'],
        metadata: {},
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    expect(result.preview.counts).toEqual({ valid: 0, rejected: 1, blank: 0 })
    expect(issues(result.preview.candidates[0])).toEqual(expect.arrayContaining([
      { code: 'invalidVoice', path: 'items[0].voiceId' },
      { code: 'invalidModel', path: 'items[0].model' },
      { code: 'invalidFormat', path: 'items[0].format' },
    ]))
  })

  it('keeps valid siblings and duplicate text while collecting every row issue', () => {
    const oversized = 'x'.repeat(4097)
    const result = parse(`
schema: echorecall.batch
version: 1
items:
  - text: Repeated text
  - text: "   "
    voiceId: "bad id!"
    model: "@@@"
    format: ogg
    surprise: true
    metadata:
      typo: value
      languages: [eng, ""]
      rating: 6
      customText:
        - description: Source
          value: Batch
          extra: rejected
  - 42
  - voiceId: echo
  - text: ${oversized}
  - text: Repeated text
`)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)

    expect(result.preview.counts).toEqual({ valid: 2, rejected: 4, blank: 0 })
    expect(result.preview.canConfirm).toBe(true)
    expect(result.preview.candidates.map((candidate) => candidate.location)).toEqual([
      { kind: 'item', number: 1 },
      { kind: 'item', number: 2 },
      { kind: 'item', number: 3 },
      { kind: 'item', number: 4 },
      { kind: 'item', number: 5 },
      { kind: 'item', number: 6 },
    ])

    const rowIssues = issues(result.preview.candidates[1])
    expect(rowIssues).toEqual(expect.arrayContaining([
      { code: 'emptyText', path: 'items[1].text' },
      { code: 'invalidVoice', path: 'items[1].voiceId' },
      { code: 'invalidModel', path: 'items[1].model' },
      { code: 'invalidFormat', path: 'items[1].format' },
      { code: 'unknownField', path: 'items[1].surprise' },
      { code: 'unknownField', path: 'items[1].metadata.typo' },
      { code: 'invalidMetadata', path: 'items[1].metadata.languages[1]' },
      { code: 'invalidMetadata', path: 'items[1].metadata.rating' },
      { code: 'unknownField', path: 'items[1].metadata.customText[0].extra' },
    ]))
    expect(issues(result.preview.candidates[2])).toContainEqual({ code: 'wrongType', path: 'items[2]' })
    expect(issues(result.preview.candidates[3])).toContainEqual({ code: 'missingField', path: 'items[3].text' })
    expect(issues(result.preview.candidates[4])).toContainEqual({ code: 'textTooLong', path: 'items[4].text' })

    const validTexts = result.preview.candidates.flatMap((candidate) => candidate.valid ? [candidate.input.text] : [])
    expect(validTexts).toEqual(['Repeated text', 'Repeated text'])
  })

  it('reports wrong runtime types without hiding best-effort display values', () => {
    const result = parse(`
schema: echorecall.batch
version: 1
items:
  - text: 123
    voiceId: null
    model: tts-1-hd
    format: flac
    metadata: null
`)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    const candidate = result.preview.candidates[0]
    expect(candidate?.display).toEqual({ excerpt: '', voiceId: 'alloy', model: 'tts-1-hd', format: 'flac' })
    expect(issues(candidate)).toEqual(expect.arrayContaining([
      { code: 'wrongType', path: 'items[0].text' },
      { code: 'wrongType', path: 'items[0].voiceId' },
      { code: 'invalidMetadata', path: 'items[0].metadata' },
    ]))
  })

  it('disables confirmation when every candidate is invalid', () => {
    const result = parse(`
schema: echorecall.batch
version: 1
items:
  - text: ""
  - format: invalid
`)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Expected preview, received ${result.error.code}`)
    expect(result.preview.counts).toEqual({ valid: 0, rejected: 2, blank: 0 })
    expect(result.preview.canConfirm).toBe(false)
    expect(result.preview.candidates.every((candidate) => !candidate.valid)).toBe(true)
  })
})

describe('batch preview – blocking document/default errors (008 · US2)', () => {
  it.each([
    ['unknown default', 'defaults:\n  unexpected: true', 'unknownField', 'defaults.unexpected'],
    ['invalid voice default', 'defaults:\n  voiceId: "@@@"', 'invalidDefaults', 'defaults.voiceId'],
    ['null metadata defaults', 'defaults:\n  metadata: null', 'invalidDefaults', 'defaults.metadata'],
    ['unknown metadata default', 'defaults:\n  metadata:\n    typo: value', 'unknownField', 'defaults.metadata.typo'],
  ])('blocks %s with a stable scope and path', (_label, defaults, code, path) => {
    const result = parse(`schema: echorecall.batch\nversion: 1\n${defaults}\nitems:\n  - text: Valid sibling\n`)
    expect(result).toEqual({ ok: false, error: { scope: 'defaults', code, path } })
  })
})
