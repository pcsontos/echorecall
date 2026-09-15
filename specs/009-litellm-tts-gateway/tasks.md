# Tasks: LiteLLM Unified Gateway & Multi-Provider TTS

**Input**: Design documents from `specs/009-litellm-tts-gateway/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required. EchoRecall Constitution v2.6.0 mandates Red–Green–Refactor. The plan and `quickstart.md` require red-first unit, component, integration, localization, and regression coverage. Default suites make no live network calls.

**Organization**: Tasks are grouped by user story. Each story starts with tests, explicit user/reviewer approval of those tests, and a recorded red run before implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Safe to execute in parallel because the task touches different files and has no dependency on unfinished work in the same phase.
- **[Story]**: Maps the task to the specification's user story (US1–US4). Setup, foundational, and polish tasks have no story label.
- Every task includes an exact repository path.

## Path Conventions

Shared core in `src/core/`; Nuxt adapters in `app/` and `server/`; tests in `tests/unit/`, `tests/component/`, and `tests/integration/`.

---

## Phase 1: Setup

**Purpose**: Declare the optional gateway URL environment mapping. No new npm dependency.

**Documented TDD exemption for T001–T002**: These tasks only add empty runtime/env plumbing so later tests can read `openaiBaseUrl`. They introduce no parse, persist, UI, or speech behavior. Any observable behavior discovered here MUST be moved behind the US1 red gate.

- [x] T001 Add empty server-only `runtimeConfig.openaiBaseUrl` (env `NUXT_OPENAI_BASE_URL`) in `nuxt.config.ts` under the documented non-behavioral TDD exemption
- [x] T002 [P] Pass `NUXT_OPENAI_BASE_URL` through the service `environment` block in `docker-compose.yml` under the documented non-behavioral TDD exemption

---

## Phase 2: Foundational Types

**Purpose**: Compile-time types shared by every story. No runtime behavior.

**⚠️ CRITICAL**: Complete this phase before any user-story implementation.

**Documented TDD exemption for T003–T005**: Type-only widening and exports so test files compile. No parse/validate/network/UI logic.

- [x] T003 Widen `Model` from the three-literal union to `string` in `src/core/shared/types.ts` under the documented non-behavioral TDD exemption
- [x] T004 [P] Add compile-time-only `CatalogEntry`, `GatewayRate`, `SpeechCatalog`, and `ConnectionTestResult` types in `src/core/tts/catalog.ts` under the documented non-behavioral TDD exemption
- [x] T005 Export the new catalog/connection types from `src/core/client.ts` and `src/core/index.ts` under the documented non-behavioral TDD exemption

**Checkpoint**: Custom model strings type-check; catalog/test result shapes exist as types only.

---

## Phase 3: User Story 1 — Point EchoRecall at a custom speech gateway (Priority: P1) 🎯 MVP

**Goal**: Optional API Base URL in Settings and env, ui→env→default OpenAI precedence, Test Connection for URL+key without saving, and speech requests using the resolved destination.

**Independent Test**: Save a valid Base URL in Settings (or set env), run Test Connection, generate one built-in catalog clip through that destination, clear the URL, and confirm generation returns to the default OpenAI path.

### Tests for User Story 1 — write and verify red first

- [ ] T006 [P] [US1] Write failing parse/normalize/reject/resolve (ui→env→unset), persist, and clear tests in `tests/unit/base-url.test.ts`
- [ ] T007 [P] [US1] Write failing tests that `OpenAiTtsProvider` constructs the SDK with optional `baseURL` and omits it when unset in `tests/unit/openai-provider.test.ts`
- [ ] T008 [P] [US1] Write failing GET/PUT/DELETE and `INVALID_BASE_URL` tests in `tests/integration/settings-base-url.test.ts`
- [ ] T009 [P] [US1] Extend failing Test Connection tests for optional `{ baseUrl, key }`, no config/audio write, and `NO_KEY`/`UNREACHABLE`/`UNAUTHORIZED`/`TIMEOUT`/`UNKNOWN` codes in `tests/integration/settings-key.test.ts`
- [ ] T010 [P] [US1] Write failing Settings Base URL field, save/clear, save-without-test, and test-result copy tests in `tests/component/OpenAiKeySettings.test.ts`
- [ ] T011 [US1] Obtain explicit user/reviewer approval for the US1 tests from T006–T010, then run the approved focused tests and record the expected failures in `specs/009-litellm-tts-gateway/quickstart.md`

### Implementation for User Story 1

- [ ] T012 [US1] Implement `parseBaseUrl`, `resolveBaseUrl`, `getBaseUrlStatus`, `setUiBaseUrl`, and `clearUiBaseUrl` in `src/core/settings/base-url.ts`
- [ ] T013 [US1] Add optional `baseURL` to `OpenAiTtsConfig` and pass it to `new OpenAI(...)` in `src/core/tts/openai-provider.ts`
- [ ] T014 [US1] Resolve the active base URL and pass `{ apiKey, baseURL }` from `getTtsProvider()` in `server/utils/container.ts`
- [ ] T015 [US1] Implement GET/PUT/DELETE in `server/api/settings/openai-base-url.get.ts`, `server/api/settings/openai-base-url.put.ts`, and `server/api/settings/openai-base-url.delete.ts`
- [ ] T016 [US1] Extend POST `/api/settings/openai-key/test` to accept draft `baseUrl`/`key`, call `models.list()` with a 10s timeout, and return typed `{ ok }` results in `server/api/settings/openai-key/test.post.ts`
- [ ] T017 [US1] Export base-url helpers from `src/core/index.ts`
- [ ] T018 [US1] Add Base URL CRUD and extended test helpers in `app/composables/useSettings.ts`
- [ ] T019 [US1] Add the optional Base URL field, save/clear, and Test Connection wiring in `app/components/settings/OpenAiKeySettings.vue`
- [ ] T020 [US1] Add English and Hungarian Base URL, validation, and test-code copy in `i18n/locales/en.json` and `i18n/locales/hu.json`
- [ ] T021 [US1] Stub `GET /api/settings/openai-base-url` in existing Settings mounts in `tests/component/SettingsModal.test.ts`
- [ ] T022 [US1] Run the US1-focused tests until green, then refactor without changing the contracts in `tests/unit/base-url.test.ts`, `tests/unit/openai-provider.test.ts`, `tests/integration/settings-base-url.test.ts`, `tests/integration/settings-key.test.ts`, and `tests/component/OpenAiKeySettings.test.ts`

**Checkpoint**: A valid Base URL can be saved without Test Connection; Test Connection reports reachability; catalog generation uses the resolved destination; empty URL keeps public OpenAI.

---

## Phase 4: User Story 2 — Generate with third-party models and voices (Priority: P1)

**Goal**: Accept custom identifiers, merge built-in and gateway catalogs in Generate, retain selected/imported ids, and keep built-in catalogs when discovery fails.

**Independent Test**: With a fake/reachable gateway catalog, Generate lists built-in plus at least one gateway-only model; generating that pair stores those identifiers in the Library. A YAML item with a custom id previews as valid.

### Tests for User Story 2 — write and verify red first

- [ ] T023 [P] [US2] Write failing `isValidIdentifier` / `isAcceptableVoice` / `isAcceptableModel` tests (length, charset, catalog membership) in `tests/unit/identifiers.test.ts`
- [ ] T024 [P] [US2] Write failing merge tests for builtin-first, gateway-only append, de-dupe, retained ids, mode filter, and `catalogError` fallback in `tests/unit/catalog-merge.test.ts`
- [ ] T025 [P] [US2] Rewrite failing `generateSpeech` tests to accept custom ids and reject empty/overlong/illegal identifiers while still rejecting unknown formats in `tests/unit/generate.test.ts`
- [ ] T026 [P] [US2] Extend failing batch tests so prefixed custom `voiceId`/`model` are valid and empty/illegal ids still emit `invalidVoice`/`invalidModel` in `tests/unit/batch-yaml.test.ts`
- [ ] T027 [P] [US2] Extend failing generation-defaults sanitize tests to keep valid custom identifiers in `tests/unit/generation-defaults.test.ts`
- [ ] T028 [P] [US2] Write failing gateway-client tests (injected `models.list` / `model/info`, speech-mode filter, rates parse, failure mapping) in `tests/unit/gateway-client.test.ts`
- [ ] T029 [P] [US2] Extend failing Voice/Model menu tests for merged items, retained current value, and no write-in in `tests/component/GenerationSettingsPanel.test.ts`
- [ ] T030 [P] [US2] Extend failing Generate-page tests for catalog load, builtin-on-error announcement, and custom-id generation in `tests/component/generate-next.gensettings.test.ts`
- [ ] T031 [US2] Obtain explicit user/reviewer approval for the US2 tests from T023–T030, then run the approved focused tests and record the expected failures in `specs/009-litellm-tts-gateway/quickstart.md`

### Implementation for User Story 2

- [ ] T032 [US2] Implement `MAX_IDENTIFIER_LENGTH`, `isValidIdentifier`, `isAcceptableVoice`, and `isAcceptableModel` in `src/core/tts/identifiers.ts`
- [ ] T033 [US2] Switch `generateSpeech` validation from catalog-only checks to acceptable-identifier gates in `src/core/tts/generate.ts`
- [ ] T034 [US2] Switch batch `invalidVoice`/`invalidModel` to acceptable-identifier rules in `src/core/batch/validate-batch.ts`
- [ ] T035 [US2] Keep valid custom identifiers in generation-defaults `sanitize` in `src/core/settings/generation-defaults.ts`
- [ ] T036 [US2] Implement `mergeSpeechCatalog` in `src/core/tts/catalog.ts`
- [ ] T037 [US2] Implement the injectable `SpeechGatewayClient` (SDK `models.list`, optional `{baseURL}/model/info` via `fetch`) in `src/core/tts/gateway-client.ts`
- [ ] T038 [US2] Pass custom `voice`/`model` strings through `src/core/tts/openai-provider.ts`
- [ ] T039 [US2] Export identifier and merge helpers from `src/core/client.ts` and the gateway client from `src/core/index.ts`
- [ ] T040 [US2] Implement `GET /api/tts/catalog` returning merged catalog, rates, and optional `catalogError` in `server/api/tts/catalog.get.ts`
- [ ] T041 [US2] Add `useSpeechCatalog` to load `GET /api/tts/catalog` in `app/composables/useSpeechCatalog.ts`
- [ ] T042 [US2] Bind Voice/Model menus to merged catalog items and append a retained current value in `app/components/generate/GenerationSettingsPanel.vue`
- [ ] T043 [US2] Wire catalog load, `catalogError` status, and retained ids in `app/pages/generate.vue`
- [ ] T044 [US2] Add English/Hungarian catalog-error and retained-value copy in `i18n/locales/en.json` and `i18n/locales/hu.json`
- [ ] T045 [US2] Run the US2-focused tests until green, then refactor without changing the contracts in `tests/unit/identifiers.test.ts`, `tests/unit/catalog-merge.test.ts`, `tests/unit/generate.test.ts`, `tests/unit/batch-yaml.test.ts`, `tests/unit/generation-defaults.test.ts`, `tests/unit/gateway-client.test.ts`, `tests/component/GenerationSettingsPanel.test.ts`, and `tests/component/generate-next.gensettings.test.ts`

**Checkpoint**: Custom ids generate and import; Generate shows builtin ∪ gateway; discovery failure keeps builtin plus an announcement.

---

## Phase 5: User Story 3 — Finish batch runs when the gateway recovers or failsover (Priority: P2)

**Goal**: Batch items dispatch through the resolved gateway. Audio after internal gateway failover is a success. A final gateway error fails that item only and follows existing per-item continuation.

**Independent Test**: Run a multi-item queue against a fake provider that returns audio for a “failover” item and throws for another; the success is in the Library, the failure is isolated, and later items still run.

### Tests for User Story 3 — write and verify red first

- [ ] T046 [P] [US3] Write failing multi-item tests: synthesize returning audio is saved/tagged; a later `ProviderUnavailableError` does not drop prior successes or skip remaining items in `tests/integration/gateway-batch.test.ts`
- [ ] T047 [P] [US3] Extend failing progress-run tests that per-item HTTP errors leave successes in the Library and continue the queue in `tests/integration/generate-next.progress-cancel.test.ts`
- [ ] T048 [US3] Obtain explicit user/reviewer approval for the US3 tests from T046–T047, then run the approved focused tests and record the expected failures in `specs/009-litellm-tts-gateway/quickstart.md`

### Implementation for User Story 3

- [ ] T049 [US3] Keep `generateSpeech` mapping of provider exceptions to `ProviderUnavailableError` with no EchoRecall retry/failover loop in `src/core/tts/generate.ts`
- [ ] T050 [US3] Keep `OpenAiTtsProvider.synthesize` as a single SDK speech call that returns bytes or throws in `src/core/tts/openai-provider.ts`
- [ ] T051 [US3] Confirm each Generate request resolves `getTtsProvider()` (key + base URL) in `server/api/generations.post.ts` and that `app/composables/useGeneration.ts` continues after isolated item failures
- [ ] T052 [US3] Run the US3-focused tests until green in `tests/integration/gateway-batch.test.ts` and `tests/integration/generate-next.progress-cancel.test.ts`

**Checkpoint**: Gateway failover that still returns audio is a normal success; a final error fails one item and does not abort the run.

---

## Phase 6: User Story 4 — Show honest cost using gateway rates when available (Priority: P2)

**Goal**: Built-in OpenAI prices unchanged; other models use gateway character or per-second rates when present; otherwise `'unavailable'` — never `$0.00` for an unknown model. Queue totals sum only estimable items.

**Independent Test**: A custom-model queue row with a gateway rate shows that estimate; without a rate it shows unavailable and still generates; mixed queues note the unavailable count.

### Tests for User Story 4 — write and verify red first

- [ ] T053 [P] [US4] Extend failing `estimateItemCost` tests for built-in table precedence, character/per-second gateway rates, ignored non-finite fields, empty-text rules, and `'unavailable'` (never `$0.00`) in `tests/unit/pricing.test.ts`
- [ ] T054 [P] [US4] Extend failing `queueCost` tests to pass `gatewayRates`, include gateway-priced items in `totalUsd`, and count unpriced custom models as unavailable in `tests/unit/useQueue.cost.test.ts`
- [ ] T055 [P] [US4] Extend failing catalog tests so parsed `rates` appear on `GET /api/tts/catalog` payloads in `tests/unit/gateway-client.test.ts`
- [ ] T056 [US4] Obtain explicit user/reviewer approval for the US4 tests from T053–T055, then run the approved focused tests and record the expected failures in `specs/009-litellm-tts-gateway/quickstart.md`

### Implementation for User Story 4

- [ ] T057 [US4] Add optional `gatewayRates` to `estimateItemCost` with the documented resolution order in `src/core/tts/pricing.ts`
- [ ] T058 [US4] Map `model/info` cost fields into `GatewayRate` in `src/core/tts/gateway-client.ts` and include `rates` from `server/api/tts/catalog.get.ts`
- [ ] T059 [US4] Pass catalog `rates` into `estimateItemCost` from `app/composables/useQueue.ts`
- [ ] T060 [US4] Run the US4-focused tests until green in `tests/unit/pricing.test.ts`, `tests/unit/useQueue.cost.test.ts`, and `tests/unit/gateway-client.test.ts`

**Checkpoint**: Unknown models never look free; gateway-reported rates estimate when present; import/generation are not blocked by missing cost.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Localization, docs, regressions, and quickstart gates.

- [ ] T061 [P] Extend English/Hungarian parity assertions for every new Settings, catalog, and test-code key in `tests/unit/i18n-parity.test.ts` and `tests/unit/i18n.generate-next.test.ts`
- [ ] T062 [P] Document optional `NUXT_OPENAI_BASE_URL` and Settings Base URL in `README.md`
- [ ] T063 Run `pnpm test`, `pnpm test:component`, `pnpm typecheck`, and `pnpm lint`, fixing only Feature 009 regressions under `src/core/`, `server/`, `app/components/settings/`, `app/components/generate/`, `app/composables/`, `app/pages/generate.vue`, `tests/`, and `i18n/locales/`
- [ ] T064 Execute the SC-001 timed Settings→Test Connection→custom-model generate walkthrough (gateway already running) and record elapsed time in `specs/009-litellm-tts-gateway/quickstart.md`
- [ ] T065 Execute remaining automated and optional live scenarios plus the no-live-network checks from `specs/009-litellm-tts-gateway/quickstart.md`, then record outcomes in `specs/009-litellm-tts-gateway/quickstart.md`

**Checkpoint**: Feature is ready for review; default suites still make no live network calls.

---

## Dependencies & Execution Order

### Phase dependencies

```text
Phase 1 Setup
  → Phase 2 Foundational Types
    → Phase 3 US1 Base URL MVP
      → Phase 4 US2 Custom identifiers + catalog
        ├→ Phase 5 US3 Batch failover transparency
        └→ Phase 6 US4 Gateway cost rates
             all completed → Phase 7 Polish
```

- Setup has no dependency.
- Foundational types depend on Setup.
- US1 is the MVP and blocks US2 catalog fetch (needs resolved base URL + key).
- After US2, US3 and US4 can proceed in parallel: US3 extends generation/batch; US4 extends pricing/catalog rates.
- Polish begins after all selected stories are complete.

### User-story dependencies

- **US1 (P1)**: Depends only on Setup and Foundational. Independently demonstrates destination configuration and Test Connection.
- **US2 (P1)**: Depends on US1’s resolved base URL/key for live catalog; merge/identifier unit tests do not need a real gateway.
- **US3 (P2)**: Depends on US1 provider wiring and US2 identifier acceptance for custom-id batches; independently demonstrates per-item success/failure.
- **US4 (P2)**: Depends on US2 catalog `rates` transport; `estimateItemCost` unit tests can start after Foundational types exist, but wiring waits on US2.

### Within each user story

1. Write the story's tests.
2. Obtain explicit user/reviewer approval for the authored tests.
3. Run the approved tests and confirm the expected red state.
4. Implement core behavior before adapters and UI wiring.
5. Run focused suites to green.
6. Refactor only while tests remain green.

---

## Parallel Opportunities

- T001 and T002 touch different files.
- T003 and T004 touch different files.
- US1 test authoring T006–T010 can run in parallel.
- US2 test authoring T023–T030 can run in parallel.
- US3 test authoring T046–T047 can run in parallel.
- US4 test authoring T053–T055 can run in parallel.
- After US2, US3 and US4 implementation can run in parallel if they avoid the same files (`gateway-client.ts` is shared with US4 rates — sequence T037 before T058).
- T061 and T062 can run in parallel.
- Do not parallelize tasks that modify `OpenAiKeySettings.vue`, `useSettings.ts`, `generate.vue`, `useQueue.ts`, shared locale files, or the same existing test file across stories.

---

## Parallel Example: User Story 1

```text
# Launch US1 tests together after T011 approval is the only sequential gate:
Task: "Write failing parse/resolve tests in tests/unit/base-url.test.ts"
Task: "Write failing OpenAiTtsProvider baseURL tests in tests/unit/openai-provider.test.ts"
Task: "Write failing REST tests in tests/integration/settings-base-url.test.ts"
Task: "Extend Test Connection tests in tests/integration/settings-key.test.ts"
Task: "Write failing Settings field tests in tests/component/OpenAiKeySettings.test.ts"
```

## Parallel Example: User Story 2

```text
Task: "Write failing identifier tests in tests/unit/identifiers.test.ts"
Task: "Write failing merge tests in tests/unit/catalog-merge.test.ts"
Task: "Rewrite generateSpeech identifier tests in tests/unit/generate.test.ts"
Task: "Extend batch custom-id tests in tests/unit/batch-yaml.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational types
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Save URL, Test Connection, generate a catalog clip through the gateway, clear URL, confirm default OpenAI
5. Demo if ready

### Incremental Delivery

1. Setup + Foundational → types and env plumbing
2. US1 → destination configuration (MVP)
3. US2 → custom models/voices and catalog union
4. US3 → batch failover transparency
5. US4 → honest cost
6. Polish → i18n, README, full suite, quickstart evidence

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. One developer: US1 (blocks catalog fetch)
3. After US1: one developer US2
4. After US2: US3 and US4 in parallel (watch `gateway-client.ts` and locales)

---

## Notes

- [P] tasks = different files, no dependencies on unfinished work in the same phase
- [Story] label maps the task to US1–US4
- Verify tests fail before implementing
- Commit after each task or logical group via `/speckit-git-commit`
- Stop at any checkpoint to validate the story independently
- Do not add vendor SDKs, a LiteLLM package, or live network calls to the default suite
- Identifier acceptance must not reopen the format catalog
