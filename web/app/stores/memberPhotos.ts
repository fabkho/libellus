import { defineStore } from 'pinia'
import {
  createAvatar,
  indexedDbAvatarCache,
  mayRetryMemberPhoto,
  memberPhotoPlan,
  memoryAvatarCache,
  type AvatarCache,
  type AvatarRepository,
  type CachedAvatar,
} from '~/data/avatar'
import type { MemberCard } from '~/data/socialShapes'
import { useSessionStore } from '~/stores/session'

/**
 * The photos of the members in her circle (social v1, U7). `photoOf(card)`
 * is an object URL of the member's small photo (`'large'`: the big one, for a
 * profile's hero), or null while it loads, offline without a copy, after a
 * failed download, and for a member with none: the avatar then draws initials.
 *
 * The files come through `createAvatar(...).download` with her session (the
 * bucket's select policy lets a connected member's photo through) and are
 * kept in the same IndexedDB store as her own photo, one record per member id,
 * so a second visit and an offline start show them. What happens to a record
 * is `memberPhotoPlan`'s: the card's path decides: the same path keeps it, a
 * new one replaces it, and a card whose `photo` is null deletes it.
 *
 * One download per member at a time; nothing is downloaded offline; a failed
 * one is asked again by the first `photoOf` after a minute. Her own id never
 * comes here (her photo is `stores/avatar.ts`'s). Signing out forgets every
 * URL (the database itself is deleted then).
 */
export const useMemberPhotosStore = defineStore('memberPhotos', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: AvatarRepository | null = null
  function repo(): AvatarRepository | null {
    if (!backend) return null
    repository ??= createAvatar(backend, { online: isOnline })
    return repository
  }

  let deviceCache: AvatarCache | null = null
  function cache(): AvatarCache {
    deviceCache ??= import.meta.client && 'indexedDB' in window ? indexedDbAvatarCache(window.indexedDB) : memoryAvatarCache()
    return deviceCache
  }

  type Shown = { path: string; small: string; large: string }
  /** What is on screen per member id. */
  const shown = ref<Record<string, Shown>>({})

  /** Members whose record has been read from the device (once each). */
  const read = new Set<string>()
  /** The path (or null) each member's record was last brought in line with. */
  const settled = new Map<string, string | null>()
  /** The card's path each member was last asked about: what a finished run must still match. */
  const wanted = new Map<string, string | null>()
  const running = new Map<string, Promise<void>>()
  const failed = new Map<string, { path: string; at: number }>()
  /** Bumped per member by `drop`: a run for her that began before it throws its result away. */
  const dropped = new Map<string, number>()
  /** Bumped on sign-out and when another member signs in: a run that began before it throws its result away. */
  let generation = 0

  function show(memberId: string, photo: CachedAvatar | null) {
    const before = shown.value[memberId]
    if (before) {
      URL.revokeObjectURL(before.small)
      URL.revokeObjectURL(before.large)
    }
    if (photo) {
      shown.value = { ...shown.value, [memberId]: { path: photo.path, small: URL.createObjectURL(photo.small), large: URL.createObjectURL(photo.large) } }
    } else if (before) {
      const { [memberId]: _gone, ...rest } = shown.value
      shown.value = rest
    }
  }

  async function keep(memberId: string, photo: CachedAvatar | null) {
    try {
      await cache().write(memberId, photo)
    } catch {
      // No room or no IndexedDB: shown now, downloaded again next time.
    }
  }

  async function reconcile(memberId: string, run: number): Promise<void> {
    const card = wanted.get(memberId) ?? null
    const drops = dropped.get(memberId) ?? 0
    if (!read.has(memberId)) {
      const kept = await cache().read(memberId).catch(() => null)
      if (run !== generation || drops !== (dropped.get(memberId) ?? 0)) return
      read.add(memberId)
      if (kept && !shown.value[memberId]) show(memberId, kept)
    }
    const plan = memberPhotoPlan(shown.value[memberId]?.path ?? null, card)
    if (plan === 'none' || plan === 'keep') return void settled.set(memberId, card)
    if (plan === 'delete') {
      show(memberId, null)
      await keep(memberId, null)
      if (run === generation) settled.set(memberId, null)
      return
    }
    // A new photo: nothing is downloaded offline (the old one, if any, stays on screen).
    const r = repo()
    if (!r || !isOnline() || !card || !mayRetryMemberPhoto(failed.get(memberId) ?? null, card, Date.now())) return
    const files = await r.download(card)
    if (run !== generation || drops !== (dropped.get(memberId) ?? 0)) return
    if (files.error) return void failed.set(memberId, { path: card, at: Date.now() })
    failed.delete(memberId)
    const photo = { path: card, ...files.data }
    show(memberId, photo)
    settled.set(memberId, card)
    await keep(memberId, photo)
  }

  /** One run per member at a time; another right after it when the card changed meanwhile. */
  function ensure(memberId: string) {
    if (running.has(memberId)) return
    const run = generation
    const go = (async () => {
      let again = true
      while (again && run === generation) {
        const asked = wanted.get(memberId) ?? null
        await reconcile(memberId, run).catch(() => {})
        again = run === generation && (wanted.get(memberId) ?? null) !== asked
      }
    })().finally(() => {
      if (running.get(memberId) === go) running.delete(memberId)
    })
    running.set(memberId, go)
  }

  /**
   * The member's photo as an object URL, or null. Reactive; asks for the
   * files itself when the card names a photo the device does not have (and
   * deletes the record when the card names none).
   */
  function photoOf(card: MemberCard, size: 'small' | 'large' = 'small'): string | null {
    const id = card.id
    if (!id || id === session.member?.id) return null
    const photo = card.photo ?? null
    wanted.set(id, photo)
    const current = shown.value[id]
    const upToDate = settled.get(id) === photo && read.has(id)
    if (!upToDate && !running.has(id)) queueMicrotask(() => ensure(id))
    // A card without a photo shows none, whatever the record still holds until it is deleted.
    if (!photo || !current) return null
    return current[size]
  }

  /**
   * Nothing of this member stays on the device: her URLs are revoked and her record deleted from IndexedDB
   * (a bare avatar never reaches the plan's "delete" branch, which needs a card without a photo). Told by the
   * social store once she is blocked, unfollowed or removed as a follower; a member who shows again is
   * downloaded again, if the bucket still lets her photo through.
   */
  function drop(memberId: string) {
    dropped.set(memberId, (dropped.get(memberId) ?? 0) + 1)
    show(memberId, null)
    read.delete(memberId)
    settled.delete(memberId)
    wanted.delete(memberId)
    running.delete(memberId)
    failed.delete(memberId)
    void keep(memberId, null)
  }

  function forget() {
    generation++
    dropped.clear()
    for (const photo of Object.values(shown.value)) {
      URL.revokeObjectURL(photo.small)
      URL.revokeObjectURL(photo.large)
    }
    shown.value = {}
    read.clear()
    settled.clear()
    wanted.clear()
    running.clear()
    failed.clear()
    deviceCache = null
  }

  // Signing out or another member: the IndexedDB database is deleted on sign-out; the URLs go too.
  watch(
    () => session.member?.id ?? null,
    (now, before) => {
      if (now !== before) forget()
    },
  )

  return { photoOf, drop }
})
