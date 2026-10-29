import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, readonly, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemberProfile } from '../app/data/socialShapes'

/** The member profile store follows a change of relation at once (social v1, gate 2, M4), with the auto-imports stood in. */

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
const bothCalls: (number | null)[] = []
let recordAnswer: { data: unknown; error: unknown; status: number } = { data: null, error: null, status: 200 }
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/social', () => ({
  useSocialStore: () => ({
    profile: async () => ({ data: answer, error: null }),
    want: async () => ({ data: null, error: null }),
    bothRead: async (_id: string, year: number | null) => {
      bothCalls.push(year)
      if (bothGate) await bothGate
      return bothAnswer
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
  vi.unstubAllGlobals()
  bothAnswer = { data: [], error: null }
  bothGate = null
  bothCalls.length = 0
  recordAnswer = { data: null, error: null, status: 200 }
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

  it('is not asked for a profile that hides her finished Books', async () => {
    answer = { ...followed, sections: { ...OPEN, finished: false } }
    const members = await store()
    await members.load('ida')
    answer = followed
    expect(bothCalls).toEqual([])
  })
})

describe('You both read, asked for ahead and kept on the device', () => {
  const read = { book: { id: 'b', title: 'B', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false, unverified: false }, mine: { rating: 12, endedOn: null }, hers: { rating: 16, endedOn: null } }
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  it('asks once for a friend however many ask before and while her page opens, and the page takes that answer', async () => {
    bothAnswer = { data: [read], error: null }
    const members = await store()
    const [a, b] = await Promise.all([members.prefetchBothRead('ida'), members.prefetchBothRead('ida')])
    expect(a).toEqual([read])
    expect(b).toEqual([read])
    await members.load('ida')
    expect(bothCalls).toEqual([null])
    expect(members.viewOf('ida').bothRead).toEqual({ all: [read] })
    // The answer was taken: a later read of her page asks again.
    await members.load('ida')
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
    // Changed Books replace it.
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
    bothAnswer = { data: null, error: 'unknown' }
    await members.load('ida')
    expect(data.size).toBe(0)
    expect(members.viewOf('ida').bothRead.all).toEqual([])
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
