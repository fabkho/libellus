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
 * screen. Signing out (or another member signing in) forgets it.
 */
export const useShelfStore = defineStore('shelf', () => {
  const session = useSessionStore()
  const library = useLibraryStore()
  const config = useRuntimeConfig().public
  /** The published library file (runtimeConfig.public.regal.librarySrc): the owner's. */
  const src = String((config.regal as { librarySrc?: string } | undefined)?.librarySrc ?? '')

  // Only in a build with Regal (LIBELLUS_REGAL=1, regal.config.ts): without it there is nothing to draw the shelf.
  const withRegal = useAppConfig().regal === true

  /** Whether this member has Your shelf: everyone signed in, in a build with Regal. */
  const available = computed(() => withRegal && !!session.member)
  /** The owner's shelf is his published file; everyone else's is her Library, on the device. */
  const source = computed<'published' | 'member'>(() =>
    isShelfOwner(session.member?.id, config.shelfOwnerId) && src !== '' ? 'published' : 'member',
  )

  // ------------------------------------------------------------ a member's

  /**
   * Her shelf's library document, for Regal's `library` prop: rebuilt only when
   * a list changes (the lists keep their identity across refreshes that change
   * nothing), so Regal is handed the same object and draws nothing again. A
   * watch, not a computed: the blurbs the device keeps are read without being
   * tracked, a description arriving later is no reason to rebuild.
   */
  const document = shallowRef<RegalLibraryFile | null>(null)
  watch(
    [available, source, () => library.loaded, () => library.reading, () => library.finished],
    ([has, from, loaded, reading, finished]) => {
      document.value =
        has && from === 'member' && loaded
          ? memberShelfDocument([...reading, ...finished], {
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              descriptionOf: (book) => library.descriptionOf(book),
            })
          : null
    },
    { immediate: true },
  )
  const memberShelf = computed<Shelf | null>(() => (document.value ? shelfOf(document.value) : null))

  // ------------------------------------------------------------ the owner's

  let repository: ShelfRepository | null = null
  const published = ref<Shelf | null>(null)
  const publishedError = ref<ShelfError | null>(null)
  const publishedLoading = ref(false)
  let pending: Promise<void> | null = null

  function loadPublished(): Promise<void> {
    pending ??= (async () => {
      publishedLoading.value = true
      repository ??= createShelf({ src, fetch: (...args) => globalThis.fetch(...args), online: isOnline })
      const member = session.member?.id
      const result = await repository.load()
      publishedLoading.value = false
      if (member !== session.member?.id) return
      if (result.error) {
        publishedError.value = result.error
        // Offline is no fault; a file that cannot be had or read is.
        if (result.error !== 'offline') reportError('shelf', `library file ${result.error}`)
        return
      }
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
    if (source.value === 'published') return publishedError.value
    if (library.loaded || !library.loadError) return null
    return isOnline() ? 'unreachable' : 'offline'
  })
  const loading = computed(() => publishedLoading.value)

  /** Gets the shelf ready: the owner's file, or a member's Library (unless it is fresh). */
  function load(): Promise<void> {
    if (!available.value) return Promise.resolve()
    if (source.value === 'published') return loadPublished()
    return library.load({ ifStale: true })
  }

  /** The Books finished in a year, newest first (a year in review's stack). */
  const readIn = (year: number) => booksReadIn(shelf.value?.books ?? [], year)

  function reset() {
    published.value = null
    publishedError.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online with the owner's file waiting on it: load without a tap (a member's Library reloads itself).
  const online = useOnline()
  watch(online, (now) => {
    if (now && publishedError.value === 'offline') void load()
  })

  return { available, source, src, document, shelf, loadError, loading, load, readIn, reset }
})
