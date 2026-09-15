# Specification Plan

> **How to use this file.** The **"Next implementation"** section is a self-contained
> feature brief written to be fed directly to `/speckit-specify` (paste it as the feature
> description, or point the skill at this section). It is intentionally phrased as *intent +
> prioritized user journeys + scope boundaries* so the generated `spec.md` maps cleanly onto
> the template (user stories → P1/P2/P3, functional requirements, key entities, success
> criteria). The **"Later / backlog"** section is a holding area for ideas that are
> deliberately **out of scope for the next feature** and are recorded only so they aren't
> forgotten when their own spec is written later.
>
> Open questions are marked **[NEEDS CLARIFICATION]** so `/speckit-specify` surfaces them
> instead of inventing answers.

---

## Next implementation — Feature 009: LiteLLM Unified Gateway & Multi-Provider TTS

> Self-contained brief for `/speckit-specify`. Connects EchoRecall's existing TTS generation
> pipeline to a LiteLLM proxy (or any OpenAI-compatible audio gateway) to unlock multi-provider
> speech generation (ElevenLabs, Azure Speech, Cartesia, Deepgram Aura), resilient batch failovers,
> audio caching, and centralized spend governance without adding custom vendor SDKs. Full-duplex
> realtime WebSockets and non-TTS audio intelligence (STT/transcription) remain out of scope.

### Intent

EchoRecall currently couples directly to OpenAI's public TTS API, with static voice and model catalogs
(`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`) and hardcoded OpenAI pricing tables. Because EchoRecall's core
TTS adapter (`OpenAiTtsProvider`) already uses the official `openai` SDK (`openai/resources/audio/speech`),
it can communicate seamlessly with an external or self-hosted **LiteLLM proxy** simply by accepting an
optional API Base URL (`baseURL`) alongside the API key.

LiteLLM exposes a unified OpenAI-compliant `/v1/audio/speech` endpoint while routing requests to 100+
downstream backends. Integrating LiteLLM as an optional gateway enables:
1. **Multi-provider TTS without vendor SDK bloat**: Generate speech using ElevenLabs, Azure Speech,
   Google Cloud TTS, or Cartesia through the existing OpenAI request schema.
2. **Resilience for batch generation**: Automatic retries and provider failover (e.g., ElevenLabs →
   Azure Speech or OpenAI) when hitting rate limits (429) or transient provider outages during large batch runs.
3. **Audio caching (deduplication)**: LiteLLM's proxy-level caching (e.g., Redis) returns cached audio bytes
   for identical text/voice requests across batches, preventing duplicate upstream API costs.
4. **Spend governance**: Support for LiteLLM virtual keys with centralized budget limits, character quotas,
   and unified spend auditing.

### User journeys (priority hints for `/speckit-specify`)

**P1 — Configure custom OpenAI / LiteLLM Base URL.**
The user can specify an API Base URL (e.g., `http://localhost:4000/v1` or a private LiteLLM deployment)
via environment variable (`NUXT_OPENAI_BASE_URL`) or directly in the in-app **Settings** modal alongside
the existing in-app API key. When left empty, EchoRecall continues pointing to `https://api.openai.com/v1`.

**P1 — Use external provider models and voices in the Generate workspace.**
Users can enter or select third-party TTS models (e.g., `elevenlabs/eleven_multilingual_v2`,
`azure/en-US-JennyNeural`, `cartesia/sonic`) and custom voice IDs. The core validation and queue editor
accept valid provider model/voice identifiers rather than rejecting non-OpenAI catalog names.

**P2 — Resilient batch generation through the gateway.**
During batch generation (from YAML, JSON, or plain text import), requests dispatch through the configured
gateway. When LiteLLM executes failover between providers, EchoRecall receives the audio bytes transparently,
stamps metadata/tags, and writes the clip to the Library without job aborts.

**P2 — Graceful cost estimation for third-party models.**
When an imported batch or queue row uses a model not present in the static OpenAI pricing table
(`MODEL_PRICING`), the UI and batch preview gracefully indicate cost as `'unavailable'` (or display
gateway-reported rates) instead of throwing an error or displaying a misleading "$0.00".

### Technical & Architecture boundaries

- **Core TTS Port & Adapter (`src/core/tts/`)**:
  - Update `OpenAiTtsConfig` to accept an optional `baseURL?: string`.
  - Pass `baseURL` to the `new OpenAI({ apiKey, baseURL })` constructor in `OpenAiTtsProvider`.
  - Loosen or extend voice/model catalog checks in `src/core/tts/provider.ts` to allow custom/prefixed
    provider identifiers while preserving validation safety.
  - Update `src/core/tts/pricing.ts` to safely handle non-OpenAI models (`CostEstimate = 'unavailable'`).
- **Server DI Container & Configuration (`server/utils/container.ts`)**:
  - Read `openaiBaseUrl` from runtime config (`NUXT_OPENAI_BASE_URL`) or decrypted from `SqliteAppConfigRepository`.
  - Inject `baseURL` into `OpenAiTtsProvider` within `getTtsProvider()`.
- **In-App Settings (`app/components/settings/`, `server/api/settings/`)**:
  - Add an optional "API Base URL / LiteLLM Proxy URL" input field to the Settings modal.
  - Persist the setting securely in the app configuration store alongside the API key.
  - Provide an optional "Test Connection" button to verify reachability.

### Functional boundaries

- Standardize strictly on the OpenAI-compatible `/v1/audio/speech` HTTP REST contract (`input`, `voice`,
  `model`, `response_format`, `speed`, `instructions`).
- Audio formats (`mp3`, `wav`, `flac`, `opus`, `aac`, `pcm`) pass through to the provider and continue
  into the existing `taglib-wasm` ID3/Vorbis metadata tagging pipeline.
- All batch import mechanics (YAML/JSON schema, defaults inheritance, preview, queue append) remain
  intact and work seamlessly with the new gateway.

### Out of scope (do **not** spec here)

- Embedded vendor SDKs (no direct `@elevenlabs/client`, Azure Speech SDK, etc. — all third-party TTS
  must be routed via the OpenAI-compatible LiteLLM gateway).
- Full-duplex real-time WebSockets, WebRTC, barge-in/interruption, or Voice Activity Detection (VAD).
- Speech-to-Text (STT / transcription), audio intelligence, or audio-file imports.
- Orchestrating or hosting the LiteLLM proxy instance itself inside EchoRecall (LiteLLM runs as an
  independent external service or container).

### Existing behavior to preserve

- Default out-of-the-box experience with a standard `NUXT_OPENAI_API_KEY` hitting OpenAI directly must
  continue to work with zero configuration changes.
- Existing tests with mocked `TtsProvider` must continue passing without network access.
- `gpt-4o-mini-tts` instructions (FR-013) and `speed` controls continue to map according to model support.
- Generated audio storage (`data/audio/YYYY/MM/DD/`), SQLite persistence, and waveform player remain unchanged.

### Open questions

- **[NEEDS CLARIFICATION]** Should the Voice and Model selectors in the Generate workspace support dynamic
  discovery (querying LiteLLM's `/v1/models` endpoint), or use a curated list with a freeform text write-in option?
- **[NEEDS CLARIFICATION]** Does Settings require a "Test Connection" button to validate the Base URL and
  API key before saving?
- **[NEEDS CLARIFICATION]** Should users be able to configure a custom character/token price rate in Settings
  for third-party models to enable cost estimation, or is displaying `'unavailable'` sufficient?

---

## Shipped — Feature 008: Structured Generate batch import

*(branch `008-batch-import`; merged to `master` via **PR #99** on 2026-09-14; merge commit `535a6a3`; kept below as the historical planning brief)*

> Self-contained brief for `/speckit-specify`. Replaces the current `.txt`-only upload with a
> previewed import workflow for text and canonical YAML/JSON batch documents. Library file
> management, XML, CLI, and Auth remain deferred.

### Intent

Let users prepare generation queues in human-readable files without manually adding each row.
Replace **Upload .txt** with a unified **Import batch** workflow that accepts `.txt`, `.yaml`,
`.yml`, and `.json`, parses files locally, previews valid rows and row-specific errors, and appends
confirmed valid rows to the current queue.

YAML is the documented, downloadable template for human authors. JSON supports scripts and
external integrations. Both structured formats are alternate serializations of one canonical
contract and receive identical validation after deserialization. **Save queue / Load queue**
remains a separate queue-replacement workflow.

### User journeys (priority hints for `/speckit-specify`)

**P1 — Import a documented YAML batch.**
The user downloads or writes an EchoRecall YAML template containing optional file defaults and one
or more queue items. EchoRecall resolves current Generate values, file defaults, and per-item
overrides, then previews the resulting queue rows before appending them.

**P1 — Review valid rows and errors before import.**
The preview identifies each candidate by item index or `.txt` line number, shows its resolved
voice/model/format and text excerpt, and reports row-specific validation errors. One invalid item
does not prevent the user from importing the valid items in the same file.

**P2 — Import the same contract from JSON or plain text.**
Scripts may emit the JSON equivalent of the documented YAML contract. Existing `.txt` files remain
supported as one nonblank line per queue item and use the same preview-and-confirm workflow.

**P2 — Discover and reuse the format.**
The import UI offers a downloadable YAML example. Human-readable documentation explains every
field, inheritance, clearing behavior, validation rule, and the equivalent JSON representation.

### Canonical batch contract

Primary example, `echorecall-batch-v1.yaml`:

```yaml
schema: echorecall.batch
version: 1

defaults:
  voiceId: nova
  model: gpt-4o-mini-tts
  format: mp3
  instructions: Speak clearly
  metadata:
    artist: EchoRecall
    album: Example batch
    languages:
      - eng

items:
  - text: |-
      The first queue item can contain
      multiple lines of text.

  - text: The second queue item.
    voiceId: alloy
    instructions: null
    metadata:
      title: Custom title
      track: "2"
      artist: null
```

The equivalent JSON document uses the same `schema`, `version`, `defaults`, `items`, and item
fields. Values resolve in this order: current Generate form values, optional file-level defaults,
then optional per-item overrides.

### Functional boundaries

- `text` is required, trimmed, nonblank, and limited to 4,096 characters.
- Missing properties inherit. Explicit `null` clears optional instructions or individual metadata
  fields. Arrays replace inherited arrays rather than concatenate.
- Voice, model, format, instructions, and metadata use the existing domain types and validation.
- Unknown schema versions, malformed documents, and invalid file defaults block the import.
- Invalid individual items remain visible in preview but do not block valid items. Unknown
  canonical fields are errors so template typos are not silently ignored.
- Preserve document order. Imported rows receive `source: 'upload'`, the original filename, fresh
  client IDs, and queued status. Imports append without modifying existing rows.
- Keep the existing 5 MiB limit. Preview rows are inspectable but not editable. Duplicate text is
  allowed.
- Parse YAML with YAML 1.2 semantics using a direct dependency; reject duplicate keys and custom
  tags, and disable or tightly limit aliases.
- Keep parsing and normalization framework-independent under `src/core/batch/`. Text, YAML, and
  JSON adapters must feed one shared validator and normalized queue-input model.
- Add English and Hungarian UI copy, accessible status announcements, the downloadable YAML
  example, contract documentation, and an equivalent JSON example.

### Out of scope (do **not** spec here)

- XML import. A future XML adapter may target the same normalized batch contract.
- Arbitrary user-defined mappings from external JSON/YAML shapes.
- Editing candidate rows inside the preview.
- Replacing the current queue through batch import; **Load queue** retains that responsibility.
- Library audio-file Copy, Move, and Import; CLI; and Auth.

### Existing behavior to preserve

- The saved-queue JSON contract and **Load queue** continue to replace the queue unchanged.
- `.txt` keeps one trimmed nonblank line per candidate, including blank and oversized-line counts.
- Current Generate defaults, pending-row behavior, generation flow, and source filename display
  continue to behave as shipped in Feature 007.
- Default tests make no live network calls and continue to enforce English/Hungarian parity.

### Verification

- Unit-test equivalent YAML and JSON producing identical normalized items, plus multiline YAML,
  comments, scalar handling, duplicate keys, aliases, custom tags, malformed input, schema
  versions, precedence, overrides, null clearing, array replacement, ordering, and validation.
- Preserve `.txt` coverage for blank lines, oversized lines, ordering, and preview results.
- Test append behavior, source filenames, fresh transient state, and preservation of existing rows.
- Component-test every accepted extension, the size limit, preview and cancellation, valid-only
  import, localization, and the YAML example download.
- Verify saved-queue loading remains separate and continues to replace the queue. Run `pnpm test`,
  `pnpm test:component`, `pnpm typecheck`, and `pnpm lint`.

---

## Shipped — Feature 007: Generate-tab redesign + generation-flow enhancements

*(branch `007-generate-redesign`; merged to `master` via **PR #89** on 2026-07-19; merge commit
`38e49cc`; kept below as the historical planning brief)*

### Shipped outcome

- `/generate` is the canonical focused queue builder; `/` redirects to it and Library remains a
  separate `/library` surface.
- The editor uses Script and Generation settings columns plus a full-width configurable Metadata
  row. Voice/Model/Format changes propagate to pending rows; synthesis stays fixed at 1×.
- Queue selection, bulk delete/clear, drag reorder, first-track configuration, derived Title/Track,
  save/load, `.txt` upload, and selected-or-all generation are implemented.
- Generation shows per-item cost estimates, progress, labelled failures, graceful cancellation,
  and success-only recording-date stamping that remains accurate across retries.
- Configured generation defaults and catalog-valid last-selected preferences persist across
  sessions.
- The authoritative implemented scope and verification record live in
  [`specs/007-generate-redesign/`](./007-generate-redesign/).

### Historical planning brief

> Self-contained brief for `/speckit-specify`. Mirrors how 006 rebuilt the Library tab from
> Figma. Consumes the backlog's "Generate tab redesign" item plus four Generate-tab
> enhancements (Voice/Format/Model/Speed defaults, Date-to-now, per-item cost estimate,
> progress-modal + cancel). Embed-source-text stays in backlog with Library **Import**; CLI
> adapter and Auth remain deferred.

### Intent

Rebuild the **Generate** tab to match its Figma **"Generate Tab — Nuxt UI"** design exactly, the
same way 006 rebuilt Library — a **single scrolling page** (page intro → three-column generation
editor → generation action bar → Library-style file table + Tag Editor inspector → status bar),
replacing the 005 two-pane QueueList + metadata editor. Primarily a **UX/interaction redesign over
existing generation capabilities**, layered with four **generation-flow enhancements** the
design's own controls invite. Build at a **parallel route** (e.g. `/generate-next`); cut over and
delete the old page once proven (mirrors 006). Accent = existing **indigo** primary, not the Figma
kit's green (006 FR-024 precedent).

### User journeys (priority hints for `/speckit-specify`)

**P1 — Three-column generation editor rebuilt to Figma.**
Single scrolling page. **Script entry** (title + badge, textarea, Clear, character hint, "Add to
queue"), **Generation settings** (Voice / Model / Format / Speed selects), **Metadata** (Title /
Artist / Album / Genre / Language / Recording date), then a **Generation action bar** (queue
summary + count badge + Save queue / Load queue / [neutral action] / Generate). No resizable split
for the editor.

**P1 — Library-style workspace on the same page (reuse 006 components).**
Below the editor the design embeds a filter bar + file-table + Tag Editor (ID3v2.4) inspector
two-pane (show/hide toggle, sortable columns, per-row checkboxes) + status bar — visually
identical to 006. Reuse the 006 components rather than rebuild.

**P2 — Persisted Generation settings.**
Voice / Model / Format / Speed each get a configurable **Settings default** (alongside Default
Tags) and a **last-selected** value persisted in `localStorage` (`echorecall:viewprefs:*`). Today
`useQueue.ts` hardcodes `voiceId=''`/`model='gpt-4o-mini-tts'`/`format='mp3'`/`speed=1` with no
persistence.

**P2 — Generation progress modal with cancel.**
On Generate: current file, per-file succeeded/failed, failures skipped (loop continues), other UI
disabled while open, **closing the modal cancels the run**, completion/cancellation summary.
`generateAll()` already does sequential + isolated failures; new = the modal UI + a cancellation
mechanism (no `AbortController` anywhere today).

**P3 — Per-item cost estimate + queue total.**
Per-item price from model + text size, plus a queue total, shown before Generate (builds on the
character hint). `tts-1` ≈ $15/1M chars, `tts-1-hd` ≈ $30/1M chars; **`gpt-4o-mini-tts` is
token-priced and unknowable before generation** — approximate or show "unavailable." New
hand-maintained client pricing constant.

**P3 — Recording date defaults to today (not tomorrow).**
`recordedAt` defaults to **today** (date-only `YYYY-MM-DD`), snapshotted at **generation time**,
**only when still empty** — never overwriting a user-set value. Replaces `useQueue.ts`'s
`tomorrowIso()` add-time default.

### In scope

- Parallel `/generate-next` route; three-column editor + action bar + lower Library-style
  workspace + status bar rebuilt to Figma; swap the Generate nav target and delete the old
  page/components once proven.
- Reuse 006 Library components (filter bar, file table + Configure Columns, Tag Editor inspector +
  Configure Visible Fields + show/hide, status bar).
- Voice/Model/Format/Speed Settings defaults + remembered last-selected.
- Generation progress modal + cancel (new cancellation mechanism).
- Per-item cost estimate + queue total (new client pricing constant).
- Recording-date-to-today default.
- New strings localized **en/hu** (Hungarian default); controls keyboard/AT-accessible;
  test-gated **red-first**; `wavesurfer.js` **mocked**.
- Accent = **indigo** primary (not Figma green).

### Out of scope (do **not** spec here)

- The App-header **Account area** (Plan / Credits / avatar) in the Figma — **design chrome,
  omitted**: it implies account/credit tracking that doesn't exist and **Auth is deferred**.
- **Embed source text into audio tags** — stays in backlog with Library **Import**.
- **CLI adapter** and **Auth** — remain in Later / backlog.
- TTS-engine / storage-layout / audio-tag-schema changes beyond the minimum these enhancements
  require — reuse existing core/server + composables (justify any core/server touch explicitly, as
  006's R-FILTER did).

### References (visual — 005/006 specs remain source of truth for reused pieces)

Figma file `LSx4m0qJpJRqvp8wCCHKTl`: entry `0-1`; screen **`112-3273`** "Generate Tab — Nuxt UI"
(1440×1688). Sub-nodes: app header `112:3274`, page intro `112:3302`, editor columns `120:223`
(Script `113:1191`, Generation settings `112:3305`, Metadata `115:39`), action bar `116:57`
(neutral button `113:1206`), filter bar `119:66`, file-list + inspector `119:73`, status bar
`119:251`. Re-extract with Figma MCP `get_design_context` at implementation time.

### Open questions

- **[NEEDS CLARIFICATION]** Rollout — parallel `/generate-next` + cutover (006 precedent, assumed)
  or in-place rebuild?
- **[NEEDS CLARIFICATION]** Lower-half scope — is the embedded Library-style workspace truly part
  of Generate (reuse 006 components), or shown only for context, making scope the upper generation
  area only?
- **[NEEDS CLARIFICATION]** Metadata column — collapsible ("Metadata accordion content") or always
  visible?
- **[NEEDS CLARIFICATION]** Action-bar neutral button (`113:1206`) — what action? (extract at spec
  time.)
- **[NEEDS CLARIFICATION]** Settings-defaults home — fifth field group alongside
  `DefaultTagsSettings`/`useDefaultTags` (server-persisted) or a client-only Settings section?
  Precedence when a Settings default *and* a remembered last-selected both exist? Per-field reset?
- **[NEEDS CLARIFICATION]** Cost estimate — pricing source of truth (hardcoded / Settings-editable
  / runtime) + staleness; `gpt-4o-mini-tts` handling (per-char approx / min–max / "unavailable");
  character basis; currency + sub-cent precision; display-only or ever **block** Generate over
  budget?
- **[NEEDS CLARIFICATION]** Cancel semantics — finish in-flight file then stop (flag between
  iterations) or abort via `AbortController`? Does closing (X/Esc/backdrop) cancel immediately or
  need a confirm first (paid calls)? Modal + inline per-row status coexist or modal replaces it?
  How are cancelled/not-started items reported in the summary?
- **[NEEDS CLARIFICATION]** Date default — replace `tomorrowIso()` outright, or make the offset a
  configurable Settings default-tag value (0 vs. +1 day)?

---

## Later / backlog — deferred for a future spec

> Recorded so they aren't lost. **Not part of the active Feature 008 above**; each gets its own
> spec when picked up.

### Feature 009 candidate — Library file management (Copy, Move, Import)

Let users move recordings into and out of EchoRecall without manually manipulating the managed
`data/` directory. Add **Copy**, **Move**, and **Import** workflows to the existing Library surface,
while preserving the current separation between framework-agnostic domain behavior, Nitro
adapters, and Vue UI.

Copy exports selected recordings without changing the Library. Move exports them and removes the
managed copies only after export succeeds. Import brings existing audio files into managed storage,
reads their embedded tags, and creates Library records that behave like generated recordings.

#### User journeys

**P1 — Import existing recordings into the Library.**
From the Library toolbar, the user selects one or more supported audio files. EchoRecall validates
each file, copies it into managed storage, reads supported ID3/Vorbis metadata through the existing
tagging adapter, creates the corresponding Library record, and refreshes the table. One invalid
file must not prevent valid files in the same batch from importing.

**P1 — Copy selected recordings out of EchoRecall.**
The user selects Library rows, chooses **Copy**, specifies an export destination, and sees per-file
progress and results. The Library rows and managed source files remain unchanged. Copy must never
silently overwrite an existing destination file.

**P2 — Move selected recordings out of EchoRecall.**
The user selects rows and chooses **Move**. A confirmation explains that successful moves remove
the Library record and managed source file. Each item follows copy-then-delete semantics: deletion
may begin only after that item's destination copy is confirmed successful. A failed item remains
intact and retryable in EchoRecall.

**P2 — Understand batch progress and partial failure.**
Copy, Move, and Import expose the current file, succeeded/failed counts, labelled per-file errors,
and a completion summary. A partial failure must leave every unaffected recording in a consistent,
explainable state.

#### In scope

- Library toolbar actions and selection-aware enablement for Copy, Move, and Import.
- Destination/import selection UX appropriate to the deployed server/browser boundary, resolved
  during clarification rather than assumed here.
- Framework-agnostic core operations and ports for file transfer/import behavior; Nitro routes and
  dependency wiring as adapters.
- Safe collision handling, path validation, copy-then-delete ordering, and per-item failure
  isolation.
- Import-time tag reading through the existing `taglib-wasm` adapter and creation of normal
  Library records in the existing storage model.
- Per-file progress and completion summaries for multi-file operations.
- Library refresh and selection cleanup after successful import or move operations.
- New strings localized in **en/hu**; keyboard/assistive-technology support; observable-behavior
  tests at core, server-integration, and component boundaries.

#### Out of scope

- CLI adapter and Auth.
- Automatic source-text embedding for new generations or retroactive source-text backfill.
- DB/file tag-drift detection and synchronization; imported tags should initialize the DB record,
  but ongoing drift management remains a separate feature.
- Arbitrary file editing outside the explicit Copy, Move, and Import workflows.
- Redesigning the Library layout, waveform player, tag editor, or generation workflow.
- New audio transcoding or format conversion.

#### Existing behavior to preserve

- Library playback, filtering, sorting, selection, tag editing, download, and deletion continue to
  behave as shipped in Features 005–007.
- Default tests use mocked filesystem/tagging ports and make no live network calls. Real WASM
  coverage remains in `pnpm test:adapters`.
- Runtime database and audio files remain under ignored `data/`; tests must use isolated temporary
  storage and must not mutate a developer's real library.
- A file operation must not leave a database row pointing at a missing managed file.

#### Open questions

- **[NEEDS CLARIFICATION]** Destination selection — typed server path, administrator-configured
  export locations, browser download, or a combination? What restrictions prevent exporting
  outside allowed roots?
- **[NEEDS CLARIFICATION]** Import source — browser multi-file upload, server-side source path, or
  both? Which audio formats are accepted initially?
- **[NEEDS CLARIFICATION]** Directory structure — preserve EchoRecall's relative folders, flatten
  the selection, or let the user choose?
- **[NEEDS CLARIFICATION]** Collision policy — rename, skip, replace with confirmation, or a
  user-selected policy for the batch?
- **[NEEDS CLARIFICATION]** Move recovery — what happens when copying succeeds but database/file
  deletion fails? Is a compensating destination delete allowed?
- **[NEEDS CLARIFICATION]** Import duplicates — detect by path, content hash, metadata, or allow
  duplicates?
- **[NEEDS CLARIFICATION]** Tag mapping — how should unsupported, malformed, or repeatable imported
  tags map into `Metadata`, `tags_extra`, and `skippedTags`?
- **[NEEDS CLARIFICATION]** Progress cancellation — graceful stop between files, no cancellation,
  or request-level abort where supported?

### CLI adapter

- A CLI adapter — the plan deliberately put OpenAI-key resolution in `src/core` "so a future CLI
  honors the same precedence." A CLI over the framework-agnostic core is the most natural next
  adapter.
- Verify `gpt-4o-mini-tts` honors `speed` — flagged here as an unverified implementation note.
- Wire the optional live-OpenAI adapter test — `vitest.adapters.config.ts` mentions it as a
  "later" addition.

### Auth

- The README explicitly notes there's no built-in authentication; only relevant if this ever
  goes multi-user.

### Embed source text into the audio file's tags at generation time

Idea: when a recording is generated, automatically save `GenerationInput.text` (the
source text sent to TTS) into the audio file's own tags as a **Custom text** entry
(`metadata.customText`, `{ description: 'Audio text', value: <text> }`) — the same
mechanism already used for entries like the existing "chapter" custom text. Today the
source text lives only in the `Generation.text` DB column (surfaced read-only in the
006 inspector's new Source-text field, FR-018a); it is **not** embedded in the file's
own ID3/Vorbis tags, so it's lost if the file is copied/exported outside the app or
re-imported elsewhere (see the Feature 009 candidate above — likely related).

- [NEEDS CLARIFICATION] Automatic for every generation, or an opt-in Settings toggle?
- [NEEDS CLARIFICATION] Exact custom-text `description` label ("Audio text" as named,
  or something else to avoid colliding with other customText entries like "chapter")?
- [NEEDS CLARIFICATION] Retroactive backfill for existing recordings, or new
  generations only?
- [NEEDS CLARIFICATION] Overlap with the Import feature above — should imported files'
  existing "Audio text" custom-text entry (if present) populate `Generation.text`, or
  are the two kept independent?

### Detect + resolve DB/file tag drift ("sync" check)

Idea: detect when a recording's audio-tag values on disk (the file's actual ID3/Vorbis
tags) disagree with the `Metadata` stored in the SQLite row, and let the user resolve
it in either direction.

- **Detection**: an out-of-sync recording shows an **error icon** next to its filename
  in the file table's Filename column; in the Tag Editor, each individual field that
  disagrees renders **in red**.
- **Per-item fix**: a **Synchronize** button in the Tag Editor for the active recording.
- **Bulk fix**: a bulk-sync button next to the existing bulk-delete button
  (`data-test="bulk-delete"` in `LibraryFileTable.vue`) — acts on the current selection.
- **Both** open a confirm modal asking the sync **direction**: DB → file (overwrite the
  file's tags with the DB row) or File → DB (overwrite the DB row with the file's tags).

Today the app's own edit path (`PATCH /api/generations/:id` → `LibraryService.update`)
already retags the file and updates the DB row **atomically in one request**, so drift
shouldn't occur from normal in-app edits — it would come from the file being edited
directly on disk outside the app, or (see the Feature 009 candidate above) an imported
file whose tags don't match what gets written to the DB row at import time. Likely
related/sequenced with that Import feature.

- [NEEDS CLARIFICATION] When is the check run — on every Library load/page (a taglib
  read per row could be costly at scale, unlike the existing on-read `AudioProperties`
  pattern which is cheap header data), on-demand via an explicit "Check sync" action, or
  lazily only when a row is selected into the inspector?
- [NEEDS CLARIFICATION] Field scope — compare all `Metadata` fields (incl. the R-TAGS
  extras in `tags_extra`), or only the dedicated-column fields?
- [NEEDS CLARIFICATION] Does File→DB also need to re-derive `skippedTags`/audio
  properties, or only the tag fields?
- [NEEDS CLARIFICATION] Bulk sync direction — one direction applied uniformly to every
  selected row, or does the modal need to handle rows individually (e.g. some need
  DB→file, others File→DB)?
- [NEEDS CLARIFICATION] Does filename/path drift (file renamed on disk outside the app)
  fall under this same sync mechanism, or is it explicitly out of scope (tag values
  only)?

---

## Shipped — Feature 006: Library tab redesign (waveform tag-editor)

*(branch `006-library-redesign`; merged to master via **PR #73** — kept for reference; not yet
cut as a numbered release)*

### Intent

Rebuild the **Library** tab to match the Figma **"Library Tab 2"** design — a desktop-style
**waveform tag-editor** — as a full re-skin of the 005 Library surface. Same data and stack as
005 (`@nuxt/ui` v4 + `wavesurfer.js` + `taglib-wasm`); this is a **UX/interaction redesign**,
not new domain behavior. Build it at a **parallel route** (e.g. `/library-next`) so the existing
`/library` keeps working untouched; once verified, point the Library nav tab at the new page and
**delete the old Library page/components** (a final, separate step).

### User journeys (priority hints for `/speckit-specify`)

**P1 — Two-pane file table + tag-editor inspector.**
Resizable `DashboardPanel`: **left** = the file-list table, **right** = the tag-editor
inspector. Selecting a row loads its tags on the right; **Previous/Next** in the inspector
toolbar change the selection without leaving the panel.

**P1 — Waveform player with loop + zoom.**
Light-theme `wavesurfer.js` player along the bottom: **Play** (Lejátszás), **Add loop section**
(Ciklusszakasz hozzáadása), **Repeat-section / loop toggle** (Szakasz ismétlése), and a **zoom**
slider (Nagyítás). Loop **regions** + **zoom** per constitution v2.5.0 / US6.

**P2 — Filter bar.**
Above the table: search-all-fields input, audio-format select, recording-date input, genre
select, language select.

**P2 — File table management.**
Multi-select **checkboxes** (header select-all + per-row), sortable columns (Filename, Title,
Artist, Album, Year, Track, Genre), selected-row highlight, and a **"Configure Columns"** modal
(gear in the file-panel header) to toggle/reorder visible columns (**Filename always-on**).

**P2 — Tag-editor inspector controls.**
Header title + settings gear; toolbar Previous / Next / Play Audio; editable fields (Name,
Text/notes, Title, Artist, Album, Comment, Date, Track Number, Genre, Encoded-By, Language); a
**"Configure Visible Fields"** modal (gear) to toggle which fields show; and a **show/hide
inspector** toggle in the file-panel header.

**P3 — Status bar.**
Save state, files-loaded count, current selection, and encoding info (UTF-8, codec/bitrate).

### In scope

- Parallel `/library-next` route; swap the Library nav target and delete the old Library
  page/components once proven.
- Two-pane resizable layout (reuse 005's `UDashboard` pattern), filter bar, file table
  (multi-select + Configure Columns), tag-editor inspector (+ Configure Visible Fields +
  show/hide toggle), waveform player (loop + zoom), status bar.
- All new strings localized **en/hu** (Hungarian default); controls keyboard/AT-accessible;
  test-gated **red-first**; `wavesurfer.js` **mocked** in tests.
- Accent color = the app's **violet primary** (NOT the Figma kit's green).

### Out of scope (do **not** spec here)

- Changes to `src/core/`, the TTS engine, storage layout, or audio-tag schema — reuse existing
  `taglib-wasm` read/write and app composables (`useViewPreferences`, `useQueueFile`, …); no
  server/schema changes unless explicitly justified (FR-018 spirit).
- **Generate**-tab changes (this feature is Library-only).
- Anything in the **Later / backlog** section below.

### References (visual only — 005 `spec.md`/`data-model.md` remain the source of truth)

Figma file `LSx4m0qJpJRqvp8wCCHKTl`, page **"Library Tab 2"** — screen node `66:3`,
"Configure Visible Fields" modal `80:2088`, "Configure Columns" modal `81:300`.

### Open questions

- **[NEEDS CLARIFICATION]** Configure Columns / Configure Visible Fields persistence — reuse
  005's `useViewPreferences`, and persist across sessions?
- **[NEEDS CLARIFICATION]** Loop **regions** — a single A–B repeat region, or multiple named
  regions?
- **[NEEDS CLARIFICATION]** Filter bar — are format/genre/language/date all present on library
  rows, or derived from tags at read time?
- **[NEEDS CLARIFICATION]** Multi-select in Library — what bulk action(s) beyond selection
  (delete, batch tag edit)?
- **[NEEDS CLARIFICATION]** Status-bar "save state" — does the inspector autosave tag edits, or
  is there an explicit Save?
- **[NEEDS CLARIFICATION]** On old-tab deletion, does the route revert to `/library` (rename
  `/library-next`) so existing links/tests keep working?

---

## Shipped — Feature 005: Dashboard workspace redesign

*(branch `005-dashboard-redesign`; released **v0.5.0** — kept for reference; superseded as
next-up by Feature 006 above)*

### Intent

Rework the **Generate** tab (called "General" in earlier notes) and the **Library** tab onto
a shared, resizable **two-panel dashboard layout** — a list on the left, a detail/metadata
panel on the right — plus a header **toolbar** that centralizes the primary actions. The goal
is a faster, IDE-like batch workflow: build and curate a generation queue, edit per-item
metadata side-by-side, and review generated audio on a waveform — all without leaving the
panel. This is a **UX/interaction redesign**, not a change to the generation engine or
storage; it builds on the `@nuxt/ui` v4 controls delivered in 004.

### User journeys (priority hints for `/speckit-specify`)

**P1 — Side-by-side generation workspace (Generate tab).**
A resizable `DashboardPanel`: **left** = the QueueList of items to generate, **right** = the
metadata fields for the selected item. Selecting an item in the list loads its metadata on the
right. The recording-date field is pre-filled with **tomorrow's date** (sourced from the
Settings default-tag values) and offers a date picker.

**P1 — Dashboard toolbar in the header.**
A `DashboardToolbar` exposing: Upload file, Previous item, Next item (navigation across the
queue selection), Generate, Save QueueList, Open QueueList, and Open Settings.

**P2 — Queue list management.**
The QueueList supports: free-text search (in filename and in item text); filters by voice,
format, album, recording date, and language; a leading **checkbox column** for multi-select +
delete; a **source column** showing the item origin (uploaded filename *or* "Text Entered");
and a per-list settings button opening a modal to choose which columns are visible.

**P2 — Add a single text item.**
A top panel on the Generate tab to add one ad-hoc text entry directly into the QueueList.

**P2 — Library tab on the same layout.**
The Library tab adopts the identical resizable two-panel layout: **left** = the library table,
**right** = an Audio Tags panel. The Audio Tags panel has Previous/Next navigation buttons that
change the selected item without returning to the table.

**P3 — Waveform audio player (Library tab).**
A bottom audio player for the selected file using **wavesurfer-vue**
(https://github.com/meer-sagor/wavesurfer-vue) with the **zoom** and **regions** plugins.

**P3 — Settings as a modal dialog.**
Convert the Settings *tab* into a Settings **modal** opened from the toolbar.

### In scope

- Resizable two-panel dashboard layout shared by the Generate and Library tabs.
- Header toolbar and the actions listed above.
- QueueList filtering, multi-select delete, source column, and configurable column visibility.
- Library Audio Tags panel with item navigation; waveform player with zoom + regions.
- Settings surfaced as a modal.

### Out of scope (do **not** spec here)

- Anything in the **Later / backlog** section below.
- Changes to `src/core/`, the generation/TTS engine, storage layout, or audio-tag schema
  (this is an interaction redesign over existing capabilities).
- New authentication / multi-user concerns.

### Open questions

- **[NEEDS CLARIFICATION]** Save/Open QueueList — persist where and in what format? (Local file
  download/upload as JSON, vs. server-side saved queues?)
- **[NEEDS CLARIFICATION]** Does the Settings *tab* go away entirely once Settings is a modal,
  or do both entry points coexist?
- **[NEEDS CLARIFICATION]** Waveform **regions** — what are regions used for (trim ranges,
  markers, segment export)? Or are they display-only for now?
- **[NEEDS CLARIFICATION]** Recording date "tomorrow" — always today+1, or a configurable
  default in the Settings default-tag values?
- **[NEEDS CLARIFICATION]** Should the resizable split position persist across sessions?
- **[NEEDS CLARIFICATION]** Filter fields (album, language, voice, format) — confirm these are
  all present on queue items and on library rows.
- **[NEEDS CLARIFICATION]** Multi-select delete — reuse the existing `ConfirmDialog`/`UModal`
  confirmation flow from 004?
