import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, readonly, ref, toRaw, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The social store's reads after a connection comes back (social v1, gate 2: M1, M2, L5, L6). The store runs
 * here as it does in Nuxt, with the auto-imports it uses stood in for: a fake backend that answers or fails
 * with no answer (status 0), a signed-in member and a switch for the connection.
 */

const online = ref(true)
const calls: string[] = []
let mode: 'answer' | 'silent' = 'answer'

const settings = { private: true, sections: {}, link: 'x'.repeat(22), requests: 0 }
const answers: Record<string, unknown> = {
  follow: { state: 'requested' },
  unfollow: null,
  remove_follower: null,
  my_social: settings,
  set_private: settings,
  my_people: { following: [], followers: [], requests: [], requested: [] },
  my_blocked: [],
  block: null,
}
const backend = {
  rpc: async (fn: string) => {
    calls.push(fn)
    if (mode === 'silent') return { data: null, error: { message: 'Failed to fetch' }, status: 0 }
    return { data: answers[fn] ?? null, error: null, status: 200 }
  },
}

const told = { dropped: [] as string[], photos: [] as string[], changes: [] as unknown[] }
vi.mock('~/stores/feed', () => ({ useFeedStore: () => ({ dropMember: (id: string) => told.dropped.push(id) }) }))
vi.mock('~/stores/memberPhotos', () => ({ useMemberPhotosStore: () => ({ drop: (id: string) => told.photos.push(id) }) }))
vi.mock('~/stores/memberProfile', () => ({ useMemberProfileStore: () => ({ relationChanged: (id: string, change: unknown) => told.changes.push([id, change]) }) }))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  setActivePinia(createPinia())
  const { useSocialStore } = await import('~/stores/social')
  return useSocialStore()
}

/** The connection dies without the browser noticing, a write goes unanswered, then it answers again. */
async function reconnect() {
  online.value = false
  await nextTick()
  mode = 'answer'
  calls.length = 0
  online.value = true
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  told.dropped.length = 0
  told.photos.length = 0
  told.changes.length = 0
  online.value = true
  mode = 'answer'
  calls.length = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('back online', () => {
  it('reads again what a write that got no answer may have changed', async () => {
    const social = await store()
    await social.loadPeople(true)
    mode = 'silent'
    const result = await social.follow('ben')
    expect(result.error).toBe('offline')
    await reconnect()
    expect(calls).toContain('my_people')
  })

  it('reads nothing for a write that was refused before it was sent', async () => {
    const social = await store()
    await social.loadPeople(true)
    online.value = false
    await nextTick()
    expect((await social.follow('ben')).error).toBe('offline')
    await reconnect()
    expect(calls).not.toContain('my_people')
  })

  it('reads People, Blocked and her settings that could not be read offline (M2, L5, L6)', async () => {
    mode = 'silent'
    const social = await store()
    await social.loadPeople(true)
    await social.loadBlocked(true)
    expect(social.errors).toMatchObject({ people: 'offline', blocked: 'offline' })
    expect(social.people).toBeNull()
    await reconnect()
    expect(calls).toEqual(expect.arrayContaining(['my_social', 'my_people', 'my_blocked']))
    expect(social.people).not.toBeNull()
    expect(social.blocked).toEqual([])
    expect(toRaw(social.mine)).toMatchObject({ private: true })
  })
})

describe('a change of relation tells the feed and the member\'s profile (M3, M4)', () => {
  it('drops her from the feed and patches her profile after Unfollow and Block, not after Remove as follower', async () => {
    const social = await store()
    await social.unfollow('ida')
    await social.block('ben')
    await social.removeFollower('cy')
    expect(told.dropped).toEqual(['ida', 'ben'])
    expect(told.changes).toEqual([
      ['ida', { kind: 'unfollow' }],
      ['ben', { kind: 'block' }],
      ['cy', { kind: 'removeFollower' }],
    ])
  })

  it('patches her profile with the state a follow answered', async () => {
    const social = await store()
    await social.follow('ida')
    expect(told.changes).toEqual([['ida', { kind: 'follow', state: 'requested' }]])
    expect(told.dropped).toEqual([])
  })

  it('tells nobody of a change that was refused', async () => {
    const social = await store()
    mode = 'silent'
    expect((await social.unfollow('ida')).error).toBe('offline')
    expect(told.dropped).toEqual([])
    expect(told.changes).toEqual([])
  })
})

describe('nothing of a member stays on the device after she is blocked, unfollowed or removed (P2)', () => {
  it('drops her photo after each of the three, and her feed rows after Unfollow and Block only', async () => {
    const social = await store()
    await social.unfollow('ida')
    await social.block('ben')
    await social.removeFollower('cy')
    expect(told.photos).toEqual(['ida', 'ben', 'cy'])
    expect(told.dropped).toEqual(['ida', 'ben'])
  })

  it('drops nothing for a follow, or for a change that was refused', async () => {
    const social = await store()
    await social.follow('ida')
    mode = 'silent'
    await social.block('ben')
    expect(told.photos).toEqual([])
    expect(told.dropped).toEqual([])
  })
})
