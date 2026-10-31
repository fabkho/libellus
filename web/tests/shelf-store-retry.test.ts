import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The owner's shelf is his published library file (stores/shelf.ts). When it cannot be had (a CORS refusal,
 * a failed fetch) his shelf is built from his Library like everyone's, with no error shown; the next `load`
 * (the retry) asks for the file again past the browser's cache (which can hold the failed answer: asking again
 * was answered by it, and Try again did nothing) and shows the file once it comes.
 */
const FIXTURE = readFileSync(new URL('./fixtures/shelf/library.json', import.meta.url), 'utf8')
const SRC = 'https://books.example/v2/library.json'

type Entry = { id: string; book: { id: string } }
const library = reactive({
  loaded: false,
  reading: [] as Entry[],
  finished: [] as Entry[],
  loadError: null as string | null,
  load: vi.fn(async () => {
    library.loaded = true
  }),
  descriptionOf: () => null,
  ensureDescriptions: vi.fn(async () => undefined),
})
const session = reactive({ member: { id: 'the-owner', email: 'owner@x.test' } as { id: string; email: string } | null })

vi.mock('~/stores/library', () => ({ useLibraryStore: () => library }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
// Her Library's shelf, two Books of the fixture: told apart from the published file's eight.
vi.mock('~/data/memberShelf', () => ({
  memberShelfDocument: () => {
    const file = JSON.parse(FIXTURE) as { books: unknown[] }
    return { ...file, books: file.books.slice(0, 2) }
  },
}))

const pinias: ReturnType<typeof createPinia>[] = []
const reportError = vi.fn()
let online = true
async function store() {
  vi.stubGlobal('useRequestURL', () => new URL('https://app.example.com/'))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { regal: { librarySrc: SRC }, shelfOwnerId: 'the-owner' } }))
  vi.stubGlobal('useAppConfig', () => ({ regal: true }))
  // The hosts her shelf's covers are drawn with, read at setup (composables/useCoverHosts.ts): the store keeps them direct.
  vi.stubGlobal('useCoverHosts', () => ({ proxy: true, own: false }))
  vi.stubGlobal('useOnline', () => ref(true))
  vi.stubGlobal('isOnline', () => online)
  vi.stubGlobal('reportError', reportError)
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
  const { useShelfStore } = await import('~/stores/shelf')
  return useShelfStore()
}

const entry = (id: string): Entry => ({ id: `e-${id}`, book: { id } })
const flush = () => vi.advanceTimersByTimeAsync(0)
/** What the browser does with a file whose CORS answer failed once: the same failure again, until the cache is gone. */
function flaky(failures: number) {
  const asked: Array<[string, RequestInit | undefined]> = []
  let failed = 0
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    asked.push([String(input), init])
    if (failed < failures) {
      failed++
      throw new TypeError('Failed to fetch')
    }
    return new Response(FIXTURE)
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, asked }
}

beforeEach(() => {
  vi.useFakeTimers()
  online = true
  session.member = { id: 'the-owner', email: 'owner@x.test' }
  library.loaded = false
  library.loadError = null
  library.reading = []
  library.finished = [entry('a'), entry('b')]
  library.load.mockClear()
  reportError.mockClear()
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("the owner's shelf when the published file fails", () => {
  it('falls back to her Library with no error, and logs it once', async () => {
    const { fetch } = flaky(Infinity)
    const shelf = await store()
    expect(shelf.source).toBe('published')

    await shelf.load()
    await flush()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(shelf.source).toBe('member')
    expect(shelf.loadError).toBeNull()
    expect(library.load).toHaveBeenCalled()
    expect(shelf.shelf?.books).toHaveLength(2)

    // Again, failing the same way: still quiet, not logged again.
    await shelf.load()
    await flush()
    expect(shelf.loadError).toBeNull()
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('Try again fetches the file once more, past the cache, and shows it when it comes', async () => {
    const { asked } = flaky(1)
    const shelf = await store()

    await shelf.load()
    await flush()
    expect(shelf.source).toBe('member')
    expect(shelf.shelf?.books).toHaveLength(2)

    const retry = shelf.load()
    expect(shelf.loading).toBe(true)
    await retry
    await flush()

    expect(shelf.loading).toBe(false)
    expect(shelf.source).toBe('published')
    expect(shelf.loadError).toBeNull()
    expect(shelf.shelf?.books).toHaveLength(8)
    // The first ask is plain; the retry skips what the browser kept of the failure.
    expect(asked.map(([, init]) => init)).toEqual([{ credentials: 'omit' }, { credentials: 'omit', cache: 'reload' }])
  })

  it('a Library that did not load is an error with a retry that loads it again', async () => {
    flaky(Infinity)
    library.load.mockImplementationOnce(async () => {
      library.loadError = 'unreachable'
    })
    const shelf = await store()

    await shelf.load()
    await flush()
    expect(shelf.shelf).toBeNull()
    expect(shelf.loadError).toBe('unreachable')

    library.load.mockImplementationOnce(async () => {
      library.loadError = null
      library.loaded = true
    })
    const retry = shelf.load()
    expect(shelf.loading).toBe(true)
    await retry
    await flush()
    expect(shelf.loading).toBe(false)
    expect(shelf.loadError).toBeNull()
    expect(shelf.shelf?.books).toHaveLength(2)
  })

  it('offline is no fault and not logged', async () => {
    online = false
    flaky(Infinity)
    const shelf = await store()
    await shelf.load()
    await flush()
    expect(shelf.loadError).toBeNull()
    expect(reportError).not.toHaveBeenCalled()
  })
})
