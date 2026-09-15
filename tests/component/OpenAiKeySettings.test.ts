import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineEventHandler, readBody, getMethod } from 'h3'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { useNuxtApp } from '#imports'
import OpenAiKeySettings from '~/components/settings/OpenAiKeySettings.vue'

// Component coverage for 009 · US1: optional API Base URL on the existing OpenAI
// key Settings card. The URL is shown in full (not masked), save/clear persist it
// without requiring Test Connection, and Test Connection checks the values
// currently shown (draft URL + key) and surfaces typed failure copy.

interface KeyStatus {
  configured: boolean
  masked?: string
  source: 'ui' | 'env' | 'none'
  secretConfigured: boolean
}

interface BaseUrlStatus {
  baseUrl?: string
  source: 'ui' | 'env' | 'none'
}

let keyStatus: KeyStatus = { configured: false, source: 'none', secretConfigured: true }
let baseUrlStatus: BaseUrlStatus = { source: 'none' }
const baseUrlPuts: { baseUrl?: string }[] = []
let baseUrlDeletes = 0
const testBodies: { baseUrl?: string; key?: string }[] = []
let testResponse: { ok: true } | { ok: false; code: string } = { ok: true }

registerEndpoint(
  '/api/settings/openai-key',
  defineEventHandler(() => keyStatus),
)

registerEndpoint(
  '/api/settings/openai-key/test',
  defineEventHandler(async (event) => {
    const body = (await readBody<{ baseUrl?: string; key?: string }>(event)) ?? {}
    testBodies.push(body)
    return testResponse
  }),
)

registerEndpoint(
  '/api/settings/openai-base-url',
  defineEventHandler(async (event) => {
    const method = getMethod(event)
    if (method === 'PUT') {
      const body = await readBody<{ baseUrl?: string }>(event)
      const raw = body?.baseUrl ?? ''
      if (raw.trim() && !/^https?:\/\//i.test(raw.trim())) {
        event.node.res.statusCode = 400
        return { error: { code: 'INVALID_BASE_URL', message: 'Invalid base URL.' } }
      }
      baseUrlPuts.push(body ?? {})
      const trimmed = raw.trim().replace(/\/$/, '')
      baseUrlStatus = { baseUrl: trimmed, source: 'ui' }
      return baseUrlStatus
    }
    if (method === 'DELETE') {
      baseUrlDeletes++
      baseUrlStatus = { source: 'none' }
      return baseUrlStatus
    }
    return baseUrlStatus
  }),
)

async function mount() {
  const wrapper = await mountSuspended(OpenAiKeySettings)
  await flushPromises()
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="base-url-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="key-status"]').exists()).toBe(true)
  })
  return wrapper
}

async function ready(wrapper: Awaited<ReturnType<typeof mount>>) {
  await vi.waitFor(() => {
    expect(wrapper.find('[data-test="base-url-status"]').exists()).toBe(true)
  })
}

function val(wrapper: Awaited<ReturnType<typeof mount>>, testId: string): string {
  return (wrapper.find(`[data-test="${testId}"]`).element as HTMLInputElement).value
}

beforeAll(async () => {
  await useNuxtApp().$i18n.setLocale('en')
})

beforeEach(async () => {
  await useNuxtApp().$i18n.setLocale('en')
  keyStatus = { configured: false, source: 'none', secretConfigured: true }
  baseUrlStatus = { source: 'none' }
  baseUrlPuts.length = 0
  baseUrlDeletes = 0
  testBodies.length = 0
  testResponse = { ok: true }
})

describe('OpenAiKeySettings — API Base URL (009 · US1)', () => {
  it('renders an unmasked optional Base URL field', async () => {
    const wrapper = await mount()
    const input = wrapper.find('[data-test="base-url-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).type).not.toBe('password')
    expect(wrapper.text()).toContain('API Base URL')
    expect(wrapper.find('[data-test="base-url-save"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="base-url-clear"]').exists()).toBe(true)
  })

  it('pre-fills the field from the saved URL and shows it in full', async () => {
    baseUrlStatus = { baseUrl: 'http://localhost:4000/v1', source: 'ui' }
    const wrapper = await mount()
    await vi.waitFor(() => {
      expect(val(wrapper, 'base-url-input')).toBe('http://localhost:4000/v1')
    })
    expect(wrapper.text()).toContain('http://localhost:4000/v1')
  })

  it('saves a valid Base URL without running Test Connection', async () => {
    const wrapper = await mount()
    await ready(wrapper)
    await wrapper.find('[data-test="base-url-input"]').setValue('http://localhost:4000/v1')
    await wrapper.find('[data-test="base-url-save"]').trigger('click')
    await flushPromises()

    expect(baseUrlPuts.at(-1)).toMatchObject({ baseUrl: 'http://localhost:4000/v1' })
    expect(testBodies).toHaveLength(0)
  })

  it('clears the in-app URL via DELETE', async () => {
    baseUrlStatus = { baseUrl: 'http://localhost:4000/v1', source: 'ui' }
    const wrapper = await mount()
    await vi.waitFor(() => {
      expect(val(wrapper, 'base-url-input')).toBe('http://localhost:4000/v1')
    })
    await wrapper.find('[data-test="base-url-clear"]').trigger('click')
    await flushPromises()

    expect(baseUrlDeletes).toBe(1)
    expect(val(wrapper, 'base-url-input')).toBe('')
  })

  it('rejects an invalid URL with actionable copy and does not keep the bad value', async () => {
    const wrapper = await mount()
    await ready(wrapper)
    await wrapper.find('[data-test="base-url-input"]').setValue('not-a-url')
    await wrapper.find('[data-test="base-url-save"]').trigger('click')
    await flushPromises()

    expect(baseUrlPuts).toHaveLength(0)
    expect(wrapper.find('[data-test="base-url-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('absolute http:// or https:// URL')
  })

  it('Test Connection posts the currently shown URL and key and does not save', async () => {
    const wrapper = await mount()
    await ready(wrapper)
    await wrapper.find('[data-test="base-url-input"]').setValue('http://localhost:4000/v1')
    await wrapper.find('[data-test="key-input"]').setValue('sk-draft')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="key-test"]').attributes('disabled')).toBeFalsy()
    })
    await wrapper.find('[data-test="key-test"]').trigger('click')
    await flushPromises()
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="key-test-ok"]').exists()).toBe(true)
    })

    expect(testBodies.at(-1)).toMatchObject({
      baseUrl: 'http://localhost:4000/v1',
      key: 'sk-draft',
    })
    expect(baseUrlPuts).toHaveLength(0)
    expect(wrapper.find('[data-test="key-test-ok"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('The connection works.')
  })

  it('shows actionable copy for each Test Connection failure code', async () => {
    const cases: { code: string; needle: string }[] = [
      { code: 'NO_KEY', needle: 'No API key is configured' },
      { code: 'UNREACHABLE', needle: 'Could not reach the speech service' },
      { code: 'UNAUTHORIZED', needle: 'The API key was rejected' },
      { code: 'TIMEOUT', needle: 'did not respond in time' },
      { code: 'UNKNOWN', needle: 'connection test failed' },
    ]

    for (const { code, needle } of cases) {
      testBodies.length = 0
      testResponse = { ok: false, code }
      const wrapper = await mount()
      await ready(wrapper)
      await wrapper.find('[data-test="key-input"]').setValue('sk-draft')
      await flushPromises()
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="key-test"]').attributes('disabled')).toBeFalsy()
      })
      await wrapper.find('[data-test="key-test"]').trigger('click')
      await flushPromises()
      await vi.waitFor(() => {
        expect(wrapper.find('[data-test="key-test-fail"]').exists(), code).toBe(true)
      })
      expect(wrapper.text(), code).toContain(needle)
      wrapper.unmount()
    }
  })

  it('keeps the Base URL field enabled when in-app key storage is disabled', async () => {
    keyStatus = { configured: false, source: 'none', secretConfigured: false }
    const wrapper = await mount()
    expect(wrapper.find('[data-test="base-url-input"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="key-input"]').attributes('disabled')).toBeDefined()
  })
})
