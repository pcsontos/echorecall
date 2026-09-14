# Feature Specification: LiteLLM Unified Gateway & Multi-Provider TTS

**Feature Branch**: `009-litellm-tts-gateway`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: `specs/specs-plan.md` “Next implementation — Feature 009: LiteLLM Unified Gateway & Multi-Provider TTS” section

## Clarifications

### Session 2026-09-14

- Q: How should Generate Voice and Model controls be populated? → A: Union of the built-in catalog and the configured gateway’s catalog. Built-in choices remain even when no gateway is set or gateway discovery fails. A currently selected or imported identifier is retained even if it is not in either list.
- Q: Does Settings require a Test Connection action? → A: Yes. Settings MUST offer Test Connection that validates the Base URL and API key together. Saving is still allowed if the user skips the test; URL format is still validated on save.
- Q: How should cost be shown for models not in the published OpenAI price table? → A: Use a rate reported by the gateway when one is present; otherwise show cost as unavailable. Never show **$0.00** and never block generation or import because cost is unknown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Point EchoRecall at a custom speech gateway (Priority: P1)

A user who already operates (or can reach) an OpenAI-compatible speech gateway wants EchoRecall to send speech requests to that address instead of the default public OpenAI speech service. In Settings, next to the existing API key, they enter an optional **API Base URL** (for example a local or private LiteLLM deployment). They can also supply the same address through environment configuration. When the address is left empty, EchoRecall continues to use the default OpenAI speech service with no extra setup. A value saved in Settings takes precedence over environment configuration, matching the existing API key rule. Gateway-issued keys — including virtual keys used for budget or character limits — are entered in the existing API key field.

Before generating paid audio, the user can run **Test Connection** to check that the address and key work together. Test Connection is available; it is not a prerequisite for saving. Save still rejects an invalid URL format.

**Why this priority**: Without a configurable destination, EchoRecall cannot use any gateway. This single change unlocks every later journey while preserving the current zero-config OpenAI path.

**Independent Test**: Save a custom base URL in Settings (or set it via environment configuration), run Test Connection successfully, generate one catalog voice/model clip, and confirm the request is sent to that address. Clear the setting and confirm generation uses the default OpenAI speech service again.

**Acceptance Scenarios**:

1. **Given** no in-app base URL and no environment base URL, **When** the user generates speech with a built-in catalog voice and model, **Then** EchoRecall uses the default OpenAI speech service and the clip is saved to the Library as today.
2. **Given** the Settings modal, **When** the user enters a valid absolute HTTP or HTTPS base URL and saves, **Then** the value persists across restarts and subsequent generations use that address together with the resolved API key.
3. **Given** both an environment base URL and a saved in-app base URL, **When** generation runs, **Then** the in-app value is used.
4. **Given** a saved in-app base URL, **When** the user clears the field and saves, **Then** EchoRecall falls back to the environment base URL if one is set, otherwise to the default OpenAI speech service.
5. **Given** a gateway-issued API key (including a virtual key with spend limits), **When** the user stores it in the existing API key field, **Then** EchoRecall uses that key with the configured base URL and does not require a separate vendor credential field.
6. **Given** an invalid base URL (not empty and not an absolute HTTP or HTTPS address), **When** the user attempts to save, **Then** the value is rejected with an actionable message and the previously saved configuration remains unchanged.
7. **Given** values currently shown in Settings, **When** the user activates Test Connection, **Then** EchoRecall checks that address and key together, reports success or an actionable failure, and does not create a Library clip.
8. **Given** a valid URL format, **When** the user saves without running Test Connection, **Then** the configuration is stored and becomes active.

---

### User Story 2 - Generate with third-party models and voices (Priority: P1)

A user generating through the gateway needs to use models and voices that are not in EchoRecall’s built-in OpenAI catalog — for example `elevenlabs/eleven_multilingual_v2`, `azure/en-US-JennyNeural`, or `cartesia/sonic` plus a provider voice id. In the Generate workspace the Voice and Model controls offer the **union of the built-in catalog and the catalog advertised by the configured gateway**. Built-in choices remain when no gateway is configured. Queue editing, validation, and batch import accept identifiers from either catalog, and they also accept a currently selected or imported identifier that is not in either list. Duplicate names that appear in both catalogs are shown once.

**Why this priority**: A custom gateway is only useful if users can name the models and voices it actually serves. This is the first user-visible payoff of Story 1.

**Independent Test**: With a gateway configured, confirm Generate lists both built-in catalog values and at least one gateway-only model, generate a gateway-only model/voice clip, and confirm the Library stores the clip with those identifiers.

**Acceptance Scenarios**:

1. **Given** no custom gateway, **When** the user opens Generate, **Then** Voice and Model offer the built-in catalog and existing catalog generation continues to work unchanged.
2. **Given** a reachable gateway that advertises additional models and/or voices, **When** the user opens Generate, **Then** those gateway entries appear alongside the built-in catalog and can be selected.
3. **Given** a selected gateway-only model and voice, **When** the user generates, **Then** the row is accepted and the Library stores the clip with those identifiers.
4. **Given** a YAML, JSON, or plain-text batch whose items use custom model and/or voice identifiers, **When** the user previews the file, **Then** those identifiers are treated as valid generation settings (subject to emptiness and length rules) even if they are not in the currently loaded catalogs, and valid items remain eligible to append.
5. **Given** a queue row whose model or voice is no longer in either catalog, **When** the user returns to Generate, **Then** the current value remains visible and usable until the user changes it.
6. **Given** a queue row with a custom model, **When** the user also supplies instructions and a supported output format, **Then** EchoRecall still sends the existing speech request fields (text, voice, model, format, speed, instructions) and applies instructions and speed according to the same model-support rules already used for built-in models.
7. **Given** an empty, whitespace-only, or overlong model or voice identifier, **When** the user tries to queue or import it, **Then** that item is rejected with a row-specific or field-level error and sibling valid items remain usable.
8. **Given** a configured gateway whose catalog cannot be loaded, **When** the user opens Generate, **Then** the built-in catalog remains available, the user is told gateway choices could not be loaded, and generation with built-in or already-selected identifiers is not blocked.

---

### User Story 3 - Finish batch runs when the gateway recovers or failsover (Priority: P2)

During a batch run (from the current queue, including rows imported from YAML, JSON, or plain text), requests go through the configured gateway. If that gateway retries or switches providers internally and still returns audio, EchoRecall treats the item as a success: it stamps metadata, writes the clip to the Library, and continues remaining work. The user does not see the whole job abort merely because the gateway recovered on another provider. If the gateway still returns a failure after its own handling, EchoRecall reports that item as failed using the existing per-item generation error behavior and continues or stops according to existing batch rules.

**Why this priority**: Large batches are where rate limits and brief provider outages hurt most. Transparent success-on-audio keeps imported queues productive once the gateway is configured. It depends on Stories 1 and 2 but is independently demonstrable with a gateway that failsover.

**Independent Test**: Run a multi-item queue through a gateway that, for at least one item, internally switches provider and still returns audio; confirm that item is in the Library with tags applied and that later items still run.

**Acceptance Scenarios**:

1. **Given** a configured gateway and a queue of multiple valid items, **When** generation runs, **Then** each item is dispatched through that gateway using the resolved base URL and API key.
2. **Given** a gateway that internally retries or failsover and still returns audio for an item, **When** EchoRecall receives that audio, **Then** the clip is tagged, stored, and listed in the Library as a successful generation and the remaining queue is not aborted because of the internal failover.
3. **Given** a gateway that returns a final error for an item after its own handling, **When** EchoRecall receives that error, **Then** the item is reported as failed with an actionable message, no partial audio is presented as success, and other items follow existing batch continuation rules.
4. **Given** a batch imported from YAML, JSON, or plain text, **When** generation runs against the gateway, **Then** import mechanics (preview, inheritance, confirmation, append) remain unchanged and only the speech destination and allowed identifiers differ.

---

### User Story 4 - Show honest cost using gateway rates when available (Priority: P2)

When a queue row, batch preview, or queue total involves a model, EchoRecall estimates cost from the published OpenAI pricing table when that model is listed there. For any other model it uses a rate reported by the configured gateway when the gateway provides one; otherwise it shows cost as **unavailable**. It must never throw, block generation, or display a misleading **$0.00** for an unknown model. Queue totals still sum only estimable items (published or gateway-reported) and note how many items have unavailable cost.

**Why this priority**: Cost display is already part of Generate. Third-party models would otherwise look free or break the preview. Gateway-reported rates keep estimates useful when the operator’s gateway publishes them.

**Independent Test**: Add a queue row whose model is absent from the published pricing table. When the gateway reports a rate, confirm the row shows that estimate rather than $0.00. When it does not, confirm the row shows unavailable, the queue total notes the unavailable count, and generation remains allowed.

**Acceptance Scenarios**:

1. **Given** a queue row whose model is in the published OpenAI pricing table, **When** cost is shown, **Then** the existing estimate behavior is unchanged.
2. **Given** a model absent from that table and a gateway that reports a rate for it, **When** cost is shown, **Then** the item uses the gateway-reported rate and is included in the queue total.
3. **Given** a model absent from that table with no gateway-reported rate, **When** cost is shown, **Then** that item’s cost is unavailable, not $0.00, and generation or import is not blocked.
4. **Given** a mixed queue with some estimable items and some unavailable-cost items, **When** the queue total is shown, **Then** the total sums only estimable items and includes a count of items whose cost is unavailable.
5. **Given** an unknown-model item in a batch preview, **When** the user reviews the preview, **Then** the preview completes and valid items remain eligible to import.

---

### Edge Cases

- The base URL is empty, contains only whitespace, has a trailing slash, includes a path prefix such as `/v1`, or points at `localhost` or a private-network host.
- The base URL uses a scheme other than HTTP or HTTPS, is a relative path, or is not a valid absolute URL.
- Environment configuration and in-app Settings disagree; the in-app value is missing, explicitly cleared, or stale after a restart.
- Test Connection is run with unsaved form values, with a saved configuration, with an empty URL (default OpenAI), or while the gateway is unreachable, slow, or rejecting the key.
- The configured address is unreachable, times out, returns an authentication error, or returns a non-speech success payload.
- The API key is missing, invalid for the gateway, or is a virtual key that has exhausted its budget or character quota.
- Gateway catalog discovery returns a mix of built-in names and new names, returns voices but not models (or the reverse), returns duplicates of built-in names, or fails entirely.
- A custom model or voice identifier contains a provider prefix, slashes, dots, or hyphens; is extremely long; or differs only by letter case from a catalog value.
- A batch file mixes catalog identifiers and custom identifiers in the same document.
- The gateway internally failsover between providers for some items and fails others in the same run.
- Output format is still one of the existing supported formats (`mp3`, `wav`, `flac`, `opus`, `aac`, `pcm`); an unknown format remains invalid even when the model is custom.
- Instructions are present on a model that ignores them; generation still succeeds if the gateway returns audio.
- Gateway cost rates are present for some models, missing for others, stale after the gateway configuration changes, or unavailable because discovery failed.
- Cost for an unknown model appears in the editor, the queue total, and the batch preview at the same time.
- Default OpenAI generation with only the existing speech API key configuration and no base URL still works after this feature ships.

## Requirements *(mandatory)*

### Functional Requirements

**Gateway destination**

- **FR-001**: Users MUST be able to set an optional speech **API Base URL** in the in-app Settings surface that already holds the API key.
- **FR-002**: Operators MUST be able to supply the same optional base URL through environment configuration of the same class already used for the speech API key.
- **FR-003**: A saved in-app base URL MUST take precedence over environment configuration. A cleared in-app value MUST fall back to environment configuration, then to the default OpenAI speech service.
- **FR-004**: When no base URL is configured, EchoRecall MUST keep sending speech requests to the default OpenAI speech service so existing deployments work with zero configuration changes.
- **FR-005**: A non-empty base URL MUST be an absolute HTTP or HTTPS address. Whitespace-only values MUST be treated as empty. Invalid values MUST be rejected before they become active.
- **FR-006**: The configured base URL MUST persist across application restarts with the rest of app configuration. It is not a second API key: the existing API key field remains the sole credential, including for gateway-issued and virtual keys.
- **FR-007**: The API key MUST remain server-only: it MUST NOT be sent to the client, written to logs, or echoed in error messages. The base URL MAY be shown to the user who configured it.
- **FR-008**: Settings MUST provide a **Test Connection** action that checks the currently shown Base URL and API key together and reports success or an actionable failure without creating a Library clip. Saving MUST remain allowed if the user skips the test. Invalid URL format MUST still be rejected on save.
- **FR-009**: Every EchoRecall surface that already generates speech (web Generate flow and CLI) MUST use the same resolved base URL and API key. This feature MUST NOT add a second, surface-specific speech destination.

**Models, voices, and request shape**

- **FR-010**: Built-in catalog voices and models MUST remain valid and selectable, including when no gateway is configured and when gateway catalog discovery fails.
- **FR-011**: EchoRecall MUST accept additional non-empty model and voice identifiers that are absent from the built-in catalog, including prefixed third-party identifiers, so they can be queued, imported, and generated.
- **FR-012**: Model and voice identifiers MUST be trimmed. Empty or whitespace-only values MUST be rejected. Identifiers longer than 128 characters MUST be rejected. Output format MUST still be one of the existing supported formats.
- **FR-013**: Generate, queue edit, and batch import MUST share the same identifier rules so a value accepted in one place is accepted in the others.
- **FR-014**: Speech requests MUST continue to use the existing request fields only: input text, voice, model, output format, speed, and instructions. EchoRecall MUST NOT add vendor-specific request fields or separate vendor speech integrations.
- **FR-015**: Instructions and speed MUST continue to follow the existing model-support rules (instructions apply to `gpt-4o-mini-tts`; speed maps according to current model support). Custom models that ignore unsupported fields MUST still be completable when the gateway returns audio.
- **FR-016**: When a gateway is configured, Generate Voice and Model controls MUST offer the union of the built-in catalog and the catalog advertised by that gateway. Names present in both lists MUST appear once. A currently selected or imported identifier MUST remain visible and usable even if it is not in either catalog. If gateway catalog discovery fails, EchoRecall MUST keep the built-in catalog, MUST tell the user that gateway choices could not be loaded, and MUST NOT block generation with built-in or already-selected identifiers.

**Generation outcomes**

- **FR-017**: Successful audio returned by the configured gateway MUST be tagged with the existing metadata pipeline, stored in the existing library locations, and listed in the Library with the requested model and voice identifiers.
- **FR-018**: When the gateway internally retries or failsover and still returns audio, EchoRecall MUST record a successful generation and MUST NOT abort the remaining batch solely because a failover occurred.
- **FR-019**: When the gateway returns a final error, EchoRecall MUST mark that item failed, MUST NOT present missing or invalid audio as success, and MUST keep using existing per-item error reporting.
- **FR-020**: Batch import (YAML, JSON, and plain text), queue append, Save queue / Load queue, audio playback, and library persistence MUST keep their current behavior except for the identifier and destination rules in this spec.
- **FR-021**: EchoRecall MUST NOT host, orchestrate, or embed the speech gateway. The gateway is an independent service the operator provides.

**Cost display**

- **FR-022**: Models in the published OpenAI pricing table MUST keep their current cost estimates.
- **FR-023**: For a model absent from that table, EchoRecall MUST use a gateway-reported rate when the configured gateway provides one. When no such rate is available, cost MUST be shown as unavailable. EchoRecall MUST NOT show **$0.00** for that item and MUST NOT fail validation or generation because cost is unknown.
- **FR-024**: Queue totals MUST sum only estimable items (published-table or gateway-reported rates) and, when any item’s cost is unknown, MUST show how many items are unavailable so the total cannot be mistaken for a complete amount.

**Localization and access**

- **FR-025**: All new user-visible copy introduced by this feature MUST be available in both supported languages (English and Hungarian, Hungarian default).
- **FR-026**: New Settings and Generate controls MUST be operable by keyboard and exposed to assistive technologies.

### Key Entities

- **Speech Gateway Configuration**: The optional base URL plus the existing API key used together as the speech destination. Empty URL means the default OpenAI speech service. In-app value overrides environment configuration.
- **Built-in Catalog**: EchoRecall’s existing selectable voices and models, always available in Generate.
- **Gateway Catalog**: The models and voices advertised by the configured gateway, merged with the built-in catalog when discovery succeeds.
- **Model Identifier**: The speech model name sent with a generation. A built-in catalog value, a gateway-catalog value, or a retained selected/imported identifier.
- **Voice Identifier**: The voice name or id sent with a generation, following the same sources as Model Identifier.
- **Cost Estimate**: A known amount from the published OpenAI table or from a gateway-reported rate, or an unavailable state when neither source has a rate.
- **Connection Test Result**: The outcome of Test Connection: success or an actionable failure, with no Library clip created.
- **Generation Result**: Audio bytes plus metadata written to the Library on success, or a per-item failure when the gateway returns a final error.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a timed acceptance walkthrough with a reachable gateway already running, a user can open Settings, save a valid base URL, run Test Connection successfully, select a gateway-advertised model and voice on Generate, produce one clip, and see it in the Library in under 3 minutes. Timing starts when Settings opens and ends when the Library shows the new clip.
- **SC-002**: With no base URL configured, 100% of existing built-in catalog generation acceptance scenarios keep their prior expected outcomes (same voices, models, formats, instructions, speed mapping, storage, and playback).
- **SC-003**: 100% of valid custom model and voice identifiers that meet FR-012 are accepted by Generate queue editing and by YAML/JSON/plain-text batch preview; 100% of empty, whitespace-only, or overlong identifiers are rejected without blocking sibling valid items.
- **SC-004**: In a 10-item batch where the gateway internally failsover on 2 items and still returns audio for all 10, 10 clips appear in the Library and the run is not aborted because of those failovers.
- **SC-005**: In 100% of models with neither a published OpenAI rate nor a gateway-reported rate, the UI never displays **$0.00** for that item and never blocks generation or import because cost is unknown. In 100% of models with a gateway-reported rate and no published OpenAI rate, the displayed estimate uses that gateway rate rather than unavailable or $0.00.
- **SC-006**: At least 90% of representative operators can point EchoRecall at a running gateway and complete one custom-model generation using only Settings and product documentation, without editing application source.
- **SC-007**: 100% of new user-visible strings are available in both supported languages, and every new interactive control is operable by keyboard and exposed to assistive technologies.
- **SC-008**: Unreachable gateway, invalid key, exhausted virtual-key budget, and failed Test Connection each produce an actionable error in under 15 seconds of the failed attempt, without crashing the app or leaving a false-success Library entry.
- **SC-009**: On the reference desktop profile, switching the base URL in Settings and seeing the saved confirmation takes no more than 2 seconds in each of five consecutive runs after the save action is confirmed.
- **SC-010**: When a gateway advertises at least one model or voice that is not in the built-in catalog, 100% of those advertised identifiers appear in the corresponding Generate control together with 100% of the built-in catalog entries.

## Assumptions

- The operator provides and runs any OpenAI-compatible speech gateway (LiteLLM or equivalent) outside EchoRecall. This feature only consumes that service.
- Caching, provider failover, retry, virtual keys, and spend limits are gateway responsibilities. EchoRecall records success when it receives audio and failure when it receives a final error.
- The existing API key precedence rule (in-app overrides environment, environment remains fallback) is reused for the base URL.
- The default OpenAI speech service address is used only when both in-app and environment base URLs are empty; users do not have to type the public OpenAI URL to keep current behavior.
- Private-network and localhost gateway addresses are allowed because EchoRecall is typically operator-secured on a trusted network.
- Test Connection uses the values currently shown in Settings, including unsaved edits; a blank field falls back to the already-resolved configuration for that field.
- Test Connection verifies that the destination accepts the key; it does not have to synthesize speech or write audio.
- If the gateway advertises models but not voices (or the reverse), Generate still shows the built-in catalog for the missing side and any advertised entries for the side that is present.
- Generate does not add a separate freeform write-in control. Identifiers that are not in either catalog reach the queue through batch import, last-selected retention, or an already-selected value.
- Gateway-reported rates apply only while a gateway is configured and a rate is actually provided for that model. EchoRecall does not add a Settings field for manual third-party prices.
- Output formats, metadata tagging, library storage layout, waveform playback, text length limits, and batch-import contracts stay as specified in prior features.
- No embedded vendor speech integrations, realtime duplex sessions, speech-to-text, or audio-file import are in scope.
- Exact environment variable names, persistence mechanism, catalog-query transport, and rate-query transport are planning concerns; this spec defines the observable configuration and generation behavior.
- The SC-001 timed walkthrough excludes time spent starting the external gateway. The SC-009 reference desktop profile matches Feature 008: at least four logical processor cores, 8 GiB of memory, a current supported browser, and no concurrent processor-intensive workload.
