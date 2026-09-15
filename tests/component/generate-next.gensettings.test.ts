import { describe, it, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineEventHandler, readBody } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import GenerateNextPage from '~/pages/generate.vue'
import GenerationSettingsPanel from '~/components/generate/GenerationSettingsPanel.vue'

// 007 · US3 (T028 / G-DEFAULTS, FR-012/FR-013): the Generate page resolves each of
// Voice/Model/Format as last-selected → configured default → built-in fallback, and a
// per-field reset (emitted by the settings panel) restores the field to its configured
// default. The last-selected half lives in localStorage (`echorecall:viewprefs:genSettings`),
// the configured half comes from GET /api/settings/generation-defaults. Speed is not a
// generation control (synthesis always runs at 1×), so it is not resolved here.

const VOICES = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'nova', label: 'Nova' },
  { id: 'sage', label: 'Sage' },
]
type CatalogEntry = { id: string; label: string; source: 'builtin' | 'gateway' | 'retained' }
const builtinCatalog: {
  voices: CatalogEntry[]
  models: CatalogEntry[]
  rates: Record<string, unknown>
  catalogError?: string
} = {
  voices: VOICES.map((voice) => ({ ...voice, source: 'builtin' })),
  models: [
    { id: 'tts-1', label: 'tts-1', source: 'builtin' },
    { id: 'tts-1-hd', label: 'tts-1-hd', source: 'builtin' },
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin' },
  ],
  rates: {},
}
let catalog = {
  ...builtinCatalog,
  voices: [...builtinCatalog.voices],
  models: [...builtinCatalog.models],
}
registerEndpoint('/api/voices', () => ({ voices: VOICES }))
registerEndpoint('/api/tts/catalog', () => catalog)
registerEndpoint('/api/settings/defaults', () => ({ defaultTags: {} }))

let configured: Record<string, unknown> = {}
let delayGenerationDefaults = false
let releaseGenerationDefaults: (() => void) | undefined
registerEndpoint('/api/settings/generation-defaults', async () => {
  if (delayGenerationDefaults) {
    await new Promise<void>((resolve) => {
      releaseGenerationDefaults = resolve
    })
  }
  return { generationDefaults: configured }
})
registerEndpoint('/api/generations', () => ({ generations: [], total: 0, page: 1, pageSize: 20 }))
const postedBodies: { text?: string; voiceId?: string; model?: string }[] = []
registerEndpoint('/api/generations', {
  method: 'POST',
  handler: defineEventHandler(async (event) => {
    const body = await readBody<{ text?: string; voiceId?: string; model?: string }>(event)
    postedBodies.push(body)
    return { id: `id-${postedBodies.length}`, audioUrl: `/api/generations/id-${postedBodies.length}/audio` }
  }),
})

const GEN_KEY = 'echorecall:viewprefs:genSettings'

function panelOf(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  return wrapper.findComponent(GenerationSettingsPanel)
}

/** Node 22's experimental `localStorage` is undefined without `--localstorage-file`. */
function storage(): Storage {
  const current = window.localStorage
  if (current && typeof current.clear === 'function') return current
  const store = new Map<string, string>()
  const memory: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memory })
  return memory
}

beforeEach(() => {
  configured = {}
  delayGenerationDefaults = false
  releaseGenerationDefaults = undefined
  catalog = {
    ...builtinCatalog,
    voices: [...builtinCatalog.voices],
    models: [...builtinCatalog.models],
    catalogError: undefined,
  }
  postedBodies.length = 0
  storage().clear()
})

describe('generate-next generation-settings resolution (US3)', () => {
  it('falls back to built-ins when nothing is configured or last-selected', async () => {
    const wrapper = await mountSuspended(GenerateNextPage)
    // Drain onMounted's chain: loadVoices → defaults → generation-defaults → resolve → nextTick.
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voiceId')).toBe('alloy') // first voice
    expect(panel.props('model')).toBe('gpt-4o-mini-tts')
    expect(panel.props('format')).toBe('mp3')
  })

  it('uses the configured defaults when no last-selected value exists', async () => {
    configured = { voiceId: 'sage', model: 'tts-1', format: 'flac' }
    const wrapper = await mountSuspended(GenerateNextPage)
    // Drain onMounted's chain: loadVoices → defaults → generation-defaults → resolve → nextTick.
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voiceId')).toBe('sage')
    expect(panel.props('model')).toBe('tts-1')
    expect(panel.props('format')).toBe('flac')
  })

  it('prefers the last-selected value over the configured default', async () => {
    configured = { voiceId: 'sage', model: 'tts-1', format: 'flac' }
    window.localStorage.setItem(GEN_KEY, JSON.stringify({ voiceId: 'nova' }))
    const wrapper = await mountSuspended(GenerateNextPage)
    // Drain onMounted's chain: loadVoices → defaults → generation-defaults → resolve → nextTick.
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voiceId')).toBe('nova') // last-selected wins
    expect(panel.props('model')).toBe('tts-1') // still the configured default
  })

  it('persists a changed field as last-selected', async () => {
    const wrapper = await mountSuspended(GenerateNextPage)
    // Drain onMounted's chain: loadVoices → defaults → generation-defaults → resolve → nextTick.
    for (let i = 0; i < 6; i++) await flushPromises()
    panelOf(wrapper).vm.$emit('update:voiceId', 'nova')
    await flushPromises()
    expect(JSON.parse(window.localStorage.getItem(GEN_KEY)!)).toMatchObject({ voiceId: 'nova' })
  })

  it('preserves and persists settings changed while configured defaults load', async () => {
    configured = { voiceId: 'sage', model: 'tts-1-hd', format: 'flac' }
    delayGenerationDefaults = true
    const wrapper = await mountSuspended(GenerateNextPage)
    for (let i = 0; i < 4; i++) await flushPromises()
    expect(releaseGenerationDefaults).toBeTypeOf('function')

    const panel = panelOf(wrapper)
    panel.vm.$emit('update:voiceId', 'nova')
    panel.vm.$emit('update:model', 'tts-1')
    panel.vm.$emit('update:format', 'wav')
    await flushPromises()

    releaseGenerationDefaults!()
    for (let i = 0; i < 6; i++) await flushPromises()

    expect(panel.props('voiceId')).toBe('nova')
    expect(panel.props('model')).toBe('tts-1')
    expect(panel.props('format')).toBe('wav')
    expect(JSON.parse(window.localStorage.getItem(GEN_KEY)!)).toMatchObject({
      voiceId: 'nova',
      model: 'tts-1',
      format: 'wav',
    })
  })

  it('per-field reset restores the configured default and forgets the last-selected value', async () => {
    configured = { voiceId: 'sage' }
    window.localStorage.setItem(GEN_KEY, JSON.stringify({ voiceId: 'nova' }))
    const wrapper = await mountSuspended(GenerateNextPage)
    // Drain onMounted's chain: loadVoices → defaults → generation-defaults → resolve → nextTick.
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voiceId')).toBe('nova')

    panel.vm.$emit('reset', 'voiceId')
    await flushPromises()

    expect(panel.props('voiceId')).toBe('sage') // configured default
    expect(JSON.parse(window.localStorage.getItem(GEN_KEY)!).voiceId).toBeUndefined() // last-selected cleared
  })
})

describe('generate-next speech catalog (009 · US2)', () => {
  it('loads the merged catalog onto Voice/Model menus', async () => {
    catalog = {
      ...builtinCatalog,
      voices: [
        ...builtinCatalog.voices,
        { id: '21m00Tcm4TlvDq8ikWAM', label: '21m00Tcm4TlvDq8ikWAM', source: 'gateway' },
      ],
      models: [
        ...builtinCatalog.models,
        {
          id: 'elevenlabs/eleven_multilingual_v2',
          label: 'elevenlabs/eleven_multilingual_v2',
          source: 'gateway',
        },
      ],
    }
    const wrapper = await mountSuspended(GenerateNextPage)
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voices')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'alloy', source: 'builtin' }),
        expect.objectContaining({ id: '21m00Tcm4TlvDq8ikWAM', source: 'gateway' }),
      ]),
    )
    expect(panel.props('models')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-4o-mini-tts', source: 'builtin' }),
        expect.objectContaining({ id: 'elevenlabs/eleven_multilingual_v2', source: 'gateway' }),
      ]),
    )
    expect(wrapper.find('[data-test="catalog-error"]').exists()).toBe(false)
  })

  it('keeps builtin catalog items and announces a non-blocking error when discovery fails', async () => {
    catalog = { ...builtinCatalog, voices: [...builtinCatalog.voices], models: [...builtinCatalog.models], catalogError: 'UNREACHABLE' }
    const wrapper = await mountSuspended(GenerateNextPage)
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    expect(panel.props('voices')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'alloy' })]),
    )
    expect(panel.props('models')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gpt-4o-mini-tts' })]),
    )
    const status = wrapper.find('[data-test="catalog-error"]')
    expect(status.exists()).toBe(true)
    expect(status.text().length).toBeGreaterThan(0)
  })

  it('generates with a custom catalog identifier', async () => {
    catalog = {
      ...builtinCatalog,
      voices: [
        ...builtinCatalog.voices,
        { id: 'azure/en-US-JennyNeural', label: 'azure/en-US-JennyNeural', source: 'gateway' },
      ],
      models: [
        ...builtinCatalog.models,
        {
          id: 'elevenlabs/eleven_multilingual_v2',
          label: 'elevenlabs/eleven_multilingual_v2',
          source: 'gateway',
        },
      ],
    }
    const wrapper = await mountSuspended(GenerateNextPage)
    for (let i = 0; i < 6; i++) await flushPromises()
    const panel = panelOf(wrapper)
    panel.vm.$emit('update:voiceId', 'azure/en-US-JennyNeural')
    panel.vm.$emit('update:model', 'elevenlabs/eleven_multilingual_v2')
    await flushPromises()

    await wrapper.find('[data-test="add-text-input"]').setValue('Gateway hello')
    await wrapper.find('[data-test="add-text-submit"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="action-generate"]').trigger('click')
    for (let i = 0; i < 8; i++) await flushPromises()

    expect(postedBodies).toHaveLength(1)
    expect(postedBodies[0]).toMatchObject({
      text: 'Gateway hello',
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
    })
  })
})
