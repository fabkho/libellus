import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry, ReadingSession, SessionEdit } from '@/data/library'

/**
 * Her page count in the Edit read sheet, in the store behind it (`stores/history.ts`,
 * `confirmEdit`): the read's own edit goes first (`update_session`, which has no page count) and hers
 * is a second call (`setTotal` → `set_read_total` → `library_entries.page_count_override`). It is sent
 * only once the read's edit has landed and only when the sheet's field changed; a refusal of the count
 * leaves the sheet open saying that the rest was kept. `SessionEdit` grows no page count.
 */

const online = ref(true)
const session = reactive({ member: { id: 'ada', email: 'ada@x.test' } as { id: string; email: string } | null })

/** The calls the sheet's Save makes, in the order it makes them. */
const calls: string[] = []
let sessionAnswer: () => Promise<unknown> = async () => ({ data: entry(), error: null })
let totalAnswer: () => Promise<boolean> = async () => true

const entry = (pageCountOverride: number | null = null): LibraryEntry => ({
  id: 'e1',
  status: 'finished',
  addedAt: '2026-10-01T00:00:00Z',
  book: { id: 'b1', pageCount: 272 } as LibraryEntry['book'],
  pageCountOverride,
  formatOverride: null,
  readAs: null,
  hidden: false,
  latestSession: null,
})

const read: ReadingSession = {
  id: 's1',
  entryId: 'e1',
  startedOn: '2026-10-01',
  endedOn: '2026-10-09',
  outcome: 'finished',
  rating: 16,
  review: 'A house of statues.',
  reviewSpoilers: false,
  abandonReason: null,
  progressPage: null,
  progressPercent: null,
}

const repository = {
  sessions: async () => ({ data: [read], error: null }),
  updateSession: async (_entryId: string, _read: ReadingSession, _edit: SessionEdit) => {
    calls.push('session')
    return sessionAnswer()
  },
}

const setTotal = vi.fn(async (_sessionId: string, _entryId: string, _pageCount: number | null) => {
  calls.push('total')
  return totalAnswer()
})

vi.mock('~/stores/library', () => ({
  useLibraryStore: () => ({
    changes: 0,
    roster: 0,
    readInYear: null,
    library: () => repository,
    entryChanged: () => {},
    loadReadInYear: async () => {},
  }),
}))
vi.mock('~/stores/book', () => ({ useBookStore: () => ({ dropEntry: () => {} }) }))
vi.mock('~/stores/collections', () => ({ useCollectionsStore: () => ({ entryRemoved: () => {} }) }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ holds: () => false }) }))
vi.mock('~/stores/stats', () => ({ useStatsStore: () => ({ setTotal }) }))

const pinias: ReturnType<typeof createPinia>[] = []

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
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
}

beforeEach(() => {
  online.value = true
  session.member = { id: 'ada', email: 'ada@x.test' }
  calls.length = 0
  setTotal.mockClear()
  sessionAnswer = async () => ({ data: entry(), error: null })
  totalAnswer = async () => true
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.unstubAllGlobals()
})

/** The Edit sheet opened on her finished read of a Book whose edition counts 272 pages. */
async function opened(pageCountOverride: number | null = null) {
  stubNuxt()
  const { useHistoryStore } = await import('~/stores/history')
  const history = useHistoryStore()
  history.openEdit(entry(pageCountOverride), read)
  return history
}

describe('the Edit sheet saves her page count after the read (stores/history.ts, confirmEdit)', () => {
  it('sends the read first and her page count second, and closes on both', async () => {
    const history = await opened()

    const saved = await history.confirmEdit({ pageCount: 144 })

    expect(calls).toEqual(['session', 'total'])
    expect(setTotal).toHaveBeenCalledWith('s1', 'e1', 144)
    expect(saved).not.toBeNull()
    expect(history.totalFailed).toBe(false)
    expect(history.editing).toBeNull()
  })

  it('clears the override with null (the edition\'s count again)', async () => {
    const history = await opened(144)

    await history.confirmEdit({ pageCount: null })

    expect(calls).toEqual(['session', 'total'])
    expect(setTotal).toHaveBeenCalledWith('s1', 'e1', null)
    expect(history.editing).toBeNull()
  })

  it('writes nothing about the count when the field still holds what it opened on', async () => {
    const history = await opened()

    await history.confirmEdit(undefined)

    expect(calls).toEqual(['session'])
    expect(setTotal).not.toHaveBeenCalled()
    expect(history.editing).toBeNull()
  })

  it('sends no count when the read\'s own edit was refused: the sheet stays with its reason', async () => {
    const history = await opened()
    sessionAnswer = async () => ({ data: null, error: 'session_invalid' })

    const saved = await history.confirmEdit({ pageCount: 144 })

    expect(calls).toEqual(['session'])
    expect(setTotal).not.toHaveBeenCalled()
    expect(saved).toBeNull()
    expect(history.editError).toBe('session_invalid')
    expect(history.editing).not.toBeNull()
  })

  it('keeps the sheet open, saying the rest was saved, when her page count is refused', async () => {
    const history = await opened(272)
    totalAnswer = async () => false

    const saved = await history.confirmEdit({ pageCount: 0 })

    expect(calls).toEqual(['session', 'total'])
    // The read's edit landed: the entry it answered with is what the screens show.
    expect(saved).toMatchObject({ id: 'e1' })
    expect(history.totalFailed).toBe(true)
    expect(history.editError).toBeNull()
    expect(history.editing).not.toBeNull()
  })

  it('a second try is a new one: the count\'s refusal goes with the next edit', async () => {
    const history = await opened(272)
    totalAnswer = async () => false
    await history.confirmEdit({ pageCount: 300 })
    expect(history.totalFailed).toBe(true)

    totalAnswer = async () => true
    await history.confirmEdit({ pageCount: 144 })

    expect(history.totalFailed).toBe(false)
    expect(history.editing).toBeNull()
  })

  it('leaves the shared draft alone: SessionEdit has no page count', async () => {
    const history = await opened()
    await history.confirmEdit({ pageCount: 144 })
    expect(Object.keys(history.draft).sort()).toEqual(['abandonReason', 'endedOn', 'rating', 'review', 'reviewSpoilers', 'startedOn'])
  })
})
