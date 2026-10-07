import { defineStore } from 'pinia'
import {
  bookCardPath,
  createReadingPages,
  readingPagePath,
  type ReadingPageErrorCode,
  type ReadingPages,
  type ReadingPageSection,
  type ReadingPageSettings,
  type SharedBook,
} from '~/data/readingPage'
import { useSessionStore } from '~/stores/session'

/**
 * Sharing, her side (issue #171, data/readingPage.ts): her reading page's
 * settings (Profile → Share) and the Books she shares as cards (a Book page's
 * options → Share). Read when either opens, once per sign-in; every change is
 * written at once (no Save) and the settings are what the database answered.
 * Writes wait for a connection (the repository refuses them offline, the
 * controls say Offline). Signing out, or another member signing in, forgets it.
 */
export const useSharingStore = defineStore('sharing', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: ReadingPages | null = null
  function repo(): ReadingPages | null {
    if (!backend) return null
    repository ??= createReadingPages(backend, { online: isOnline })
    return repository
  }

  /** Her settings; null until known. */
  const settings = ref<ReadingPageSettings | null>(null)
  const loadError = ref<ReadingPageErrorCode | null>(null)
  /** A write on its way: the controls wait for it. */
  const busy = ref(false)
  const error = ref<ReadingPageErrorCode | null>(null)

  let loading: Promise<void> | null = null
  let loadedFor: string | null = null

  function load(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && loadedFor === member && settings.value)) return Promise.resolve()
    loading ??= (async () => {
      const r = repo()
      if (!r) return
      if (!isOnline()) {
        loadError.value = 'offline'
        return
      }
      const result = await r.settings()
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        return
      }
      loadError.value = null
      settings.value = result.data
      loadedFor = member
    })().finally(() => (loading = null))
    return loading
  }

  /** One write that answers with the settings. True when it went through. */
  async function write(run: (r: ReadingPages) => ReturnType<ReadingPages['setOn']>): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || busy.value) return false
    busy.value = true
    error.value = null
    const result = await run(r).finally(() => (busy.value = false))
    if (member !== session.member?.id) return false
    if (result.error) {
      error.value = result.error
      return false
    }
    settings.value = result.data
    loadedFor = member
    return true
  }

  const setOn = (on: boolean) => write((r) => r.setOn(on))
  const renewLink = () => write((r) => r.renewLink())
  const setSection = (section: ReadingPageSection, on: boolean) => write((r) => r.setSections({ [section]: on }))

  /** The page's address on this origin, and whole (for the Share sheet and the clipboard); null while it is off. */
  const pagePath = computed(() => (settings.value?.token ? readingPagePath(settings.value.token) : null))
  const pageUrl = computed(() => (pagePath.value ? absolute(pagePath.value) : null))

  /** A Book card's whole address; null while the page is off. */
  function cardUrl(bookId: string): string | null {
    return settings.value?.token ? absolute(bookCardPath(settings.value.token, bookId)) : null
  }

  /** How she shared a Book (null: not as a card); read when its Share sheet opens. */
  async function sharedBook(bookId: string): Promise<SharedBook | null> {
    const result = await repo()?.sharedBook(bookId)
    return result?.data ?? null
  }

  /** Shares the Book as a card (with or without her review): its address, or null when refused (`error` says why). */
  async function shareBook(bookId: string, review: boolean): Promise<string | null> {
    const r = repo()
    if (!r || busy.value) return null
    busy.value = true
    error.value = null
    const result = await r.shareBook(bookId, review).finally(() => (busy.value = false))
    if (result.error) {
      error.value = result.error
      return null
    }
    return cardUrl(bookId)
  }

  function clearError() {
    error.value = null
  }

  function reset() {
    settings.value = null
    loadError.value = null
    error.value = null
    loadedFor = null
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online with her settings never read: read them now.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { settings, loadError, busy, error, load, setOn, renewLink, setSection, pagePath, pageUrl, cardUrl, sharedBook, shareBook, clearError, reset }
})

/** An address on this origin, whole (what a messenger needs). */
function absolute(path: string): string {
  return import.meta.client ? new URL(path, window.location.origin).href : path
}
