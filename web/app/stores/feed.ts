import { defineStore } from 'pinia'
import { createFeed, feedDays, FEED_PAGE, readFeed, saveFeed, type Feed, type FeedEntry } from '~/data/feed'
import type { SocialErrorCode } from '~/data/socialShapes'
import { isoDay } from '~/utils/dates'
import { appendPage, copyTakenAt, feedEmptyState, mergeFirstPage, withoutMember } from '~/utils/feedView'
import { useSessionStore } from '~/stores/session'

/**
 * The feed (social v1, docs/proposals/social-v1.md §C, data/feed.ts): what the members she follows
 * did, newest first. Shown on Home as "Your circle" (its newest three) and on its own page
 * (`/friends`, thirty at a time, more as she scrolls).
 *
 * The device keeps the last first page (`saveFeed`), read back when the store is set up, so the feed
 * opens with what was last seen at once and the load that follows only refreshes it; offline it is
 * all there is, and `offlineSince` says when it was taken. A refresh keeps the older pages she has
 * already scrolled to (`mergeFirstPage`). A load that fails keeps what is on screen. Signing out
 * (or another member signing in) forgets all of it; the device's copy goes with the rest of
 * `libellus.`. Read only: nothing here writes.
 *
 * The feed answers `[]` both for a member who follows nobody and for one whose people did nothing
 * yet. `my_people()` is asked once after an empty answer, only to tell the two apart (`emptyState`).
 */
export const useFeedStore = defineStore('feed', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  let repository: Feed | null = null
  function feed(): Feed | null {
    if (!backend) return null
    repository ??= createFeed(backend, { online: isOnline })
    return repository
  }

  const entries = ref<FeedEntry[]>([])
  /** Something to show: the device's copy, or an answer (an empty one included). */
  const loaded = ref(false)
  /** The first page is on its way. */
  const loading = ref(false)
  /** An older page is on its way. */
  const loadingMore = ref(false)
  const loadError = ref<SocialErrorCode | null>(null)
  /** The last page came back short: there is no more. */
  const ended = ref(false)
  /** When what is shown was taken from the database (the device's copy: when it was saved). */
  const takenAt = ref<Date | null>(null)
  /** How many people she follows, once asked after an empty feed; null: not asked, or it failed. */
  const following = ref<number | null>(null)
  /** `my_people()` is on its way: no empty state yet, so the wrong one never shows for a moment. */
  const asking = ref(false)

  const days = computed(() => feedDays(entries.value, (at) => isoDay(new Date(at))))
  /** Offline with entries on screen: when they are from (the offline line). */
  const offlineSince = computed(() => (!online.value && entries.value.length ? takenAt.value : null))
  /** Which empty state to show; null while there are entries or nothing has answered yet. */
  const emptyState = computed(() => (loaded.value && !asking.value && !entries.value.length ? feedEmptyState(following.value) : null))

  async function askFollowing() {
    if (!backend) return
    asking.value = true
    try {
      const { data, error } = await backend.rpc('my_people')
      following.value = error ? null : ((data as { following?: unknown[] } | null)?.following?.length ?? 0)
    } finally {
      asking.value = false
    }
  }

  /** Reads the first page and joins it to what is shown. Offline, or without a backend, it changes nothing. */
  async function refresh() {
    const repo = feed()
    if (!repo || loading.value || !session.member) return
    if (!isOnline()) {
      if (!loaded.value) loadError.value = 'offline'
      return
    }
    const member = session.member?.id
    loading.value = true
    const result = await repo.page()
    if (member !== session.member?.id) return
    loading.value = false
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    const merged = mergeFirstPage(entries.value, result.data)
    // The same entries as the ones showing (the device's copy, or the last load) change nothing on the page.
    if (JSON.stringify(toRaw(entries.value)) !== JSON.stringify(merged)) entries.value = merged
    ended.value = result.data.length < FEED_PAGE
    loaded.value = true
    const now = new Date()
    takenAt.value = now
    if (import.meta.client && member) saveFeed(window.localStorage, member, result.data, now)
    if (merged.length) following.value = null
    else await askFollowing()
  }

  /** The next older page, when there is one and the device can ask. */
  async function loadMore() {
    const repo = feed()
    const last = entries.value.at(-1)
    if (!repo || !last || ended.value || loadingMore.value || loading.value || !isOnline()) return
    const member = session.member?.id
    loadingMore.value = true
    const result = await repo.page({ at: last.at, id: last.id })
    if (member !== session.member?.id) return
    loadingMore.value = false
    // A page that fails stays unread: scrolling to the end asks again.
    if (result.error) return
    entries.value = appendPage(entries.value, result.data)
    ended.value = result.data.length < FEED_PAGE
  }

  /**
   * A member is no longer in her circle (unfollowed, blocked, removed as a follower; told by the social
   * store, which changes the relationship): her entries leave what is shown and the device's copy is
   * saved again without them, with the time it was taken (not "now": the rest is no newer). Without it
   * an offline Home, or a refresh that keeps the older pages she scrolled to, would still show her.
   */
  function dropMember(id: string) {
    if (!entries.value.some((entry) => entry.member.id === id)) return
    entries.value = withoutMember(entries.value, id)
    const member = session.member?.id
    if (import.meta.client && member) saveFeed(window.localStorage, member, entries.value.slice(0, FEED_PAGE), takenAt.value ?? new Date())
    // Nothing left: the empty state depends on whether she follows anyone still.
    if (!entries.value.length && isOnline()) void askFollowing()
  }

  function reset() {
    entries.value = []
    loaded.value = false
    loading.value = false
    loadingMore.value = false
    loadError.value = null
    ended.value = false
    takenAt.value = null
    following.value = null
    asking.value = false
  }

  /** Puts back the first page this device saw last, if it is this member's. */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member || loaded.value) return
    const saved = readFeed(window.localStorage, member, new Date())
    if (!saved) return
    entries.value = saved
    takenAt.value = copyTakenAt(window.localStorage, member)
    ended.value = saved.length < FEED_PAGE
    loaded.value = true
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      restore()
    },
  )
  restore()

  // Back online with the feed waiting on it (nothing shown, or the copy only): ask without a tap.
  watch(online, (now) => {
    if (now && (loadError.value === 'offline' || takenAt.value)) void refresh()
  })

  return { entries, days, loaded, loading, loadingMore, loadError, ended, offlineSince, emptyState, refresh, loadMore, dropMember, reset }
})
