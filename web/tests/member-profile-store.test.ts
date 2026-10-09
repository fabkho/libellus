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
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))
vi.mock('~/stores/social', () => ({
  useSocialStore: () => ({
    profile: async () => ({ data: answer, error: null }),
    want: async () => ({ data: null, error: null }),
  }),
}))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({ rpc: async () => ({ data: null, error: null, status: 200 }) }))
  vi.stubGlobal('useOnline', () => readonly(ref(true)))
  vi.stubGlobal('isOnline', () => true)
  setActivePinia(createPinia())
  const { useMemberProfileStore } = await import('~/stores/memberProfile')
  return useMemberProfileStore()
}

afterEach(() => vi.unstubAllGlobals())

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
