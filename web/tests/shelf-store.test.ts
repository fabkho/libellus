import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A member's shelf (stores/shelf.ts): its library document is built only once a shelf screen asks
 * for it (`load`), and only once the blurbs of her Books are in (`ensureDescriptions`), so every
 * back Regal prints carries its blurb; a slow answer is waited for at most BLURB_WAIT, then the
 * Books come without and once more when the blurbs are in.
 */

type Entry = { id: string; book: { id: string; description?: string | null } }

let blurbsIn: () => void = () => {}
const blurbs = new Map<string, string>()
const library = reactive({
  loaded: false,
  reading: [] as Entry[],
  finished: [] as Entry[],
  loadError: null as string | null,
  load: vi.fn(async () => {
    library.loaded = true
  }),
  descriptionOf: (book: { id: string }) => blurbs.get(book.id) ?? null,
  ensureDescriptions: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        blurbsIn = resolve
      }),
  ),
})

vi.mock('~/stores/library', () => ({ useLibraryStore: () => library }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada', email: 'ada@x.test' } }) }))
// The document as built: each Book with the blurb the device knew at that moment.
vi.mock('~/data/memberShelf', () => ({
  memberShelfDocument: (entries: Entry[], options: { descriptionOf: (book: Entry['book']) => string | null }) => ({
    books: entries.map((entry) => ({ id: entry.book.id, description: options.descriptionOf(entry.book) })),
  }),
}))
vi.mock('~/data/shelf', () => ({
  shelfOf: (doc: { books: unknown[] }) => ({ books: doc.books }),
  booksReadIn: () => [],
  createShelf: () => ({ load: async () => ({ data: null, error: 'offline' }) }),
}))

const pinias: ReturnType<typeof createPinia>[] = []
async function store() {
  vi.stubGlobal('useRequestURL', () => new URL('https://app.example.com/'))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { regal: { librarySrc: 'https://books.example/library.json' }, shelfOwnerId: 'the-owner' } }))
  vi.stubGlobal('useAppConfig', () => ({ regal: true }))
  // The hosts her shelf's covers are drawn with, read at setup (composables/useCoverHosts.ts): the store keeps them direct.
  vi.stubGlobal('useCoverHosts', () => ({ proxy: true, own: false }))
  vi.stubGlobal('useOnline', () => ref(true))
  vi.stubGlobal('isOnline', () => true)
  vi.stubGlobal('reportError', () => {})
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
  const { useShelfStore } = await import('~/stores/shelf')
  return useShelfStore()
}

const entry = (id: string): Entry => ({ id: `e-${id}`, book: { id } })
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  library.loaded = false
  library.reading = []
  library.finished = [entry('a'), entry('b')]
  library.ensureDescriptions.mockClear()
  blurbs.clear()
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a member's shelf document", () => {
  it('is not built before a shelf screen asks for it', async () => {
    const shelf = await store()
    library.loaded = true
    await flush()
    expect(shelf.document).toBeNull()
    expect(library.ensureDescriptions).not.toHaveBeenCalled()
  })

  it('waits for the blurbs, then carries them', async () => {
    const shelf = await store()
    await shelf.load()
    await flush()
    expect(library.ensureDescriptions).toHaveBeenCalled()
    expect(shelf.document).toBeNull()

    blurbs.set('a', 'About A.')
    blurbsIn()
    await flush()
    expect(shelf.document?.books).toEqual([
      { id: 'a', description: 'About A.' },
      { id: 'b', description: null },
    ])
  })

  it('a slow answer: the Books come without after the wait, and again with the blurbs once they are in', async () => {
    const shelf = await store()
    await shelf.load()
    await vi.advanceTimersByTimeAsync(3000)
    const first = shelf.document
    expect(first?.books).toEqual([
      { id: 'a', description: null },
      { id: 'b', description: null },
    ])

    blurbs.set('a', 'About A.')
    blurbsIn()
    await flush()
    expect(shelf.document).not.toBe(first)
    expect(shelf.document?.books[0]).toEqual({ id: 'a', description: 'About A.' })
  })

  it('a list that changes builds again, after its new Books\u2019 blurbs', async () => {
    const shelf = await store()
    await shelf.load()
    blurbsIn()
    await flush()
    const first = shelf.document

    library.finished = [...library.finished, entry('c')]
    await flush()
    expect(shelf.document).toBe(first)
    blurbs.set('c', 'About C.')
    blurbsIn()
    await flush()
    expect(shelf.document?.books.at(-1)).toEqual({ id: 'c', description: 'About C.' })
  })
})
