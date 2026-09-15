import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ref, watch } from 'vue'
import { useViewPreferences } from '../../app/composables/useViewPreferences'

// 007 · US3 (T020 / G-DEFAULTS, FR-011/012/013) — the per-device "last-selected"
// generation settings added to useViewPreferences under key
// `echorecall:viewprefs:genSettings`. A partial `{ voiceId?, model?, format? }` persisted
// to localStorage so the editor can restore the user's last picks, with a per-field setter
// and a per-field reset (reset drops the field so it falls back to the configured default).
// Reads keep only well-typed known fields; SSR-safe fallback to {}. Speed is not remembered.
// Node-env unit test: shim the Vue reactivity auto-imports + in-memory localStorage.

const g = globalThis as unknown as Record<string, unknown>
g.ref = ref
g.watch = watch

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

const KEY = 'echorecall:viewprefs:genSettings'

beforeEach(() => {
  g.localStorage = new MemoryStorage()
})
afterEach(() => {
  delete g.localStorage
})

describe('useViewPreferences — genSettings last-selected', () => {
  it('defaults to an empty set when nothing is stored', () => {
    const { genSettings } = useViewPreferences()
    expect(genSettings.value).toEqual({})
  })

  it('persists a per-field last-selected value and re-reads it on a fresh instance', () => {
    const a = useViewPreferences()
    a.setGenSetting('voiceId', 'nova')
    a.setGenSetting('model', 'tts-1')

    const raw = (g.localStorage as MemoryStorage).getItem(KEY)
    expect(JSON.parse(raw!)).toEqual({ voiceId: 'nova', model: 'tts-1' })

    const b = useViewPreferences()
    expect(b.genSettings.value).toEqual({ voiceId: 'nova', model: 'tts-1' })
  })

  it('per-field reset drops only that field (falls back to configured default on load)', () => {
    const a = useViewPreferences()
    a.setGenSetting('voiceId', 'nova')
    a.setGenSetting('format', 'flac')
    a.resetGenSetting('voiceId')

    expect(a.genSettings.value).toEqual({ format: 'flac' })
    const b = useViewPreferences()
    expect(b.genSettings.value).toEqual({ format: 'flac' })
  })

  it('ignores unknown/mistyped stored values (SSR-safe, tolerant read)', () => {
    ;(g.localStorage as MemoryStorage).setItem(
      KEY,
      JSON.stringify({ voiceId: 'sage', model: 42, format: '', bogus: 'x', speed: 1.5 }),
    )
    const { genSettings } = useViewPreferences()
    // model 42 (not a string), empty format, the unsupported speed field, and the unknown
    // key are all dropped.
    expect(genSettings.value).toEqual({ voiceId: 'sage' })
  })

  it('keeps valid custom identifiers and drops a closed-catalog format', () => {
    ;(g.localStorage as MemoryStorage).setItem(
      KEY,
      JSON.stringify({ voiceId: 'retired-voice', model: 'tts-9', format: 'ogg' }),
    )

    const { genSettings } = useViewPreferences()

    expect(genSettings.value).toEqual({ voiceId: 'retired-voice', model: 'tts-9' })
  })

  it('drops illegal identifiers so they cannot override configured defaults', () => {
    ;(g.localStorage as MemoryStorage).setItem(
      KEY,
      JSON.stringify({ voiceId: '@@@', model: 'bad id!', format: 'ogg' }),
    )

    const { genSettings } = useViewPreferences()

    expect(genSettings.value).toEqual({})
  })

  it('falls back to {} when localStorage is unavailable (SSR) and holds a value in-memory', () => {
    delete g.localStorage
    const { genSettings, setGenSetting } = useViewPreferences()
    expect(genSettings.value).toEqual({})
    setGenSetting('voiceId', 'echo') // must not throw without storage
    expect(genSettings.value).toEqual({ voiceId: 'echo' })
  })
})
