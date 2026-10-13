import { describe, it, expect } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import GenerateNextPage from '~/pages/generate.vue'

// 007 · US1 (T008 / FR-004/FR-007): page-level wiring for the redesigned Generate editor.
// The Script column's Add appends a queue row and the action bar's count badge tracks the
// queue; Clear leaves the queue untouched. (Runs in the Nuxt component env — the repo's
// tests/integration/** is node-only, so a page-mount test lives here.)
registerEndpoint('/api/voices', () => ({
  voices: [
    { id: 'alloy', label: 'Alloy' },
    { id: 'echo', label: 'Echo' },
  ],
}))
registerEndpoint('/api/settings/defaults', () => ({ defaultTags: {} }))

async function mountPage() {
  const wrapper = await mountSuspended(GenerateNextPage)
  await flushPromises() // resolve onMounted loadVoices() + defaults fetch
  return wrapper
}

describe('generate-next editor wiring (US1)', () => {
  it('adds a queued row from the script panel and tracks the count badge', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[data-test="queue-count-badge"]').text()).toContain('0')

    await wrapper.find('[data-test="add-text-input"]').setValue('hello world')
    await wrapper.find('[data-test="add-text-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="queue-count-badge"]').text()).toContain('1')
  })

  it('Clear empties the script box without touching the queue', async () => {
    const wrapper = await mountPage()
    const box = wrapper.find('[data-test="add-text-input"]')
    await box.setValue('hello world')
    await wrapper.find('[data-test="add-text-submit"]').trigger('click')
    await flushPromises()

    await box.setValue('draft to discard')
    await wrapper.find('[data-test="script-clear"]').trigger('click')

    expect((box.element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(1)
  })

  it('confirms before a loaded queue replaces existing rows', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-test="add-text-input"]').setValue('keep me')
    await wrapper.find('[data-test="add-text-submit"]').trigger('click')
    await flushPromises()

    const queueFile = new File([JSON.stringify({
      schema: 'echorecall.queue',
      version: 1,
      items: [{
        text: 'loaded row',
        voiceId: 'alloy',
        model: 'gpt-4o-mini-tts',
        format: 'mp3',
        metadata: {},
        source: 'text',
      }],
    })], 'replacement.echoqueue.json', { type: 'application/json' })
    const input = wrapper.find('[data-test="queue-file-input"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [queueFile] })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.find('[data-test="queue-row"]').text()).toContain('keep me')
    const dialog = document.body.querySelector('[data-test="confirm-dialog"]')
    expect(dialog).not.toBeNull()

    ;(document.body.querySelector('[data-test="confirm-ok"]') as HTMLButtonElement).click()
    await flushPromises()

    expect(wrapper.findAll('[data-test="queue-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="queue-row"]').text()).toContain('loaded row')
    wrapper.unmount()
  })

  it('triggers export and toast when Save queue is clicked on non-empty queue', async () => {
    const wrapper = await mountPage()
    await wrapper.find('[data-test="add-text-input"]').setValue('item to save')
    await wrapper.find('[data-test="add-text-submit"]').trigger('click')
    await flushPromises()

    const saveBtn = wrapper.find('[data-test="action-save-queue"]')
    expect((saveBtn.element as HTMLButtonElement).disabled).toBe(false)
    await saveBtn.trigger('click')
    await flushPromises()

    wrapper.unmount()
  })
})
