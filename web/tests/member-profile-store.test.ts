import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, readonly, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemberProfile } from '../app/data/socialShapes'

/** The member profile store follows a change of relation at once (social v1, gate 2, M4), with the auto-imports stood in. */

/**
 * The shapes of a page of her history, as the repository hands them out (`MemberFinishedPage`): the fields the
 * store reads are all this test needs of a row.
 */
type Page = { total: number; items: { book: { id: string } }[]; next: { day: string; at: string; entry: string } | null }
type Pages = { data: Page | null; error: string | null }

const card = { id: 'ida', name: 'Ida', photo: null }
const OPEN = { reading: true, want: true, finished: true, ratings: true, reviews: true, abandoned: true, year: true }
const followed: MemberProfile = {
  member: card,
  private: true,
  state: 'following',
  visible: true,
  followsYou: true,
  sections: OPEN,
  since: null,
  counts: { read: 1, reading: 0, want: 0 },
  reading: [],
  want: [],
  finished: [],
}

let answer: MemberProfile | null = followed
let bothAnswer: { data: unknown[] | null; error: string | null } = { data: [], error: null }
/** While set, `both_read` does not answer until it is released: the moments between her profile and her answer. */
let bothGate: Promise<void> | null = null
/** While set, her profile does not answer until it is released. */
let answerGate: Promise<void> | null = null
const bothCalls: (number | null)[] = []
let recordAnswer: { data: unknown; error: unknown; status: number } = { data: null, error: null, status: 200 }
/** `member_finished`: the pages it answers, in order, and the cursors it was asked with (null: the first page). */
let finishedAnswers: Pages[] = []
const finishedCalls: (Page['next'])[] = []
/** While set, a page of her history does not answer until it is released. */
let finishedGate: Promise<void> | null = null
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/social', () => ({
  useSocialStore: () => ({
    profile: async () => {
      if (answerGate) await answerGate
      return { data: answer, error: null }
    },
    want: async () => ({ data: null, error: null }),
    bothRead: async (_id: string, year: number | null) => {
      bothCalls.push(year)
      if (bothGate) await bothGate
      return bothAnswer
    },
    memberFinished: async (_id: string, after: Page['next'] = null) => {
      finishedCalls.push(after)
      if (finishedGate) await finishedGate
      return finishedAnswers.length > 0 ? finishedAnswers.shift()! : { data: null, error: null }
    },
  }),
}))

/** The device's storage, in memory: each test starts with an empty one unless it made its own first. */
const device = () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      get length() {
        return data.size
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  })
  return data
}

async function store() {
  if (typeof window === 'undefined') device()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useNuxtApp', () => ({ $i18n: { t: (key: string) => key } }))
  vi.stubGlobal('useBackend', () => ({ rpc: async () => recordAnswer }))
  vi.stubGlobal('useOnline', () => readonly(ref(true)))
  vi.stubGlobal('isOnline', () => true)
  setActivePinia(createPinia())
  const { useMemberProfileStore } = await import('~/stores/memberProfile')
  return useMemberProfileStore()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  bothAnswer = { data: [], error: null }
  bothGate = null
  answerGate = null
  bothCalls.length = 0
  recordAnswer = { data: null, error: null, status: 200 }
  finishedAnswers = []
  finishedCalls.length = 0
  finishedGate = null
})

describe('relationChanged', () => {
  it('turns a followed private profile into its closed card after Unfollow, with no read', async () => {
    const members = await store()
    await members.load('ida')
    expect(members.viewOf('ida').profile).toMatchObject({ visible: true, state: 'following' })
    members.relationChanged('ida', { kind: 'unfollow' })
    expect(members.viewOf('ida').profile).toEqual({ member: card, private: true, state: 'none', visible: false })
    expect(members.viewOf('ida')).toMatchObject({ loaded: true, record: null, want: null })
  })

  it('leaves nobody to show after Block: loaded, with no profile', async () => {
    const members = await store()
    await members.load('ida')
    members.relationChanged('ida', { kind: 'block' })
    expect(members.viewOf('ida')).toMatchObject({ profile: null, loaded: true, error: null })
  })

  it('does nothing for a member whose profile was never read', async () => {
    const members = await store()
    members.relationChanged('ida', { kind: 'block' })
    expect(members.viewOf('ida').loaded).toBe(false)
  })
})

describe('her figures that could not be read (L2)', () => {
  it('keeps the error, so the page does not call it a dead link; a record that is not for her has none', async () => {
    recordAnswer = { data: null, error: { message: 'Failed to fetch' }, status: 0 }
    const members = await store()
    await members.load('ida')
    expect(members.viewOf('ida')).toMatchObject({ record: null, recordError: 'offline', recordLoading: false })

    recordAnswer = { data: null, error: null, status: 200 }
    await members.load('ida')
    expect(members.viewOf('ida')).toMatchObject({ record: null, recordError: null })
  })
})

describe('what was read of her after she is unfollowed, blocked or removed (P2)', () => {
  it('keeps no figures, Want to read or year of hers; only the profile the action leaves', async () => {
    recordAnswer = { data: { reads: [], wantToRead: 2, reading: 1 }, error: null, status: 200 }
    const members = await store()
    await members.load('ida')
    members.setYear('ida', 2025)
    expect(members.viewOf('ida').record).not.toBeNull()
    members.relationChanged('ida', { kind: 'unfollow' })
    expect(members.viewOf('ida')).toMatchObject({ record: null, want: null, year: 'all', recordError: null, loaded: true })

    await members.load('ida')
    members.relationChanged('ida', { kind: 'removeFollower' })
    expect(members.viewOf('ida')).toMatchObject({ record: null, loaded: true })
  })
})

describe('You both read (social v2a)', () => {
  const read = { book: { id: 'b' }, mine: { rating: 12, endedOn: null }, hers: { rating: null, endedOn: null } }

  it('is read with her profile, for all her years, and for one year when the year page asks', async () => {
    bothAnswer = { data: [read], error: null }
    const members = await store()
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
    await members.load('ida', 2025)
    expect(bothCalls).toEqual([null, 2025])
    expect(Object.keys(members.viewOf('ida').bothRead).sort()).toEqual(['2025', 'all'])
    await members.loadBothRead('ida', 2024)
    expect(bothCalls).toEqual([null, 2025, 2024])
  })

  it('stays empty, with no error, when she may not see it or it is refused', async () => {
    bothAnswer = { data: null, error: 'unknown' }
    const members = await store()
    await members.load('ida')
    expect(members.viewOf('ida')).toMatchObject({ bothRead: {}, error: null, recordError: null, loaded: true, bothReadLoading: false })
  })

  it('is pending from the render the profile arrives in until her answer is in, so the page holds the section\'s box', async () => {
    bothAnswer = { data: [read], error: null }
    const members = await store()
    expect(members.viewOf('ida').bothReadLoading).toBe(false)
    const loading = members.load('ida')
    await Promise.resolve()
    await loading
    expect(members.viewOf('ida')).toMatchObject({ bothRead: { all: [read] }, bothReadLoading: false })
    // A copy already held is not asked for again as pending: the section stays as it is while it is read afresh.
    const again = members.load('ida')
    expect(members.viewOf('ida').bothReadLoading).toBe(false)
    await again
  })

  it('is cleared once her finished section is off, or her profile closes (privacy review L4)', async () => {
    bothAnswer = { data: [read], error: null }
    const members = await store()
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
    // She turns her finished section off: the next read of her profile takes the row away.
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({})
    // It comes back with the section, and goes again with a profile that closes (a private card).
    answer = followed
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
    answer = { member: card, private: true, state: 'none', visible: false }
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({})
    answer = followed
  })

  it('uses nothing of the answer asked for with her profile when the profile hides her finished Books', async () => {
    bothAnswer = { data: [{ book: { id: 'b' } }], error: null }
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    const members = await store()
    await members.load('ida')
    answer = followed
    expect(members.viewOf('ida')).toMatchObject({ bothRead: {}, bothReadLoading: false })
    // And it is not kept for a later warm to find.
    expect(await members.prefetchBothRead('ida')).not.toBeNull()
    expect(bothCalls).toEqual([null, null])
  })
})

describe('You both read, asked for ahead and kept on the device', () => {
  const read = { book: { id: 'b', title: 'B', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false, unverified: false }, mine: { rating: 12, endedOn: null }, hers: { rating: 16, endedOn: null } }
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  it('asks once for a friend however many ask before and while her page opens, and for a few minutes after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    bothAnswer = { data: [read], error: null }
    const members = await store()
    const [a, b] = await Promise.all([members.prefetchBothRead('ida'), members.prefetchBothRead('ida')])
    expect(a).toEqual([read])
    expect(b).toEqual([read])
    await members.load('ida')
    expect(bothCalls).toEqual([null])
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
    // A tap, or another read of her page, a minute later: still her answer, no second request.
    vi.setSystemTime(Date.now() + 60_000)
    await members.prefetchBothRead('ida')
    await members.load('ida')
    expect(bothCalls).toEqual([null])
    // Past its few minutes it is asked for again.
    vi.setSystemTime(Date.now() + 4 * 60_000)
    await members.load('ida')
    expect(bothCalls).toEqual([null, null])
  })

  it('starts her answer with her profile, not after it', async () => {
    bothAnswer = { data: [read], error: null }
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const members = await store()
    answerGate = held
    const loading = members.load('ida')
    await settle()
    expect(bothCalls, 'both_read asked while the profile is still on its way').toEqual([null])
    release()
    await loading
    expect(bothCalls).toEqual([null])
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
  })

  it('does not keep a failed answer: the next ask tries again', async () => {
    bothAnswer = { data: null, error: 'offline' }
    const members = await store()
    expect(await members.prefetchBothRead('ida')).toBeNull()
    await settle()
    bothAnswer = { data: [read], error: null }
    expect(await members.prefetchBothRead('ida')).toEqual([read])
    expect(bothCalls).toEqual([null, null])
  })

  it('shows nothing of what was asked for ahead until her profile says it is hers to show', async () => {
    bothAnswer = { data: [read], error: null }
    const members = await store()
    await members.prefetchBothRead('ida')
    expect(members.viewOf('ida').bothRead).toEqual({})
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    await members.load('ida')
    expect(members.viewOf('ida').bothRead).toEqual({})
    answer = followed
  })

  it('does not ask while offline', async () => {
    const members = await store()
    vi.stubGlobal('isOnline', () => false)
    expect(await members.prefetchBothRead('ida')).toBeNull()
    expect(bothCalls).toEqual([])
  })

  it('draws a return visit from the device in the same render as her profile, and keeps the very same answer when the fresh one is equal', async () => {
    device()
    bothAnswer = { data: [read], error: null }
    await (await store()).load('ida')
    // Another visit (a new store: the page opened afresh), her answer slow to come.
    let release!: () => void
    bothGate = new Promise<void>((resolve) => (release = resolve))
    const again = await store()
    const loading = again.load('ida')
    await settle()
    expect(again.viewOf('ida')).toMatchObject({ bothRead: { all: [read] }, bothReadLoading: false, loaded: true })
    const shown = again.viewOf('ida').bothRead.all
    release()
    await loading
    expect(again.viewOf('ida').bothRead.all).toBe(shown)
    // Changed Books replace it (her answer asked for again once the last has lapsed).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 4 * 60_000)
    bothGate = null
    bothAnswer = { data: [read, { ...read, book: { ...read.book, id: 'c' } }], error: null }
    await again.load('ida')
    expect(again.viewOf('ida').bothRead.all).toHaveLength(2)
  })

  it('forgets her copy when her section goes off, when a refusal comes, and when the relation ends', async () => {
    const data = device()
    bothAnswer = { data: [read], error: null }
    const members = await store()
    await members.load('ida')
    expect(data.size).toBe(1)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 4 * 60_000)
    bothAnswer = { data: null, error: 'unknown' }
    await members.load('ida')
    expect(data.size).toBe(0)
    expect(members.viewOf('ida').bothRead.all).toEqual([])
    vi.setSystemTime(Date.now() + 8 * 60_000)
    bothAnswer = { data: [read], error: null }
    await members.load('ida')
    expect(data.size).toBe(1)
    members.relationChanged('ida', { kind: 'unfollow' })
    expect(data.size).toBe(0)
    await members.load('ida')
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    await members.load('ida')
    expect(data.size).toBe(0)
    answer = followed
  })
})

describe("her whole finished history, a page at a time (her shelf's Stack)", () => {
  /** A page of her history: `n` rows from the `from`th on, of `total` in all, and the cursor after them. */
  const page = (n: number, from: number, total: number, next: Page['next'] = null): Page => ({
    total,
    items: Array.from({ length: n }, (_, i) => ({ book: { id: `b${from + i}` } })),
    next,
  })

  it('reads the first page once her profile says her Finished switch is on, and keeps it', async () => {
    const first = page(3, 1, 5, { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b3' })
    finishedAnswers = [{ data: first, error: null }]
    const members = await store()
    // Nothing is asked before her profile is read: who may see her and whether it is hers to show is its answer.
    expect(finishedCalls).toEqual([])
    await members.load('ida')
    await members.loadShelf('ida')
    expect(finishedCalls).toEqual([null])
    expect(members.viewOf('ida').shelf).toMatchObject({ items: first.items, total: 5, loading: false, error: null })
    // A re-entry of the page takes what the session holds: no second request for the same page.
    await members.loadShelf('ida')
    expect(finishedCalls).toEqual([null])
    // `again` asks afresh (the page's Try again).
    finishedAnswers = [{ data: first, error: null }]
    await members.loadShelf('ida', { again: true })
    expect(finishedCalls).toEqual([null, null])
  })

  it('asks nothing for a member it is not hers to show, or with her Finished switch off', async () => {
    const members = await store()
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    await members.load('ida')
    await members.loadShelf('ida')
    await members.loadMoreShelf('ida')
    expect(finishedCalls).toEqual([])
    expect(members.viewOf('ida').shelf).toMatchObject({ items: [], total: null })

    // A closed profile, or a member never read: nothing either.
    answer = { member: card, private: true, state: 'none', visible: false }
    await members.load('ida')
    await members.loadShelf('ida')
    expect(finishedCalls).toEqual([])
    answer = followed
  })

  it('walks the pages after the rows it holds, and never past the end', async () => {
    const next = { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b2' }
    finishedAnswers = [{ data: page(2, 1, 3, next), error: null }, { data: page(1, 3, 3), error: null }]
    const members = await store()
    await members.load('ida')
    await members.loadShelf('ida')
    expect(members.viewOf('ida').shelf.next).toEqual(next)
    await members.loadMoreShelf('ida')
    expect(finishedCalls).toEqual([null, next])
    expect(members.viewOf('ida').shelf.items.map((item) => item.book.id)).toEqual(['b1', 'b2', 'b3'])
    expect(members.viewOf('ida').shelf).toMatchObject({ total: 3, next: null, more: false })
    // The end: another scroll asks nothing.
    await members.loadMoreShelf('ida')
    expect(finishedCalls).toEqual([null, next])
  })

  it('never holds a Book twice, however the pages overlap', async () => {
    // The first page is her profile's newest 12 as well: a page read after a profile that moved must not repeat one.
    finishedAnswers = [{ data: page(3, 1, 4, { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b1' }), error: null }]
    const members = await store()
    await members.load('ida')
    // The page the page's first read holds, and a page behind it that starts one row early.
    finishedAnswers = [
      { data: page(3, 1, 4, { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b3' }), error: null },
      { data: { ...page(2, 3, 4), next: null }, error: null },
    ]
    await members.loadShelf('ida')
    await members.loadMoreShelf('ida')
    expect(members.viewOf('ida').shelf.items.map((item) => item.book.id)).toEqual(['b1', 'b2', 'b3', 'b4'])
  })

  it('keeps the rows it has when a page is refused, and says so with no first page at all', async () => {
    finishedAnswers = [{ data: page(2, 1, 3, { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b2' }), error: null }]
    const members = await store()
    await members.load('ida')
    await members.loadShelf('ida')
    finishedAnswers = [{ data: null, error: 'offline' }]
    await members.loadMoreShelf('ida')
    expect(members.viewOf('ida').shelf).toMatchObject({ items: expect.any(Array), more: false, error: null })
    expect(members.viewOf('ida').shelf.items).toHaveLength(2)

    // The first page failing leaves nothing to draw behind the twelve her profile carries, so the page says why.
    finishedAnswers = [{ data: null, error: 'unknown' }]
    const other = await store()
    await other.load('ida')
    await other.loadShelf('ida')
    expect(other.viewOf('ida').shelf).toMatchObject({ items: [], total: null, loading: false, error: 'unknown' })
  })

  it('asks for one page at a time, however many scrolls ask at once', async () => {
    let release = () => {}
    finishedGate = new Promise<void>((resolve) => (release = resolve))
    finishedAnswers = [{ data: page(2, 1, 3, { day: '2026-01-01', at: '2026-01-01T00:00:00Z', entry: 'b2' }), error: null }]
    const members = await store()
    await members.load('ida')
    const first = members.loadShelf('ida')
    const double = members.loadShelf('ida')
    release()
    finishedGate = null
    await Promise.all([first, double])
    expect(finishedCalls).toEqual([null])
    // A page behind it: asked once, whichever way the scrolls come in.
    finishedAnswers = [{ data: page(1, 3, 3), error: null }]
    const more = members.loadMoreShelf('ida')
    const moreAgain = members.loadMoreShelf('ida')
    await Promise.all([more, moreAgain])
    expect(finishedCalls.filter(Boolean)).toHaveLength(1)
  })

  it('forgets her history with her, on another member', async () => {
    finishedAnswers = [{ data: page(2, 1, 2), error: null }]
    const members = await store()
    await members.load('ida')
    await members.loadShelf('ida')
    expect(members.viewOf('ida').shelf.items).toHaveLength(2)
    // Nothing of her shelf stays when the relation ends (a block, an unfollow, a removed follower).
    members.relationChanged('ida', { kind: 'block' })
    expect(members.viewOf('ida').shelf).toEqual({ items: [], total: null, next: null, loading: false, more: false, error: null })
  })
})
