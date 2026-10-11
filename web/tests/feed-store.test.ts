import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, readonly, ref, toRaw, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_FEED_KEY, FEED_PAGE, readFeed, saveFeed, type FeedEntry } from '@/data/feed'

/**
 * The feed store's refresh, load more and dropMember (social v1, gate 2). It had no test of its own, and a
 * local `following` set that shadowed the store's `following` ref made every refresh with entries on screen
 * throw (`following.value = null` on a Set variable) while the suite and the friends flow stayed green. The
 * store runs here as in Nuxt, with the auto-imports it uses stood in for: a fake backend answering `feed` and
 * `my_people`, a signed-in member, a device storage and a switch for the connection. The real social store
 * answers People.
 */

const online = ref(true)
const calls: string[] = []
let feedAnswer: unknown[] = []
let people: 'answer' | 'fail' = 'answer'
let followingIds: string[] = ['ben']

const backend = {
  rpc: async (fn: string) => {
    calls.push(fn)
    if (fn === 'my_social') return { data: { private: true, sections: {}, link: 'x'.repeat(22), requests: 0 }, error: null, status: 200 }
    if (fn === 'feed') return { data: feedAnswer, error: null, status: 200 }
    if (fn === 'my_people') {
      if (people === 'fail') return { data: null, error: { message: 'boom', code: 'XX000' }, status: 500 }
      return { data: { following: followingIds.map((id) => ({ id, name: id, photo: null })), followers: [], followingIds, requests: [], requested: [] }, error: null, status: 200 }
    }
    return { data: null, error: null, status: 200 }
  },
}

vi.mock('~/stores/memberPhotos', () => ({ useMemberPhotosStore: () => ({ drop: () => undefined }) }))
vi.mock('~/stores/memberProfile', () => ({ useMemberProfileStore: () => ({ relationChanged: () => undefined }) }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))

/** The device's storage: a map that counts what is written. */
function storage() {
  const items = new Map<string, string>()
  const writes: string[] = []
  return {
    items,
    writes,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key)
      items.set(key, value)
    },
    removeItem: (key: string) => void items.delete(key),
  }
}
let device = storage()

const BASE = Date.parse('2026-10-09T12:00:00Z')
const BOOK = { id: 'b1', title: 'A Book', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false }

/** A feed entry as the store holds it; `minutes` back from BASE. */
function entry(id: string, memberId: string, minutes: number): FeedEntry {
  return {
    id,
    at: new Date(BASE - minutes * 60_000).toISOString(),
    member: { id: memberId, name: memberId, photo: null },
    kind: 'started',
    again: false,
    day: null,
    book: { ...BOOK, id: `book-${id}` },
    rating: null,
    review: null,
  }
}

/** The same entry as `feed` answers it. */
function json(e: FeedEntry) {
  return {
    id: e.id,
    at: e.at,
    member: e.member,
    kind: e.kind,
    again: e.again,
    day: e.day,
    book: { id: e.book.id, title: e.book.title, authors: [], published_year: null, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, manual: false },
    rating: e.rating,
    review: e.review,
  }
}

/** A full first page by Ben, newest first. */
const fullPage = () => Array.from({ length: FEED_PAGE }, (_, i) => entry(`new${i}`, 'ben', i))
/** What the device kept from before: older than the page above, by Ben (still followed) and Cleo (not). */
const older = () => [entry('old-ben-1', 'ben', 100), entry('old-cleo-1', 'cleo', 101), entry('old-ben-2', 'ben', 102), entry('old-cleo-2', 'cleo', 103)]

let pinia: ReturnType<typeof createPinia> | null = null

async function store(copy: FeedEntry[] | null = null) {
  if (copy) saveFeed(device, 'ada', copy, new Date(Date.now() - 60_000))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('toRaw', toRaw)
  vi.stubGlobal('window', { localStorage: device })
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  pinia = createPinia()
  setActivePinia(pinia)
  const { useFeedStore } = await import('~/stores/feed')
  return useFeedStore()
}

const ids = (entries: readonly FeedEntry[]) => entries.map((e) => e.id)

beforeEach(() => {
  online.value = true
  calls.length = 0
  feedAnswer = []
  people = 'answer'
  followingIds = ['ben']
  device = storage()
})
afterEach(() => {
  // The stores' watchers (the connection coming back) must not outlive the test and its stubbed globals.
  ;(pinia as unknown as { _e: { stop(): void } } | null)?._e.stop()
  vi.unstubAllGlobals()
})

describe('refresh with a full first page and entries below it', () => {
  it('keeps the older entries of members she still follows, drops the others, and saves the first page', async () => {
    const feed = await store(older())
    expect(ids(feed.entries)).toEqual(['old-ben-1', 'old-cleo-1', 'old-ben-2', 'old-cleo-2'])
    feedAnswer = fullPage().map(json)

    // The path that threw: the entries to keep are checked against People, then `following` is reset.
    await expect(feed.refresh()).resolves.toBeUndefined()

    expect(calls).toEqual(['feed', 'my_people'])
    expect(ids(feed.entries)).toEqual([...ids(fullPage()), 'old-ben-1', 'old-ben-2'])
    expect(feed.loaded).toBe(true)
    expect(feed.loading).toBe(false)
    expect(feed.loadError).toBeNull()
    expect(feed.ended).toBe(false)
    // The device's copy is the fresh first page alone, the member's own, taken just now.
    const saved = readFeed(device, 'ada', new Date())
    expect(ids(saved ?? [])).toEqual(ids(fullPage()))
    expect(JSON.parse(device.items.get(DEVICE_FEED_KEY)!).data.memberId).toBe('ada')
  })

  it('does not throw when nothing was on screen before (no People read, nothing to keep)', async () => {
    const feed = await store()
    feedAnswer = fullPage().map(json)
    await expect(feed.refresh()).resolves.toBeUndefined()
    expect(calls).toEqual(['feed'])
    expect(feed.entries).toHaveLength(FEED_PAGE)
  })
})

describe('refresh with a short first page', () => {
  it('is the whole feed: it replaces what was shown, reads no People and does not throw', async () => {
    const feed = await store(older())
    feedAnswer = fullPage().slice(0, 3).map(json)

    await expect(feed.refresh()).resolves.toBeUndefined()

    expect(calls).toEqual(['feed'])
    expect(ids(feed.entries)).toEqual(['new0', 'new1', 'new2'])
    expect(feed.ended).toBe(true)
  })
})

describe('refresh when People cannot be read', () => {
  it('drops nothing and does not throw', async () => {
    people = 'fail'
    const feed = await store(older())
    feedAnswer = fullPage().map(json)

    await expect(feed.refresh()).resolves.toBeUndefined()

    expect(calls).toEqual(['feed', 'my_people'])
    expect(ids(feed.entries)).toEqual([...ids(fullPage()), 'old-ben-1', 'old-cleo-1', 'old-ben-2', 'old-cleo-2'])
    expect(feed.loaded).toBe(true)
  })
})

describe('refresh offline', () => {
  it('keeps the copy, asks nothing and says when it is from', async () => {
    const feed = await store(older())
    online.value = false
    await nextTick()

    await expect(feed.refresh()).resolves.toBeUndefined()

    expect(calls).toEqual([])
    expect(ids(feed.entries)).toEqual(['old-ben-1', 'old-cleo-1', 'old-ben-2', 'old-cleo-2'])
    expect(feed.loaded).toBe(true)
    expect(feed.loadError).toBeNull()
    expect(feed.offlineSince).toBeInstanceOf(Date)
  })

  it('with no copy it says so, and writes nothing', async () => {
    const feed = await store()
    online.value = false
    await nextTick()

    await expect(feed.refresh()).resolves.toBeUndefined()

    expect(calls).toEqual([])
    expect(feed.entries).toEqual([])
    expect(feed.loadError).toBe('offline')
    expect(device.writes).toEqual([])
  })
})

describe('dropMember', () => {
  it("removes her entries and saves the copy again without them, with the time it was taken", async () => {
    const feed = await store(older())
    const savedAt = JSON.parse(device.items.get(DEVICE_FEED_KEY)!).data.savedAt as string
    device.writes.length = 0

    feed.dropMember('cleo')

    expect(ids(feed.entries)).toEqual(['old-ben-1', 'old-ben-2'])
    expect(device.writes).toEqual([DEVICE_FEED_KEY])
    const copy = JSON.parse(device.items.get(DEVICE_FEED_KEY)!).data
    expect(ids(copy.entries)).toEqual(['old-ben-1', 'old-ben-2'])
    expect(copy.savedAt).toBe(savedAt)
  })

  it('does nothing for a member with no entries on screen', async () => {
    const feed = await store(older())
    device.writes.length = 0
    calls.length = 0

    feed.dropMember('dora')

    expect(feed.entries).toHaveLength(4)
    expect(device.writes).toEqual([])
    expect(calls).toEqual([])
  })

  it('asks who she follows when nothing is left, so the right empty state shows', async () => {
    followingIds = []
    const feed = await store([entry('only', 'cleo', 5)])

    feed.dropMember('cleo')
    await vi.waitFor(() => expect(feed.emptyState).toBe('nobody'))

    expect(feed.entries).toEqual([])
    expect(calls).toEqual(['my_people'])
  })
})
