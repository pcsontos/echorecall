# Phase 0 Research: LiteLLM Unified Gateway & Multi-Provider TTS

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

All behavioral clarifications are resolved in the spec. This document records implementation decisions; no clarification marker remains.

## R1 — Speech destination via the existing OpenAI SDK

**Decision**: Pass an optional `baseURL` into `new OpenAI({ apiKey, baseURL, timeout })` in `OpenAiTtsProvider`. Empty/absent `baseURL` keeps today’s default (`https://api.openai.com/v1`). No new TTS client, no vendor SDKs, no LiteLLM package.

Normalize a configured URL by trimming whitespace and stripping a single trailing slash. Do not add or remove `/v1`; operators type the prefix their gateway documents (LiteLLM commonly `http://localhost:4000/v1`). Reject anything that is not an absolute `http:` or `https:` URL before it becomes active.

**Rationale**: The official OpenAI Node SDK already targets OpenAI-compatible `/v1/audio/speech` backends through `baseURL`. LiteLLM’s proxy documents exactly that contract. Constitution Technology Stack already approves this SDK; configuration is not a new stack item.

**Alternatives considered**: Add ElevenLabs/Azure/Cartesia SDKs — rejected by spec and YAGNI. Raw `fetch` to `/v1/audio/speech` — duplicates the approved SDK. Host LiteLLM inside EchoRecall — rejected by spec.

**Primary sources**: [LiteLLM OpenAI TTS / proxy `/audio/speech`](https://docs.litellm.ai/docs/providers/openai/text_to_speech), OpenAI Node SDK `baseURL` constructor option.

## R2 — Identifier validation vs built-in catalog

**Decision**: Split membership from acceptability.

- `isKnownVoice` / `isKnownModel` remain exact built-in catalog membership (UI defaults, labels).
- New `isValidIdentifier(value)` accepts a trimmed non-empty string of at most 128 characters matching `^[A-Za-z0-9][A-Za-z0-9_./:+-]*$`.
- `generateSpeech`, batch validation, and generation-defaults sanitization accept a value if it is a known catalog id **or** a valid identifier.
- Formats stay closed: `isKnownFormat` is unchanged.

**Rationale**: Spec FR-012/FR-011 require prefixed third-party ids (`azure/en-US-JennyNeural`, `elevenlabs/eleven_multilingual_v2`) without dropping everyday catalog names. A closed format catalog is required by tagging. Empty/overlong/whitespace values stay errors.

**Alternatives considered**: Keep catalog-only rejection — contradicts the spec. Freeform any Unicode string — allows path-like and control-character accidents. Write-in Generate control — rejected by clarification; batch import and retained current values cover ids not in either catalog.

## R3 — `Model` type

**Decision**: Widen `Model` to `string` while keeping `MODELS` as the built-in catalog tuple and `INSTRUCTIONS_MODEL` as `'gpt-4o-mini-tts'`. SQLite already stores `model` as TEXT. `OpenAiTtsProvider` already casts `voice` into the SDK union; keep that cast and pass custom model names through as strings.

**Rationale**: A union of three literals cannot express gateway ids under strict TypeScript. Widening matches the opaque-identifier spec and avoids a parallel `CustomModel` type that would collapse to `string` anyway.

**Alternatives considered**: `BuiltinModel | (string & {})` branded union — extra ceremony for no runtime gain. Keep the union and escape-hatch `as Model` at every boundary — hides invalid states from the type checker.

## R4 — Gateway catalog discovery

**Decision**: When a base URL is configured, the server asks the gateway for models using the OpenAI SDK `models.list()` (same call Test Connection already uses). Optionally GET `{baseURL}/model/info` with the resolved key via native `fetch` (Node 22). If `model_info.mode` is present, keep entries whose mode is `audio_speech` (and `audio` if that is the only speech tag). If mode is absent, keep every listed model id.

Merge: built-in `VOICES`/`MODELS` first, then gateway-only ids, de-duplicated by case-sensitive id. If the gateway does not advertise voices, Generate keeps the built-in voice catalog. Discovery failure returns the built-in catalog plus a non-blocking `catalogError` code; it does not fail generation.

Expose the merge as a pure core function (`mergeSpeechCatalog`) so tests need no network. The Nitro adapter calls the gateway client and then the merger.

`GET /api/voices` stays the built-in catalog for Library filters. Generate uses a new `GET /api/tts/catalog`.

**Rationale**: Spec requires the union of built-in and gateway catalogs, with built-in surviving discovery failure. `/v1/models` is OpenAI-compatible and already used. `/model/info` is LiteLLM-specific and optional; a 404 must not break OpenAI-compatible gateways that only implement `/v1/models`. Filtering chat models out of the Generate picker is a UX necessity when LiteLLM lists every routed model.

**Alternatives considered**: Client-side discovery — would need the API key in the browser (forbidden). Replace `/api/voices` — would change Library filter semantics out of scope. Require `/model/info` — breaks non-LiteLLM compatible proxies.

**Primary sources**: [LiteLLM `/v1/models` discovery](https://docs.litellm.ai/docs/proxy/model_discovery), [LiteLLM model info](https://docs.litellm.ai/docs/proxy/model_management).

## R5 — Gateway-reported cost rates

**Decision**: Keep `MODEL_PRICING` authoritative for built-in catalog models. For any other model, `estimateItemCost(model, text, gatewayRates?)` uses a gateway rate when present:

| Gateway field | Estimate |
|---------------|----------|
| `input_cost_per_character` (or `output_cost_per_character`) | `text.length * rate` |
| else `output_cost_per_second` | duration model: `(words / 150) * 60 * rate` (same 150 WPM as `gpt-4o-mini-tts`) |
| else | `'unavailable'` |

Never return `{ amountUsd: 0 }` for an unpriced non-empty unknown model. Empty text on a priced model remains `{ amountUsd: 0 }` as today. Queue totals still sum only estimable items and count unavailable ones.

Rates travel with `GET /api/tts/catalog` (public numbers, not secrets). `useQueue` passes that map into `estimateItemCost`. No Settings field for manual third-party prices.

**Rationale**: Spec clarification C: gateway rate when present, otherwise unavailable. LiteLLM’s cost map uses per-character and per-second fields for `audio_speech`. Token-only chat rates are not a usable TTS estimate.

**Alternatives considered**: Always unavailable for non-OpenAI models — rejected by clarification. Settings custom rate — rejected. Use `x-litellm-response-cost` after generation — that is post-hoc spend, not a pre-generation estimate.

## R6 — Base URL persistence and precedence

**Decision**: Mirror the API key’s resolution order without encryption.

- Environment: `runtimeConfig.openaiBaseUrl` from `NUXT_OPENAI_BASE_URL`.
- In-app: `app_config` key `openai_base_url`, plaintext (same store as generation defaults).
- Resolve: trimmed in-app value if present → env → `undefined` (SDK default).
- Clearing the Settings field deletes the row so env can apply.
- Saving does not require `NUXT_APP_SECRET`.

**Rationale**: Spec FR-003 matches the existing key precedence. A base URL is configuration, not a credential; encrypting it would block save when key storage is disabled and would not match default-tags/generation-defaults.

**Alternatives considered**: Encrypt like the API key — unnecessary and coupled to `APP_SECRET`. Settings-only, no env — operators deploying Docker need env. Env-only — contradicts the in-app Settings story.

## R7 — Test Connection

**Decision**: Keep `POST /api/settings/openai-key/test` and extend the body to optional `{ baseUrl?: string, key?: string }`. The handler builds an OpenAI client from those drafts when provided, otherwise from the resolved saved/env pair, with a 10s timeout, and calls `models.list()`. It never writes config and never creates a Library clip.

Map failures to `{ ok: false, code }` where `code` is `NO_KEY` | `UNREACHABLE` | `UNAUTHORIZED` | `TIMEOUT` | `UNKNOWN`. Success is `{ ok: true }`. Never echo the key or raw provider body.

Save remains independent: invalid URL format is rejected on PUT; Test Connection is not required before save.

**Rationale**: Spec FR-008 requires the action, allows skipping it, and wants an actionable failure. Reusing `models.list()` avoids billed speech. Draft fields satisfy “values currently shown in Settings”.

**Alternatives considered**: Require test before save — rejected by clarification. Synthesize a tiny clip — costs money and writes audio. New route only — extra surface for the same action the UI already has.

## R8 — Settings and Generate UI

**Decision**: Add an optional API Base URL field and wire Test Connection to URL+key on the existing OpenAI key Settings section (one speech-destination card). Generate Voice/Model `USelectMenu` items become the merged catalog from `GET /api/tts/catalog`. If the current form/queue value is missing from that list, append it as a retained item so the control can display it. No create-item/write-in. Show a non-blocking alert when `catalogError` is set.

**Rationale**: Spec: union catalogs, retain selected/imported ids, no write-in, built-in catalog on discovery failure.

**Alternatives considered**: Separate Settings page — more chrome for one field. Always-on write-in — rejected by clarification.

## R9 — Batch import and generation defaults

**Decision**: Change `validate-batch.ts` so `invalidVoice` / `invalidModel` fire only when the string fails `isValidIdentifier` (or is the wrong type), not when it is absent from `VOICES`/`MODELS`. Format checks stay catalog-only. Generation-defaults `sanitize` keeps valid identifiers, including gateway ids, and still drops invalid/empty values.

**Rationale**: Spec FR-013: Generate, queue edit, and batch import share identifier rules. Defaults must be able to remember a gateway model.

**Alternatives considered**: Leave batch catalog-only — imported YAML with `azure/en-US-JennyNeural` would fail preview. Drop generation-defaults restriction later — would prevent Settings defaults for gateway models.

## R10 — Failover and errors

**Decision**: No new EchoRecall retry/failover loop. `generateSpeech` already maps provider exceptions to `ProviderUnavailableError` per item. If the gateway internally failsover and returns audio bytes, the existing success path tags and saves. If it returns a final HTTP error, the existing per-item failure path runs. Batch continuation stays as Feature 007 defines it.

**Rationale**: Spec assigns retry/failover to the gateway. Adding a second retry policy would double-charge and violate YAGNI.

## R11 — HTTP mocking and dependencies

**Decision**: No new runtime dependency. Gateway client is injectable; unit tests pass fakes. Default suites make no live network calls. Adapter tests that would hit a real gateway stay out of the default suite, matching the existing OpenAI provider pattern.

`ky` is constitution-listed but unused in this repo; do not add it for one optional GET. Node 22 `fetch` plus the OpenAI SDK covers Test Connection, `models.list()`, speech, and `/model/info`.

**Rationale**: Constitution II (mocked HTTP) and V (YAGNI). Adding `ky` now would be an unused stack expansion.

**Alternatives considered**: Add `ky` — extra package for one GET. Call live LiteLLM in CI — forbidden.

## R12 — CLI surface

**Decision**: There is no shipped CLI binary in this repository. Keep every new rule in `src/core/` with public signatures so a future CLI can resolve the same base URL, identifiers, catalog merge, and pricing. Web adapters stay thin. Do not invent CLI flags in this feature.

**Rationale**: Principle IV: capabilities are core-reachable. Spec FR-009 forbids a second speech destination; it does not require inventing a CLI that does not exist yet.
