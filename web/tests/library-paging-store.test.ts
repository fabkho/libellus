import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowReactive, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntryRow } from '@/data/library'
import { fakeClient, library } from './support/fakeClient'

/**
 * The Library store over the real repository and a client that pages like the server (1,000 rows
 * an answer; support/fakeClient.ts): a Library of 2,500 finished entries is shown whole, and a
 * read that fails on its second page leaves the good Library as it was. The three lists are
 * applied together or not at all, so the screens never show a partial Library for a whole one.
 */

const online = ref(true)
const pinias: ReturnType<typeof createPinia>[] = []
let table: EntryRow[] = []
/** The page (`from`) of the finished list that fails, or null. */
let failFrom: number | null = null

vi.mock('~/data/library', async (original) => {
  const actual = await original<typeof import('~/data/library')>()
  return {
    ...actual,
    createLibrary: () =>
      actual.createLibrary(
        fakeClient(
          (asked) => (asked.filters.includes('eq:status,finished') ? table : []),
          (asked) => failFrom !== null && asked.filters.includes('eq:status,finished') && asked.from === failFrom,
        ).client,
      ),
  }
})
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada', email: 'ada@x.test' } }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ markAdded: () => {}, markRemoved: () => {}, reset: () => {}, repository: () => ({}) }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ items: [], queue: { open: () => false } }) }))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('shallowReactive', shallowReactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useOnline', () => online)
  vi.stubGlobal('isOnline', () => online.value)
  const map = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      get length() {
        return map.size
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    addEventListener: () => {},
  })
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
  const { useLibraryStore } = await import('~/stores/library')
  return useLibraryStore()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  online.value = true
  failFrom = null
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the Library store over a server that cuts at 1,000 rows', () => {
  it('shows all 2,500 finished entries', async () => {
    table = library(2500)
    const lib = await store()
    await lib.load()
    expect(lib.loadError).toBeNull()
    expect(lib.finished).toHaveLength(2500)
  })

  it('a failure on page 2 leaves the good Library as it was, with the error to show', async () => {
    table = library(2500)
    const lib = await store()
    await lib.load()
    const before = lib.finished
    expect(before).toHaveLength(2500)

    // The Library grew; the next read dies on its second page.
    table = library(2600)
    failFrom = 1000
    await lib.load()
    expect(lib.loadError).toBe('unknown')
    expect(lib.finished).toBe(before)
    expect(lib.finished).toHaveLength(2500)
    expect(lib.loaded).toBe(true)

    // The next read, whole, replaces it.
    failFrom = null
    await lib.load()
    expect(lib.loadError).toBeNull()
    expect(lib.finished).toHaveLength(2600)
  })

  it('a failure on page 2 of a first read shows no partial Library either', async () => {
    table = library(2500)
    failFrom = 1000
    const lib = await store()
    await lib.load()
    expect(lib.loadError).toBe('unknown')
    expect(lib.loaded).toBe(false)
    expect(lib.finished).toHaveLength(0)
  })
})
