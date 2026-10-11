import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@/data/books'
import type { CollectionSummary } from '@/data/collections'
import type { LibraryEntry } from '@/data/library'
import { heldOrder } from '@/utils/editedOrder'

/**
 * Collections are listed by last edited (docs/parity.md, Collections): the store stamps a Collection it
 * changes and moves it to the top at once, with or without a connection (the change waits in the outbox, the
 * repository's answer is the same), and a screen being looked at holds the order it took on entering. The
 * store runs here as in Nuxt, with the auto-imports it uses stood in for, a repository that answers like
 * the one in the data layer and the other stores stubbed.
 */

const online = ref(true)
const T0 = Date.parse('2026-10-20T08:00:00Z')

const summary = (id: string, name: string, updatedAt: string, count = 1): CollectionSummary => ({
  id,
  name,
  position: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt,
  count,
  covers: [],
})
const SCIFI = summary('scifi', 'Sci-fi', '2026-10-03T00:00:00Z')
const GIFTS = summary('gifts', 'Gifts', '2026-10-02T00:00:00Z')
const CLASSICS = summary('classics', 'Classics', '2026-10-01T00:00:00Z')

const book = (id: string): Book => ({
  id,
  createdAt: '2026-10-01T00:00:00Z',
  title: `Book ${id}`,
  authors: ['A. Writer'],
  isbn13: null,
  isbn10: null,
  pageCount: 200,
  year: 2020,
  language: 'en',
  publisher: null,
  description: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: null,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})
const entry = (id: string): LibraryEntry => ({
  id,
  status: 'want_to_read',
  addedAt: '2026-10-01T00:00:00Z',
  book: book(`b-${id}`),
  pageCountOverride: null,
  formatOverride: null,
  readAs: null,
  hidden: false,
  latestSession: null,
})

let server: CollectionSummary[] = []
let outbox = 0
const repository = {
  list: async () => ({ data: server, error: null }),
  get: async (id: string) => ({ data: null, error: null, id }),
  memberships: async () => ({ data: [] as string[], error: null }),
  create: async (name: string) => ({ data: summary('new', name, new Date().toISOString(), 0), error: null }),
  rename: async (id: string, name: string) => ({ data: { ...server.find((c) => c.id === id)!, name }, error: null }),
  delete: async () => ({ data: true, error: null }),
  addEntry: async (_id: string, b: Book) => ({ data: entry(`e-${b.id}`), error: null }),
  removeEntry: async () => ({ data: true, error: null }),
  reorder: async () => ({ data: true, error: null }),
}

vi.mock('~/data/collections', async (original) => ({
  ...(await original<typeof import('~/data/collections')>()),
  createCollections: () => repository,
}))
vi.mock('~/stores/library', () => ({ useLibraryStore: () => ({ entryChanged: () => undefined }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ repository: () => ({}) }) }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => reactive({ get pending() { return outbox }, queue: undefined }) }))

let pinia: ReturnType<typeof createPinia> | null = null
async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useOnline', () => online)
  vi.stubGlobal('isOnline', () => online.value)
  pinia = createPinia()
  setActivePinia(pinia)
  const { useCollectionsStore } = await import('~/stores/collections')
  const collections = useCollectionsStore()
  await collections.loadList()
  return collections
}
const names = (list: readonly { name: string }[]) => list.map((c) => c.name)

beforeEach(() => {
  online.value = true
  outbox = 0
  server = [CLASSICS, SCIFI, GIFTS]
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  ;(pinia as unknown as { _e: { stop(): void } } | null)?._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the list the store keeps', () => {
  it('is last edited first, whatever order the repository answered in', async () => {
    const collections = await store()
    expect(names(collections.list)).toEqual(['Sci-fi', 'Gifts', 'Classics'])
  })

  it('moves a Collection to the top at once when it is renamed', async () => {
    const collections = await store()
    expect(await collections.rename('classics', 'Old books')).toBeNull()
    expect(names(collections.list)).toEqual(['Old books', 'Sci-fi', 'Gifts'])
    expect(collections.list[0]!.updatedAt).toBe(new Date(T0).toISOString())
  })

  it('moves a Collection to the top when a Book is put on it, even offline with writes waiting', async () => {
    const collections = await store()
    online.value = false
    outbox = 1
    const result = await collections.addBook('gifts', book('one'))
    expect(result.error).toBeNull()
    expect(names(collections.list)).toEqual(['Gifts', 'Sci-fi', 'Classics'])
    expect(collections.list[0]).toMatchObject({ id: 'gifts', count: 2, updatedAt: new Date(T0).toISOString() })
    // Offline the device's copy stands: a read does not undo it.
    await collections.loadList()
    expect(names(collections.list)).toEqual(['Gifts', 'Sci-fi', 'Classics'])
  })

  it('moves a Collection to the top when a Book is taken off it (a Collection not opened here), and later edits win', async () => {
    const collections = await store()
    online.value = false
    outbox = 1
    expect(await collections.removeEntry('classics', 'e1')).toBeNull()
    expect(names(collections.list)).toEqual(['Classics', 'Sci-fi', 'Gifts'])
    expect(collections.list[0]!.count).toBe(0)

    vi.setSystemTime(T0 + 60_000)
    await collections.rename('gifts', 'Presents')
    expect(names(collections.list)).toEqual(['Presents', 'Classics', 'Sci-fi'])
  })

  it('keeps a Collection in place when only the cover of a Book on it changed (a new edition)', async () => {
    const collections = await store()
    collections.entryChanged(entry('e1'))
    expect(names(collections.list)).toEqual(['Sci-fi', 'Gifts', 'Classics'])
  })

  it('ties break by name', async () => {
    const same = '2026-10-05T00:00:00Z'
    server = [summary('b', 'beta', same), summary('a', 'Alpha', same), summary('c', 'Charlie', same)]
    const collections = await store()
    expect(names(collections.list)).toEqual(['Alpha', 'beta', 'Charlie'])
  })

  it('takes a new Collection to the top', async () => {
    const collections = await store()
    vi.setSystemTime(T0 + 1000)
    const made = await collections.create('Fresh')
    expect(made.error).toBeNull()
    expect(names(collections.list)).toEqual(['Fresh', 'Sci-fi', 'Gifts', 'Classics'])
  })
})

describe('a screen that is being looked at', () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id }))
  const ids = (list: readonly { id: string }[]) => list.map((x) => x.id)

  it('holds the order it took, whatever the list does meanwhile', () => {
    // She entered with a, b, c; then c was edited and went to the top of the list.
    expect(ids(heldOrder(['a', 'b', 'c'], rows('c', 'a', 'b'), 'first'))).toEqual(['a', 'b', 'c'])
  })

  it('drops a Collection that is gone and puts a new one at the top of the page, the end of the picker', () => {
    expect(ids(heldOrder(['a', 'b', 'c'], rows('n', 'c', 'a'), 'first'))).toEqual(['n', 'a', 'c'])
    expect(ids(heldOrder(['a', 'b', 'c'], rows('n', 'c', 'a'), 'last'))).toEqual(['a', 'c', 'n'])
  })

  it('shows everything, in the list\'s order, when it entered with nothing', () => {
    expect(ids(heldOrder([], rows('c', 'a', 'b'), 'first'))).toEqual(['c', 'a', 'b'])
  })

  it('shows the Collection\'s current data in the held place', () => {
    const now = [{ id: 'c', name: 'C, renamed' }, { id: 'a', name: 'A' }]
    expect(heldOrder(['a', 'c'], now, 'first')).toEqual([{ id: 'a', name: 'A' }, { id: 'c', name: 'C, renamed' }])
  })
})
