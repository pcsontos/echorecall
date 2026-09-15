# Data Model: LiteLLM Unified Gateway & Multi-Provider TTS

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14

No new SQLite table or migration. Base URL reuses `app_config(key, value)`. Library `generations.model` / `voice_id` remain TEXT and already store opaque strings.

## 1. Speech gateway configuration

```ts
interface SpeechGatewayConfig {
  /** Absolute http(s) URL, trailing slash stripped, or undefined for the SDK default. */
  baseUrl?: string
  source: 'ui' | 'env' | 'none'
}

interface SpeechGatewayConfigInput {
  baseUrl?: string | null
}
```

| Field | Rule |
|-------|------|
| `baseUrl` | Trimmed. Empty/whitespace/`null` means unset. Non-empty must be an absolute `http:` or `https:` URL. Max 2048 characters. |
| `source` | `ui` when an `app_config` row exists, else `env` when `NUXT_OPENAI_BASE_URL` is set, else `none`. |

Persistence:

- `app_config.key = 'openai_base_url'`
- Value is the normalized URL string (not encrypted)
- Delete the row to clear the in-app override
- Resolution: in-app → env → undefined

Relationships: pairs with the existing resolved API key (`ui` → `env`) at request time. Neither field is a substitute for the other.

## 2. Identifier

```ts
const MAX_IDENTIFIER_LENGTH = 128
type Model = string
type VoiceId = string
```

A model or voice identifier is acceptable when it is a built-in catalog id **or** it matches:

- trim → length 1–128
- `^[A-Za-z0-9][A-Za-z0-9_./:+-]*$`

Format remains `Format = 'mp3' | 'wav' | 'flac' | 'opus' | 'aac' | 'pcm'`.

Built-in catalogs stay:

- `VOICES`: `{ id, label }[]`
- `MODELS`: `['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']`
- `INSTRUCTIONS_MODEL`: `'gpt-4o-mini-tts'`

## 3. Merged speech catalog

```ts
interface CatalogEntry {
  id: string
  label: string
  source: 'builtin' | 'gateway' | 'retained'
  /** Models only. Built-in → `openai`. Gateway → `model_info.litellm_provider` or `litellm_params.custom_llm_provider`. Omitted → grouped as `other`. */
  provider?: string
}

interface GatewayRate {
  inputCostPerCharacter?: number
  outputCostPerCharacter?: number
  outputCostPerSecond?: number
}

interface SpeechCatalog {
  voices: CatalogEntry[]
  models: CatalogEntry[]
  rates: Record<string, GatewayRate>
  catalogError?: 'UNREACHABLE' | 'UNAUTHORIZED' | 'TIMEOUT' | 'UNKNOWN'
}
```

Merge rules:

1. Start with built-in voices/models (`source: 'builtin'`).
2. Append gateway ids not already present (`source: 'gateway'`). Ids compare case-sensitively.
3. If a currently selected/imported id is still missing, append it (`source: 'retained'`).
4. On discovery failure, steps 1 and 3 still apply and `catalogError` is set.
5. `rates` contains only gateway-reported numeric fields; built-in `MODEL_PRICING` is not copied here.

Lifecycle: resolved config → optional gateway fetch → merge → Generate selectors and cost map.

## 4. Connection test result

```ts
type ConnectionTestCode = 'NO_KEY' | 'UNREACHABLE' | 'UNAUTHORIZED' | 'TIMEOUT' | 'UNKNOWN'

type ConnectionTestResult = { ok: true } | { ok: false; code: ConnectionTestCode }
```

Inputs: optional draft `baseUrl` and draft `key`; omitted fields use the resolved saved/env values. No persistence. No Library row.

## 5. Cost estimate

Existing `CostEstimate = { amountUsd: number } | 'unavailable'` is unchanged.

Resolution order for one item:

1. Built-in `MODEL_PRICING[model]` → existing character or duration formula.
2. Else `gatewayRates[model]` → character rate or 150 WPM × per-second rate.
3. Else `'unavailable'`.

Queue aggregate (existing): `totalUsd` sums only `{ amountUsd }`; `unavailableCount` counts `'unavailable'`.

## 6. Generation result (unchanged path)

Successful gateway audio follows the existing `Generation` entity: tagged bytes, SQLite row, filesystem path. `voiceId` and `model` store the requested identifiers verbatim. Provider failover that still returns bytes is indistinguishable from a normal success. A final provider error remains `ProviderUnavailableError` and creates no Library row.

## State transitions

```text
Base URL:  unset ──save valid──► ui-set ──clear──► env or unset
                 └──invalid──► unchanged + error

Catalog:   builtin-only ──gateway ok──► merged
                         └──gateway fail──► builtin-only + catalogError

Cost:      builtin-priced ──else gateway rate──► amountUsd
                                           └──else──► unavailable

Test:      idle ──run──► ok | fail(code)   (never writes)
```
