import { defineStore } from 'pinia'
import { createSocial, READERS_PAGE, type BookReader, type ReadersCursor, type Social } from '~/data/social'
import { useSessionStore } from '~/stores/session'
import { mergeReaders, READERS_SHOWN, readersWithout } from '~/utils/bookReaders'

/**
 * Readers on a Book's page (social v2a, contract §1.5): the members she follows who hold the Book's work, read
 * when the Book's page shows (`load`, the first `READERS_SHOWN`) and, for *See all*, in pages (`loadAll`,
 * `loadMore`). Online only: offline, or on a refusal, the last list loaded for this Book in the session stays on
 * screen, and with none there is nothing to show, never an error. Nothing is kept on the device: signing out or
 * another member signing in forgets it, and so does a change of relation (a member who leaves her circle goes from
 * every list at once, `dropMember`; a follow or an accepted request makes every list stale, so the next view asks).
 *
 * Per Book: `top` (what the section shows), `total` (how many in all), `all` (the sheet's rows, paged).
 */
type PerBook = {
  top: BookReader[]
  total: number
  /** Asked at least once and answered. */
  loaded: boolean
  /** The sheet's rows, newest page last; `next` the keyset of the page after them (null: the end). */
  all: BookReader[]
  next: ReadersCursor | null
  allLoaded: boolean
}

const fresh = (): PerBook => ({ top: [], total: 0, loaded: false, all: [], next: null, allLoaded: false })

export const useBookReadersStore = defineStore('bookReaders', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: Social | null = null
  function repo(): Social | null {
    if (!backend) return null
    repository ??= createSocial(backend, { online: isOnline })
    return repository
  }

  const books = ref<Record<string, PerBook>>({})
  /** Which Books are being read now (the section's placeholder). */
  const loading = ref<Record<string, boolean>>({})
  const loadingMore = ref<Record<string, boolean>>({})
  /** Bumped when the member changes or the circle moved: an answer that began before it is thrown away. */
  let generation = 0

  const of = (book: string): PerBook => books.value[book] ?? fresh()
  function patch(book: string, change: Partial<PerBook>) {
    books.value = { ...books.value, [book]: { ...of(book), ...change } }
  }

  /** Asks for the Book's first readers. A refusal or no connection keeps what the session already had. */
  async function load(book: string): Promise<void> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || !isOnline() || loading.value[book]) return
    const run = generation
    loading.value = { ...loading.value, [book]: true }
    const answer = await r.bookReaders(book, null, READERS_SHOWN)
    loading.value = { ...loading.value, [book]: false }
    if (run !== generation || member !== session.member?.id) return
    if (answer.error) return
    patch(book, { top: answer.data.items, total: answer.data.total, loaded: true })
  }

  /** The sheet opens: its rows are asked from the start, so it never shows an older list than the section. */
  async function loadAll(book: string): Promise<void> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || !isOnline() || loadingMore.value[book]) return
    const run = generation
    loadingMore.value = { ...loadingMore.value, [book]: true }
    const answer = await r.bookReaders(book, null, READERS_PAGE)
    loadingMore.value = { ...loadingMore.value, [book]: false }
    if (run !== generation || member !== session.member?.id || answer.error) return
    patch(book, { all: answer.data.items, next: answer.data.next, allLoaded: true, total: answer.data.total })
  }

  /** The next page of the sheet. */
  async function loadMore(book: string): Promise<void> {
    const r = repo()
    const member = session.member?.id
    const have = of(book)
    if (!r || !member || !isOnline() || !have.next || loadingMore.value[book]) return
    const run = generation
    loadingMore.value = { ...loadingMore.value, [book]: true }
    const answer = await r.bookReaders(book, have.next, READERS_PAGE)
    loadingMore.value = { ...loadingMore.value, [book]: false }
    if (run !== generation || member !== session.member?.id || answer.error) return
    patch(book, { all: mergeReaders(of(book).all, answer.data.items), next: answer.data.next, total: answer.data.total })
  }

  /** A member left her circle (unfollow, block, remove as follower): her row goes from every list, and an answer on its way is thrown away. */
  function dropMember(id: string) {
    generation++
    books.value = Object.fromEntries(
      Object.entries(books.value).map(([book, per]) => {
        const top = readersWithout(per.top, id)
        const all = readersWithout(per.all, id)
        const was = top.length !== per.top.length || all.length !== per.all.length
        return [book, { ...per, top, all, total: was ? Math.max(0, per.total - 1) : per.total }]
      }),
    )
  }

  /** The circle changed (a follow, an accepted request): what was read may be missing someone, the next view asks again. */
  function stale() {
    generation++
    books.value = Object.fromEntries(Object.entries(books.value).map(([book, per]) => [book, { ...per, loaded: false, allLoaded: false, next: null }]))
  }

  function reset() {
    generation++
    books.value = {}
    loading.value = {}
    loadingMore.value = {}
  }

  watch(
    () => session.member?.id ?? null,
    (now, before) => now !== before && reset(),
  )

  return { of, load, loadAll, loadMore, dropMember, stale, reset, loading, loadingMore, books }
})
