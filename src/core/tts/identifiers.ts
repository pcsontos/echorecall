import { isKnownModel, isKnownVoice } from './provider'

/** Shared maximum length for model and voice identifiers (after trim). */
export const MAX_IDENTIFIER_LENGTH = 128

const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9_./:+-]*$/

/**
 * True when `value` is a trimmed non-empty identifier of at most 128 characters
 * matching `^[A-Za-z0-9][A-Za-z0-9_./:+-]*$`. Used together with catalog
 * membership so prefixed gateway ids can generate and import.
 */
export function isValidIdentifier(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_IDENTIFIER_LENGTH) return false
  return IDENTIFIER_RE.test(trimmed)
}

/** Built-in catalog voice **or** a valid custom identifier. */
export function isAcceptableVoice(id: string): boolean {
  const trimmed = id.trim()
  return isKnownVoice(trimmed) || isValidIdentifier(id)
}

/** Built-in catalog model **or** a valid custom identifier. */
export function isAcceptableModel(model: string): boolean {
  const trimmed = model.trim()
  return isKnownModel(trimmed) || isValidIdentifier(model)
}
