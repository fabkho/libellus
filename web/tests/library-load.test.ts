import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, readonly, ref, shallowReactive, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Library store's load, one at a time. Home loads the Library each time it is shown again,
 * so every Book page closed back into Home asked for the whole Library anew, whether or not the
 * last ask had come back. On a slow connection with a few hundred Books the reads piled up faster
 * than they came in (55 at once after a dozen round-trips: e2e/perf/flight-soak.spec.ts) and
 * starved the Book page's own reads until the pile had drained. A load asked while one is on its
 * way now starts none of its own: one more follows the one on its way, for all that asked.
 *
 * The store runs as in Nuxt, its auto-imports stood in for; the Library's reads answer when the
 * test lets them.
 */

const online = ref(true)
/** Each read of a Status list asked for, answered by `answer()`. */
let reads: { status: string; answer: () => void }[] = []

vi.mock('~/data/library', async (actual) => ({
  ...(await actual<typeof import('~/data/library')>()),
  createLibrary: () => ({
    entries: (status: string) =>
      new Promise((resolve) => reads.push({ status, answer: () => resolve({ data: [], error: null }) })),
  }),
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ reset: () => undefined, markRemoved: () => undefined }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ items: [], queue: () => undefined }) }))

let pinia: ReturnType<typeof createPinia> | null = null

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('shallowReactive', shallowReactive)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  // The store keeps the device's copy as it does in the browser (the vitest config reads `import.meta.client` as true for it).
  const storage = { length: 0, key: () => null, getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  vi.stubGlobal('window', { localStorage: storage, addEventListener: () => undefined })
  vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' })
  pinia = createPinia()
  setActivePinia(pinia)
  const { useLibraryStore } = await import('~/stores/library')
  return useLibraryStore()
}

/** Lets every promise that can settle settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Answers every read asked so far, and lets what follows from them run. */
async function answerAll() {
  const now = reads
  reads = []
  for (const read of now) read.answer()
  await settle()
}

beforeEach(() => {
  online.value = true
  reads = []
})
afterEach(() => {
  ;(pinia as unknown as { _e: { stop(): void } } | null)?._e.stop()
  vi.unstubAllGlobals()
})

describe('loading the Library', () => {
  it('asks once for each Status list', async () => {
    const library = await store()
    const loaded = library.load()
    expect(reads.map((read) => read.status).sort()).toEqual(['finished', 'reading', 'want_to_read'])
    await answerAll()
    await loaded
    expect(library.loaded).toBe(true)
  })

  it('starts no second read while one is on its way: one more load follows it, for all that asked', async () => {
    const library = await store()
    const first = library.load()
    // Home shown again fifteen times before the Library has come back.
    const later = Array.from({ length: 15 }, () => library.load())
    expect(reads).toHaveLength(3)

    await answerAll()
    await first
    await settle()
    // The one load that follows, asked after all fifteen.
    expect(reads).toHaveLength(3)
    await answerAll()
    await Promise.all(later)
    // And nothing after it.
    expect(reads).toHaveLength(0)
  })

  it('asks again when asked after a load has come back', async () => {
    const library = await store()
    const first = library.load()
    await answerAll()
    await first
    const second = library.load()
    expect(reads).toHaveLength(3)
    await answerAll()
    await second
    expect(reads).toHaveLength(0)
  })
})
