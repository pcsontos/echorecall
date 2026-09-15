# Implementation Plan: LiteLLM Unified Gateway & Multi-Provider TTS

**Branch**: `009-litellm-tts-gateway` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-litellm-tts-gateway/spec.md`

## Summary

Let operators point EchoRecall at an OpenAI-compatible speech gateway (LiteLLM or equivalent) by setting an optional API Base URL in Settings or `NUXT_OPENAI_BASE_URL`. The existing official OpenAI SDK sends `/v1/audio/speech` to that address with the resolved API key (in-app key still wins over env). Empty URL keeps today’s public OpenAI path with zero config change.

Generate Voice/Model controls show the union of the built-in catalog and the gateway catalog. Custom identifiers that pass shared validation (1–128 characters, prefixed provider ids allowed) can be queued, imported, and synthesized. Cost uses the published OpenAI table when present, else a gateway-reported character or per-second rate, else `'unavailable'` — never `$0.00` for an unknown model. Test Connection checks URL + key via `models.list()` and is not required to save. EchoRecall does not host the gateway, add vendor SDKs, or implement its own retry/failover.

## Technical Context

**Language/Version**: Strict TypeScript 6 on Node.js 22 (project `engines`: `>=22.6`); Vue SFCs use `<script setup lang="ts">`.

**Primary Dependencies**: Existing Nuxt 4.4 / Vue 3.5 / Nitro / Vite, `@nuxt/ui` 4.8, `@nuxtjs/i18n` 10.4, `openai` ^6.42. **No new runtime dependency.** Optional gateway `GET {baseURL}/model/info` uses Node 22 `fetch`.

**Storage**: Existing SQLite `app_config` row `openai_base_url` (plaintext). No new table, no migration, no change to generation audio paths.

**Testing**: Vitest 4 unit/integration tests plus `@nuxt/test-utils` with happy-dom for components. Red-first. Default suites make no live network calls; gateway client is injected. Existing i18n parity tests cover new English/Hungarian keys.

**Target Platform**: Dockerized Nuxt/Nitro web app on modern evergreen browsers; core APIs remain Node-testable and CLI-ready. External gateway is operator-provided.

**Project Type**: Nuxt full-stack web application over a framework-independent TypeScript core.

**Performance Goals**: Spec SC-001 walkthrough under 3 minutes with a gateway already running. SC-008/Test Connection failures surface within 15 seconds (implementation timeout 10 seconds). SC-009 Settings save confirmation within 2 seconds on the Feature 008 reference desktop profile.

**Constraints**: No `any`; domain logic stays in `src/core/`; API key remains server-only; Base URL is http(s) only; identifier max 128 characters; formats stay catalog-closed; English/Hungarian parity; keyboard/AT-accessible Settings and Generate controls; no vendor SDKs; no embedded LiteLLM.

**Scale/Scope**: One settings persistence helper, identifier/catalog/pricing core changes, OpenAI adapter `baseURL`, two thin Nitro surfaces (base URL CRUD + catalog GET, extended key test), Settings field, Generate catalog wiring, focused tests. CLI binary is not shipped; core stays programmatic.

## Constitution Check

*GATE: Evaluated before Phase 0 and re-checked after Phase 1 design.*

Against EchoRecall Constitution **v2.6.0**:

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. TypeScript-First | PASS | PASS | `Model` widens to `string` with explicit identifier predicates; public signatures on parse/resolve/merge/estimate; no `any`. |
| II. Test-First | PASS | PASS | Core URL/identifier/catalog/pricing/generation, Settings/Generate UI, and regressions are red-first. Gateway HTTP is injected/faked; default suites have no live calls. |
| III. Modular Architecture | PASS | PASS | URL rules, identifiers, catalog merge, and pricing live in `src/core/`; Vue only renders fields and catalog items; Nitro only resolves secrets and calls the injectable gateway client. |
| IV. Shared Core, Multiple Interfaces | PASS | PASS | All new behavior is core-exported. Web is a thin adapter. No CLI binary exists yet; no second speech destination is introduced. |
| V. Simplicity & YAGNI | PASS | PASS | Reuses the approved OpenAI SDK `baseURL`. No vendor SDKs, no `ky`, no hosted proxy, no EchoRecall retry loop, no write-in control, no manual rate field. |

**Technology Stack governance gate — PASS.** Constitution v2.6.0 already lists “OpenAI TTS API via the official OpenAI SDK”. Optional `baseURL` is constructor configuration of that SDK, not a new stack entry. LiteLLM is an external operator service, not a project dependency. No amendment or Complexity-Tracking exception is required.

**Constitution HTTP-mocking follow-up**: gateway `models.list()` / `model/info` / Test Connection are covered by an injectable client and fakes. Live LiteLLM is optional manual validation only.

## Project Structure

### Documentation (this feature)

```text
specs/009-litellm-tts-gateway/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gateway-config-contract.md
│   ├── catalog-contract.md
│   ├── speech-generation-contract.md
│   └── cost-estimate-contract.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md                         # created later by /speckit-tasks
```

### Source Code (repository root)

```text
src/core/
├── settings/
│   ├── base-url.ts                  # NEW: parse/resolve/persist openai_base_url
│   ├── api-key.ts                   # ADAPT: testApiKey may receive resolved base URL via verifier
│   └── generation-defaults.ts       # ADAPT: sanitize accepts valid identifiers
├── tts/
│   ├── identifiers.ts               # NEW: isValidIdentifier / isAcceptableVoice / isAcceptableModel
│   ├── catalog.ts                   # NEW: mergeSpeechCatalog (pure)
│   ├── pricing.ts                   # ADAPT: optional gatewayRates argument
│   ├── generate.ts                  # ADAPT: identifier gates replace catalog-only reject
│   ├── provider.ts                  # KEEP: VOICES/MODELS/isKnown*; formats closed
│   ├── openai-provider.ts           # ADAPT: optional baseURL; string voice/model
│   └── gateway-client.ts            # NEW server-only: models.list + optional /model/info
├── batch/validate-batch.ts          # ADAPT: acceptable identifiers
├── client.ts                        # ADAPT: export identifier/catalog/pricing helpers
└── index.ts                         # ADAPT: export base-url + gateway client

server/
├── utils/container.ts               # ADAPT: resolveActiveBaseUrl; getTtsProvider({ apiKey, baseURL })
└── api/
    ├── settings/openai-base-url.get.ts    # NEW
    ├── settings/openai-base-url.put.ts    # NEW
    ├── settings/openai-base-url.delete.ts # NEW
    ├── settings/openai-key/test.post.ts   # ADAPT: optional draft baseUrl/key; typed failure codes
    └── tts/catalog.get.ts                 # NEW: merged catalog + rates

app/
├── components/settings/
│   ├── OpenAiKeySettings.vue        # ADAPT: Base URL field; test uses URL+key
│   └── SettingsModal.vue            # unchanged host
├── components/generate/
│   └── GenerationSettingsPanel.vue  # ADAPT: catalog items, retained current value
├── composables/
│   ├── useSettings.ts               # ADAPT: base URL CRUD + extended test
│   ├── useSpeechCatalog.ts          # NEW: GET /api/tts/catalog
│   └── useQueue.ts                  # ADAPT: pass gateway rates into estimateItemCost
└── pages/generate.vue               # ADAPT: catalog load, retained ids, catalogError

i18n/locales/
├── en.json                          # ADD base URL, test codes, catalog error copy
└── hu.json                          # ADD matching Hungarian keys

tests/
├── unit/
│   ├── base-url.test.ts             # NEW
│   ├── identifiers.test.ts          # NEW
│   ├── catalog-merge.test.ts        # NEW
│   ├── generate.test.ts             # ADAPT: accept custom ids; reject empty/illegal
│   ├── pricing.test.ts              # ADAPT: gateway rates + unavailable
│   ├── batch-yaml.test.ts           # ADAPT: custom ids valid
│   ├── generation-defaults.test.ts  # ADAPT: custom ids persist
│   └── i18n*.test.ts                # ADAPT: new key parity
├── component/
│   ├── OpenAiKeySettings.test.ts    # NEW/ADAPT
│   └── GenerationSettingsPanel.test.ts # ADAPT: merged items, retained value
└── integration/
    ├── settings-base-url.test.ts    # NEW
    ├── settings-key.test.ts         # ADAPT: test body + codes
    └── generations-post.test.ts     # ADAPT: custom model/voice through provider mock
```

**Structure Decision**: Keep URL parsing, identifier rules, catalog merge, and cost math in framework-independent `src/core/`. The OpenAI SDK remains the only speech network adapter, now constructed with optional `baseURL`. Nitro routes resolve the server-only key, persist the non-secret URL, and fetch the catalog. Vue components do not contain destination or validation rules.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|--------------------------------------|
| Optional `{baseURL}/model/info` fetch | Spec requires gateway-reported rates when the gateway publishes them | `/v1/models` has no prices; a Settings manual rate was rejected by clarification |
| Identifier predicate besides `isKnown*` | Spec allows prefixed third-party ids without deleting the built-in catalog | Catalog-only rejection breaks batch import and Generate for gateway models |
| Test Connection draft `baseUrl`/`key` | Spec tests the values currently shown, including unsaved edits | Testing only saved config cannot verify a URL the user has not saved yet |
| Retained catalog item (not write-in) | Spec forbids a freeform control but requires imported/last-selected ids to remain visible | Dropping unknown current values would blank Generate after import |

## Phase 0: Research Outcome

All technical unknowns are resolved in [research.md](./research.md). SDK `baseURL`, identifier rules, catalog merge, rate mapping, persistence, Test Connection, batch/defaults, failover transparency, mocking, and CLI non-scope have no unresolved clarification markers. Constitution v2.6.0 already covers the OpenAI SDK; no planning gate remains.

## Phase 1: Design Outcome

- [data-model.md](./data-model.md) defines gateway config, identifiers, merged catalog, test result, and cost resolution.
- [gateway-config-contract.md](./contracts/gateway-config-contract.md) fixes env, `app_config`, REST, and Test Connection.
- [catalog-contract.md](./contracts/catalog-contract.md) fixes merge, `GET /api/tts/catalog`, and Generate selector behavior.
- [speech-generation-contract.md](./contracts/speech-generation-contract.md) fixes identifier gates across generate/batch/defaults.
- [cost-estimate-contract.md](./contracts/cost-estimate-contract.md) fixes built-in vs gateway vs unavailable estimates.
- [quickstart.md](./quickstart.md) provides red-first slices and an optional live-gateway walkthrough.

Post-design constitution re-check: Principles I–V pass; no new dependency, table, or vendor SDK. The feature is ready for task generation.
