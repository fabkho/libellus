import { defineStore } from 'pinia'
import { createBookGenres, type BookGenresRepository, type EntryGenres } from '~/data/enrich/bookGenres'
import { readDeviceGenres, saveDeviceGenres } from '~/data/enrich/deviceGenres'
import type { EnrichErrorCode } from '~/data/enrich/result'
import type { GenreId } from '~/data/enrich/genres'
import { useLibraryViewStore } from '~/stores/libraryView'
import { useSessionStore } from '~/stores/session'

/**
 * The genres of the member's Books (issue #168, data/enrich/bookGenres.ts): hers where she
 * corrected them for her entry, else the computed ones. One answer feeds the Book page's chips,
 * the Library's genre filter (`provideGenres`, the seam of stores/libraryView.ts) and the
 * Profile's figures (data/enrich/genreFigures.ts).
 *
 * `load()` reads every entry of her Library at once (`library_genres`); the device keeps the
 * last answer (`libellus.genres`) and the store reads it back when it is set up, so the chips,
 * the filter and the figures stand offline and at the first frame, and the load that follows only
 * refreshes them. A Book that is not in her Library (a search result, a Catalogue Book) is asked
 * for on its own (`loadBook`) and only held for the session. Her corrections (`set`, `reset`)
 * need the connection; the answer replaces what was held, and the device copy follows. Signing
 * out (or another member signing in) forgets all of it.
 */
export const useGenresStore = defineStore('genres', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const libraryView = useLibraryViewStore()

  let repository: BookGenresRepository | null = null
  function repo(): BookGenresRepository | null {
    if (!backend) return null
    repository ??= createBookGenres(backend, { online: isOnline })
    return repository
  }

  type Held = { entries: ReadonlyMap<string, EntryGenres>; books: ReadonlyMap<string, { genres: readonly GenreId[]; overridden: boolean }>; loaded: boolean }
  const none: Held = { entries: new Map(), books: new Map(), loaded: false }
  // Replaced as a whole on every change, so what reads it (the filter, the figures) follows.
  const held = shallowRef<Held>(none)
  const loadError = ref<EnrichErrorCode | null>(null)

  function hold(entries: readonly EntryGenres[], extra: Held['books'] = new Map()) {
    const books = new Map(extra)
    for (const e of entries) books.set(e.bookId, { genres: e.genres, overridden: e.overridden })
    held.value = { entries: new Map(entries.map((e) => [e.entryId, e])), books, loaded: true }
    // The filter finds a Book's genres here; until some are known there is nothing to filter by.
    libraryView.provideGenres(lookup)
  }

  /** Whether her Library's genres are known (the device's copy, or asked for). */
  const loaded = computed(() => held.value.loaded)
  /** Whether any of her Library's entries has a genre: with none (a new account, a Book nobody knows) the screens leave genres out. */
  const any = computed(() => [...held.value.entries.values()].some((e) => e.genres.length > 0))

  /** A Book's genres: undefined while they are not known. */
  function lookup(bookId: string): readonly GenreId[] | undefined {
    return held.value.books.get(bookId)?.genres
  }
  /** The genres of a Library entry, by its id (the Profile's figures). */
  function ofEntry(entryId: string): readonly GenreId[] | undefined {
    return held.value.entries.get(entryId)?.genres
  }
  /** Whether the genres of this Book are hers. */
  function overridden(bookId: string): boolean {
    return held.value.books.get(bookId)?.overridden ?? false
  }

  function save() {
    const member = session.member?.id
    if (import.meta.client && member) saveDeviceGenres(window.localStorage, member, [...held.value.entries.values()])
  }

  let loading: Promise<void> | null = null
  /** Reads the genres of her whole Library (again). Offline it keeps what the device has. */
  function load(): Promise<void> {
    loading ??= (async () => {
      const r = repo()
      const member = session.member?.id
      if (!r || !member) return
      if (!isOnline()) {
        if (!held.value.loaded) loadError.value = 'offline'
        return
      }
      const result = await r.library()
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        return
      }
      loadError.value = null
      // What was asked for on its own (a Book outside her Library) stays.
      const before = held.value
      const was = new Set([...before.entries.values()].map((e) => e.bookId))
      hold(result.data, new Map([...before.books].filter(([id]) => !was.has(id))))
      save()
    })().finally(() => (loading = null))
    return loading
  }

  /** Asks for one Book's genres (a Catalogue Book, in her Library or not). */
  async function loadBook(bookId: string): Promise<void> {
    const r = repo()
    if (!r || !isOnline()) return
    const member = session.member?.id
    const result = await r.forBook(bookId)
    if (result.error || member !== session.member?.id) return
    const now = held.value
    const books = new Map(now.books)
    books.set(bookId, result.data)
    // A Book of her Library keeps its entry's row in step.
    const entries = new Map(now.entries)
    for (const [id, e] of entries) if (e.bookId === bookId) entries.set(id, { ...e, ...result.data })
    held.value = { entries, books, loaded: now.loaded }
    if (now.loaded || entries.size) libraryView.provideGenres(lookup)
    save()
  }

  /** Her genres for an entry; null when saved, else why not. */
  async function set(entry: { id: string; bookId: string }, genres: readonly GenreId[]): Promise<EnrichErrorCode | null> {
    const r = repo()
    if (!r) return 'unknown'
    const result = await r.set(entry.id, genres)
    if (result.error) return result.error
    keep(entry, result.data, true)
    return null
  }

  /** Back to the computed genres; null when done, else why not. */
  async function reset(entry: { id: string; bookId: string }): Promise<EnrichErrorCode | null> {
    const r = repo()
    if (!r) return 'unknown'
    const result = await r.reset(entry.id)
    if (result.error) return result.error
    keep(entry, result.data, false)
    return null
  }

  /** The genres an entry has now, as the database answered, held at once and kept on the device. */
  function keep(entry: { id: string; bookId: string }, genres: GenreId[], hers: boolean) {
    const now = held.value
    const row: EntryGenres = { entryId: entry.id, bookId: entry.bookId, genres, overridden: hers }
    const entries = new Map(now.entries).set(entry.id, row)
    const books = new Map(now.books).set(entry.bookId, { genres, overridden: hers })
    held.value = { entries, books, loaded: true }
    libraryView.provideGenres(lookup)
    save()
  }

  function forget() {
    held.value = none
    loadError.value = null
    libraryView.provideGenres(null)
  }

  /** Puts back what this device saw last, if it is this member's. */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member || held.value.loaded) return
    const saved = readDeviceGenres(window.localStorage, member)
    if (saved) hold(saved)
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      forget()
      restore()
    },
  )
  restore()

  // Back online with nothing known: ask now.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { loadError, loaded, any, lookup, ofEntry, overridden, load, loadBook, set, reset, forget }
})
