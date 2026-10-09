import { defineStore } from 'pinia'
import {
  createSocial,
  type FollowTarget,
  type MemberCard,
  type MemberProfile,
  type MySocial,
  type People,
  type Social,
  type SocialErrorCode,
  type SocialResult,
  type SocialSection,
} from '~/data/social'
import { useSessionStore } from '~/stores/session'
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

  function loadPeople(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && people.value)) return Promise.resolve()
    loadingPeople ??= (async () => {
      const r = repo()
      if (!r) return
      take(member, 'people', await r.people(), (data) => (people.value = data))
    })().finally(() => (loadingPeople = null))
    return loadingPeople
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
    if (kept && action === 'privacy') people.value = null
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
    people.value = null
    return true
  }

  // ----------------------------------------------------- for the later screens

  /**
   * A change to who follows whom: done, then what it touches is read again (her settings carry the
   * requests count, People the lists, Blocked the list). The result is the repository's, for the screen.
   */
  async function change<T>(run: (r: Social) => Promise<SocialResult<T>>, refresh: ('mine' | 'people' | 'blocked')[]): Promise<SocialResult<T>> {
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
    await Promise.all([
      refresh.includes('mine') ? load(true) : null,
      refresh.includes('people') ? loadPeople(true) : null,
      refresh.includes('blocked') ? loadBlocked(true) : null,
    ])
    return result
  }

  const follow = (member: string) => change((r) => r.follow(member), ['people'])
  const withdraw = (member: string) => change((r) => r.withdraw(member), ['people'])
  const answer = (member: string, accept: boolean) => change((r) => r.answer(member, accept), ['mine', 'people'])
  const unfollow = (member: string) => change((r) => r.unfollow(member), ['people'])
  const removeFollower = (member: string) => change((r) => r.removeFollower(member), ['people'])
  const block = (member: string) => change((r) => r.block(member), ['mine', 'people', 'blocked'])

  /** What a follow link opens, a member's profile and her whole Want to read: read, nothing kept. */
  const target = async (token: string): Promise<SocialResult<FollowTarget | null>> => repo()?.target(token) ?? { data: null, error: 'unknown' }
  const profile = async (member: string): Promise<SocialResult<MemberProfile | null>> => repo()?.profile(member) ?? { data: null, error: 'unknown' }
  const want = async (member: string) => repo()?.want(member) ?? { data: null, error: 'unknown' as const }

  function clearError(action?: SocialAction) {
    errors.value = action ? { ...errors.value, [action]: undefined } : {}
  }

  function reset() {
    mine.value = null
    people.value = null
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

  // Back online with her settings never read: read them now. So are the reads a write that got no
  // answer may have changed (the server may have applied it before the line died).
  const online = useOnline()
  watch(online, (now) => {
    if (!now) return
    if (errors.value.load === 'offline') void load()
    for (const target of rereads.take()) void (target === 'mine' ? load(true) : target === 'people' ? loadPeople(true) : loadBlocked(true))
  })

  return {
    mine,
    people,
    blocked,
    errors,
    busy,
    requests,
    load,
    loadPeople,
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
