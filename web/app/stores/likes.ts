import { defineStore } from 'pinia'
import { LOCAL_DATA_PREFIX } from '~/data/localData'
import { createSocial, type MemberCard, type RecentLike, type Social, type SocialErrorCode, type SocialResult } from '~/data/social'
import { useSessionStore } from '~/stores/session'
import { shownFace, toggledFace, type LikeFace, type LikeOverride } from '~/utils/likes'

/**
 * Likes (social v2a, contract §1.2 and §3): the hearts on other members' finished reads and, for her own
 * reads, who liked them. A tap shows its result at once and is sent; the database's answer (the count now)
 * replaces it, a refusal takes it back and the row says so (`failed`). Likes need the connection: offline
 * the heart says Offline and nothing is sent or queued. Home's "Your circle" lists her reads liked this
 * week (`recent`, read with the feed's refresh); the device keeps the last answer for an offline Home.
 * Signing out, or another member signing in, forgets everything.
 */

const DEVICE_KEY = `${LOCAL_DATA_PREFIX}likes`
const DEVICE_VERSION = 1

export const useLikesStore = defineStore('likes', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  let repository: Social | null = null
  function repo(): Social | null {
    if (!backend) return null
    repository ??= createSocial(backend, { online: isOnline })
    return repository
  }

  // ------------------------------------------------------------- the hearts

  /** Her taps, by read: what the heart shows until the row says something else. */
  const overrides = reactive<Record<string, LikeOverride>>({})
  /** A like or unlike on its way, by read. */
  const busy = reactive<Record<string, boolean>>({})
  /** The last tap on this read was refused (and taken back). */
  const failed = reactive<Record<string, boolean>>({})

  /** What the heart of a read shows, given what its row says. */
  function face(session: string, base: LikeFace): LikeFace {
    return shownFace(base, overrides[session])
  }

  /** Likes the read, or takes the like back. Returns false for a refusal. Offline it does nothing (the heart says Offline). */
  async function toggle(read: string, base: LikeFace): Promise<boolean> {
    const r = repo()
    if (!r || busy[read] || !online.value) return false
    const member = session.member?.id
    const now = face(read, base)
    const next = toggledFace(now)
    failed[read] = false
    busy[read] = true
    overrides[read] = { face: next, base }
    const result = await (now.liked ? r.unlike(read) : r.like(read))
    busy[read] = false
    if (member !== session.member?.id) return false
    if (result.error) {
      // Taken back: the row says what it said before the tap.
      delete overrides[read]
      failed[read] = result.error !== 'offline'
      return false
    }
    overrides[read] = { face: { likes: result.data.likes, liked: result.data.liked }, base }
    return true
  }

  // ------------------------------------------------------- her reads' likes

  /** Her reads liked in the last week, newest like first; null until read (or copied from the device). */
  const recent = ref<RecentLike[] | null>(null)
  let loading: Promise<void> | null = null

  function loadRecent(): Promise<void> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member) return Promise.resolve()
    if (!isOnline()) return Promise.resolve()
    loading ??= (async () => {
      const result = await r.myRecentLikes()
      if (member !== session.member?.id || result.error) return
      recent.value = result.data
      save(member, result.data)
    })().finally(() => (loading = null))
    return loading
  }

  /** Who liked one of her reads, newest first (the likers sheet). */
  function likers(read: string): Promise<SocialResult<MemberCard[]>> {
    const r = repo()
    if (!r) return Promise.resolve({ data: null, error: 'unknown' as SocialErrorCode })
    return r.sessionLikers(read)
  }

  function save(member: string, items: RecentLike[]) {
    if (!import.meta.client) return
    try {
      window.localStorage.setItem(DEVICE_KEY, JSON.stringify({ version: DEVICE_VERSION, memberId: member, items }))
    } catch {
      // Full or switched off: an older copy would be wrong.
      try {
        window.localStorage.removeItem(DEVICE_KEY)
      } catch {
        // Nothing more to do.
      }
    }
  }

  /** The device's last copy, when it is this member's. */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member || recent.value) return
    try {
      const parsed = JSON.parse(window.localStorage.getItem(DEVICE_KEY) ?? 'null') as { version?: number; memberId?: string; items?: RecentLike[] } | null
      if (parsed?.version === DEVICE_VERSION && parsed.memberId === member && Array.isArray(parsed.items)) recent.value = parsed.items
    } catch {
      // A torn or foreign value: as good as none.
    }
  }

  function reset() {
    for (const map of [overrides, busy, failed] as Record<string, unknown>[]) for (const key of Object.keys(map)) delete map[key]
    recent.value = null
    loading = null
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

  return { face, toggle, busy, failed, recent, loadRecent, likers, reset }
})
