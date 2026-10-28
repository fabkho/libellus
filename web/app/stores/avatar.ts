import { defineStore } from 'pinia'
import {
  createAvatar,
  indexedDbAvatarCache,
  memoryAvatarCache,
  type AvatarCache,
  type AvatarErrorCode,
  type AvatarFiles,
  type AvatarRepository,
  type CachedAvatar,
} from '~/data/avatar'
import { useSessionStore } from '~/stores/session'

/** How long a decode may hold a photo back; how long an old object URL outlives the one that replaced it. */
const DECODE_MS = 1500
const REVOKE_MS = 2000

/**
 * The member's profile photo (issue #156, data/avatar.ts) as the avatars show
 * it: `small` for the tab header's, `large` for the Profile's ring and the
 * photo sheet, both object URLs of the files the device keeps (IndexedDB,
 * deleted with everything else on sign-out), or null for her initials.
 *
 * `load` shows the device's copy at once (offline too), then, online, asks
 * her account which photo is current and downloads it only when the path is a
 * new one. Once per member, again after every save. A photo whose files are
 * gone (a restored backup has no Storage) shows the initials.
 */
export const useAvatarStore = defineStore('avatar', () => {
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

  /** The current photo's path; null: initials. */
  const path = ref<string | null>(null)
  const large = ref<string | null>(null)
  const small = ref<string | null>(null)
  const saving = ref(false)
  const error = ref<AvatarErrorCode | null>(null)

  /**
   * A blob's object URL, once its picture is decoded. WebKit decodes a blob image on its own time: a header that
   * mounts with a URL it has not decoded yet draws the initials for a frame or more first (every tab switch
   * mounts a new header). Decoded here, once, and the `Image` handed back to be kept (a reference keeps the
   * bitmap in the engine's cache for every avatar that later shows the URL). A decode that fails or hangs does
   * not hold the photo back: it is shown as it always was.
   */
  async function decoded(blob: Blob, keepers: HTMLImageElement[]): Promise<string> {
    const url = URL.createObjectURL(blob)
    if (typeof Image === 'undefined') return url
    const image = new Image()
    image.src = url
    keepers.push(image)
    let timer: ReturnType<typeof setTimeout> | undefined
    const giveUp = new Promise<void>((resolve) => (timer = setTimeout(resolve, DECODE_MS)))
    await Promise.race([image.decode().catch(() => {}), giveUp])
    clearTimeout(timer)
    return url
  }

  /** The decoded images of the photo on screen: only the reference matters. */
  let held: HTMLImageElement[] = []
  /** Which `show` is the latest: a photo still decoding when another one came (or she signed out) is dropped. */
  let latest = 0

  /**
   * Shows `photo` (null: the initials, at once). The new URLs are published together and decoded; the old ones
   * are revoked only after that, and a moment later still (`REVOKE_MS`), so no avatar (a kept-alive page's, one
   * mid-render) ever points at a URL that is gone.
   */
  async function show(photo: CachedAvatar | null): Promise<void> {
    const ticket = ++latest
    let next: { path: string; large: string; small: string } | null = null
    const keepers: HTMLImageElement[] = []
    if (photo) {
      const [nextSmall, nextLarge] = await Promise.all([decoded(photo.small, keepers), decoded(photo.large, keepers)])
      if (ticket !== latest) {
        // Another photo (or none) came while this one decoded: it was never on screen.
        for (const url of [nextSmall, nextLarge]) URL.revokeObjectURL(url)
        return
      }
      next = { path: photo.path, large: nextLarge, small: nextSmall }
    }
    const before = [large.value, small.value]
    held = keepers
    path.value = next?.path ?? null
    large.value = next?.large ?? null
    small.value = next?.small ?? null
    for (const url of before) if (url) setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS)
  }

  async function keep(memberId: string, photo: CachedAvatar | null) {
    try {
      await cache().write(memberId, photo)
    } catch {
      // No room or no IndexedDB: shown now, downloaded again next time.
    }
  }

  let loadedFor: string | null = null
  let loading: Promise<void> | null = null

  // Another member (or nobody): her photo goes from the screen at once.
  watch(
    () => session.member?.id ?? null,
    (now, before) => {
      if (now === before) return
      loadedFor = null
      error.value = null
      void show(null)
    },
  )

  /** The device's copy first, then the account's current photo (online). */
  function load(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && loadedFor === member)) return loading ?? Promise.resolve()
    loading ??= (async () => {
      if (!path.value) {
        const kept = await cache().read(member).catch(() => null)
        if (kept && member === session.member?.id && !path.value) await show(kept)
      }
      const r = repo()
      if (!r || !isOnline()) return
      const current = await r.current()
      if (current.error || member !== session.member?.id) return
      loadedFor = member
      const next = current.data.path
      if (next === path.value) return
      if (!next) {
        await show(null)
        return void (await keep(member, null))
      }
      const files = await r.download(next)
      if (member !== session.member?.id) return
      if (files.error) {
        // Gone from the bucket: initials. Anything else: what was shown stays, asked again next time.
        if (files.error !== 'missing') return void (loadedFor = null)
        await show(null)
        return void (await keep(member, null))
      }
      const photo = { path: next, ...files.data }
      await show(photo)
      await keep(member, photo)
    })().finally(() => (loading = null))
    return loading
  }

  /** Uploads a new photo (made by encodeAvatar) and shows it; true when it was saved. */
  async function save(files: AvatarFiles): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || saving.value) return false
    saving.value = true
    error.value = null
    try {
      const result = await r.save(files)
      if (result.error) {
        error.value = result.error
        return false
      }
      if (member !== session.member?.id) return false
      const photo = { path: result.data.path!, large: files.large, small: files.small }
      await show(photo)
      loadedFor = member
      await keep(member, photo)
      return true
    } finally {
      saving.value = false
    }
  }

  /** Back to the initials; true when it was done. */
  async function remove(): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || saving.value) return false
    saving.value = true
    error.value = null
    try {
      const result = await r.remove()
      if (result.error) {
        error.value = result.error
        return false
      }
      if (member !== session.member?.id) return false
      await show(null)
      loadedFor = member
      await keep(member, null)
      return true
    } finally {
      saving.value = false
    }
  }

  function clearError() {
    error.value = null
  }

  return { path, large, small, saving, error, load, save, remove, clearError }
})
