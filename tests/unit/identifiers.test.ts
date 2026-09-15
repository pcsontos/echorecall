import { describe, expect, it } from 'vitest'
import {
  MAX_IDENTIFIER_LENGTH,
  isAcceptableModel,
  isAcceptableVoice,
  isValidIdentifier,
} from '../../src/core/tts/identifiers'

// 009 · US2: identifier acceptability is independent of built-in catalog membership.
// A value is a valid identifier after trim when it is 1–128 chars and matches
// `^[A-Za-z0-9][A-Za-z0-9_./:+-]*$`. generate/batch/defaults accept a known catalog
// id OR a valid identifier. Formats stay closed (not covered here).

describe('isValidIdentifier', () => {
  it('accepts trimmed 1–128 character ids that match the allowed charset', () => {
    expect(isValidIdentifier('a')).toBe(true)
    expect(isValidIdentifier('alloy')).toBe(true)
    expect(isValidIdentifier('azure/en-US-JennyNeural')).toBe(true)
    expect(isValidIdentifier('elevenlabs/eleven_multilingual_v2')).toBe(true)
    expect(isValidIdentifier('openai.gpt-4o-mini-tts')).toBe(true)
    expect(isValidIdentifier('provider:model+variant')).toBe(true)
    expect(isValidIdentifier('1custom')).toBe(true)
    expect(isValidIdentifier(`  alloy  `)).toBe(true)
    expect(isValidIdentifier('a'.repeat(MAX_IDENTIFIER_LENGTH))).toBe(true)
  })

  it('rejects empty, whitespace-only, overlong, and illegal values', () => {
    expect(isValidIdentifier('')).toBe(false)
    expect(isValidIdentifier('   ')).toBe(false)
    expect(isValidIdentifier('a'.repeat(MAX_IDENTIFIER_LENGTH + 1))).toBe(false)
    expect(isValidIdentifier('@@@')).toBe(false)
    expect(isValidIdentifier('bad id!')).toBe(false)
    expect(isValidIdentifier('_leading')).toBe(false)
    expect(isValidIdentifier('-leading')).toBe(false)
    expect(isValidIdentifier('/leading')).toBe(false)
    expect(isValidIdentifier('café')).toBe(false)
  })
})

describe('isAcceptableVoice', () => {
  it('accepts built-in catalog voices and valid custom identifiers', () => {
    expect(isAcceptableVoice('alloy')).toBe(true)
    expect(isAcceptableVoice('nova')).toBe(true)
    expect(isAcceptableVoice('bogus')).toBe(true)
    expect(isAcceptableVoice('azure/en-US-JennyNeural')).toBe(true)
  })

  it('rejects empty, overlong, and illegal voice ids', () => {
    expect(isAcceptableVoice('')).toBe(false)
    expect(isAcceptableVoice('   ')).toBe(false)
    expect(isAcceptableVoice('@@@')).toBe(false)
    expect(isAcceptableVoice('bad id!')).toBe(false)
    expect(isAcceptableVoice('a'.repeat(MAX_IDENTIFIER_LENGTH + 1))).toBe(false)
  })
})

describe('isAcceptableModel', () => {
  it('accepts built-in catalog models and valid custom identifiers', () => {
    expect(isAcceptableModel('tts-1')).toBe(true)
    expect(isAcceptableModel('gpt-4o-mini-tts')).toBe(true)
    expect(isAcceptableModel('gpt-9000')).toBe(true)
    expect(isAcceptableModel('elevenlabs/eleven_multilingual_v2')).toBe(true)
  })

  it('rejects empty, overlong, and illegal model ids', () => {
    expect(isAcceptableModel('')).toBe(false)
    expect(isAcceptableModel('   ')).toBe(false)
    expect(isAcceptableModel('@@@')).toBe(false)
    expect(isAcceptableModel('a'.repeat(MAX_IDENTIFIER_LENGTH + 1))).toBe(false)
  })
})
