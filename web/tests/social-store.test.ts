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
  my_people: { following: [], followers: [], followingIds: [], requests: [], requested: [] },
  my_blocked: [],
  block: null,
}
const args: Record<string, unknown>[] = []
/** What `my_people_page` answers, by list; a function of the args so a test can page through a long list. */
let pages: (list: string, before: { at: string; id: string } | null) => unknown[] = () => []
const backend = {
  rpc: async (fn: string, given: Record<string, unknown> = {}) => {
    calls.push(fn)
    args.push(given)
    if (mode === 'silent') return { data: null, error: { message: 'Failed to fetch' }, status: 0 }
    if (fn === 'my_people_page') {
      const before = given.p_before ? { at: String(given.p_before), id: String(given.p_before_id) } : null
      return { data: pages(String(given.p_list), before), error: null, status: 200 }
    }
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
  args.length = 0
  pages = () => []
  answers.my_people = { following: [], followers: [], followingIds: [], requests: [], requested: [] }
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

describe('People in pages', () => {
  const PAGE = 30
  /** `total` members, newest follow first: `m<total>` .. `m1`, a minute apart. */
  const everyone = (total: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: total }, (_, k) => {
      const n = total - k
      return { id: `m${n}`, name: `M${n}`, photo: null, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), ...extra }
    })
  /** The list as the database pages it: the rows after `before`, at most a page. */
  function serve(rows: { id: string }[]) {
    pages = (_list, before) => {
      const from = before ? rows.findIndex((row) => row.id === before.id) + 1 : 0
      return rows.slice(from, from + PAGE)
    }
  }
  const ids = (rows: { id: string }[] | undefined) => rows?.map((row) => row.id)

  it('reads the first page, and says there is more only when it came back full', async () => {
    answers.my_people = { following: everyone(PAGE, { followsYou: false }), followers: everyone(4, { followsBack: false }), followingIds: [], requests: [], requested: [] }
    const social = await store()
    await social.loadPeople()
    expect(social.people?.following).toHaveLength(PAGE)
    expect(social.peopleEnded).toEqual({ following: false, followers: true })
  })

  it('asks for the next page after the last row, by its time and id, until one comes back short', async () => {
    const followers = everyone(70, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    serve(followers)
    const social = await store()
    await social.loadPeople()

    await social.loadMorePeople('followers')
    expect(args.at(-1)).toEqual({ p_list: 'followers', p_before: followers[PAGE - 1]!.at, p_before_id: 'm41', p_limit: PAGE })
    expect(social.people?.followers).toHaveLength(60)
    expect(social.peopleEnded.followers).toBe(false)

    await social.loadMorePeople('followers')
    expect(ids(social.people?.followers)).toEqual(ids(followers))
    expect(social.peopleEnded.followers).toBe(true)

    calls.length = 0
    await social.loadMorePeople('followers')
    expect(calls).toEqual([])
  })

  it('pages Following on its own: the other list is left as it is', async () => {
    const following = everyone(40, { followsYou: true })
    answers.my_people = { following: following.slice(0, PAGE), followers: [], followingIds: ids(following), requests: [], requested: [] }
    serve(following)
    const social = await store()
    await social.loadPeople()
    await social.loadMorePeople('following')
    expect(args.at(-1)).toMatchObject({ p_list: 'following' })
    expect(ids(social.people?.following)).toEqual(ids(following))
    expect(social.people?.followers).toEqual([])
    expect(social.peopleEnded).toEqual({ following: true, followers: true })
  })

  it('asks once while a page is on its way, and a page that is already there is not added twice', async () => {
    const followers = everyone(45, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    // A member who followed meanwhile shifts the list: the page repeats the last row of the one before.
    pages = () => followers.slice(PAGE - 1)
    const social = await store()
    await social.loadPeople()
    const first = social.loadMorePeople('followers')
    expect(social.peopleLoadingMore.followers).toBe(true)
    await Promise.all([first, social.loadMorePeople('followers')])
    expect(calls.filter((fn) => fn === 'my_people_page')).toHaveLength(1)
    expect(social.peopleLoadingMore.followers).toBe(false)
    expect(ids(social.people?.followers)).toEqual(ids(followers))
  })

  it('leaves a page that failed unread, and asks again at the next end; offline it asks nothing', async () => {
    const followers = everyone(40, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    serve(followers)
    const social = await store()
    await social.loadPeople()

    mode = 'silent'
    await social.loadMorePeople('followers')
    expect(social.people?.followers).toHaveLength(PAGE)
    expect(social.peopleEnded.followers).toBe(false)
    expect(social.peopleLoadingMore.followers).toBe(false)

    mode = 'answer'
    online.value = false
    calls.length = 0
    await social.loadMorePeople('followers')
    expect(calls).toEqual([])

    online.value = true
    await social.loadMorePeople('followers')
    expect(social.people?.followers).toHaveLength(40)
  })

  it('reads again as deep as the list was, so unfollowing in a long list does not send her back to its start', async () => {
    const followers = everyone(75, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    serve(followers)
    const social = await store()
    await social.loadPeople()
    await social.loadMorePeople('followers')
    await social.loadMorePeople('followers')
    expect(social.people?.followers).toHaveLength(75)

    calls.length = 0
    await social.removeFollower('m70')
    expect(calls.filter((fn) => fn === 'my_people_page')).toHaveLength(2)
    expect(social.people?.followers).toHaveLength(75)
    expect(social.peopleEnded.followers).toBe(true)
  })

  it('drops a page that arrives after the list was read afresh', async () => {
    const followers = everyone(70, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    serve(followers)
    const social = await store()
    await social.loadPeople()
    const late = social.loadMorePeople('followers')
    await social.loadPeople(true)
    await late
    expect(social.people?.followers).toHaveLength(PAGE)
    expect(social.peopleLoadingMore.followers).toBe(false)
  })

  it('starts from the first page again when her people are dropped (going public settles the requests)', async () => {
    const followers = everyone(40, { followsBack: false })
    answers.my_people = { following: [], followers: followers.slice(0, PAGE), followingIds: [], requests: [], requested: [] }
    serve(followers)
    const social = await store()
    await social.loadPeople()
    await social.loadMorePeople('followers')
    expect(social.peopleEnded.followers).toBe(true)
    await social.setPrivate(false)
    expect(social.people).toBeNull()
    expect(social.peopleEnded).toEqual({ following: false, followers: false })
  })
})
