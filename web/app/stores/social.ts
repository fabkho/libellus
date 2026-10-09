import { defineStore } from 'pinia'
import {
  createSocial,
  PEOPLE_PAGE,
  type FollowTarget,
  type MemberCard,
  type MemberProfile,
  type MySocial,
  type People,
  type PeopleList,
  type Social,
  type SocialErrorCode,
  type SocialResult,
  type SocialSection,
} from '~/data/social'
import { useSessionStore } from '~/stores/session'
import { useFeedStore } from '~/stores/feed'
import { useMemberPhotosStore } from '~/stores/memberPhotos'
import { useMemberProfileStore } from '~/stores/memberProfile'
import type { RelationChange } from '~/utils/memberProfile'
import { createRereads } from '~/utils/rereads'

/**
 * Following, her side (social v1, data/social.ts): her own settings (private or public, what her
 * followers see, her follow link), her people and the members she blocked. The one store of following
 * for every screen of it: Profile → Friends (settings, link, blocked) and, later, People, the feed's
 * request rows, a member's profile. Each part is read when a screen needs it, once per sign-in, and
 * every change is written at once (no Save): what the database answered replaces what was shown.
 *
 * Writes wait for a connection (the repository refuses them offline, the controls say Offline). A
 * refusal is kept per action for the sheet that made it to show (`errors`). Signing out, or another
 * member signing in, forgets everything.
 *
 * People comes in pages: Following and Followers the first thirty newest follows at first and the next
 * ones through `loadMorePeople` (`peopleEnded`, `peopleLoadingMore`); Requests and Requested whole.
 */

/** The actions whose refusal a sheet shows. */
export type SocialAction = 'load' | 'people' | 'blocked' | 'privacy' | 'link' | 'unblock' | 'follow'

export const useSocialStore = defineStore('social', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: Social | null = null
  function repo(): Social | null {
    if (!backend) return null
    repository ??= createSocial(backend, { online: isOnline })
    return repository
  }

  /** Her settings; null until known. */
  const mine = ref<MySocial | null>(null)
  /** Who she follows, who follows her, who asked, who she asked; null until known. */
  const people = ref<People | null>(null)
  /** Per list: the last page came back short, there is no more to ask for. */
  const peopleEnded = ref<Record<PeopleList, boolean>>({ following: false, followers: false })
  /** Per list: an older page is on its way. */
  const peopleLoadingMore = ref<Record<PeopleList, boolean>>({ following: false, followers: false })
  /** The members she blocked; null until known. */
  const blocked = ref<MemberCard[] | null>(null)
  /** The last refusal of each action; cleared when the action is tried again. */
  const errors = ref<Partial<Record<SocialAction, SocialErrorCode>>>({})
  /** A write on its way: the controls wait for it. */
  const busy = ref(false)

  /** Follow requests waiting for her answer (the People row's value, the lamp dot on her avatar). */
  const requests = computed(() => mine.value?.requests ?? 0)

  /** What a write that got no answer may have changed on the server: read again when back online. */
  const rereads = createRereads<'mine' | 'people' | 'blocked'>()

  let loadedFor: string | null = null
  let loadingMine: Promise<void> | null = null
  let loadingPeople: Promise<void> | null = null
  let loadingBlocked: Promise<void> | null = null
  /** Counts the lists read afresh or dropped: a page that was asked for before is then of a list that is gone. */
  let peopleEpoch = 0

  /** Keeps `result`'s data in `target` when this member is still the one signed in; true when it did. */
  function take<T>(member: string, action: SocialAction, result: SocialResult<T>, keep: (data: T) => void): boolean {
    if (member !== session.member?.id) return false
    if (result.error) {
      errors.value = { ...errors.value, [action]: result.error }
      return false
    }
    errors.value = { ...errors.value, [action]: undefined }
    keep(result.data)
    return true
  }

  /** Her settings (made on the first call). Read once per sign-in unless `force`. */
  function load(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && loadedFor === member && mine.value)) return Promise.resolve()
    loadingMine ??= (async () => {
      const r = repo()
      if (!r) return
      const result = await r.mine()
      if (take(member, 'load', result, (data) => (mine.value = data))) loadedFor = member
    })().finally(() => (loadingMine = null))
    return loadingMine
  }

  /**
   * Her people. Read once per sign-in unless `force`; read again, it is the first page of Following and
   * Followers and then as many more as she had scrolled to, so a list she is deep in does not jump back
   * to its start when she unfollows someone or a request is answered.
   */
  function loadPeople(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && people.value)) return Promise.resolve()
    loadingPeople ??= (async () => {
      const r = repo()
      if (!r) return
      const had = { following: people.value?.following.length ?? 0, followers: people.value?.followers.length ?? 0 }
      const result = await r.people()
      if (member !== session.member?.id) return
      if (result.error) return void take(member, 'people', result, () => undefined)
      let read = result.data
      const ended = { following: read.following.length < PEOPLE_PAGE, followers: read.followers.length < PEOPLE_PAGE }
      for (const list of ['following', 'followers'] as const) {
        while (!ended[list] && read[list].length < had[list]) {
          const last = read[list].at(-1)!
          const more = await (list === 'following' ? r.peoplePage('following', last) : r.peoplePage('followers', last))
          if (member !== session.member?.id) return
          // A page that fails leaves the list as far as it got; the end mark asks again.
          if (more.error) break
          read = { ...read, [list]: [...read[list], ...more.data] }
          ended[list] = more.data.length < PEOPLE_PAGE
        }
      }
      peopleEpoch++
      peopleEnded.value = ended
      take(member, 'people', { data: read, error: null }, (data) => (people.value = data))
    })().finally(() => (loadingPeople = null))
    return loadingPeople
  }

  /**
   * The next page of Following or Followers, when the list has one and the device can ask: asked when the
   * end of the list shows. A page that fails stays unread (the end showing again asks again); one that
   * arrives after the list was read afresh or dropped is of a list that is gone, and is left out.
   */
  async function loadMorePeople(list: PeopleList): Promise<void> {
    const r = repo()
    const member = session.member?.id
    const have = people.value
    const last = have?.[list].at(-1)
    if (!r || !member || !have || !last || peopleEnded.value[list] || peopleLoadingMore.value[list] || !isOnline()) return
    const epoch = peopleEpoch
    peopleLoadingMore.value = { ...peopleLoadingMore.value, [list]: true }
    const result = await (list === 'following' ? r.peoplePage('following', last) : r.peoplePage('followers', last))
    peopleLoadingMore.value = { ...peopleLoadingMore.value, [list]: false }
    if (epoch !== peopleEpoch || member !== session.member?.id) return
    if (result.error || !people.value) return
    const known = new Set(people.value[list].map((row) => row.id))
    const fresh = result.data.filter((row) => !known.has(row.id))
    people.value = { ...people.value, [list]: [...people.value[list], ...fresh] } as People
    peopleEnded.value = { ...peopleEnded.value, [list]: result.data.length < PEOPLE_PAGE }
  }

  /** Forgets what was read of People, so the next read starts from the first page. */
  function dropPeople() {
    people.value = null
    peopleEpoch++
    peopleEnded.value = { following: false, followers: false }
  }

  function loadBlocked(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && blocked.value)) return Promise.resolve()
    loadingBlocked ??= (async () => {
      const r = repo()
      if (!r) return
      take(member, 'blocked', await r.blocked(), (data) => (blocked.value = data))
    })().finally(() => (loadingBlocked = null))
    return loadingBlocked
  }

  /** One write that answers with her settings. True when it went through. */
  async function writeMine(action: SocialAction, run: (r: Social) => Promise<SocialResult<MySocial>>): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || busy.value) return false
    busy.value = true
    errors.value = { ...errors.value, [action]: undefined }
    const sent = isOnline()
    const result = await run(r).finally(() => (busy.value = false))
    rereads.note(sent, result.error, action === 'privacy' ? ['mine', 'people'] : ['mine'])
    const kept = take(member, action, result, (data) => {
      mine.value = data
      loadedFor = member
    })
    // Going public settles the requests waiting: People is no longer what it was.
    if (kept && action === 'privacy') dropPeople()
    return kept
  }

  const setPrivate = (on: boolean) => writeMine('privacy', (r) => r.setPrivate(on))
  const setSections = (sections: Partial<Record<SocialSection, boolean>>) => writeMine('privacy', (r) => r.setSections(sections))
  const renewLink = () => writeMine('link', (r) => r.renewLink())

  /** Unblocking: the list she sees is what the database answers afterwards. */
  async function unblock(id: string): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || busy.value) return false
    busy.value = true
    errors.value = { ...errors.value, unblock: undefined }
    const sent = isOnline()
    const result = await r.unblock(id).finally(() => (busy.value = false))
    rereads.note(sent, result.error, ['blocked', 'people'])
    if (!take(member, 'unblock', result, () => undefined)) return false
    await loadBlocked(true)
    dropPeople()
    return true
  }

  // ----------------------------------------------------- for the later screens

  /**
   * A change to who follows whom: done, then what it touches is read again (her settings carry the
   * requests count, People the lists, Blocked the list). The result is the repository's, for the screen.
   * `after` tells the other stores what the answer changed (the feed, the member's profile), so none of
   * them waits for a read that may fail and no page patches itself.
   */
  async function change<T>(
    run: (r: Social) => Promise<SocialResult<T>>,
    refresh: ('mine' | 'people' | 'blocked')[],
    after?: (data: T) => void,
  ): Promise<SocialResult<T>> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member) return { data: null, error: 'not_signed_in' }
    errors.value = { ...errors.value, follow: undefined }
    const sent = isOnline()
    const result = await run(r)
    if (member !== session.member?.id) return result
    rereads.note(sent, result.error, refresh)
    if (result.error) {
      errors.value = { ...errors.value, follow: result.error }
      return result
    }
    after?.(result.data)
    await Promise.all([
      refresh.includes('mine') ? load(true) : null,
      refresh.includes('people') ? loadPeople(true) : null,
      refresh.includes('blocked') ? loadBlocked(true) : null,
    ])
    return result
  }

  /**
   * One place for what a change of relation does to the others (the stores below only keep what they were
   * told): her profile on screen follows the action (`relationChanged`); `left` (unfollow, block, remove as
   * follower): nothing of her stays on the device (her photo, in memory and in IndexedDB, and what was read
   * of her profile), and `fromFeed` (she leaves her circle: unfollow, block) her entries leave the feed and
   * its device copy. Remove as follower leaves the feed alone: whom she follows is unchanged.
   */
  function relation(member: string, what: RelationChange, { left = false, fromFeed = false } = {}) {
    if (fromFeed) useFeedStore().dropMember(member)
    if (left) useMemberPhotosStore().drop(member)
    useMemberProfileStore().relationChanged(member, what)
  }

  const follow = (member: string) => change((r) => r.follow(member), ['people'], (state) => relation(member, { kind: 'follow', state }))
  const withdraw = (member: string) => change((r) => r.withdraw(member), ['people'], () => relation(member, { kind: 'withdraw' }))
  const answer = (member: string, accept: boolean) => change((r) => r.answer(member, accept), ['mine', 'people'])
  const unfollow = (member: string) => change((r) => r.unfollow(member), ['people'], () => relation(member, { kind: 'unfollow' }, { left: true, fromFeed: true }))
  // She stops following the caller: what the caller sees of her feed is unchanged.
  const removeFollower = (member: string) => change((r) => r.removeFollower(member), ['people'], () => relation(member, { kind: 'removeFollower' }, { left: true }))
  const block = (member: string) => change((r) => r.block(member), ['mine', 'people', 'blocked'], () => relation(member, { kind: 'block' }, { left: true, fromFeed: true }))

  /** What a follow link opens, a member's profile and her whole Want to read: read, nothing kept. */
  const target = async (token: string): Promise<SocialResult<FollowTarget | null>> => repo()?.target(token) ?? { data: null, error: 'unknown' }
  const profile = async (member: string): Promise<SocialResult<MemberProfile | null>> => repo()?.profile(member) ?? { data: null, error: 'unknown' }
  const want = async (member: string) => repo()?.want(member) ?? { data: null, error: 'unknown' as const }

  function clearError(action?: SocialAction) {
    errors.value = action ? { ...errors.value, [action]: undefined } : {}
  }

  function reset() {
    mine.value = null
    dropPeople()
    peopleLoadingMore.value = { following: false, followers: false }
    blocked.value = null
    errors.value = {}
    busy.value = false
    loadedFor = null
    rereads.clear()
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online: read what could not be read while offline, or never was (the header skips her settings
  // offline, People and Blocked opened with nothing to show), and the reads a write that got no answer may
  // have changed (the server may have applied it before the line died).
  const online = useOnline()
  watch(online, (now) => {
    if (!now) return
    if (!mine.value || errors.value.load) void load(true)
    if (errors.value.people) void loadPeople(true)
    if (errors.value.blocked) void loadBlocked(true)
    for (const target of rereads.take()) void (target === 'mine' ? load(true) : target === 'people' ? loadPeople(true) : loadBlocked(true))
  })

  return {
    mine,
    people,
    peopleEnded,
    peopleLoadingMore,
    blocked,
    errors,
    busy,
    requests,
    load,
    loadPeople,
    loadMorePeople,
    loadBlocked,
    setPrivate,
    setSections,
    renewLink,
    unblock,
    target,
    follow,
    withdraw,
    answer,
    unfollow,
    removeFollower,
    block,
    profile,
    want,
    clearError,
    reset,
  }
})
