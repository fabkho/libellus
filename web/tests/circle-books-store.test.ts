import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, readonly, ref, shallowRef, watch } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CIRCLE_BOOKS_MAX } from '@/data/social'

/**
 * Who she follows reads, or wants, the same Books (social v2a, stores/circleBooks.ts): the calls carry only Book
 * ids (her open reads, her Want to read), at most CIRCLE_BOOKS_MAX; offline, or refused, the last answer stays;
 * a member who follows nobody makes no call; the feed's refresh asks again. The store runs as in Nuxt with the
 * auto-imports it uses stood in for, a fake backend (`circle_reading`, `circle_want`, `my_people`), and the real
 * social store for People.
 */

let online = ref(true)
const calls: { fn: string; args: unknown }[] = []
let followingIds: string[] = ['ben']
let refuse = false
const CARD = { id: 'ben', name: 'Ben', photo: null }

const backend = {
  rpc: async (fn: string, args: { p_books?: string[] }) => {
    calls.push({ fn, args })
    if (fn === 'my_social') return { data: { private: true, sections: {}, link: 'x'.repeat(22), requests: 0 }, error: null, status: 200 }
    if (fn === 'my_people') {
      return { data: { following: followingIds.map((id) => ({ id, name: id, photo: null })), followers: [], followingIds, requests: [], requested: [] }, error: null, status: 200 }
    }
    if (fn === 'circle_reading' || fn === 'circle_want') {
      if (refuse) return { data: null, error: { message: 'boom', code: 'XX000' }, status: 500 }
      // Everybody she asked about has Ben, except the first Book of the list.
      return { data: (args.p_books ?? []).slice(1).map((book) => ({ book, members: [CARD], more: fn === 'circle_want' ? 2 : 0 })), error: null, status: 200 }
    }
    return { data: null, error: null, status: 200 }
  },
}

type Entries = { book: { id: string } }[]
const freshLists = () => reactive({ loaded: false, reading: [] as Entries, wantToRead: [] as Entries })
let lists = freshLists()
// Made afresh for each test, so the watchers of an earlier test's store never see this one's changes.
let feedState = reactive({ takenAt: null as Date | null })
let session = reactive({ member: { id: 'ada' } as { id: string } | null })

vi.mock('~/stores/memberPhotos', () => ({ useMemberPhotosStore: () => ({ drop: () => undefined }) }))
vi.mock('~/stores/memberProfile', () => ({ useMemberProfileStore: () => ({ relationChanged: () => undefined }) }))
vi.mock('~/stores/feed', () => ({ useFeedStore: () => feedState }))
vi.mock('~/stores/library', () => ({ useLibraryStore: () => lists }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

const books = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ book: { id: `${prefix}${i}` } }))
const asked = (fn: string) => calls.filter((c) => c.fn === fn).map((c) => (c.args as { p_books: string[] }).p_books)

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  setActivePinia(createPinia())
  const { useCircleBooksStore } = await import('~/stores/circleBooks')
  return useCircleBooksStore()
}

beforeEach(() => {
  online = ref(true)
  calls.length = 0
  followingIds = ['ben']
  refuse = false
  lists = freshLists()
  lists.reading = books('r', 3)
  lists.wantToRead = books('w', 3)
  feedState = reactive({ takenAt: null as Date | null })
  session = reactive({ member: { id: 'ada' } as { id: string } | null })
})

describe('the circle on her Books', () => {
  // The cause of "Home never shows the avatars": the store waited for a page to call `load`, and Home no longer did.
  // It asks by itself once her lists are there, and again when her Books change.
  it('asks by itself when her lists arrive, with no page asking, and when her Books change', async () => {
    const circle = await store()
    await nextTick()
    expect(calls.filter((c) => c.fn.startsWith('circle_'))).toEqual([])
    lists.loaded = true
    await vi.waitFor(() => expect(Object.keys(circle.reading)).toEqual(['r1', 'r2']))
    expect(asked('circle_reading')).toEqual([['r0', 'r1', 'r2']])
    expect(asked('circle_want')).toEqual([['w0', 'w1', 'w2']])
    lists.wantToRead = [...books('w', 3), ...books('x', 1)]
    await vi.waitFor(() => expect(asked('circle_want')).toHaveLength(2))
    expect(asked('circle_want')[1]).toEqual(['w0', 'w1', 'w2', 'x0'])
  })

  it('makes no call for a member who follows nobody, even when her lists arrive', async () => {
    followingIds = []
    await store()
    lists.loaded = true
    await vi.waitFor(() => expect(calls.some((c) => c.fn === 'my_people')).toBe(true))
    await nextTick()
    expect(calls.filter((c) => c.fn.startsWith('circle_'))).toEqual([])
  })

  it('leaves a fresh answer to the same Books alone when a page shows again (ifStale), and asks when they changed', async () => {
    const circle = await store()
    lists.loaded = true
    await vi.waitFor(() => expect(asked('circle_reading')).toHaveLength(1))
    await circle.load({ ifStale: true })
    expect(asked('circle_reading')).toHaveLength(1)
    await circle.load()
    expect(asked('circle_reading')).toHaveLength(2)
  })

  it('asks with Book ids only, one call for each list, and keeps the answers by Book', async () => {
    const circle = await store()
    await circle.load()
    expect(asked('circle_reading')).toEqual([['r0', 'r1', 'r2']])
    expect(asked('circle_want')).toEqual([['w0', 'w1', 'w2']])
    expect(circle.reading).toEqual({ r1: { members: [CARD], more: 0 }, r2: { members: [CARD], more: 0 } })
    expect(circle.want.w1).toEqual({ members: [CARD], more: 2 })
    expect(circle.want.w0).toBeUndefined()
  })

  it('asks about at most CIRCLE_BOOKS_MAX Books of each list, the first (newest) ones', async () => {
    lists.reading = books('r', CIRCLE_BOOKS_MAX + 10)
    lists.wantToRead = books('w', CIRCLE_BOOKS_MAX + 10)
    const circle = await store()
    await circle.load()
    expect(asked('circle_reading')[0]).toEqual(lists.reading.slice(0, CIRCLE_BOOKS_MAX).map((e) => e.book.id))
    expect(asked('circle_want')[0]).toHaveLength(CIRCLE_BOOKS_MAX)
  })

  it('asks nothing for a list without Books', async () => {
    lists.reading = []
    const circle = await store()
    await circle.load()
    expect(asked('circle_reading')).toEqual([])
    expect(asked('circle_want')).toHaveLength(1)
  })

  it('makes no call for a member who follows nobody', async () => {
    followingIds = []
    const circle = await store()
    await circle.load()
    expect(calls.filter((c) => c.fn.startsWith('circle_'))).toEqual([])
    expect(circle.reading).toEqual({})
  })

  it('keeps the last answer offline and on a refusal', async () => {
    const circle = await store()
    await circle.load()
    const before = { reading: circle.reading, want: circle.want }
    calls.length = 0
    online.value = false
    await circle.load()
    expect(calls).toEqual([])
    expect({ reading: circle.reading, want: circle.want }).toEqual(before)
    // Back online asks again by itself; the database refuses.
    refuse = true
    online.value = true
    await circle.load()
    expect(calls.filter((c) => c.fn.startsWith('circle_')).length).toBeGreaterThanOrEqual(2)
    expect({ reading: circle.reading, want: circle.want }).toEqual(before)
  })

  it('asks again after the feed is refreshed, once a page has asked for it', async () => {
    const circle = await store()
    feedState.takenAt = new Date()
    await nextTick()
    await nextTick()
    expect(calls.filter((c) => c.fn.startsWith('circle_'))).toEqual([])
    await circle.load()
    calls.length = 0
    feedState.takenAt = new Date(Date.now() + 1000)
    await vi.waitFor(() => expect(asked('circle_reading')).toHaveLength(1))
  })

  it('takes a member who left her circle out of every group at once, and a group with nobody left goes (privacy review M2)', async () => {
    const circle = await store()
    await circle.load()
    expect(circle.reading.r1?.members).toEqual([CARD])
    circle.dropMember('ben')
    expect(circle.reading).toEqual({})
    expect(circle.want).toEqual({})
  })

  it('keeps the others of a group', async () => {
    const circle = await store()
    await circle.load()
    const cleo = { id: 'cleo', name: 'Cleo', photo: null }
    circle.reading = { r1: { members: [CARD, cleo], more: 1 } }
    circle.dropMember('ben')
    expect(circle.reading).toEqual({ r1: { members: [cleo], more: 1 } })
  })

  it('throws away an answer that was on its way when she left (it may still name her)', async () => {
    const circle = await store()
    const asking = circle.load()
    circle.dropMember('ben')
    await asking
    expect(circle.reading).toEqual({})
    expect(circle.want).toEqual({})
  })

  it('forgets everything when another member signs in', async () => {
    const circle = await store()
    await circle.load()
    expect(Object.keys(circle.reading)).not.toHaveLength(0)
    session.member = { id: 'bea' }
    await nextTick()
    expect(circle.reading).toEqual({})
    expect(circle.want).toEqual({})
  })
})
