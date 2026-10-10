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
const bothCalls: (number | null)[] = []
let recordAnswer: { data: unknown; error: unknown; status: number } = { data: null, error: null, status: 200 }
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/social', () => ({
  useSocialStore: () => ({
    profile: async () => ({ data: answer, error: null }),
    want: async () => ({ data: null, error: null }),
    bothRead: async (_id: string, year: number | null) => {
      bothCalls.push(year)
      return bothAnswer
    },
  }),
}))

async function store() {
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
    expect(members.viewOf('ida')).toMatchObject({ bothRead: {}, error: null, recordError: null, loaded: true })
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
