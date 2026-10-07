import { defineStore } from 'pinia'
import { createAuthors, type AuthorPage, type AuthorsRepository, type BookAuthor } from '~/data/enrich'
import { LIMITS, remembered } from '~/data/enrich/device'
import { useEnrichCopyStore } from '~/stores/enrichCopy'
import { useSessionStore } from '~/stores/session'

/**
 * loading: nothing to show yet · ready: the page · missing: no author has
 * that key · offline: never opened on this device and no connection ·
 * error: it could not be asked for.
 */
export type AuthorPagePhase = 'loading' | 'ready' | 'missing' | 'offline' | 'error'
export type AuthorPageState = { phase: AuthorPagePhase; page: AuthorPage | null }

/**
 * The author pages (`/author/<key>`, issue #167) and the linked authors of
 * Books (the Book page's author line, a list row's). A page opens at once from
 * the device's copy (stores/enrichCopy.ts) and refreshes behind it; one the
 * cache calls stale (older than 30 days, or its works never fetched) is asked
 * of the enrich function again, online only, then read once more.
 *
 * A list row asks for its Book's authors with `want`; the asks of one frame go
 * out as one call (`book_authors_for`), and a Book is asked once per session.
 */
export const useAuthorsStore = defineStore('authors', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const copy = useEnrichCopyStore()
  const nuxtApp = useNuxtApp()

  let repository: AuthorsRepository | null = null
  function authors(): AuthorsRepository | null {
    if (!backend) return null
    repository ??= createAuthors(backend, { online: isOnline })
    return repository
  }
  const language = () => String(nuxtApp.$i18n?.locale?.value ?? 'en')

  // ------------------------------------------------------------ the pages

  const pages = reactive(new Map<string, AuthorPageState>())
  const loading = new Map<string, Promise<void>>()
  /** Pages refreshed from the sources this session: asked once, however often the page opens. */
  const refreshed = new Set<string>()

  /** The page as it can be shown now: what was loaded this session, else the device's copy. */
  function page(key: string): AuthorPageState | null {
    const loaded = pages.get(key)
    if (loaded?.page) return loaded
    const saved = copy.data.authors[key]
    if (saved) return { phase: 'ready', page: saved }
    return loaded ?? null
  }

  function keep(key: string, data: AuthorPage) {
    pages.set(key, { phase: 'ready', page: data })
    copy.update((c) => ({ authors: remembered(c.authors, key, data, LIMITS.authors) }))
  }

  /** Asks for a page (again). What the device has shows while it comes. */
  function load(key: string): Promise<void> {
    const running = loading.get(key)
    if (running) return running
    const repo = authors()
    const shown = page(key)
    if (!repo) return Promise.resolve()
    if (!isOnline()) {
      if (!shown?.page) pages.set(key, { phase: 'offline', page: null })
      return Promise.resolve()
    }
    if (!shown) pages.set(key, { phase: 'loading', page: null })
    const member = session.member?.id
    const task = (async () => {
      const result = await repo.page(key, language())
      if (member !== session.member?.id) return
      if (result.error) {
        if (!page(key)?.page) pages.set(key, { phase: result.error === 'offline' ? 'offline' : 'error', page: null })
        return
      }
      if (!result.data) {
        pages.set(key, { phase: 'missing', page: null })
        return
      }
      keep(key, result.data)
      // Old or never fully fetched: the function asks the sources again (polite: once a session), then it is read again.
      if (result.data.stale && !refreshed.has(key)) {
        refreshed.add(key)
        const again = await repo.refresh(key)
        if (again.data && member === session.member?.id) {
          const fresh = await repo.page(key, language())
          if (fresh.data && member === session.member?.id) keep(key, fresh.data)
        }
      }
    })().finally(() => loading.delete(key))
    loading.set(key, task)
    return task
  }

  // ------------------------------------------------- a Book's linked authors

  /** The linked authors of a Book, as far as this device knows (undefined: not asked yet). */
  function ofBook(bookId: string): BookAuthor[] | undefined {
    return copy.data.bookAuthors[bookId]
  }

  const asked = new Set<string>()
  const pending = new Set<string>()
  let flushing: ReturnType<typeof setTimeout> | null = null

  /** A row wants its Book's authors: asked with the other rows of this moment, once a session. */
  function want(bookId: string) {
    if (asked.has(bookId) || !authors()) return
    pending.add(bookId)
    flushing ??= setTimeout(flush, 30)
  }

  async function flush() {
    flushing = null
    const repo = authors()
    const ids = [...pending]
    pending.clear()
    if (!repo || !ids.length || !isOnline()) return
    for (const id of ids) asked.add(id)
    const member = session.member?.id
    const result = await repo.forBooks(ids)
    if (result.error || member !== session.member?.id) {
      for (const id of ids) asked.delete(id)
      return
    }
    const found = result.data
    copy.update((c) => {
      const bookAuthors = { ...c.bookAuthors }
      for (const id of ids) bookAuthors[id] = found[id] ?? []
      return { bookAuthors }
    })
  }

  /** The Book page's authors: asked every time the page opens (one Book, one call). */
  async function loadForBook(bookId: string) {
    const repo = authors()
    if (!repo || !isOnline()) return
    const member = session.member?.id
    const result = await repo.forBook(bookId)
    if (result.error || member !== session.member?.id) return
    asked.add(bookId)
    copy.update((c) => ({ bookAuthors: { ...c.bookAuthors, [bookId]: result.data } }))
  }

  function reset() {
    pages.clear()
    loading.clear()
    refreshed.clear()
    asked.clear()
    pending.clear()
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  return { page, load, ofBook, want, loadForBook, reset }
})
