import { defineStore } from 'pinia'
import type { RegalLibraryFile } from '~/data/export/regalLibraryFile'
import { memberShelfDocument } from '~/data/memberShelf'
import { booksReadIn, createShelf, shelfOf, type Shelf, type ShelfError, type ShelfRepository } from '~/data/shelf'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/**
 * Your shelf (#23, data/shelf.ts): every signed-in member's, in a build with
 * Regal (LIBELLUS_REGAL=1, regal.config.ts); nobody's in a build without it.
 *
 * Whose Books, from where (`source`):
 * - `member`, everyone: her own Library, built on the device from the lists the
 *   app keeps (stores/library.ts, with its device copy, so offline too) into a
 *   Regal library document (`document`, data/memberShelf.ts) that Regal's
 *   components are handed (`library`). Nothing fetched for it, nothing written
 *   or sent anywhere: a member's shelf is never public.
 * - `published`, the owner with a library file configured (`shelfOwnerId`,
 *   `regal.librarySrc`): the file his portfolio shows, as before (its paid
 *   Spine and back art; the `shelf_publish` chain writes it), fetched and read
 *   here for the count, a year's Books and the loading pile; Regal reads it
 *   again itself (the browser answers that from its cache).
 *
 * `shelf` is the same for both: the Books as the app needs them. Loaded when a
 * shelf screen opens; a published file that fails keeps the last shelf on
 * screen, and one that fails (and was never had) falls back to the `member` shelf, silently
 * (logged once), the file tried again on the next `load` (the retry goes past the browser's cache).
 * Signing out (or another member signing in) forgets it.
 */
/** Longest a member's shelf waits for its blurbs before it shows without them (ms). */
const BLURB_WAIT = 3000

export const useShelfStore = defineStore('shelf', () => {
  const session = useSessionStore()
  const library = useLibraryStore()
  const config = useRuntimeConfig().public
  /** The published library file (runtimeConfig.public.regal.librarySrc): the owner's. */
  const src = String((config.regal as { librarySrc?: string } | undefined)?.librarySrc ?? '')

  // Only in a build with Regal (LIBELLUS_REGAL=1, regal.config.ts): without it there is nothing to draw the shelf.
  const withRegal = useAppConfig().regal === true

  const published = ref<Shelf | null>(null)
  const publishedError = ref<ShelfError | null>(null)

  /** Whether this member has Your shelf: everyone signed in, in a build with Regal. */
  const available = computed(() => withRegal && !!session.member)
  const hasFile = computed(() => isShelfOwner(session.member?.id, config.shelfOwnerId) && src !== '')
  /**
   * The owner's shelf is his published file; everyone else's is her Library, on the device. When the
   * owner's file fails (and none was had before), his is built from his Library like everyone's:
   * the file failing is no reason to show an error while there is a shelf on the device.
   */
  const source = computed<'published' | 'member'>(() =>
    hasFile.value && !(publishedError.value && !published.value) ? 'published' : 'member',
  )

  // ------------------------------------------------------------ a member's

  /**
   * Her shelf's library document, for Regal's `library` prop. Built once a shelf screen asks for it
   * (`load`), and again when a list changes (the lists keep their identity across refreshes that
   * change nothing, so Regal is handed the same object and draws nothing again). Each build waits
   * for the blurbs of her Books first (`ensureDescriptions`: the lists leave them out; the first
   * time on a device they are asked for, after that the device has them), so every back is
   * printed with its blurb. A slow answer is not waited for past BLURB_WAIT: the Books come
   * without, and once more when the blurbs are in. Until the first build there is no document,
   * and the screens show no row (never the published file in its place).
   */
  const document = shallowRef<RegalLibraryFile | null>(null)
  /** The hosts her shelf's covers are drawn with: direct, as the shelf asked before own covers (docs/plans/owned-covers.md §5). */
  const coverHosts = { ...useCoverHosts(), proxy: false }
  /** A shelf screen asked for it (`load`): until then nothing is built. */
  const wanted = ref(false)
  let builds = 0
  function buildDocument(): RegalLibraryFile {
    return memberShelfDocument([...library.reading, ...library.finished], {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      descriptionOf: (book) => library.descriptionOf(book),
      covers: coverHosts,
      origin: useRequestURL().origin,
    })
  }
  watch(
    [available, source, wanted, () => library.loaded, () => library.reading, () => library.finished],
    ([has, from, want, loaded]) => {
      const build = ++builds
      if (!has || from !== 'member') {
        document.value = null
        return
      }
      if (!want || !loaded) return
      const current = () => build === builds
      const late = setTimeout(() => {
        if (current()) document.value = buildDocument()
      }, BLURB_WAIT)
      void library
        .ensureDescriptions()
        .catch(() => undefined)
        .then(() => {
          clearTimeout(late)
          if (current()) document.value = buildDocument()
        })
    },
    { immediate: true },
  )
  const memberShelf = computed<Shelf | null>(() => (document.value ? shelfOf(document.value) : null))

  // ------------------------------------------------------------ the owner's

  let repository: ShelfRepository | null = null
  let pending: Promise<void> | null = null
  /** The failure already reported for this member, so a retry that fails the same way is not logged again. */
  let reported: string | null = null

  /** Fetches the file; after a failure (`publishedError`) past the browser's cache, which may hold the failure. */
  function loadPublished(): Promise<void> {
    pending ??= (async () => {
      repository ??= createShelf({ src, fetch: (...args) => globalThis.fetch(...args), online: isOnline })
      const member = session.member?.id
      const result = await repository.load({ fresh: publishedError.value !== null })
      if (member !== session.member?.id) return
      if (result.error) {
        publishedError.value = result.error
        // Offline is no fault; a file that cannot be had or read is. Logged once: she has her own shelf meanwhile.
        if (result.error !== 'offline' && reported !== result.error) {
          reported = result.error
          reportError('shelf', `library file ${result.error}; showing her own Library's shelf`)
        }
        return
      }
      reported = null
      publishedError.value = null
      published.value = result.data
    })().finally(() => (pending = null))
    return pending
  }

  // ------------------------------------------------------------ either

  const shelf = computed<Shelf | null>(() => {
    if (!available.value) return null
    return source.value === 'published' ? published.value : memberShelf.value
  })
  /** Why there is no shelf yet: the owner's file could not be had; a member's Library could not be loaded. */
  const loadError = computed<ShelfError | null>(() => {
    if (!available.value) return null
    if (source.value === 'published') return null
    if (library.loaded || !library.loadError) return null
    return isOnline() ? 'unreachable' : 'offline'
  })
  /** A `load` on its way: the file's fetch or the Library's lists (a retry's button shows it). */
  const loadsOnTheWay = ref(0)
  const loading = computed(() => loadsOnTheWay.value > 0)

  /**
   * Gets the shelf ready: the owner's file, or a member's Library (unless it is fresh). The owner's
   * file failing falls back to her Library, which is loaded then; the next call tries the file
   * again (the retry), and the shelf stays the Library's until it comes.
   */
  function load(): Promise<void> {
    if (!available.value) return Promise.resolve()
    loadsOnTheWay.value++
    return prepare().finally(() => loadsOnTheWay.value--)
  }
  function prepare(): Promise<void> {
    if (!hasFile.value) {
      wanted.value = true
      return library.load({ ifStale: true })
    }
    return loadPublished().then(() => {
      if (!publishedError.value) return
      wanted.value = true
      return library.load({ ifStale: true })
    })
  }

  /** The Books finished in a year, newest first (a year in review's stack). */
  const readIn = (year: number) => booksReadIn(shelf.value?.books ?? [], year)

  function reset() {
    wanted.value = false
    document.value = null
    published.value = null
    publishedError.value = null
    reported = null
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online with the owner's file waiting on it: load without a tap (a member's Library reloads itself).
  const online = useOnline()
  watch(online, (now) => {
    if (now && publishedError.value !== null) void load()
  })

  return { available, source, src, document, shelf, loadError, loading, load, readIn, reset }
})
