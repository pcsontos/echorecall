import { DomainError, type ErrorCode } from '#core'

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  EMPTY_INPUT: 400,
  INPUT_TOO_LONG: 400,
  INVALID_VOICE: 400,
  INVALID_MODEL: 400,
  INVALID_FORMAT: 400,
  INVALID_FILENAME: 400,
  INVALID_BASE_URL: 400,
  NO_API_KEY: 400,
  UPLOAD_TOO_LARGE: 413,
  KEY_STORAGE_DISABLED: 409,
  PROVIDER_UNAVAILABLE: 502,
  TAGGING_FAILED: 502,
  NOT_FOUND: 404,
}

export interface ApiErrorBody {
  error: { code: ErrorCode | 'INTERNAL'; message: string }
}

// Minimal structural view of an h3 event — avoids importing `h3` directly
// (not a direct dependency under pnpm). A real H3Event satisfies this.
interface EventLike {
  node: { res: { statusCode: number } }
}

/**
 * Map any thrown error to an HTTP status + ApiError envelope, set the status on
 * the event, and return the body. Domain errors map to their declared codes;
 * everything else becomes a generic 500 (never leaking internals/secrets).
 */
export function respondError(event: EventLike, err: unknown): ApiErrorBody {
  if (err instanceof DomainError) {
    event.node.res.statusCode = STATUS_BY_CODE[err.code]
    return { error: { code: err.code, message: err.message } }
  }
  // Unexpected (non-domain) error: log it server-side so production failures are
  // debuggable, but never leak internals/secrets in the client response.
  console.error('[respondError] Unhandled server error:', err)
  event.node.res.statusCode = 500
  return { error: { code: 'INTERNAL', message: 'Internal server error.' } }
}
