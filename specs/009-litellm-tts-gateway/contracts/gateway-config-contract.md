# Contract: Speech gateway configuration

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14

Operator-visible destination for speech requests: optional Base URL plus the existing API key. See [data-model.md](../data-model.md) for fields and [research.md](../research.md) R1, R6, R7.

## Environment

| Runtime config | Environment variable | Role |
|----------------|----------------------|------|
| `openaiApiKey` | `NUXT_OPENAI_API_KEY` | Existing speech credential (unchanged) |
| `openaiBaseUrl` | `NUXT_OPENAI_BASE_URL` | Optional absolute `http(s)` gateway URL |
| `appSecret` | `NUXT_APP_SECRET` | Encrypts the in-app API key only; **not** required to save a Base URL |

Docker Compose should pass `NUXT_OPENAI_BASE_URL` the same way it already passes the API key. Empty means “use the public OpenAI speech service”.

## Core API (framework-independent)

```ts
const OPENAI_BASE_URL_CONFIG_KEY = 'openai_base_url'

function parseBaseUrl(raw: string | undefined | null): string | undefined
function resolveBaseUrl(deps: { config: AppConfigRepository; envBaseUrl?: string }): string | undefined
function getBaseUrlStatus(deps): { baseUrl?: string; source: 'ui' | 'env' | 'none' }
function setUiBaseUrl(deps, raw: string): { baseUrl: string; source: 'ui' }
function clearUiBaseUrl(deps): { baseUrl?: string; source: 'env' | 'none' }
```

`parseBaseUrl`:

- trim; empty → `undefined`
- reject if longer than 2048 characters
- reject if `new URL` fails or protocol is not `http:` / `https:`
- strip a single trailing `/`
- do not add or remove `/v1`

`setUiBaseUrl` throws a domain error on invalid input and writes nothing. `clearUiBaseUrl` deletes the `app_config` row.

`OpenAiTtsConfig` becomes `{ apiKey: string; baseURL?: string }`. `getTtsProvider()` passes `resolveBaseUrl(...)`.

## REST

### GET `/api/settings/openai-base-url`

- **200**: `{ "baseUrl": "http://localhost:4000/v1", "source": "ui" }`
- When unset: `{ "source": "none" }` or `{ "baseUrl": "http://…", "source": "env" }`
- Never 500s on a missing row.

### PUT `/api/settings/openai-base-url`

- Body: `{ "baseUrl": "http://localhost:4000/v1" }`
- **200**: normalized `{ baseUrl, source: "ui" }`
- **400** `INVALID_BASE_URL` when the value is not an absolute http(s) URL
- Does not require `NUXT_APP_SECRET`
- Does not call the gateway

### DELETE `/api/settings/openai-base-url`

- **200**: resulting `{ baseUrl?, source }` after deleting the in-app row

### POST `/api/settings/openai-key/test` (extended)

Existing route. Optional body:

```ts
{ baseUrl?: string; key?: string }
```

Resolution:

1. `key` from body if a non-empty string, else resolved API key
2. `baseUrl` from body if the property is present (empty string → default OpenAI), else resolved stored/env URL

Behavior:

- Timeout 10 seconds
- `models.list()` only; no speech, no Library write, no config write
- **200** `{ "ok": true }` or `{ "ok": false, "code": "NO_KEY" | "UNREACHABLE" | "UNAUTHORIZED" | "TIMEOUT" | "UNKNOWN" }`
- Key is never logged or returned

Save of URL or key remains allowed when this action is skipped.

## Settings UI

The existing OpenAI key card gains:

- Optional **API Base URL** text field (shown in full; not masked)
- Existing Test Connection button, now validating URL + key together
- Actionable test copy for each `code`
- English and Hungarian strings

Clearing the URL field and saving issues DELETE (or PUT empty, which the adapter treats as clear).
