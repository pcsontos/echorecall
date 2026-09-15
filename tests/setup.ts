// Global Vitest setup. Intentionally minimal: tests inject their own fakes
// and use temp directories, so no global mocks are required here.
//
// Node 22 exposes an experimental `localStorage` global that is undefined
// without `--localstorage-file`, which shadows happy-dom's window storage and
// breaks component tests that call `localStorage.clear()` in beforeEach.
import { beforeEach, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
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
}

function installLocalStorage(storage: Storage): void {
  const g = globalThis as typeof globalThis & {
    localStorage?: Storage
    window?: Window & { localStorage: Storage }
  }
  vi.stubGlobal('localStorage', storage)
  try {
    Object.defineProperty(g, 'localStorage', { configurable: true, writable: true, value: storage })
  } catch {
    // Node's experimental getter may be non-configurable.
  }
  if (g.window) {
    try {
      Object.defineProperty(g.window, 'localStorage', { configurable: true, value: storage })
    } catch {
      // happy-dom may already own a non-configurable storage.
    }
  }
}

const sharedStorage = memoryStorage()
installLocalStorage(sharedStorage)
beforeEach(() => {
  installLocalStorage(sharedStorage)
})

export {}
