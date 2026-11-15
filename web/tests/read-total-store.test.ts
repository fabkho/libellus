import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryEntry } from '@/data/library'
import { readStats } from '@/data/deviceLibrary'

/**
 * Her own page count set in the pagesMissing sheet (issue #60), in the Profile's store
 * (`stores/stats.ts`, `setTotal`): the override is written through the Library store's repository
 * (`setReadTotal`, `library_entries.page_count_override` only — never the edition's `books.page_count`,
 * never recorded progress) and laid over the record at once, so the figures and the list behind the
 * sheet follow without a reload, on the device copy too. The next read of the sessions is the
 * authority again. The store runs here as it does in Nuxt, with the auto-imports it uses stood in for.
 */

const online = ref(true)
const session = reactive({ member: { id: 'ada', email: 'ada@x.test' } as { id: string; email: string } | null })

const calls = { record: 0, setReadTotal: 0 }
let totalArgs: { entryId: string; pageCount: number | null } | null = null
let totalAnswer: () => Promise<unknown> = async () => ({ data: entry('e1'), error: null })

const record = {
  reads: [
    { sessionId: 's1', entryId: 'e1', book: { id: 'b1', title: 'Piranesi' }, startedOn: '2026-10-01', endedOn: '2026-10-09', outcome: 'finished', rating: 20, pages: null, days: 9, nth: 1 },
    { sessionId: 's2', entryId: 'e2', book: { id: 'b2', title: 'The Wave' }, startedOn: '2026-10-01', endedOn: '2026-10-05', outcome: 'finished', rating: null, pages: 180, days: 5, nth: 2 },
  ],
  wantToRead: 0,
  reading: 0,
  days: [],
  daysSince: null,
}

const libraryRepository = {
  setReadTotal: async (entryId: string, pageCount: number | null) => {
    calls.setReadTotal++
    totalArgs = { entryId, pageCount }
    return totalAnswer()
  },
}
vi.mock('~/data/stats', async (original) => ({
  ...(await original<typeof import('~/data/stats')>()),
  createStats: () => ({
    record: () => {
      calls.record++
      return Promise.resolve({ data: record, error: null })
    },
  }),
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('~/stores/library', () => ({ useLibraryStore: () => ({ changes: 0, roster: 0, library: () => libraryRepository }) }))
vi.mock('~/stores/sync', () => ({ useSyncStore: () => ({ pending: 0, waiting: false, queue: { open: () => false }, holds: () => false }) }))

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
const storage = memoryLocalStorage()
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
  vi.stubGlobal('window', { localStorage: storage })
  const pinia = createPinia()
  pinias.push(pinia)
  setActivePinia(pinia)
}

/** A member's entry, as `setReadTotal` answers it (the repository rereads the row, see data/library.ts). */
function entry(id: string, pageCountOverride: number | null = null): LibraryEntry {
  return {
    id,
    status: 'finished',
    addedAt: '2026-10-01T00:00:00Z',
    book: { id: 'b1' } as LibraryEntry['book'],
    pageCountOverride,
    formatOverride: null,
    readAs: null,
    hidden: false,
    latestSession: null,
  }
}

beforeEach(() => {
  online.value = true
  session.member = { id: 'ada', email: 'ada@x.test' }
  Object.assign(calls, { record: 0, setReadTotal: 0 })
  totalArgs = null
  totalAnswer = async () => ({ data: entry('e1'), error: null })
  storage.removeItem('libellus.stats')
})
afterEach(() => {
  for (const pinia of pinias.splice(0)) pinia._e.stop()
  vi.unstubAllGlobals()
})

async function loaded() {
  stubNuxt()
  const { useStatsStore } = await import('~/stores/stats')
  const stats = useStatsStore()
  await stats.load()
  return stats
}

describe('her own page count (stores/stats.ts, setTotal)', () => {
  it('writes the override and lays it over the record at once, on the device copy too', async () => {
    const stats = await loaded()
    expect(stats.record!.reads[0]).toMatchObject({ sessionId: 's1', pages: null })

    expect(await stats.setTotal('s1', 'e1', 272)).toBe(true)

    expect(calls.setReadTotal).toBe(1)
    expect(totalArgs).toEqual({ entryId: 'e1', pageCount: 272 })
    // The record the figures and the sheet read: this read now has a count, the others are untouched.
    expect(stats.record!.reads[0]).toMatchObject({ sessionId: 's1', pages: 272 })
    expect(stats.record!.reads[1]).toMatchObject({ sessionId: 's2', pages: 180 })
    // Saved for the device, so the figures stand offline and on the next start.
    expect(readStats(storage, 'ada')!.reads[0]).toMatchObject({ sessionId: 's1', pages: 272 })
  })

  it('clears the override back to the edition\'s count (null) the same way', async () => {
    const stats = await loaded()
    await stats.setTotal('s1', 'e1', 272)
    totalAnswer = async () => ({ data: entry('e1', null), error: null })
    expect(await stats.setTotal('s1', 'e1', null)).toBe(true)
    expect(totalArgs).toEqual({ entryId: 'e1', pageCount: null })
    expect(stats.record!.reads[0]).toMatchObject({ sessionId: 's1', pages: null })
  })

  it('a refused write leaves the record as it was and says so', async () => {
    const stats = await loaded()
    totalAnswer = async () => ({ data: null, error: 'progress_invalid' })
    expect(await stats.setTotal('s1', 'e1', 0)).toBe(false)
    expect(stats.record!.reads[0]).toMatchObject({ sessionId: 's1', pages: null })
    expect(readStats(storage, 'ada')!.reads[0]).toMatchObject({ sessionId: 's1', pages: null })
  })
})
