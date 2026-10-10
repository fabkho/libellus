import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowReactive, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@/data/books'
import { DEVICE_DESCRIPTIONS_KEY, DEVICE_LIBRARY_KEY, DEVICE_LIBRARY_VERSION } from '@/data/deviceLibrary'
import type { EntryStatus, LibraryEntry } from '@/data/library'

/**
 * The Library store's reads (perf F4): Home and Library do not ask for the three lists again while
 * they are fresh, a forced load always does, and the descriptions the lists leave out are kept apart
 * on the device and asked for once. The store runs here as it does in Nuxt, with the auto-imports it
 * uses stood in for, a repository that counts its calls and a `localStorage`.
 */

const BOOK_A = '11111111-1111-4111-8111-111111111111'
const BOOK_B = '22222222-2222-4222-8222-222222222222'
const BOOK_C = '33333333-3333-4333-8333-333333333333'

const book = (id: string, description: string | null = null): Book => ({
  id,
  createdAt: '2026-10-01T00:00:00Z',
  title: `Book ${id.slice(0, 1)}`,
  authors: ['A. Writer'],
  isbn13: null,
  isbn10: null,
  pageCount: 200,
  year: 2020,
  language: 'en',
  publisher: null,
  description,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: null,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})
const entry = (id: string, status: EntryStatus, b: Book): LibraryEntry => ({
  id,
  status,
  addedAt: '2026-10-01T00:00:00Z',
  book: b,
  pageCountOverride: null,
  formatOverride: null,
  readAs: null,
  hidden: false,
  latestSession: null,
})

const online = ref(true)
const calls = { entries: 0, readInYear: 0, descriptions: [] as string[][] }
let server: Record<EntryStatus, LibraryEntry[]> = { want_to_read: [], reading: [], finished: [] }
const catalogue = new Map<string, string | null>()

const repository = {
  entries: async (status: EntryStatus) => {
    calls.entries++
    return { data: server[status], error: null }
  },
  readInYear: async () => {
    calls.readInYear++
    return { data: 3, error: null }
  },
  descriptions: async (ids: readonly string[]) => {
    calls.descriptions.push([...ids])
    return { data: new Map(ids.filter((id) => catalogue.has(id)).map((id) => [id, catalogue.get(id)!] as const)), error: null }
  },
}
vi.mock('~/data/library', async (original) => ({ ...(await original<typeof import('~/data/library')>()), createLibrary: () => repository }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada', email: 'ada@x.test' } }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ markAdded: () => {}, markRemoved: () => {}, reset: () => {}, repository: () => ({}) }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ items: [], queue: { open: () => false } }) }))

function memoryLocalStorage() {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}
let storage = memoryLocalStorage()
const pinias: ReturnType<typeof createPinia>[] = []

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('shallowReactive', shallowReactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useOnline', () => online)
  vi.stubGlobal('isOnline', () => online.value)
  vi.stubGlobal('window', { localStorage: storage, addEventListener: () => {} })
  vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' })
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
  const { useLibraryStore } = await import('~/stores/library')
  return useLibraryStore()
}

/** The browser's idle moments: the store's background work runs when the test says so. */
const idle = () => vi.advanceTimersByTimeAsync(10_000)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  online.value = true
  calls.entries = 0
  calls.readInYear = 0
  calls.descriptions = []
  catalogue.clear()
  storage = memoryLocalStorage()
  server = { want_to_read: [entry('e1', 'want_to_read', book(BOOK_A))], reading: [], finished: [entry('e2', 'finished', book(BOOK_B))] }
})
afterEach(() => {
  // The stores' watchers (the connection coming back) end with the test.
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('stale-while-revalidate', () => {
  it('asks for the lists once, and again only after the window or when forced', async () => {
    const library = await store()
    await library.load({ ifStale: true })
    expect(calls.entries).toBe(3)

    // A run of tab switches inside the window: no request.
    for (let i = 0; i < 5; i++) await library.load({ ifStale: true })
    expect(calls.entries).toBe(3)

    // Forced (back online, the outbox drained, an import): always asks.
    await library.load()
    expect(calls.entries).toBe(6)

    // Past the window: asked again, and what it holds is what the server says now.
    server = { ...server, reading: [entry('e3', 'reading', book(BOOK_C))] }
    await vi.advanceTimersByTimeAsync(61_000)
    await library.load({ ifStale: true })
    expect(calls.entries).toBe(9)
    expect(library.reading.map((e) => e.id)).toEqual(['e3'])
  })

  it('two asks while the first is on its way are one request', async () => {
    const library = await store()
    await Promise.all([library.load({ ifStale: true }), library.load({ ifStale: true })])
    expect(calls.entries).toBe(3)
  })

  it('a copy from the device is not fresh: the first visit asks, showing the copy meanwhile', async () => {
    storage.setItem(
      DEVICE_LIBRARY_KEY,
      JSON.stringify({
        version: DEVICE_LIBRARY_VERSION,
        data: { member: { id: 'ada', email: 'ada@x.test' }, savedAt: '2026-10-01T00:00:00Z', lists: { want_to_read: [entry('e1', 'want_to_read', book(BOOK_A))], reading: [], finished: [] }, readInYear: null },
      }),
    )
    const library = await store()
    expect(library.loaded).toBe(true)
    expect(library.wantToRead).toHaveLength(1)
    await library.load({ ifStale: true })
    expect(calls.entries).toBe(3)
  })

  it('a failed load is asked again at the next visit, and offline nothing is asked', async () => {
    const library = await store()
    const failing = vi.spyOn(repository, 'entries').mockResolvedValue({ data: null, error: 'unknown' } as never)
    await library.load({ ifStale: true })
    expect(library.loadError).toBe('unknown')
    failing.mockRestore()
    await library.load({ ifStale: true })
    expect(library.loadError).toBeNull()
    expect(library.finished).toHaveLength(1)

    online.value = false
    await vi.advanceTimersByTimeAsync(61_000)
    const before = calls.entries
    await library.load({ ifStale: true })
    expect(calls.entries).toBe(before)
  })

  it('a change made here stays in the lists across a fresh visit', async () => {
    const library = await store()
    await library.load({ ifStale: true })
    library.entryChanged(entry('e1', 'reading', book(BOOK_A)))
    await library.load({ ifStale: true })
    expect(library.reading.map((e) => e.id)).toEqual(['e1'])
    expect(library.wantToRead).toEqual([])
    expect(calls.entries).toBe(3)
  })

  it('the year count is asked once inside the window too, and again when forced', async () => {
    const library = await store()
    await library.loadReadInYear({ ifStale: true })
    await library.loadReadInYear({ ifStale: true })
    expect(calls.readInYear).toBe(1)
    expect(library.readInYear).toBe(3)
    await library.loadReadInYear()
    expect(calls.readInYear).toBe(2)
    await vi.advanceTimersByTimeAsync(61_000)
    await library.loadReadInYear({ ifStale: true })
    expect(calls.readInYear).toBe(3)
  })
})

describe('descriptions', () => {
  it('the lists carry none: the store asks for the ones it lacks once idle, keeps them, and asks only for new Books afterwards', async () => {
    catalogue.set(BOOK_A, 'About A.')
    catalogue.set(BOOK_B, null)
    const library = await store()
    await library.load({ ifStale: true })
    expect(library.descriptionOf(book(BOOK_A))).toBeNull()

    await idle()
    expect(calls.descriptions).toEqual([[BOOK_A, BOOK_B]])
    expect(library.descriptionOf(book(BOOK_A))).toBe('About A.')
    expect(library.descriptionOf(book(BOOK_B))).toBeNull()
    expect(JSON.parse(storage.getItem(DEVICE_DESCRIPTIONS_KEY)!).data.descriptions).toEqual({ [BOOK_A]: 'About A.', [BOOK_B]: '' })

    // Nothing missing: nothing asked. A Book added since is the only one asked for.
    await library.load()
    await idle()
    expect(calls.descriptions).toHaveLength(1)
    catalogue.set(BOOK_C, 'About C.')
    server = { ...server, reading: [entry('e3', 'reading', book(BOOK_C))] }
    await library.load()
    await idle()
    expect(calls.descriptions).toEqual([[BOOK_A, BOOK_B], [BOOK_C]])
  })

  it('a next start has them from the device, offline too, without asking', async () => {
    catalogue.set(BOOK_A, 'About A.')
    const first = await store()
    await first.load({ ifStale: true })
    await idle()
    calls.descriptions = []

    online.value = false
    const second = await store() // a new store set up on the same storage
    expect(second.descriptionOf(book(BOOK_A))).toBe('About A.')
    await idle()
    expect(calls.descriptions).toEqual([])
  })

  it('the book page\'s own read is remembered, and a copy from before the lists left them out keeps its own', async () => {
    storage.setItem(
      DEVICE_LIBRARY_KEY,
      JSON.stringify({
        version: DEVICE_LIBRARY_VERSION,
        data: { member: { id: 'ada', email: 'ada@x.test' }, savedAt: '2026-10-01T00:00:00Z', lists: { want_to_read: [entry('e1', 'want_to_read', book(BOOK_A, 'Old copy A.'))], reading: [], finished: [] }, readInYear: null },
      }),
    )
    const library = await store()
    expect(library.descriptionOf(book(BOOK_A))).toBe('Old copy A.')
    library.rememberDescription(BOOK_B, 'About B, from its page.')
    expect(library.descriptionOf(book(BOOK_B))).toBe('About B, from its page.')
    // A Book with a description of its own is believed over the device's.
    expect(library.descriptionOf(book(BOOK_B, 'Its own.'))).toBe('Its own.')
  })

  it('a Book a snapshot added with a description keeps it when the database\'s entry replaces the snapshot', async () => {
    const library = await store()
    await library.load({ ifStale: true })
    library.entryChanged(entry('e9', 'want_to_read', book(BOOK_C, 'From the search result.')))
    expect(library.descriptionOf(book(BOOK_C))).toBe('From the search result.')
  })
})
