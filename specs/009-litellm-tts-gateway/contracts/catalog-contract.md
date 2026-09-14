# Contract: Speech catalog

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14

Generate Voice and Model controls show the union of the built-in catalog and the configured gateway catalog. See [data-model.md](../data-model.md) §3 and [research.md](../research.md) R4–R5.

## Core API (browser-safe merge)

```ts
function mergeSpeechCatalog(input: {
  builtinVoices: readonly Voice[]
  builtinModels: readonly string[]
  gatewayVoices?: readonly { id: string; label?: string }[]
  gatewayModels?: readonly { id: string; label?: string; mode?: string }[]
  retainedVoiceId?: string
  retainedModel?: string
  catalogError?: SpeechCatalog['catalogError']
}): Pick<SpeechCatalog, 'voices' | 'models' | 'catalogError'>
```

Gateway model filter: if any advertised model has `mode`, keep `audio_speech` and `audio`; if none have `mode`, keep all ids.

## Server gateway client (not in `#core/client`)

Injectable port:

```ts
interface SpeechGatewayClient {
  listModels(): Promise<{ id: string; label?: string; mode?: string }[]>
  listVoices(): Promise<{ id: string; label?: string }[]>
  listRates(): Promise<Record<string, GatewayRate>>
}
```

Default adapter:

1. `OpenAI({ apiKey, baseURL, timeout: 10_000 }).models.list()`
2. Optional `GET {baseURL}/model/info` with `Authorization: Bearer {apiKey}`
3. Parse rates from `input_cost_per_character`, `output_cost_per_character`, `output_cost_per_second` when they are finite numbers
4. Voices: empty array unless the info payload clearly lists them
5. Any failure of (1) or (2) → caller returns built-in catalog + `catalogError`

When no base URL is configured, skip the client and return built-in catalogs with empty `rates`.

## REST

### GET `/api/tts/catalog`

Server-only: uses the resolved key + base URL. Never returns the key.

**200**:

```json
{
  "voices": [
    { "id": "alloy", "label": "Alloy", "source": "builtin" },
    { "id": "21m00Tcm4TlvDq8ikWAM", "label": "21m00Tcm4TlvDq8ikWAM", "source": "gateway" }
  ],
  "models": [
    { "id": "gpt-4o-mini-tts", "label": "gpt-4o-mini-tts", "source": "builtin" },
    { "id": "elevenlabs/eleven_multilingual_v2", "label": "elevenlabs/eleven_multilingual_v2", "source": "gateway" }
  ],
  "rates": {
    "elevenlabs/eleven_multilingual_v2": { "inputCostPerCharacter": 0.00003 }
  }
}
```

On gateway failure, **200** with built-in voices/models, `"rates": {}`, and `"catalogError": "UNREACHABLE"` (or `UNAUTHORIZED` / `TIMEOUT` / `UNKNOWN`). Discovery never 401s the Generate page.

### GET `/api/voices`

Unchanged: `{ voices: VOICES }` (built-in only). Library filters keep this list.

## Generate UI

- Voice and Model menus bind to `GET /api/tts/catalog`.
- Built-in entries remain when the catalog is loading or `catalogError` is set.
- A non-blocking status announces catalog load failure.
- If the current form/queue `voiceId` or `model` is not in the list, the page appends a `source: "retained"` item so the control can show it.
- No create-item / freeform write-in.
- Duplicate ids from gateway and built-in appear once (`source: "builtin"` wins).
