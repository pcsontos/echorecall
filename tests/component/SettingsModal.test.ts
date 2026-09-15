import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { mountSuspended, mockNuxtImport, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineEventHandler } from 'h3'
import SettingsModal from '~/components/settings/SettingsModal.vue'

// Component coverage for US7 (FR-017, contract §9): Settings opens as a modal that
// hosts the four existing settings sections unchanged (appearance, language, OpenAI
// key, default tags). It is controlled via v-model:open, dismissible by its close
// button and by Escape, and returns focus to the opener on close (UModal focus
// management). With the standalone Settings page/tab removed, this modal is the sole
// entry point. UModal teleports its panel to document.body, so controls are queried
// there.

// AppearanceSettings reads useColorMode, whose real client plugin needs a browser-only
// helper absent from the vitest Nuxt env — mock it (matches the other settings tests).
const { useColorModeMock } = vi.hoisted(() => ({ useColorModeMock: vi.fn() }))
mockNuxtImport('useColorMode', () => useColorModeMock)

// The OpenAI-key and default-tags sections load their state on mount; stub both
// endpoints so the modal mounts deterministically (no 404 noise).
registerEndpoint(
  '/api/settings/openai-key',
  defineEventHandler(() => ({ configured: false, source: 'none', secretConfigured: true })),
)
registerEndpoint(
  '/api/settings/openai-base-url',
  defineEventHandler(() => ({ source: 'none' })),
)
registerEndpoint('/api/settings/defaults', defineEventHandler(() => ({ defaultTags: {} })))

beforeEach(() => {
  useColorModeMock.mockReturnValue({ preference: 'system', value: 'light' })
})
afterEach(() => vi.restoreAllMocks())

function el(testId: string): HTMLElement | null {
  return document.body.querySelector(`[data-test="${testId}"]`)
}

describe('SettingsModal (US7)', () => {
  it('renders nothing until opened, then shows the panel via v-model:open', async () => {
    const wrapper = await mountSuspended(SettingsModal, { props: { open: false } })
    await flushPromises()
    expect(el('settings-modal')).toBeNull()

    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(el('settings-modal')).not.toBeNull()
    wrapper.unmount()
  })

  it('hosts the four settings sections', async () => {
    const wrapper = await mountSuspended(SettingsModal, { props: { open: true } })
    await flushPromises()
    expect(el('theme-system'), 'appearance section').not.toBeNull()
    expect(el('lang-hu'), 'language section').not.toBeNull()
    expect(el('key-status'), 'openai-key section').not.toBeNull()
    expect(el('default-status'), 'default-tags section').not.toBeNull()
    wrapper.unmount()
  })

  it('closes via the close button (emits update:open false)', async () => {
    const wrapper = await mountSuspended(SettingsModal, { props: { open: true } })
    await flushPromises()

    ;(el('settings-modal-close') as HTMLButtonElement).click()
    await flushPromises()

    const emitted = wrapper.emitted('update:open')
    expect(emitted).toBeTruthy()
    expect(emitted!.at(-1)![0]).toBe(false)
    wrapper.unmount()
  })

  it('exposes the modal as a named dialog to assistive tech (FR-020)', async () => {
    // FR-020: beyond the focus trap / Escape / focus-return covered below, the panel
    // is announced as a dialog named by its title (aria-labelledby) when it opens.
    const wrapper = await mountSuspended(SettingsModal, { props: { open: true } })
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-labelledby')).toBeTruthy()
    wrapper.unmount()
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const Host = defineComponent({
      components: { SettingsModal },
      setup() {
        const open = ref(false)
        return { open }
      },
      template: `<div>
        <button data-test="opener" @click="open = true">open</button>
        <SettingsModal v-model:open="open" />
      </div>`,
    })
    // Attach to the document so focus management is real: reka-ui captures the
    // pre-open focus target and restores it on close, which only works for elements
    // connected to the document.
    const wrapper = await mountSuspended(Host, { attachTo: document.body })
    const opener = wrapper.find('[data-test="opener"]').element as HTMLButtonElement
    opener.focus()
    opener.click()
    await flushPromises()
    expect(el('settings-modal')).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    await nextTick()

    // Escape dismisses the modal and focus returns to the control that opened it.
    expect(el('settings-modal')).toBeNull()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })
})
