# EchoRecall

Turn written text into spoken audio and keep a permanent, browsable library of
everything you've generated. EchoRecall is a small web app: build a list of
text, pick a voice and format, and generate a whole batch at once — every
successful clip is saved so you can replay, retag, download, or delete it later
without regenerating.

- **Generation workspace** — a single scrolling queue builder: type a script or preview and import `.txt`, YAML, or JSON batches, choose Voice/Model/Format and visible metadata fields, then select, reorder, bulk-delete, save/load, and generate pending rows. A downloadable YAML example and [batch format guide](docs/batch-import.md) make the structured contract reusable. Generation targets checked rows (or all rows), reports per-item progress, cost, and failures, supports graceful cancellation, and removes successful rows while keeping failures for retry.
- **Voices, models & formats** — choose a voice and model, and render to MP3, WAV, FLAC, Opus, AAC, or PCM.
- **Standards-based metadata** — attach title, artist, album, genre, comment, languages, a recording date, and repeatable custom text/URL tags, written as ID3v2.4 / Vorbis comments where the format supports them.
- **Persistent library** — every generation is stored (SQLite + on-disk audio under `data/`) and survives restarts; replay makes no new provider call. Files are saved with human-readable, title-slugged names under a `YYYY/MM/DD` folder.
- **Library workspace** — the same two-pane layout (results table + an audio-tags panel with previous/next), plus a **waveform review player** with zoom and loop regions (playback aid only — it never modifies the audio). Server-side search, sort, filter (voice/format/date), and pagination; rename, retag, delete, or bulk-clean by filter.
- **Personalize** — light/dark theme and language (English / Hungarian, Hungarian default), persisted per browser.
- **In-app OpenAI key** — optionally set/replace/clear the OpenAI key from **Settings** (a modal opened from the toolbar or header); it is encrypted at rest and never returned to the client.
- **Versioned** — the running app version is shown in the header and bumped with one release command.

There is no built-in authentication — secure network access yourself (localhost,
reverse proxy, or VPN).

## Stack

TypeScript (strict) on Node.js · Nuxt 4 (Vue 3 + Nitro) · `@nuxt/ui` v4 (+ color-mode,
dashboard primitives) · `@nuxtjs/i18n` (en/hu) · `wavesurfer.js` (Library waveform review,
display/playback only) · `yaml` (strict YAML 1.2 and JSON duplicate-property checks) · OpenAI TTS · multi-format audio with ID3/Vorbis tagging via
`taglib-wasm` (pure WASM — no system binary) · SQLite (`better-sqlite3`) + filesystem
audio under `data/` · Vitest + `@nuxt/test-utils` · Docker Compose. A framework-agnostic
core lives in `src/core/`; the Nuxt server (`server/`) and UI (`app/`) are adapters over it.

## Prerequisites

- **Node.js 22.22.2** — pinned in `.mise.toml` / `.node-version`. Using [mise](https://mise.jdx.dev)
  (`mise install`) is recommended; the native `better-sqlite3` addon must be built
  against this version. (Node ≥ 22.6 is required for the WASM tagger.)
- **pnpm 10** (`corepack enable` will provide it).
- An **OpenAI API key** with TTS access — set it in `.env` or in **Settings** (the in-app modal).

## Local development

```bash
pnpm install
cp .env.example .env          # then set NUXT_OPENAI_API_KEY=sk-... (or set it in Settings)
pnpm dev                      # http://localhost:3102
```

Environment variables (server-only; never commit real keys):

| Variable                     | Required | Default  | Purpose                                                                 |
| ---------------------------- | -------- | -------- | ----------------------------------------------------------------------- |
| `NUXT_OPENAI_API_KEY`        | no\*     | —        | OpenAI key for TTS. \*Required unless you set one in Settings.           |
| `NUXT_OPENAI_BASE_URL`       | no       | —        | Optional OpenAI-compatible speech gateway (for example LiteLLM `http://localhost:4000/v1`). Empty uses the public OpenAI speech API. Can also be set in Settings → API Base URL (in-app value wins over this env). |
| `NUXT_DATA_DIR`              | no       | `./data` | Where the SQLite DB + audio are kept.                                   |
| `NUXT_APP_SECRET`            | no       | —        | 32+ char secret enabling the encrypted in-app OpenAI key; unset → env key only. |

Default tag values (Artist, Album, Genre, Comment, Languages — Title is never defaulted)
are configured in **Settings** ("Default tag values") and persisted in the app;
they are no longer set via environment variables. Upgrading from a release that used
`NUXT_DEFAULT_TAG_*`? Those values are not migrated — re-enter them once in Settings.

## Tests, types, and lint

```bash
pnpm test            # core unit + server integration (TTS provider mocked — no live calls)
pnpm test:component  # Vue component tests (@nuxt/test-utils)
pnpm test:adapters   # GATED: real taglib-wasm tagger (+ optional live OpenAI if keyed)
pnpm typecheck       # nuxt typecheck
pnpm lint            # eslint
```

The default suites mock the TTS provider and tagger at the core port boundary, so they
never touch the network or a system binary. The real WASM tagger is exercised only by the
opt-in `test:adapters` suite.

## Release

```bash
pnpm bumpp <patch|minor|major>   # omit the type to choose interactively
```

`bumpp` bumps the single `version` in `package.json` and creates a release commit + tag.
`nuxt.config.ts` reads that version into `runtimeConfig.public.appVersion`, which the
header displays — so the shown version updates with no further edit.

## Docker

```bash
# Reads NUXT_* vars from .env; serves on http://localhost:3102
docker compose up --build -d
```

`docker-compose.yml` passes the OpenAI key, optional `NUXT_OPENAI_BASE_URL`, and
`NUXT_APP_SECRET` through from `.env` (all optional), and bind-mounts `./data` so the SQLite
database and generated audio persist across container recreation. No extra system packages
are needed — `better-sqlite3` is built in the image and the tagger ships as WASM via npm.
Stop with `docker compose down`.

## Project layout

```
src/core/      framework-agnostic domain: batch/, tts/, library/, settings/, shared/
server/        Nitro API routes (server/api/, incl. settings/) + DI container & error mapping
app/           Nuxt UI: components/ (generate, library, settings, common), composables/, pages/
public/        static browser assets, including the canonical batch YAML example
docs/          user-facing author guides, including the batch import contract
i18n/locales/  en.json · hu.json
tests/         unit/ · integration/ · component/ · adapters/ (gated)
data/          runtime SQLite DB + audio/ (gitignored; Docker volume)
specs/         feature specs, plans, data models, API contracts, quickstarts
```

## Documentation

The current feature — preview-first **structured batch import** for text, YAML, and JSON — is
documented in the [batch format guide](docs/batch-import.md) and specified in
[`specs/008-batch-import/`](specs/008-batch-import/) (see its
[`quickstart.md`](specs/008-batch-import/quickstart.md) for end-to-end validation steps).
The dashboard redesign is specified in
[`specs/005-dashboard-redesign/`](specs/005-dashboard-redesign/). The batch studio, formats,
tagging, library, settings, defaults, and versioning are
specified in [`specs/002-studio-enhancements/`](specs/002-studio-enhancements/); the original
single-generation baseline lives in
[`specs/001-tts-generation-library/`](specs/001-tts-generation-library/).
