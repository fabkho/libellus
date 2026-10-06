import { defineStore } from 'pinia'
import { booksReadIn, createShelf, type Shelf, type ShelfError, type ShelfRepository } from '~/data/shelf'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useSessionStore } from '~/stores/session'

/**
 * Your shelf (#23, data/shelf.ts): whether the signed-in member is the owner,
 * and the owner's published library file as the Profile card, a year in
 * review and the shelf's loading pile need it (Regal's components read the
 * file again themselves; the browser answers that second fetch from its cache).
 * Everyone else never gets past `isOwner`: nothing is fetched, nothing shown.
 * Loaded when one of those screens opens; a load that fails keeps the last
 * shelf on screen. Signing out (or another member signing in) forgets it.
 */
export const useShelfStore = defineStore('shelf', () => {
  const session = useSessionStore()
  const config = useRuntimeConfig().public
  /** The library file (runtimeConfig.public.regal.librarySrc, the one Regal's components show). */
  const src = String((config.regal as { librarySrc?: string } | undefined)?.librarySrc ?? '')

  // Only in a build with Regal (LIBELLUS_REGAL=1, regal.config.ts): without it there is nothing to draw the shelf.
  const withRegal = useAppConfig().regal === true

  const isOwner = computed(() => withRegal && isShelfOwner(session.member?.id, config.shelfOwnerId) && src !== '')

  let repository: ShelfRepository | null = null
  const shelf = ref<Shelf | null>(null)
  const loadError = ref<ShelfError | null>(null)
  const loading = ref(false)
  let pending: Promise<void> | null = null

  function load(): Promise<void> {
    if (!isOwner.value) return Promise.resolve()
    pending ??= (async () => {
      loading.value = true
      repository ??= createShelf({ src, fetch: (...args) => globalThis.fetch(...args), online: isOnline })
      const member = session.member?.id
      const result = await repository.load()
      loading.value = false
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        // Offline is no fault; a file that cannot be had or read is.
        if (result.error !== 'offline') reportError('shelf', `library file ${result.error}`)
        return
      }
      loadError.value = null
      shelf.value = result.data
    })().finally(() => (pending = null))
    return pending
  }

  /** The Books finished in a year, newest first (a year in review's stack). */
  const readIn = (year: number) => booksReadIn(shelf.value?.books ?? [], year)

  function reset() {
    shelf.value = null
    loadError.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online with the shelf waiting on it: load without a tap.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { isOwner, src, shelf, loadError, loading, load, readIn, reset }
})
