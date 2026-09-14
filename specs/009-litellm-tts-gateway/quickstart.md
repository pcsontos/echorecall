# Quickstart Validation: LiteLLM Unified Gateway & Multi-Provider TTS

**Feature**: 009-litellm-tts-gateway | **Branch**: `009-litellm-tts-gateway`

Runnable validation guide. It does not replace red-first task implementation.

## 1. Governance status

Constitution v2.6.0 already approves the official OpenAI SDK for TTS. This feature configures that SDK’s optional `baseURL` and adds no runtime dependency. The governance gate is satisfied; task generation and red-first implementation may proceed. No constitution amendment is required.

## 2. Environment

Expected toolchain:

- Node.js 22.x (project `engines`: `>=22.6`)
- pnpm 10
- repository branch `009-litellm-tts-gateway`

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3102/generate`. Default generation with only `NUXT_OPENAI_API_KEY` (no base URL) must keep working.

An external OpenAI-compatible gateway (LiteLLM or equivalent) is optional for live checks and **must not** be required by the default test suite.

## 3. Contract references

- Destination, env, Settings, Test Connection: [gateway-config-contract.md](./contracts/gateway-config-contract.md)
- Catalog merge and Generate selectors: [catalog-contract.md](./contracts/catalog-contract.md)
- Identifiers, generateSpeech, batch, defaults: [speech-generation-contract.md](./contracts/speech-generation-contract.md)
- Cost estimates: [cost-estimate-contract.md](./contracts/cost-estimate-contract.md)
- Entities and transitions: [data-model.md](./data-model.md)

## 4. Red-first verification order

For each slice, add/enable tests first and confirm they fail for the missing behavior. Then implement until they pass.

1. Base URL parse/resolve/persist (ui → env → default) and invalid URL rejection.
2. Identifier acceptability; `generateSpeech` accepts gateway ids; still rejects empty/overlong/illegal format.
3. Batch import and generation-defaults accept custom ids; format stays closed.
4. Catalog merge (builtin + gateway + retained + error fallback) with no network.
5. `estimateItemCost` uses built-in table, else gateway rate, else `'unavailable'` (never `$0.00` for unknown models).
6. Test Connection maps draft URL+key to `{ ok }` / `{ ok: false, code }` without writing config or audio.
7. Settings Base URL field, Test Connection copy, Generate catalog wiring, i18n parity, a11y.
8. Regression: empty base URL still uses public OpenAI; mocked `TtsProvider` suites stay green without network.

Focused commands during development:

```bash
pnpm test -- tests/unit/base-url.test.ts tests/unit/identifiers.test.ts tests/unit/generate.test.ts tests/unit/pricing.test.ts tests/unit/catalog-merge.test.ts
pnpm test -- tests/unit/batch-yaml.test.ts tests/unit/generation-defaults.test.ts tests/unit/api-key.test.ts tests/unit/i18n-parity.test.ts tests/unit/i18n.generate-next.test.ts
pnpm test:component -- tests/component/OpenAiKeySettings.test.ts tests/component/GenerationSettingsPanel.test.ts tests/component/generate-next.gensettings.test.ts
pnpm test -- tests/integration/settings-key.test.ts tests/integration/settings-base-url.test.ts tests/integration/generations-post.test.ts
```

Exact test file names are fixed in `/speckit-tasks`; the list above is the intended slice order.

## 5. Manual walkthrough (optional live gateway)

Prerequisites: a reachable LiteLLM (or compatible) proxy with at least one speech model, and a key the proxy accepts.

1. Settings → enter Base URL (for example `http://localhost:4000/v1`) → Save. Confirmation appears without requiring Test Connection.
2. Test Connection → success copy when the proxy answers `models.list()`; failure copy with an actionable code when it does not.
3. Generate Voice/Model lists include built-in entries plus at least one gateway-advertised speech model when discovery succeeds.
4. Generate one gateway-only model/voice clip → Library shows the clip with those identifiers.
5. Import a YAML item whose `model` is a gateway id → preview accepts it → generate succeeds or fails per item without aborting solely because the gateway failsover internally.
6. A model with neither published nor gateway rate shows unavailable cost, not `$0.00`, and still generates.
7. Clear the Base URL → Save → catalog and generation return to the built-in OpenAI path.

Do not add this live walkthrough to CI.

## 6. Out of scope checks (must stay false)

- No ElevenLabs/Azure/Cartesia client packages in `package.json`
- No LiteLLM binary or container defined by this feature
- No speech-to-text, realtime WebSocket, or audio-file import
- Default unit/component suites make zero live network calls
