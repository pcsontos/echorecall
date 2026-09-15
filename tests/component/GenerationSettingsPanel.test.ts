import { describe, it, expect } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GenerationSettingsPanel from '~/components/generate/GenerationSettingsPanel.vue'

// 007 · US1 (T005 / FR-005): the Generation settings column — Voice / Model / Format over
// the existing catalogs, controlled via v-model. Forks GenerateForm as a vertical editor
// column. Speed is intentionally not exposed (synthesis always runs at 1×). Per-field reset
// + defaults resolution arrive in US3.
const voices = [
  { id: 'alloy', label: 'Alloy', source: 'builtin' as const },
  { id: 'echo', label: 'Echo', source: 'builtin' as const },
]

const models = [
  { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin' as const },
  { id: 'tts-1', label: 'tts-1', source: 'builtin' as const },
]

function mountPanel(
  props: Record<string, unknown> = {},
) {
  return mountSuspended(GenerationSettingsPanel, {
    props: { voices, models, voiceId: 'alloy', model: 'gpt-4o-mini-tts', format: 'mp3', ...props },
  })
}

// USelectMenu is a button-triggered combobox; drive it by emitting update:modelValue on
// the menu whose subtree carries the data-test trigger (established repo lesson).
function selectMenu(w: VueWrapper, testId: string) {
  const menu = w
    .findAllComponents({ name: 'USelectMenu' })
    .find((c) => c.find(`[data-test="${testId}"]`).exists())
  if (!menu) throw new Error(`USelectMenu [data-test="${testId}"] not found`)
  return menu
}

function pickMenu(w: VueWrapper, testId: string, value: string) {
  selectMenu(w, testId).vm.$emit('update:modelValue', value)
}

function itemIds(w: VueWrapper, testId: string): string[] {
  const items = selectMenu(w, testId).props('items') as unknown[]
  return items.map((item) => (typeof item === 'string' ? item : (item as { id: string }).id))
}

describe('GenerationSettingsPanel', () => {
  it('renders the three generation controls', async () => {
    const wrapper = await mountPanel()
    for (const id of ['voice', 'model', 'format']) {
      expect(wrapper.find(`[data-test="${id}"]`).exists(), id).toBe(true)
    }
  })

  it('places Voice and Format on one row under Model', async () => {
    const wrapper = await mountPanel()
    const row = wrapper.get('[data-test="gen-settings-voice-format"]')
    expect(row.find('[data-test="voice"]').exists()).toBe(true)
    expect(row.find('[data-test="format"]').exists()).toBe(true)
    expect(row.find('[data-test="model"]').exists()).toBe(false)
  })

  it('does not expose a speed control (synthesis always runs at 1×)', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-test="speed"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="gen-reset-speed"]').exists()).toBe(false)
  })

  it('updates voice / model / format via v-model', async () => {
    const wrapper = await mountPanel()

    pickMenu(wrapper, 'voice', 'echo')
    await flushPromises()
    expect(wrapper.emitted('update:voiceId')?.at(-1)?.[0]).toBe('echo')

    pickMenu(wrapper, 'model', 'tts-1')
    await flushPromises()
    expect(wrapper.emitted('update:model')?.at(-1)?.[0]).toBe('tts-1')

    pickMenu(wrapper, 'format', 'flac')
    await flushPromises()
    expect(wrapper.emitted('update:format')?.at(-1)?.[0]).toBe('flac')
  })

  // 007 · US3 (T022 / FR-013): each control offers a per-field reset that asks the page to
  // restore the field to its configured default (resolution is owned by the page).
  it('emits a per-field reset for each control', async () => {
    const wrapper = await mountPanel()
    const cases: [string, string][] = [
      ['gen-reset-voice', 'voiceId'],
      ['gen-reset-model', 'model'],
      ['gen-reset-format', 'format'],
    ]
    for (const [testId, field] of cases) {
      const btn = wrapper.find(`[data-test="${testId}"]`)
      expect(btn.exists(), testId).toBe(true)
      await btn.trigger('click')
      expect(wrapper.emitted('reset')?.at(-1)?.[0], field).toBe(field)
    }
  })

  it('lists merged builtin and gateway Voice/Model items', async () => {
    const wrapper = await mountPanel({
      voices: [
        ...voices,
        { id: '21m00Tcm4TlvDq8ikWAM', label: '21m00Tcm4TlvDq8ikWAM', source: 'gateway' },
      ],
      models: [
        ...models,
        {
          id: 'elevenlabs/eleven_multilingual_v2',
          label: 'elevenlabs/eleven_multilingual_v2',
          source: 'gateway',
        },
      ],
    })
    expect(itemIds(wrapper, 'voice')).toEqual(['alloy', 'echo', '21m00Tcm4TlvDq8ikWAM'])
    expect(itemIds(wrapper, 'model')).toContain('elevenlabs/eleven_multilingual_v2')
    expect(itemIds(wrapper, 'model')).toContain('gpt-4o-mini-tts')
  })

  it('appends a retained current Voice/Model when it is missing from the catalog', async () => {
    const wrapper = await mountPanel({
      voiceId: 'azure/en-US-JennyNeural',
      model: 'elevenlabs/eleven_multilingual_v2',
    })
    expect(itemIds(wrapper, 'voice')).toContain('azure/en-US-JennyNeural')
    expect(itemIds(wrapper, 'model')).toContain('elevenlabs/eleven_multilingual_v2')
  })

  it('does not offer a write-in / create-item control', async () => {
    const wrapper = await mountPanel()
    for (const id of ['voice', 'model']) {
      const menu = selectMenu(wrapper, id)
      expect(menu.props('createItem') ?? false, id).toBe(false)
      expect(wrapper.find(`[data-test="${id}-write-in"]`).exists(), id).toBe(false)
    }
  })

  const multiProviderModels = [
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', source: 'builtin' as const, provider: 'openai' },
    { id: 'tts-1', label: 'tts-1', source: 'builtin' as const, provider: 'openai' },
    {
      id: 'elevenlabs/eleven_multilingual_v2',
      label: 'elevenlabs/eleven_multilingual_v2',
      source: 'gateway' as const,
      provider: 'elevenlabs',
    },
  ]

  it('hides Provider when the catalog has a single provider', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-test="provider"]').exists()).toBe(false)
  })

  it('places Provider on the Model row when multiple providers exist', async () => {
    const wrapper = await mountPanel({ models: multiProviderModels })
    const row = wrapper.get('[data-test="gen-settings-model-row"]')
    expect(row.find('[data-test="provider"]').exists()).toBe(true)
    expect(row.find('[data-test="model"]').exists()).toBe(true)
    expect(selectMenu(wrapper, 'provider').props('createItem') ?? false).toBe(false)
  })

  it('lists only the selected provider’s models and auto-selects the first on change', async () => {
    const wrapper = await mountPanel({ models: multiProviderModels })
    expect(itemIds(wrapper, 'model')).toEqual(['gpt-4o-mini-tts', 'tts-1'])
    expect(itemIds(wrapper, 'model')).not.toContain('elevenlabs/eleven_multilingual_v2')

    pickMenu(wrapper, 'provider', 'elevenlabs')
    await flushPromises()
    expect(wrapper.emitted('update:model')?.at(-1)?.[0]).toBe('elevenlabs/eleven_multilingual_v2')
  })

  it('shows input cost per character next to Model when the selected model has a rate', async () => {
    const wrapper = await mountPanel({
      models: multiProviderModels,
      model: 'elevenlabs/eleven_multilingual_v2',
      rates: {
        'elevenlabs/eleven_multilingual_v2': { inputCostPerCharacter: 0.00003 },
      },
    })
    const label = wrapper.get('[data-test="model-char-rate"]')
    expect(label.text()).toContain('0.00003')
    expect(wrapper.get('[data-test="gen-settings-model-row"]').find('[data-test="model-char-rate"]').exists()).toBe(true)
  })

  it('hides the char-rate label when the selected model has no input cost', async () => {
    const wrapper = await mountPanel({
      rates: { tts1: { inputCostPerCharacter: 0.1 } },
    })
    expect(wrapper.find('[data-test="model-char-rate"]').exists()).toBe(false)
  })
})
