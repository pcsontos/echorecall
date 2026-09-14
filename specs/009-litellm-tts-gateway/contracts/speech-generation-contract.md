# Contract: Speech generation with custom identifiers

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14

Shared validation for Generate, batch import, generation defaults, and `generateSpeech`. See [data-model.md](../data-model.md) §2 and [research.md](../research.md) R2, R3, R9, R10.

## Identifier rules

| Input | Outcome |
|-------|---------|
| Built-in catalog voice/model | Valid |
| Valid identifier (1–128 chars, `^[A-Za-z0-9][A-Za-z0-9_./:+-]*$`) | Valid, even if absent from both catalogs |
| Empty / whitespace | Invalid (`invalidVoice` / `invalidModel` / `InvalidVoiceError` / `InvalidModelError`) |
| Longer than 128 | Invalid (same codes) |
| Disallowed characters | Invalid (same codes) |
| Unknown **format** | Invalid (`invalidFormat` / `InvalidFormatError`) — catalog still closed |

`isKnownVoice` / `isKnownModel` remain for catalog membership. New `isValidIdentifier` is the generation/import gate together with catalog membership:

```ts
function isAcceptableVoice(id: string): boolean
function isAcceptableModel(model: string): boolean
```

## `generateSpeech`

Unchanged signature. Validation order stays: text → voice → model → format → speed, then provider. Custom ids pass validation and reach `TtsProvider.synthesize`.

`OpenAiTtsProvider.synthesize`:

- constructs the SDK client with `{ apiKey, baseURL?: resolved }`
- sends `model`, `voice`, `input`, `response_format`, and existing instructions/speed mapping
- casts `voice` to the SDK param type (SDK union is narrower than gateway ids)
- returns audio bytes; caller tags and saves as today

Instructions still apply only when `model === 'gpt-4o-mini-tts'`. Speed is still omitted for that model. Custom models that ignore extra fields succeed when the gateway returns audio.

Provider exceptions still become `ProviderUnavailableError`. No EchoRecall retry/failover loop.

## Batch import

`validate-batch.ts` uses `isAcceptableVoice` / `isAcceptableModel` instead of catalog-only checks. Existing issue codes `invalidVoice` and `invalidModel` stay; their meaning widens to “not an acceptable identifier”. YAML/JSON/plain-text preview, inheritance, and append are otherwise unchanged.

## Generation defaults

`sanitize` keeps `voiceId`/`model` when `isAcceptableVoice`/`isAcceptableModel` pass, so a gateway id can be a Settings default. Invalid values are still dropped. Format stays catalog-only.

## Library persistence

No schema change. Stored `voice_id` and `model` are the requested strings. Playback, tagging, and paths are unchanged.

## Tests that must change meaning

| Current assertion | New assertion |
|-------------------|---------------|
| `generateSpeech` rejects `voiceId: 'bogus'` | `'bogus'` is a valid identifier and is synthesized; reject `''`, `'@@@'`, and 129-char ids |
| `generateSpeech` rejects `model: 'gpt-9000'` | accept `'gpt-9000'` / `'elevenlabs/eleven_multilingual_v2'`; still reject empty/overlong |
| Batch `invalidVoice` for `not-a-voice` | that string is acceptable; use empty/`bad id!` for the error case |
