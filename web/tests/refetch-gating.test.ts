import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionSummary } from '@/data/collections'
import { createFreshness } from '@/utils/fresh'

/**
 * Refetch gating beyond Home and Library (perf, after #255): the Profile's record, the genres and the
 * Collections' list are not asked for again within the freshness window of their last answer
 * (`load({ ifStale })`, utils/fresh.ts), and a change of the member's own forgets that at once. The
 * stores run as in Nuxt, with the auto-imports they use stood in for, a repository that counts its
 * calls and a Library store that only says what changed (the real one is covered in
 * tests/library-fresh.test.ts, `change signals`).
 */

const WINDOW = 60_000

// ------------------------------------------------------------------ the rule

describe('createFreshness', () => {
  let now = 0
  const clock = () => now
  beforeEach(() => (now = 1_000))

  it('nothing is fresh until a read has landed', () => {
    const fresh = createFreshness({ now: clock, ms: WINDOW })
    expect(fresh.isFresh()).toBe(false)
    fresh.ask()
    expect(fresh.isFresh()).toBe(false)
  })

  it('a landed read stands for the window from when it was asked, not from when it landed', () => {
    const fresh = createFreshness({ now: clock, ms: WINDOW })
    const ticket = fresh.ask()
    now += 5_000
    fresh.landed(ticket)
    now += WINDOW - 5_001
    expect(fresh.isFresh()).toBe(true)
    now += 2
    expect(fresh.isFresh()).toBe(false)
  })

  it('a change forgets it, and a read asked before the change never makes the data fresh', () => {
    const fresh = createFreshness({ now: clock, ms: WINDOW })
    fresh.landed(fresh.ask())
    expect(fresh.isFresh()).toBe(true)
    fresh.invalidate()
    expect(fresh.isFresh()).toBe(false)

    const before = fresh.ask()
    fresh.invalidate()
    expect(fresh.outdated(before)).toBe(true)
    fresh.landed(before)
    expect(fresh.isFresh()).toBe(false)

    const after = fresh.ask()
    expect(fresh.outdated(after)).toBe(false)
    fresh.landed(after)
    expect(fresh.isFresh()).toBe(true)
  })

  it('a window of 0 (the e2e build) is never fresh', () => {
    const fresh = createFreshness({ now: clock, ms: 0 })
    fresh.landed(fresh.ask())
    expect(fresh.isFresh()).toBe(false)
  })
})

// ---------------------------------------------------------------- the stores

const online = ref(true)
const pinias: ReturnType<typeof createPinia>[] = []
const session = reactive({ member: { id: 'ada', email: 'ada@x.test' } as { id: string; email: string } | null })
/** What the Library store tells the others: `changes` (any change of hers) and `roster` (entries came or went). */
const libraryStub = reactive({ changes: 0, roster: 0 })

const calls = { record: 0, genres: 0, list: 0, genresWrites: 0 }
let recordAnswer: () => Promise<unknown> = async () => ({ data: emptyRecord(), error: null })
const emptyRecord = () => ({ reads: [], wantToRead: 0, reading: 0, days: [], daysSince: null })
let genresAnswer: () => Promise<unknown> = async () => ({ data: [], error: null })
let listAnswer: () => Promise<unknown> = async () => ({ data: [], error: null })
let renameAnswer: () => Promise<unknown> = async () => ({ data: { name: 'Renamed' }, error: null })

vi.mock('~/data/stats', async (original) => ({
  ...(await original<typeof import('~/data/stats')>()),
  createStats: () => ({
    record: () => {
      calls.record++
      return recordAnswer()
    },
  }),
}))
vi.mock('~/data/enrich/bookGenres', () => ({
  createBookGenres: () => ({
    library: () => {
      calls.genres++
      return genresAnswer()
    },
    forBook: async () => ({ data: { genres: [], overridden: false }, error: null }),
    set: async (_entry: string, genres: string[]) => ({ data: genres, error: null }),
    reset: async () => ({ data: [], error: null }),
  }),
}))
vi.mock('~/data/collections', async (original) => ({
  ...(await original<typeof import('~/data/collections')>()),
  createCollections: () => ({
    list: () => {
      calls.list++
      return listAnswer()
    },
    rename: () => renameAnswer(),
  }),
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('~/stores/library', () => ({ useLibraryStore: () => libraryStub }))
vi.mock('~/stores/libraryView', () => ({ useLibraryViewStore: () => ({ provideGenres: () => {} }) }))
vi.mock('~/stores/search', () => ({ useSearchStore: () => ({ repository: () => ({}) }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ pending: 0, queue: { open: () => false } }) }))

function stubNuxt() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('toRaw', toRaw)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useOnline', () => online)
  vi.stubGlobal('isOnline', () => online.value)
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null } })
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  online.value = true
  session.member = { id: 'ada', email: 'ada@x.test' }
  libraryStub.changes = 0
  libraryStub.roster = 0
  Object.assign(calls, { record: 0, genres: 0, list: 0, genresWrites: 0 })
  recordAnswer = async () => ({ data: emptyRecord(), error: null })
  genresAnswer = async () => ({ data: [{ entryId: 'e1', bookId: 'b1', genres: ['fantasy'], overridden: false }], error: null })
  listAnswer = async () => ({ data: [] as CollectionSummary[], error: null })
  renameAnswer = async () => ({ data: { name: 'Renamed' }, error: null })
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const later = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe('the Profile\'s record (stores/stats.ts)', () => {
  async function store() {
    stubNuxt()
    const { useStatsStore } = await import('~/stores/stats')
    return useStatsStore()
  }

  it('a quick revisit costs no request, and a visit after the window costs one', async () => {
    const stats = await store()
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(1)
    for (let i = 0; i < 5; i++) await stats.load({ ifStale: true })
    expect(calls.record).toBe(1)

    await later(WINDOW + 1_000)
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
  })

  it('Retry and any other forced load always ask', async () => {
    const stats = await store()
    await stats.load({ ifStale: true })
    await stats.load()
    expect(calls.record).toBe(2)
  })

  it('two visits while the first read is on its way are one request', async () => {
    const stats = await store()
    await Promise.all([stats.load({ ifStale: true }), stats.load({ ifStale: true })])
    expect(calls.record).toBe(1)
  })

  it('a change of hers (a finish, an edit of a read, a removal) makes the next visit ask', async () => {
    const stats = await store()
    await stats.load({ ifStale: true })
    libraryStub.changes++
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
    // And then it stands again.
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
  })

  it('a change while the read is on its way is not hidden by that read: it asks once more, and shows the newer answer', async () => {
    const stats = await store()
    const finished = { ...emptyRecord(), reading: 0, wantToRead: 0 }
    let answers: ((value: unknown) => void)[] = []
    recordAnswer = () => new Promise((resolve) => answers.push(resolve))
    const first = stats.load({ ifStale: true })
    await vi.advanceTimersByTimeAsync(0)
    libraryStub.changes++
    answers[0]!({ data: { ...finished, wantToRead: 1 }, error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.record).toBe(2)
    answers[1]!({ data: { ...finished, wantToRead: 2 }, error: null })
    await first
    expect(stats.record?.wantToRead).toBe(2)
    // The second read was asked after the change: it stands.
    recordAnswer = async () => ({ data: emptyRecord(), error: null })
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
  })

  it('a failed read is not fresh: the next visit asks again', async () => {
    const stats = await store()
    recordAnswer = async () => ({ data: null, error: 'unknown' })
    await stats.load({ ifStale: true })
    expect(stats.loadError).toBe('unknown')
    recordAnswer = async () => ({ data: emptyRecord(), error: null })
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
    expect(stats.loadError).toBeNull()
  })

  it('offline asks nothing, and a member change forgets what was fresh', async () => {
    const stats = await store()
    await stats.load({ ifStale: true })
    online.value = false
    await later(WINDOW + 1_000)
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(1)

    online.value = true
    session.member = { id: 'bob', email: 'bob@x.test' }
    await vi.advanceTimersByTimeAsync(0)
    await stats.load({ ifStale: true })
    expect(calls.record).toBe(2)
  })
})

describe('her genres (stores/genres.ts)', () => {
  async function store() {
    stubNuxt()
    const { useGenresStore } = await import('~/stores/genres')
    return useGenresStore()
  }

  it('a revisit inside the window costs no request, a visit after it costs one, forced always asks', async () => {
    const genres = await store()
    await genres.load({ ifStale: true })
    for (let i = 0; i < 4; i++) await genres.load({ ifStale: true })
    expect(calls.genres).toBe(1)
    expect(genres.ofEntry('e1')).toEqual(['fantasy'])

    await genres.load()
    expect(calls.genres).toBe(2)
    await later(WINDOW + 1_000)
    await genres.load({ ifStale: true })
    expect(calls.genres).toBe(3)
  })

  it('an entry that came or went (an add, a removal, another edition) makes the next visit ask; a finish does not', async () => {
    const genres = await store()
    await genres.load({ ifStale: true })
    // A change to an entry she has (changes only, no new roster): the genres are keyed by Book, still right.
    libraryStub.changes++
    await genres.load({ ifStale: true })
    expect(calls.genres).toBe(1)

    libraryStub.roster++
    await genres.load({ ifStale: true })
    expect(calls.genres).toBe(2)
  })

  it('her own correction forgets what was fresh: the next visit reads the database\'s word', async () => {
    const genres = await store()
    await genres.load({ ifStale: true })
    expect(await genres.set({ id: 'e1', bookId: 'b1' }, ['crime'])).toBeNull()
    // The answer is held at once…
    expect(genres.ofEntry('e1')).toEqual(['crime'])
    // …and read again at the next visit.
    await genres.load({ ifStale: true })
    expect(calls.genres).toBe(2)
  })

  it('a read that was on its way when the Library changed does not stand for the change', async () => {
    const genres = await store()
    const answers: ((value: unknown) => void)[] = []
    genresAnswer = () => new Promise((resolve) => answers.push(resolve))
    const first = genres.load({ ifStale: true })
    await vi.advanceTimersByTimeAsync(0)
    libraryStub.roster++
    answers[0]!({ data: [], error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.genres).toBe(2)
    answers[1]!({ data: [{ entryId: 'e9', bookId: 'b9', genres: ['crime'], overridden: false }], error: null })
    await first
    expect(genres.ofEntry('e9')).toEqual(['crime'])
  })

  it('a failed read is asked again at the next visit', async () => {
    const genres = await store()
    genresAnswer = async () => ({ data: null, error: 'unknown' })
    await genres.load({ ifStale: true })
    expect(genres.loadError).toBe('unknown')
    genresAnswer = async () => ({ data: [], error: null })
    await genres.load({ ifStale: true })
    expect(calls.genres).toBe(2)
  })
})

describe('the Collections\' list (stores/collections.ts)', () => {
  async function store() {
    stubNuxt()
    const { useCollectionsStore } = await import('~/stores/collections')
    return useCollectionsStore()
  }
  const summary = (id: string): CollectionSummary => ({ id, name: `Shelf ${id}`, position: 0, createdAt: '2026-10-01T00:00:00Z', count: 0, covers: [] })

  it('the Library tab shown again costs no request inside the window, one after it', async () => {
    const collections = await store()
    await collections.loadList({ ifStale: true })
    for (let i = 0; i < 4; i++) await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(1)

    await collections.loadList()
    expect(calls.list).toBe(2)
    await later(WINDOW + 1_000)
    await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(3)
  })

  it('a change made here (a rename) makes the next visit read the list again', async () => {
    const collections = await store()
    listAnswer = async () => ({ data: [summary('c1')], error: null })
    await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(1)

    expect(await collections.rename('c1', 'Renamed')).toBeNull()
    expect(collections.list[0]!.name).toBe('Renamed')
    await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(2)
    await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(2)
  })

  it('a forced read asked while one is on its way is not answered by the older read', async () => {
    const collections = await store()
    const answers: ((value: unknown) => void)[] = []
    listAnswer = () => new Promise((resolve) => answers.push(resolve))
    const first = collections.loadList({ ifStale: true })
    await vi.advanceTimersByTimeAsync(0)
    const forced = collections.loadList()
    answers[0]!({ data: [summary('old')], error: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.list).toBe(2)
    answers[1]!({ data: [summary('new')], error: null })
    await Promise.all([first, forced])
    expect(collections.list.map((c) => c.id)).toEqual(['new'])
  })

  it('a failed read is asked again at the next visit', async () => {
    const collections = await store()
    listAnswer = async () => ({ data: null, error: 'unknown' })
    await collections.loadList({ ifStale: true })
    expect(collections.loadError).toBe('unknown')
    listAnswer = async () => ({ data: [], error: null })
    await collections.loadList({ ifStale: true })
    expect(calls.list).toBe(2)
  })
})
