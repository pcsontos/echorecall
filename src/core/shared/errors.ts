/** Stable machine-readable error codes shared across the core and adapters. */
export type ErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'INVALID_VOICE'
  | 'INVALID_MODEL'
  | 'INVALID_FORMAT'
  | 'INVALID_FILENAME'
  | 'INVALID_BASE_URL'
  | 'UPLOAD_TOO_LARGE'
  | 'NO_API_KEY'
  | 'KEY_STORAGE_DISABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TAGGING_FAILED'
  | 'NOT_FOUND'

/** Base class for all domain errors. Carries a stable `code`. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class EmptyInputError extends DomainError {
  constructor() {
    super('EMPTY_INPUT', 'Text must not be empty.')
  }
}

export class InputTooLongError extends DomainError {
  constructor(public readonly max: number) {
    super('INPUT_TOO_LONG', `Text exceeds the maximum of ${max} characters.`)
  }
}

export class InvalidVoiceError extends DomainError {
  constructor(public readonly voiceId: string) {
    super('INVALID_VOICE', `Unknown voice: "${voiceId}".`)
  }
}

export class InvalidModelError extends DomainError {
  constructor(public readonly model: string) {
    super('INVALID_MODEL', `Unknown model: "${model}".`)
  }
}

export class InvalidFormatError extends DomainError {
  constructor(public readonly format: string) {
    super('INVALID_FORMAT', `Unknown format: "${format}".`)
  }
}

export class InvalidFilenameError extends DomainError {
  constructor(message = 'Filename is empty or cannot be turned into a valid name.') {
    super('INVALID_FILENAME', message)
  }
}

export class InvalidBaseUrlError extends DomainError {
  constructor(message = 'Enter an absolute http:// or https:// URL.') {
    super('INVALID_BASE_URL', message)
  }
}

export class UploadTooLargeError extends DomainError {
  constructor(public readonly maxBytes: number) {
    super('UPLOAD_TOO_LARGE', `Uploaded file exceeds the maximum of ${maxBytes} bytes.`)
  }
}

export class NoApiKeyError extends DomainError {
  constructor() {
    super(
      'NO_API_KEY',
      'No OpenAI API key is configured. Set one in Settings or via the OPENAI_API_KEY environment variable.',
    )
  }
}

export class KeyStorageDisabledError extends DomainError {
  constructor() {
    super(
      'KEY_STORAGE_DISABLED',
      'In-app key storage is disabled. Set NUXT_APP_SECRET to store an OpenAI key in the app.',
    )
  }
}

export class ProviderUnavailableError extends DomainError {
  constructor(message = 'The text-to-speech provider is currently unavailable.') {
    super('PROVIDER_UNAVAILABLE', message)
  }
}

export class TaggingFailedError extends DomainError {
  constructor(message = 'Failed to write audio metadata.') {
    super('TAGGING_FAILED', message)
  }
}

export class NotFoundError extends DomainError {
  constructor(public readonly id: string) {
    super('NOT_FOUND', `Generation not found: "${id}".`)
  }
}
